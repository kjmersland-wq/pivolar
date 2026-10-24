import { PROTECTED_PATHS, type FileMap } from "../files.ts";
import { readBrand } from "../publish/brand.ts";
import type { Finding } from "./quality.ts";

/**
 * SEO check: reads /brand.json and the page markup and lists what search engines and link
 * previews depend on. The title, description, share image, canonical address, sitemap and
 * structured data are produced when the project is published (see publish/project.ts), so this
 * only looks at what the author controls: the text and the markup.
 */

export const SEO_LIMITS = { descriptionMin: 70, descriptionMax: 160, titleMax: 60 };

const CODE = /\.(tsx|jsx)$/;
const KEEP_LOOK = "Utseendet skal være likt etterpå: bare tekst og markup som trengs for søk og deling endres.";

const sources = (files: FileMap) => Object.entries(files).filter(([path]) => CODE.test(path) && !PROTECTED_PATHS.has(path));

const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;
const fileName = (path: string) => path.split("/").pop();

function rawText(json: string | undefined, key: string): string {
  try {
    const value = (JSON.parse(json ?? "{}") as Record<string, unknown>)[key];
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export function seoFindings(files: FileMap, fallbackName = "Appen"): Finding[] {
  const out: Finding[] = [];
  const brand = readBrand(files, fallbackName);

  if (!files["/brand.json"]) {
    out.push({
      id: "no-brand",
      severity: "high",
      title: "Mangler /brand.json",
      detail: "Uten den får nettstedet ingen beskrivelse for Google og ingen tekst i delingskortet.",
      path: "/brand.json",
      fix: `Lag /brand.json med name, tagline, description (én setning for søk og deling), primary, secondary, headingFont og ogStyle, ut fra det appen faktisk handler om og bruker. ${KEEP_LOOK}`,
    });
  } else {
    const length = brand.description.length;
    if (!brand.tagline) {
      out.push({
        id: "no-tagline",
        severity: "low",
        title: "Mangler slagord",
        detail: "Et kort slagord brukes i delingskortet og som reserve når beskrivelsen mangler.",
        path: "/brand.json",
        fix: `Legg til en kort tagline i /brand.json som beskriver hva siden tilbyr. ${KEEP_LOOK}`,
      });
    }
    if (length < SEO_LIMITS.descriptionMin) {
      out.push({
        id: "description-short",
        severity: length < 40 ? "high" : "medium",
        title: `Beskrivelsen er kort (${length} tegn)`,
        detail: `Google viser gjerne ${SEO_LIMITS.descriptionMin}–${SEO_LIMITS.descriptionMax} tegn. En kort beskrivelse gir lite å klikke på.`,
        path: "/brand.json",
        fix: `Skriv om description i /brand.json til én konkret setning på ${SEO_LIMITS.descriptionMin}–${SEO_LIMITS.descriptionMax} tegn som sier hva siden gir og til hvem. ${KEEP_LOOK}`,
      });
    } else if (length > SEO_LIMITS.descriptionMax) {
      out.push({
        id: "description-long",
        severity: "low",
        title: `Beskrivelsen er lang (${length} tegn)`,
        detail: `Alt over ${SEO_LIMITS.descriptionMax} tegn blir kuttet i søkeresultatet.`,
        path: "/brand.json",
        fix: `Kort ned description i /brand.json til høyst ${SEO_LIMITS.descriptionMax} tegn uten å miste poenget. ${KEEP_LOOK}`,
      });
    }
    // readBrand already cuts the name at 60, so the length is read from the file itself.
    const rawName = rawText(files["/brand.json"], "name");
    if (rawName.length > SEO_LIMITS.titleMax) {
      out.push({
        id: "title-long",
        severity: "low",
        title: `Navnet er langt (${rawName.length} tegn)`,
        detail: `Sidetittelen kuttes etter ca. ${SEO_LIMITS.titleMax} tegn i søk.`,
        path: "/brand.json",
        fix: `Kort ned name i /brand.json til høyst ${SEO_LIMITS.titleMax} tegn. ${KEEP_LOOK}`,
      });
    }
  }

  if (!brand.logoSvg && !brand.hasFavicon) {
    out.push({
      id: "no-icon",
      severity: "low",
      title: "Mangler logo eller favorittikon",
      detail: "Ikonet vises i fanen, i bokmerker og i delingskortet.",
      path: "/public/favicon.svg",
      fix: `Lag en enkel /public/favicon.svg og /public/logo.svg som passer til fargene og navnet. ${KEEP_LOOK}`,
    });
  }

  const pages = sources(files);
  let h1Count = 0;
  for (const [path, source] of pages) {
    const found = [...source.matchAll(/<h1[\s>]/g)];
    h1Count += found.length;
    if (found.length > 1) {
      out.push({
        id: `many-h1:${path}`,
        severity: "low",
        title: `${found.length} hovedoverskrifter (h1) i ${fileName(path)}`,
        detail: "En side bør ha én h1. Resten bør være h2 eller lavere, slik at søkemotoren ser hva siden handler om.",
        path,
        line: lineOf(source, found[1]!.index ?? 0),
        fix: `La ${path} ha nøyaktig én <h1> og gjør de andre til <h2>/<h3> med samme utseende (behold klassene). ${KEEP_LOOK}`,
      });
    }
    for (const img of source.matchAll(/<img\b[^>]*>/g)) {
      if (/\balt\s*=/.test(img[0])) continue;
      const line = lineOf(source, img.index ?? 0);
      out.push({
        id: `img-alt:${path}:${line}`,
        severity: "medium",
        title: `Bilde uten alt-tekst i ${fileName(path)}`,
        detail: 'Alt-teksten brukes av skjermlesere og bildesøk. Dekorative bilder får alt="".',
        path,
        line,
        fix: `Legg til beskrivende alt-tekst på bildet i ${path} linje ${line} (alt="" hvis det bare er pynt). ${KEEP_LOOK}`,
      });
    }
  }
  if (pages.length > 0 && h1Count === 0) {
    out.push({
      id: "no-h1",
      severity: "high",
      title: "Siden mangler hovedoverskrift (h1)",
      detail: "Søkemotorer bruker h1 for å forstå hva siden handler om.",
      fix: `Sørg for at forsiden har nøyaktig én <h1> med hovedbudskapet, uten å endre utseendet (behold klassene). ${KEEP_LOOK}`,
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function seoRequest(findings: Finding[]): string {
  const list = findings.map((f, i) => `${i + 1}. ${f.title}${f.path ? ` (${f.path}${f.line ? `:${f.line}` : ""})` : ""}`).join("\n");
  return `Gå gjennom disse SEO-punktene og rett dem alle:\n${list}\n\n${KEEP_LOOK}`;
}
