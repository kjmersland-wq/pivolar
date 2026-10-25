import type { SupabaseClient } from "@supabase/supabase-js";
import { applyAssets, MEDIA_LIMITS, processBatch, type AssetRow, type FailReason, type Failure, type Stored } from "./media.ts";
import type { Design } from "./design.ts";
import type { SiteModel } from "./model.ts";
import { createRobots, ImportFetchError, safeFetch } from "./safe-fetch.ts";

/**
 * The part of an import that lives in the database: the job holds the content model, and the
 * pictures are fetched a few at a time, each call doing what fits in a short time. The job can be
 * picked up again by the next call, so nothing depends on one long request staying alive.
 */

export const BUCKET = "pivolar-assets";

type Db = Pick<SupabaseClient, "from" | "rpc" | "storage">;

export async function saveJob(db: Db, userId: string, sourceUrl: string, model: SiteModel): Promise<string> {
  const { data, error } = await db.from("import_jobs").insert({ owner_id: userId, source_url: sourceUrl.slice(0, 300), model, media_total: model.media.length }).select("id").single();
  if (error || !data) throw new Error("Kunne ikke lagre importen. Har du kjørt migrasjonen 20261024180000_pivolar_import_assets.sql?");
  return data.id as string;
}

const COLUMNS = "source_url, hash, file, mime, bytes, source_bytes, width, height, failed";
type Row = AssetRow & { source_bytes: number | null };

async function loadRows(db: Db, jobId: string): Promise<Row[]> {
  const { data, error } = await db.from("import_assets").select(COLUMNS).eq("job_id", jobId).limit(5000);
  if (error) throw new Error("Kunne ikke lese bildene i importen.");
  return (data ?? []) as Row[];
}

export type StepReport = { stored: number; failed: number; remaining: number; total: number; bytesStored: number; status: "fetched" | "images_done"; stoppedBy: string };

export type StepDeps = { download?: (url: string) => Promise<Buffer>; allowed?: (url: string) => Promise<boolean>; now?: () => number; quotaBytes?: number };

const toRow = (jobId: string, userId: string, s: Stored) => ({ job_id: jobId, owner_id: userId, source_url: s.sourceUrl, hash: s.hash, file: s.file, mime: s.mime, bytes: s.bytes, source_bytes: s.sourceBytes, width: s.width, height: s.height });
const failRow = (jobId: string, userId: string, f: Failure | { sourceUrl: string; reason: FailReason }) => ({ job_id: jobId, owner_id: userId, source_url: f.sourceUrl, failed: f.reason });

