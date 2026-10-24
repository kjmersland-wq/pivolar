import { createHash } from "node:crypto";
import type { Media, Page, SiteModel } from "./model.ts";
import { rewriteImages } from "./model.ts";
import { ImportFetchError } from "./safe-fetch.ts";

/**
 * Pictures from an old website: fetched safely, checked to really be pictures, shrunk, stripped of
 * metadata (positions in photos, camera and author) and stored once under a name made from their
 * content. All of it is plain code. Nothing is trusted from the old site: not the file type it
 * claims, not the size it says, not the names it uses.
 */

export const MEDIA_LIMITS = {
  /** Pictures per import. */
  count: 400,
  /** The largest single picture that is fetched. */
  fileBytes: 10_000_000,
  /** Everything one import may download. */
  totalBytes: 150_000_000,
  concurrency: 4,
  /** One step (one request from the browser) works for this long and then reports back. */
  stepMs: 45_000,
  /** Pictures are scaled down to fit inside this square. */
  maxSide: 2000,
  /** Pictures with more pixels than this are refused, so a tiny file cannot unpack into gigabytes. */
  maxPixels: 50_000_000,
  /** What one user may keep, in bytes. */
  quotaBytes: 500_000_000,
};

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif";

/** What a file really is, from its first bytes. The type the server claims is never used. */
export function sniffImage(bytes: Uint8Array): ImageMime | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && /^(avif|avis)$/.test(ascii(8, 12))) return "image/avif";
  return null;
}

export type Optimized = { bytes: Buffer; mime: "image/webp"; width: number; height: number };

/**
 * Re-encodes a picture as WebP inside a size limit. A new encoding drops everything that is not
 * the picture itself, so location and author data in photos is gone, and anything that was hidden
 * in the file is not carried over.
 */
