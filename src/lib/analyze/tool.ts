import { z } from "zod";
import { analyzeSite } from "./analyze.ts";
import { condenseSpec, type Spec } from "./condense.ts";
import { AnalyzeError } from "./guard.ts";

/**
 * The analyzeSite chat tool. The stored output holds the whole measured spec (the comparison needs
 * it) and the addresses of the screenshots; what the model reads each turn is a trimmed copy plus
 * the pictures, made in toModelOutput. Older analyses are dropped from the conversation so that a
 * long project does not pay for them on every message.
 */

export type AnalyzeOutput = { ok: boolean; message: string; url?: string; spec?: Spec; shots?: string[]; trimmed?: string[] };

/** Analyses one request may start. Each opens a real browser and takes 10 to 30 seconds. */
export const MAX_ANALYSES_PER_REQUEST = 2;
/** Screenshots are sent to the model only while the analysis is recent; later turns work from the numbers. */
export const IMAGES_FOR_MESSAGES = 8;
const MAX_IMAGES = 8;
const SPEC_CHARS = 30_000;

type Deps = {
  userId: string;
  upload: (args: { path: string; bytes: Uint8Array; mediaType: string }) => Promise<string>;
  analyze?: typeof analyzeSite;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  newId?: () => string;
};

export function createAnalyzeTool(deps: Deps) {
  const analyze = deps.analyze ?? analyzeSite;
  const fetcher = deps.fetcher ?? fetch;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  let used = 0;

  return {
    description:
      "Åpner en offentlig nettside i en ekte nettleser (1280 px bredde), måler layouten og gir deg skrifter, farger, seksjoner (topp, høyde, padding), hver tekstblokk og hvert bilde med posisjon og størrelse, kort og rutenett, faste elementer og skjermbilder. Bruk den når brukeren vil lage noe i samme stil som, eller en kopi av, en eksisterende side. Bare for brukerens egne sider eller sider de har rett til å gjenskape. Tar 10–30 sekunder.",
    inputSchema: z.object({ url: z.string().min(4).max(500).describe("Adressen til siden, for eksempel https://www.eksempel.no/") }),
    execute: async ({ url }: { url: string }): Promise<AnalyzeOutput> => {
      if (used >= MAX_ANALYSES_PER_REQUEST) {
        return { ok: false, message: `Grensen på ${MAX_ANALYSES_PER_REQUEST} analyser per melding er nådd. Bruk målene du allerede har.` };
      }
      used++;
      try {
        const { spec, shots, finalUrl } = await analyze(url);
        const settled = await Promise.allSettled(
          shots.map((bytes) => deps.upload({ path: `${deps.userId}/refs/${newId()}.jpg`, bytes, mediaType: "image/jpeg" })),
        );
        const urls = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        const { steps } = condenseSpec(spec, SPEC_CHARS);
        return {
          ok: true,
          message: `Målte ${finalUrl}: ${spec.sections.length} seksjoner, ${spec.docH} px høy, ${urls.length} skjermbilder.`,
          url: finalUrl,
          spec,
          shots: urls,
          trimmed: steps,
        };
      } catch (error) {
        return { ok: false, message: error instanceof AnalyzeError ? error.message : "Kunne ikke analysere siden akkurat nå. Prøv igjen om litt." };
      }
    },
    /** What the model sees: the trimmed spec as text, and the screenshots as pictures. */
    toModelOutput: async ({ output }: { output: AnalyzeOutput }) => {
      if (!output?.ok || !output.spec) return { type: "text" as const, value: output?.message ?? "Analysen mislyktes." };
      const { json, steps } = condenseSpec(output.spec, SPEC_CHARS);
      const intro = [
        `Måling av ${output.url} på ${output.spec.vw} px bredde. Alle tall er piksler. Seksjonene har "top" (fra sidens topp) og "h" (høyde); hver blokk har "y" (fra seksjonens topp), "x", "w", "h" og skriftdata (fs størrelse, fw vekt, lh linjehøyde, ls bokstavavstand, c farge, ff skrift, grad = gradienttekst).`,
        "Merk: målt uten rullefelt, så en ekte nettleser med rullefelt gir ca. 15 px smalere innhold.",
        steps.length ? `For å spare plass er målingen forkortet (${steps.join("; ")}).` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const parts: ({ type: "text"; text: string } | { type: "file"; mediaType: string; data: { type: "data"; data: string } })[] = [
        { type: "text", text: `${intro}\n${json}` },
      ];
      for (const url of (output.shots ?? []).slice(0, MAX_IMAGES)) {
        try {
          const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) continue;
          parts.push({ type: "file", mediaType: "image/jpeg", data: { type: "data", data: Buffer.from(await response.arrayBuffer()).toString("base64") } });
        } catch {
          /* a missing screenshot only costs some detail */
        }
      }
      return { type: "content" as const, value: parts };
    },
  };
}

type Part = { type: string; state?: string; output?: AnalyzeOutput; [key: string]: unknown };
type Msg = { role: string; parts: Part[]; [key: string]: unknown };

/**
 * Keeps only the newest analysis in full. Older ones are replaced by a one-line note, and the
 * newest loses its screenshots once the conversation has moved on.
 */
export function trimOldAnalyses<T extends { role: string; parts: unknown[] }>(messages: T[]): T[] {
  const found: { m: number; p: number }[] = [];
  (messages as unknown as Msg[]).forEach((message, m) => {
    if (message.role !== "assistant") return;
    message.parts.forEach((part, p) => {
      if (part.type === "tool-analyzeSite" && part.state === "output-available" && part.output?.spec) found.push({ m, p });
    });
  });
  if (found.length === 0) return messages;
  const last = found[found.length - 1]!;
  const next = (messages as unknown as Msg[]).map((message) => ({ ...message, parts: [...message.parts] }));
  for (const { m, p } of found) {
    const part = next[m]!.parts[p]!;
    if (m === last.m && p === last.p) {
      if (messages.length - m > IMAGES_FOR_MESSAGES) next[m]!.parts[p] = { ...part, output: { ...part.output!, shots: [] } };
    } else {
      next[m]!.parts[p] = { ...part, output: { ok: true, message: "En tidligere analyse er utelatt for å spare plass." } };
    }
  }
  return next as unknown as T[];
}