/** Fetches the next pictures of a job. Call it again until `status` is `images_done`. */
export async function runImagesStep(db: Db, userId: string, jobId: string, deps: StepDeps = {}): Promise<StepReport> {
  const { data: job } = await db.from("import_jobs").select("model, status").eq("id", jobId).maybeSingle();
  if (!job) throw new ImportFetchError("network", "Fant ikke importen.");
  const model = job.model as SiteModel;
  const rows = await loadRows(db, jobId);
  const handled = new Set(rows.map((r) => r.source_url));
  // Only pictures a page shows are fetched. A library full of unused pictures, sound and video does not fill the storage.
  const urls = [...new Set(model.media.filter((m) => m.usedBy.length > 0 && (!m.mime || m.mime.startsWith("image/"))).map((m) => m.sourceUrl))];
  // More pictures than the limit: the rest are given up on, once, and reported.
  const inLimit = urls.slice(0, MEDIA_LIMITS.count);
  const beyond = urls.slice(MEDIA_LIMITS.count).filter((u) => !handled.has(u));
  const todo = inLimit.filter((u) => !handled.has(u));

  const downloadedSoFar = rows.reduce((sum, r) => sum + (r.source_bytes ?? 0), 0);
  const used = await db.rpc("import_bytes_used");
  const usedBytes = typeof used.data === "number" ? used.data : Number(used.data ?? 0);
  const quota = deps.quotaBytes ?? MEDIA_LIMITS.quotaBytes;
  const now = deps.now ?? Date.now;

  const allowed = deps.allowed ?? createRobots();
  const download =
    deps.download ??
    (async (url: string) => {
      const res = await safeFetch(url, { accept: /^image\/|^application\/octet-stream/i, maxBytes: MEDIA_LIMITS.fileBytes, timeoutMs: 15_000 });
      if (!res.ok) throw new ImportFetchError("network", "Bildet finnes ikke lenger.");
      return res.body;
    });
  const storage = db.storage.from(BUCKET);
  const upload = async (file: string, bytes: Buffer, mime: string) => {
    const { error } = await storage.upload(`${userId}/${jobId}/${file}`, bytes, { contentType: mime, upsert: false });
    // The same file already being there is what "stored once" means, so it is not a problem.
    if (error && !/already exists|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ""}`)) throw error;
  };

  const result = await processBatch(
    { todo, knownHashes: new Set(rows.flatMap((r) => (r.hash ? [r.hash] : []))), bytesLeft: MEDIA_LIMITS.totalBytes - downloadedSoFar, storageLeft: quota - usedBytes, deadline: now() + MEDIA_LIMITS.stepMs },
    { download, allowed, upload, now },
  );

  const records: Record<string, unknown>[] = [...result.stored.map((s) => toRow(jobId, userId, s)), ...result.failed.map((f) => failRow(jobId, userId, f)), ...beyond.map((u) => failRow(jobId, userId, { sourceUrl: u, reason: "limit" }))];
  // When a limit ends the work, what is left will never be fetched, so it is marked as given up on.
  const finalReason: FailReason | null = result.stoppedBy === "limit" ? "limit" : result.stoppedBy === "quota" ? "quota" : null;
  if (finalReason) records.push(...result.remaining.map((u) => failRow(jobId, userId, { sourceUrl: u, reason: finalReason })));
  if (records.length > 0) {
    const { error } = await db.from("import_assets").upsert(records, { onConflict: "job_id,source_url", ignoreDuplicates: true });
    if (error) throw new Error("Kunne ikke lagre resultatet av bildene.");
  }

  const remaining = finalReason ? 0 : result.remaining.length;
  const status = remaining === 0 ? "images_done" : "fetched";
  if (status === "images_done" && job.status !== "images_done") await db.from("import_jobs").update({ status }).eq("id", jobId);
  return { stored: result.stored.length, failed: result.failed.length + beyond.length + (finalReason ? result.remaining.length : 0), remaining, total: urls.length, bytesStored: result.bytesStored, status, stoppedBy: result.stoppedBy };
}

/** The model of a job with the stored pictures filled in, and where each one is. */
export async function loadModel(db: Db, userId: string, jobId: string) {
  const { data: job } = await db.from("import_jobs").select("model, status, source_url, project_id").eq("id", jobId).maybeSingle();
  if (!job) return null;
  const rows = await loadRows(db, jobId);
  const storage = db.storage.from(BUCKET);
  const assets = rows.filter((r) => !r.failed && r.file).map((r) => ({ file: r.file!, path: `${userId}/${jobId}/${r.file}`, url: storage.getPublicUrl(`${userId}/${jobId}/${r.file}`).data.publicUrl, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height }));
  const unique = [...new Map(assets.map((a) => [a.file, a])).values()];
  return { status: job.status as string, sourceUrl: job.source_url as string, model: applyAssets(job.model as SiteModel, rows), assets: unique };
}

/** Keeps the design brief with the job, so it is there when the project is made. Only the owner's own job can be changed (row-level security). */
export async function saveDesign(db: Db, jobId: string, design: Design): Promise<boolean> {
  const { data: job } = await db.from("import_jobs").select("model").eq("id", jobId).maybeSingle();
  if (!job) return false;
  const { error } = await db.from("import_jobs").update({ model: { ...(job.model as SiteModel), design } }).eq("id", jobId);
  return !error;
}