export async function optimize(input: Buffer, mime: ImageMime): Promise<Optimized> {
  const sharp = (await import("sharp")).default;
  const animated = mime === "image/gif" || mime === "image/webp";
  const source = sharp(input, { limitInputPixels: MEDIA_LIMITS.maxPixels, animated, failOn: "error" });
  const meta = await source.metadata();
  const pipeline = source.rotate().resize({ width: MEDIA_LIMITS.maxSide, height: MEDIA_LIMITS.maxSide, fit: "inside", withoutEnlargement: true }).webp({ quality: meta.hasAlpha ? 90 : 82, alphaQuality: 100 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  // An animated picture reports the height of all frames together; the shape of one frame is what a page needs.
  const height = info.pageHeight ?? info.height;
  return { bytes: data, mime: "image/webp", width: info.width, height };
}

export type Stored = { sourceUrl: string; hash: string; file: string; mime: "image/webp"; bytes: number; sourceBytes: number; width: number; height: number };
export type FailReason = "blocked" | "too-large" | "not-image" | "network" | "quota" | "limit" | "robots";
export type Failure = { sourceUrl: string; reason: FailReason };

/** The name of a stored picture: the start of its hash and the extension. Same content, same name. */
export const fileNameFor = (hash: string, mime: string) => `${hash.slice(0, 12)}.${{ "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/avif": "avif" }[mime] ?? "webp"}`;

export type BatchDeps = {
  /** Fetches the bytes of a picture. Throws ImportFetchError. */
  download: (url: string) => Promise<Buffer>;
  /** robots.txt. */
  allowed: (url: string) => Promise<boolean>;
  /** Puts a stored picture into storage under its file name. Called once per different picture. */
  upload: (file: string, bytes: Buffer, mime: string) => Promise<void>;
  optimize?: (bytes: Buffer, mime: ImageMime) => Promise<Optimized>;
  now?: () => number;
};

export type BatchInput = {
  /** Pictures still to do. */
  todo: string[];
  /** Hashes already stored in this job, so the same picture is not stored twice. */
  knownHashes: Set<string>;
  /** What this job may still download, and what the user may still store. */
  bytesLeft: number;
  storageLeft: number;
  /** The step stops starting new pictures after this time (milliseconds, same clock as `now`). */
  deadline: number;
};

export type BatchResult = { stored: Stored[]; failed: Failure[]; bytesDownloaded: number; bytesStored: number; remaining: string[]; stoppedBy: "done" | "time" | "limit" | "quota" };

const reasonOf = (error: unknown): FailReason => {
  if (error instanceof ImportFetchError) return error.code === "blocked" ? "blocked" : error.code === "too-large" ? "too-large" : error.code === "bad-type" ? "not-image" : "network";
  return "network";
};

/** Does one step of work: some of the pictures still to do, within the time and the limits. */
export async function processBatch(input: BatchInput, deps: BatchDeps): Promise<BatchResult> {
  const now = deps.now ?? Date.now;
  const run = deps.optimize ?? optimize;
  const result: BatchResult = { stored: [], failed: [], bytesDownloaded: 0, bytesStored: 0, remaining: [], stoppedBy: "done" };
  const queue = [...input.todo];
  const known = new Set(input.knownHashes);
  let bytesLeft = input.bytesLeft;
  let storageLeft = input.storageLeft;

  async function one(url: string): Promise<void> {
    if (!(await deps.allowed(url))) return void result.failed.push({ sourceUrl: url, reason: "robots" });
    let raw: Buffer;
    try {
      raw = await deps.download(url);
    } catch (error) {
      return void result.failed.push({ sourceUrl: url, reason: reasonOf(error) });
    }
    result.bytesDownloaded += raw.length;
    bytesLeft -= raw.length;
    const mime = sniffImage(raw);
    if (!mime) return void result.failed.push({ sourceUrl: url, reason: "not-image" });
    let done: Optimized;
    try {
      done = await run(raw, mime);
    } catch {
      // A picture that cannot be read, or that has far too many pixels, is not a picture worth keeping.
      return void result.failed.push({ sourceUrl: url, reason: "not-image" });
    }
    const hash = createHash("sha256").update(done.bytes).digest("hex");
    const file = fileNameFor(hash, done.mime);
    const isNew = !known.has(hash);
    if (isNew) {
      if (done.bytes.length > storageLeft) return void result.failed.push({ sourceUrl: url, reason: "quota" });
      try {
        await deps.upload(file, done.bytes, done.mime);
      } catch {
        return void result.failed.push({ sourceUrl: url, reason: "network" });
      }
      known.add(hash);
      storageLeft -= done.bytes.length;
      result.bytesStored += done.bytes.length;
    }
    result.stored.push({ sourceUrl: url, hash, file, mime: done.mime, bytes: done.bytes.length, sourceBytes: raw.length, width: done.width, height: done.height });
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (now() >= input.deadline) {
        result.stoppedBy = "time";
        return;
      }
      if (bytesLeft <= 0) {
        result.stoppedBy = "limit";
        return;
      }
      if (storageLeft <= 0) {
        result.stoppedBy = "quota";
        return;
      }
      const url = queue.shift();
      if (url === undefined) return;
      await one(url);
    }
  }
  await Promise.all(Array.from({ length: MEDIA_LIMITS.concurrency }, worker));

  // What the workers did not reach is still to do; the next step takes it.
  result.remaining = queue;
  if (queue.length === 0) result.stoppedBy = "done";
  else if (result.stoppedBy === "done") result.stoppedBy = "time";
  return result;
}

export type AssetRow = { source_url: string; hash: string | null; file: string | null; mime: string | null; bytes: number | null; width: number | null; height: number | null; failed: string | null };

/**
 * The model with every picture address that was stored pointing at its project file
 * (/images/<file>). The pictures that could not be stored keep their old address, which keeps
 * working as long as the old site does, and are listed so the owner knows.
 */
export function applyAssets(model: SiteModel, rows: AssetRow[]): SiteModel {
  const stored = new Map(rows.filter((r) => !r.failed && r.file).map((r) => [r.source_url, r]));
  const to = (src: string) => (stored.has(src) ? `/images/${stored.get(src)!.file}` : src);
  const pages: Page[] = model.pages.map((page) => ({ ...page, featuredImage: page.featuredImage ? to(page.featuredImage) : null, blocks: rewriteImages(page.blocks, to) }));
  const media: Media[] = model.media.map((m) => {
    const row = stored.get(m.sourceUrl);
    const failed = rows.find((r) => r.source_url === m.sourceUrl && r.failed)?.failed;
    return { ...m, ...(row ? { stored: { file: row.file!, hash: row.hash!, bytes: row.bytes!, width: row.width ?? 0, height: row.height ?? 0 } } : {}), ...(failed ? { failed } : {}) };
  });
  const failedCount = media.filter((m) => m.failed).length;
  const warnings = [...model.warnings, ...(failedCount > 0 ? [`${failedCount} bilder kunne ikke lagres og peker fortsatt på det gamle nettstedet.`] : [])];
  return { ...model, pages, media, warnings };
}
