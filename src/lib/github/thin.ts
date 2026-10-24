import { Unzip, UnzipInflate, UnzipPassThrough, zipSync } from "fflate";
import { BINARY, checkPath, IGNORED_DIRS, ImportError, type Skipped } from "../zip/read.ts";

/**
 * A big repository is mostly things Pivolar does not keep anyway: pictures, sound, video, dependencies
 * and build output. Instead of refusing it because the whole archive is large, the archive is read as it
 * arrives, one file at a time, and only the files that could be kept are held in memory. What is left
 * is packed into a small ZIP that goes through exactly the same checks as an uploaded one (paths,
 * sizes, text only, files that may hold secrets). Nothing is written to disk and nothing is executed.
 */

export const THIN_LIMITS = {
  /** Largest repository GitHub may report, in kilobytes. */
  repoKb: 500_000,
  /** The most that is read from the network, however it is packed. */
  downloadBytes: 400_000_000,
  /** Entries looked at. */
  entries: 100_000,
  /** Files kept for the checks, and their total size. The ZIP reader's own limits apply after this. */
  keptFiles: 2_000,
  keptBytes: 8_000_000,
  /** Left out files that are listed one by one. The rest are counted. */
  listed: 200,
  ms: 100_000,
};

export type Thin = { zip: Uint8Array; dropped: Skipped[]; droppedCount: number; stats: { entries: number; kept: number; downloadedBytes: number } };

const concat = (chunks: Uint8Array[], size: number) => {
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

export async function thinArchive(stream: ReadableStream<Uint8Array>, options: { fileBytes: number; now?: () => number }): Promise<Thin> {
  const now = options.now ?? Date.now;
  const deadline = now() + THIN_LIMITS.ms;
  const kept: Record<string, Uint8Array> = {};
  const dropped: Skipped[] = [];
  let droppedCount = 0;
  let entries = 0;
  let keptBytes = 0;
  let downloaded = 0;
  let failure: Error | null = null;
  const drop = (path: string, reason: string) => {
    droppedCount++;
    if (dropped.length < THIN_LIMITS.listed) dropped.push({ path, reason });
  };

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (file) => {
    try {
      if (failure || file.name.endsWith("/")) return;
      entries++;
      if (entries > THIN_LIMITS.entries) throw new ImportError(`Repoet har for mange filer (over ${THIN_LIMITS.entries}).`);
      const checked = checkPath(file.name);
      if (!checked.ok) throw new ImportError(`Arkivet avvist: «${file.name.slice(0, 80)}» ${checked.reason}.`);
      // GitHub puts everything in one folder named after the repository and commit.
      const path = checked.path.split("/").slice(1).join("/");
      if (!path) return;
      if (path.split("/").slice(0, -1).some((segment) => IGNORED_DIRS.has(segment))) return drop(path, "bygge- eller avhengighetsmappe");
      if (BINARY.test(path)) return drop(path, "binærfil, lagres ikke i Pivolar ennå");
      if (file.originalSize !== undefined && file.originalSize > options.fileBytes) return drop(path, `stor datafil (${Math.round(file.originalSize / 1000)} KB), blir i repoet`);
      if (file.compression !== 0 && file.compression !== 8) return drop(path, "ukjent komprimering");
      if (Object.keys(kept).length >= THIN_LIMITS.keptFiles) return drop(path, "for mange filer, blir i repoet");

      const chunks: Uint8Array[] = [];
      let size = 0;
      let over = false;
      file.ondata = (error, data, final) => {
        if (error) {
          failure = new ImportError("Kunne ikke lese innholdet i arkivet.");
          return;
        }
        if (over) return;
        size += data.length;
        if (size > options.fileBytes) {
          over = true;
          chunks.length = 0;
          drop(path, `stor datafil (over ${Math.round(options.fileBytes / 1000)} KB), blir i repoet`);
          return;
        }
        chunks.push(data);
        if (!final) return;
        if (keptBytes + size > THIN_LIMITS.keptBytes) return drop(path, "passer ikke i prosjektet (for mye tekst), blir i repoet");
        keptBytes += size;
        kept[file.name] = concat(chunks, size);
      };
      file.start();
    } catch (error) {
      failure = error instanceof Error ? error : new ImportError("Kunne ikke lese arkivet.");
    }
  };

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.length;
      if (downloaded > THIN_LIMITS.downloadBytes) throw new ImportError(`Arkivet er for stort (over ${THIN_LIMITS.downloadBytes / 1_000_000} MB).`);
      if (now() > deadline) throw new ImportError("Det tok for lang tid å lese repoet. Prøv en mindre gren, eller importer som ZIP.");
      unzip.push(value, false);
      if (failure) throw failure;
    }
    unzip.push(new Uint8Array(0), true);
    if (failure) throw failure;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ImportError) throw error;
    throw new ImportError("ZIP-filen er skadet eller bruker et format Pivolar ikke støtter.");
  }
  return { zip: zipSync(kept, { level: 6 }), dropped, droppedCount, stats: { entries, kept: Object.keys(kept).length, downloadedBytes: downloaded } };
}
