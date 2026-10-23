import { visibleFiles, type FileMap } from "../files.ts";

/**
 * Keeps the prompt small for big projects. Up to a size, every file is sent in full, as before.
 * Above it the model gets a map of the files (size, lines, what each exports) with only the
 * newest files in full, and reads or searches the rest with readFile and searchFiles.
 */

/** Characters of project text above which the index is used. About 15 000 tokens. */
export const INDEX_THRESHOLD = 60_000;
/** Characters of file content sent in full when the index is used. About 7 500 tokens. */
export const INLINE_BUDGET = 30_000;
/** Files that are always worth sending in full when they are small. */
const ESSENTIAL = ["/App.tsx", "/styles.css", "/brand.json"];
const ESSENTIAL_MAX = 6_000;

export const READ_MAX_LINES = 600;
export const READ_MAX_CHARS = 24_000;
export const SEARCH_MAX_HITS = 40;

export const totalChars = (files: FileMap) => Object.values(files).reduce((sum, code) => sum + code.length, 0);

export function shouldIndex(files: FileMap): boolean {
  return totalChars(visibleFiles(files)) > INDEX_THRESHOLD;
}

const lineCount = (code: string) => (code.length === 0 ? 0 : code.split("\n").length);

/** What a file offers, in a few words: exported names for code, selectors for CSS. */
function summarize(path: string, code: string): string {
  if (/\.(tsx?|jsx?|mjs)$/.test(path)) {
    const names = [...code.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|type|interface)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]!);
    const unique = [...new Set(names)].slice(0, 6);
    if (unique.length) return `exporterer ${unique.join(", ")}${names.length > unique.length ? " …" : ""}`;
    return /export\s+default/.test(code) ? "default-eksport" : "";
  }
  if (/\.css$/.test(path)) {
    const vars = (code.match(/^\s*--[\w-]+\s*:/gm) ?? []).length;
    const classes = [...code.matchAll(/^\.([\w-]+)/gm)].map((m) => `.${m[1]}`).slice(0, 5);
    return [vars ? `${vars} variabler` : "", classes.length ? `klasser ${classes.join(", ")}` : ""].filter(Boolean).join("; ");
  }
  if (/\.json$/.test(path)) return `${Math.min(code.length, 99999)} tegn json`;
  return "";
}

export type Index = {
  /** The map: one line per file. */
  map: string;
  /** Paths whose full text is included. */
  inlined: string[];
  /** Paths that must be read with readFile before they are changed. */
  omitted: string[];
};

/**
 * `recent` lists the paths touched most recently first. Those are sent in full while the budget
 * lasts, then small essential files. Everything else stays in the map only.
 */
export function buildIndex(files: FileMap, recent: string[] = []): Index {
  const visible = visibleFiles(files);
  const paths = Object.keys(visible).sort();
  const inlined: string[] = [];
  let used = 0;
  const take = (path: string, limit = Infinity) => {
    const code = visible[path];
    if (code === undefined || inlined.includes(path) || code.length > limit || used + code.length > INLINE_BUDGET) return;
    inlined.push(path);
    used += code.length;
  };
  for (const path of recent) take(path);
  for (const path of ESSENTIAL) take(path, ESSENTIAL_MAX);
  const map = paths
    .map((path) => {
      const code = visible[path]!;
      const note = summarize(path, code);
      return `${path}  (${lineCount(code)} linjer, ${code.length} tegn)${note ? ` – ${note}` : ""}${inlined.includes(path) ? " [i fulltekst under]" : ""}`;
    })
    .join("\n");
  return { map, inlined, omitted: paths.filter((p) => !inlined.includes(p)) };
}

export type ReadResult = { ok: boolean; message: string; path?: string; totalLines?: number; from?: number; to?: number; content?: string };

