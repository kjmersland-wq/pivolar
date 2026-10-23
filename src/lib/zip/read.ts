// Reads an uploaded ZIP entirely in memory. Nothing is written to disk and nothing is executed, so
// path tricks and symbolic links in the archive have nowhere to act. Sizes declared in the archive
// are checked before any entry is decompressed.

import { unzipSync, type UnzipFileInfo } from "fflate";
import { isSecretFile, scanSecrets } from "./secrets.ts";

export const LIMITS = {
  /** Largest upload, compressed. */
  archiveBytes: 10_000_000,
  entries: 2000,
  /** Largest single text file that is kept. */
  fileBytes: 1_000_000,
  /** All text kept together. Projects live in browser storage until they move to a database. */
  textBytes: 3_000_000,
  /** Everything the archive declares, kept or not. Guards against decompression bombs. */
  declaredBytes: 60_000_000,
  ratio: 100,
};

export class ImportError extends Error {}

export type Skipped = { path: string; reason: string };
export type SecretWarning = { path: string; kinds: string[]; line: number };

export type ReadResult = {
  files: Record<string, string>;
  skipped: Skipped[];
  /** Files deliberately left out because they hold credentials. */
  omittedSecrets: Skipped[];
  /** Kept files that look like they contain a credential. */
  secretWarnings: SecretWarning[];
  stats: { entries: number; kept: number; bytes: number };
};

const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", ".vercel", ".cache", "dist", "build", "out", "coverage", "__pycache__", ".venv", "venv", ".idea", ".vscode"]);
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|svgz|woff2?|ttf|otf|eot|mp[34]|mov|avi|webm|wav|ogg|pdf|zip|gz|tgz|bz2|7z|rar|jar|exe|dll|so|dylib|class|wasm|sqlite3?|db|psd|ai)$/i;
const LOCKFILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock)$/;

/** Returns the safe form of an entry path, or the reason it is unsafe. */
export function checkPath(name: string): { ok: true; path: string } | { ok: false; reason: string } {
  if (name.includes("\0")) return { ok: false, reason: "inneholder null-tegn" };
  if (name.includes("\\")) return { ok: false, reason: "bruker bakoverstrek i stien" };
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return { ok: false, reason: "absolutt sti" };
  const parts = name.split("/");
  if (parts.some((part) => part === "..")) return { ok: false, reason: "prøver å gå ut av prosjektmappen (..)" };
  if (name.length > 300) return { ok: false, reason: "for lang sti" };
  return { ok: true, path: parts.filter((p) => p && p !== ".").join("/") };
}

export function readZip(data: Uint8Array): ReadResult {
  if (data.length === 0) throw new ImportError("Filen er tom.");
  if (data.length > LIMITS.archiveBytes) throw new ImportError(`Arkivet er for stort (maks ${LIMITS.archiveBytes / 1_000_000} MB).`);
  if (!(data[0] === 0x50 && data[1] === 0x4b)) throw new ImportError("Dette ser ikke ut som en ZIP-fil.");

  // Pass 1: look at the table of contents only. Returning false keeps every entry compressed.
  const infos: UnzipFileInfo[] = [];
  try {
    unzipSync(data, {
      filter: (info) => {
        infos.push(info);
        return false;
      },
    });
  } catch {
    throw new ImportError("ZIP-filen er skadet eller bruker et format Pivolar ikke støtter (for eksempel kryptering).");
  }

  if (infos.length > LIMITS.entries) throw new ImportError(`Arkivet har for mange filer (maks ${LIMITS.entries}).`);
  for (const info of infos) {
    const checked = checkPath(info.name);
    if (!checked.ok) throw new ImportError(`Arkivet avvist: «${info.name.slice(0, 80)}» ${checked.reason}.`);
  }
  const entries = infos.filter((info) => !info.name.endsWith("/"));
  const declared = entries.reduce((sum, info) => sum + info.originalSize, 0);
  if (declared > LIMITS.declaredBytes) throw new ImportError("Arkivet blir for stort når det pakkes ut.");

  const skipped: Skipped[] = [];
  const omittedSecrets: Skipped[] = [];
  const wanted = new Map<string, string>();

  // A single top-level folder (GitHub's repo-main/) is removed so the project root is the root.
  const cleaned = entries.map((info) => ({ info, path: (checkPath(info.name) as { path: string }).path }));
  const tops = new Set(cleaned.map((e) => e.path.split("/")[0]));
  const strip = tops.size === 1 && cleaned.every((e) => e.path.includes("/"));

  for (const { info, path: full } of cleaned) {
    const path = strip ? full.split("/").slice(1).join("/") : full;
    const segments = path.split("/");
    if (segments.slice(0, -1).some((s) => IGNORED_DIRS.has(s))) {
      skipped.push({ path, reason: "bygge- eller avhengighetsmappe" });
      continue;
    }
    if (isSecretFile(path)) {
      omittedSecrets.push({ path, reason: "kan inneholde hemmeligheter" });
      continue;
    }
    if (BINARY.test(path)) {
      skipped.push({ path, reason: "binærfil, lagres ikke i Pivolar ennå" });
      continue;
    }
    if (info.originalSize > LIMITS.fileBytes) {
      skipped.push({ path, reason: `over ${LIMITS.fileBytes / 1_000_000} MB` });
      continue;
    }
    if (info.size > 0 && info.originalSize > 100_000 && info.originalSize / info.size > LIMITS.ratio) {
      skipped.push({ path, reason: "mistenkelig høy komprimering" });
      continue;
    }
    if (LOCKFILES.test(path) && info.originalSize > 400_000) {
      skipped.push({ path, reason: "stor låsefil" });
      continue;
    }
    wanted.set(info.name, path);
  }

  // Pass 2: decompress only what is kept. The real size is checked again in case the headers lied.
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data, { filter: (info) => wanted.has(info.name) });
  } catch {
    throw new ImportError("Kunne ikke lese innholdet i ZIP-filen.");
  }

  const files: Record<string, string> = {};
  const secretWarnings: SecretWarning[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  for (const [name, content] of Object.entries(raw)) {
    const path = wanted.get(name)!;
    if (content.length > LIMITS.fileBytes) {
      skipped.push({ path, reason: "større enn oppgitt i arkivet" });
      continue;
    }
    if (content.subarray(0, 8000).includes(0)) {
      skipped.push({ path, reason: "binærfil" });
      continue;
    }
    let text: string;
    try {
      text = decoder.decode(content);
    } catch {
      skipped.push({ path, reason: "ikke UTF-8-tekst" });
      continue;
    }
    bytes += content.length;
    if (bytes > LIMITS.textBytes) {
      throw new ImportError(`Prosjektet har mer enn ${LIMITS.textBytes / 1_000_000} MB tekst. Større prosjekter støttes først når Pivolar lagrer prosjekter i en database.`);
    }
    const hits = scanSecrets(text);
    if (hits.length > 0) secretWarnings.push({ path, kinds: [...new Set(hits.map((h) => h.kind))], line: hits[0]!.line });
    files[`/${path}`] = text;
  }

  if (Object.keys(files).length === 0) throw new ImportError("Fant ingen tekstfiler å importere i arkivet.");
  return { files, skipped, omittedSecrets, secretWarnings, stats: { entries: entries.length, kept: Object.keys(files).length, bytes } };
}
