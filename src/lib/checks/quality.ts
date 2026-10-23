import { PROTECTED_PATHS, type FileMap } from "../files.ts";

/**
 * Quality guard: finds code that has grown hard to change (huge files, many components in one
 * file, copy-pasted blocks) and describes a cleanup that must leave the page looking the same.
 */

export type Finding = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  path?: string;
  line?: number;
  /** A request that fixes it, ready to send to the model. */
  fix: string;
};

export const QUALITY_LIMITS = { fileWarn: 300, fileHigh: 500, components: 4, duplicateLines: 6 };

const CODE = /\.(tsx|ts|jsx|js)$/;
const SAME_LOOK = "Siden skal se helt lik ut og oppføre seg likt etterpå: ikke endre tekst, farger, avstander eller funksjon.";

const countLines = (text: string) => (text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length);

/** Top-level components: capitalised function or const arrow declarations. */
export function countComponents(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/^(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)\s*\(/gm)) names.add(m[1]!);
  for (const m of source.matchAll(/^(?:export\s+)?const\s+([A-Z]\w*)\s*(?::[^=]+)?=\s*(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/gm)) names.add(m[1]!);
  return [...names];
}

const normalise = (line: string) => line.trim().replace(/\s+/g, " ");
const trivial = (line: string) => line.length < 12 || /^[)}\]>;,/*]+$/.test(line) || /^(import|export \{|\/\/|\/\*|\*)/.test(line);

type Place = { path: string; line: number };

/** Blocks of consecutive, non-trivial lines that appear more than once. */
export function findDuplicates(files: FileMap, window = QUALITY_LIMITS.duplicateLines): { sample: string; places: Place[] }[] {
  const seen = new Map<string, Place[]>();
  for (const [path, content] of Object.entries(files)) {
    if (!CODE.test(path) || PROTECTED_PATHS.has(path)) continue;
    const lines = content.split("\n").map(normalise);
    for (let i = 0; i + window <= lines.length; i++) {
      const block = lines.slice(i, i + window);
      if (block.some(trivial)) continue;
      const key = block.join("\n");
      const list = seen.get(key) ?? [];
      list.push({ path, line: i + 1 });
      seen.set(key, list);
    }
  }
  // Overlapping windows of the same copy report once: keep the first window of each run.
  const groups: { sample: string; places: Place[] }[] = [];
  const covered = new Set<string>();
  for (const [key, places] of seen) {
    if (places.length < 2) continue;
    const fresh = places.filter((p) => !covered.has(`${p.path}:${p.line}`));
    if (fresh.length < 2) continue;
    for (const p of places) for (let k = 0; k < window; k++) covered.add(`${p.path}:${p.line + k}`);
    groups.push({ sample: key.split("\n")[0]!, places });
  }
  return groups;
}

export function qualityFindings(files: FileMap): Finding[] {
  const out: Finding[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!CODE.test(path) || PROTECTED_PATHS.has(path)) continue;
    const lines = countLines(content);
    if (lines > QUALITY_LIMITS.fileWarn) {
      out.push({
        id: `big-file:${path}`,
        severity: lines > QUALITY_LIMITS.fileHigh ? "high" : "medium",
        title: `${path} er stor (${lines} linjer)`,
        detail: "Store filer er vanskelige å endre uten å ødelegge noe, og koster mer hver gang Pivolar må lese dem.",
        path,
        fix: `Del opp ${path} (${lines} linjer) i flere mindre filer, én komponent per fil, i /components. Behold nøyaktig samme innhold og utseende. ${SAME_LOOK}`,
      });
    }
    if (/\.(tsx|jsx)$/.test(path)) {
      const names = countComponents(content);
      if (names.length > QUALITY_LIMITS.components) {
        out.push({
          id: `many-components:${path}`,
          severity: "medium",
          title: `${path} har ${names.length} komponenter`,
          detail: `Komponentene (${names.slice(0, 6).join(", ")}${names.length > 6 ? ", …" : ""}) bør ligge i hver sin fil.`,
          path,
          fix: `Flytt komponentene ${names.join(", ")} fra ${path} til egne filer i /components, og importer dem. ${SAME_LOOK}`,
        });
      }
    }
  }
  for (const group of findDuplicates(files)) {
    const where = [...new Set(group.places.map((p) => p.path))];
    out.push({
      id: `duplicate:${group.places[0]!.path}:${group.places[0]!.line}`,
      severity: "low",
      title: `Samme kode står ${group.places.length} steder`,
      detail: `Begynner med «${group.sample.slice(0, 60)}» i ${where.slice(0, 3).join(", ")}${where.length > 3 ? " …" : ""}.`,
      path: group.places[0]!.path,
      line: group.places[0]!.line,
      fix: `Samme kodeblokk (begynner med «${group.sample}») er kopiert til ${group.places.map((p) => `${p.path}:${p.line}`).join(", ")}. Lag én felles komponent eller funksjon og bruk den alle stedene. ${SAME_LOOK}`,
    });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** One request that cleans up everything found, biggest problems first. */
export function cleanupRequest(findings: Finding[]): string {
  const list = findings.slice(0, 6).map((f, i) => `${i + 1}. ${f.fix}`).join("\n");
  return `Rydd opp i koden, ett punkt om gangen, og les hver fil før du endrer den:\n${list}\n\n${SAME_LOOK}`;
}