/** Returns the exact text of a file (or a line range), so editFile can match it character for character. */
export function readFile(files: FileMap, input: { path: string; from?: number | undefined; to?: number | undefined }): ReadResult {
  const path = input.path.startsWith("/") ? input.path : `/${input.path}`;
  const code = visibleFiles(files)[path];
  if (code === undefined) {
    const close = Object.keys(visibleFiles(files)).filter((p) => p.toLowerCase().includes(path.split("/").pop()!.toLowerCase())).slice(0, 5);
    return { ok: false, message: `${path} finnes ikke.${close.length ? ` Mente du ${close.join(", ")}?` : ""}` };
  }
  const lines = code.split("\n");
  const total = lines.length;
  const from = Math.max(1, Math.floor(input.from ?? 1));
  let to = Math.min(total, Math.floor(input.to ?? total));
  if (from > total) return { ok: false, message: `${path} har bare ${total} linjer.` };
  if (to < from) to = from;
  let slice = lines.slice(from - 1, to);
  let truncated = false;
  if (slice.length > READ_MAX_LINES) {
    slice = slice.slice(0, READ_MAX_LINES);
    truncated = true;
  }
  let content = slice.join("\n");
  if (content.length > READ_MAX_CHARS) {
    content = content.slice(0, READ_MAX_CHARS);
    truncated = true;
  }
  const end = from + content.split("\n").length - 1;
  return {
    ok: true,
    message: `${path}, linje ${from}–${end} av ${total}${truncated ? `. Utdraget er kortet ned, be om neste del med from: ${end + 1}.` : ""}`,
    path,
    totalLines: total,
    from,
    to: end,
    content,
  };
}

export type SearchHit = { path: string; line: number; text: string };
export type SearchResult = { ok: boolean; message: string; hits: SearchHit[]; files?: Record<string, number> };

/** Finds where something is used. Plain text by default (any case), or a regular expression. */
export function searchFiles(files: FileMap, input: { query: string; regex?: boolean | undefined; path?: string | undefined }): SearchResult {
  const query = input.query.trim();
  if (!query) return { ok: false, message: "Mangler søkeord.", hits: [] };
  let matcher: RegExp;
  try {
    matcher = new RegExp(input.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch {
    return { ok: false, message: "Ugyldig regulært uttrykk.", hits: [] };
  }
  const prefix = input.path ? (input.path.startsWith("/") ? input.path : `/${input.path}`) : "";
  const hits: SearchHit[] = [];
  const perFile: Record<string, number> = {};
  let total = 0;
  for (const [path, code] of Object.entries(visibleFiles(files)).sort(([a], [b]) => a.localeCompare(b))) {
    if (prefix && !path.startsWith(prefix)) continue;
    code.split("\n").forEach((line, i) => {
      if (!matcher.test(line)) return;
      total++;
      perFile[path] = (perFile[path] ?? 0) + 1;
      if (hits.length < SEARCH_MAX_HITS) hits.push({ path, line: i + 1, text: line.trim().slice(0, 200) });
    });
  }
  return {
    ok: true,
    message: total === 0 ? "Ingen treff." : `${total} treff i ${Object.keys(perFile).length} filer${total > hits.length ? ` (viser de ${hits.length} første)` : ""}.`,
    hits,
    files: perFile,
  };
}

type ToolPart = { type: string; state?: string; input?: { path?: unknown }; output?: { ok?: boolean } };

/** Paths the conversation has written or changed, newest first. */
export function recentPaths(messages: { role: string; parts: unknown[] }[]): string[] {
  const seen: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant") continue;
    const parts = message.parts as ToolPart[];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j]!;
      if (!/^tool-(writeFile|editFile)$/.test(part.type) || part.state !== "output-available" || part.output?.ok === false) continue;
      const path = typeof part.input?.path === "string" ? (part.input.path.startsWith("/") ? part.input.path : `/${part.input.path}`) : null;
      if (path && !seen.includes(path)) seen.push(path);
    }
  }
  return seen;
}
