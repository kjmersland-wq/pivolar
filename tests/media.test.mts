import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadModel, runImagesStep, saveJob } from "../src/lib/import/job.ts";
import { applyAssets, fileNameFor, MEDIA_LIMITS, optimize, processBatch, sniffImage, type AssetRow, type BatchDeps} from "../src/lib/import/media.ts";
import type { Block, Media, Page, SiteModel } from "../src/lib/import/model.ts";
import { ImportFetchError } from "../src/lib/import/safe-fetch.ts";

const sharp = (await import("sharp")).default;
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const solid = (width: number, height: number, background: string | { r: number; g: number; b: number; alpha: number } = "#336699") => sharp({ create: { width, height, channels: 4, background } });
const png = await solid(200, 100, { r: 255, g: 0, b: 0, alpha: 0.5 }).png().toBuffer();
const jpg = await solid(3000, 2000).removeAlpha().jpeg().withExif({ IFD0: { Copyright: "Hemmelig", Artist: "Meg Selv" } }).toBuffer();
const gif = await solid(40, 40).gif().toBuffer();
const webp = await solid(60, 30).webp().toBuffer();
const avif = await solid(32, 32).avif().toBuffer();

// --- what a file really is
{
  assert.equal(sniffImage(png), "image/png");
  assert.equal(sniffImage(jpg), "image/jpeg");
  assert.equal(sniffImage(gif), "image/gif");
  assert.equal(sniffImage(webp), "image/webp");
  assert.equal(sniffImage(avif), "image/avif");
  for (const [name, bytes] of [["svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], ["html", "<!doctype html><html></html>"], ["empty", ""], ["text", "hei"], ["php", "<?php echo 1;"], ["zip", "PK\u0003\u0004abc"]] as const) {
    assert.equal(sniffImage(Buffer.from(bytes)), null, `${name} is not a picture`);
  }
  assert.equal(sniffImage(png.subarray(0, 4)), null, "a cut-off header is not enough");
  assert.equal(sniffImage(Buffer.from("RIFF1234WAVE")), null, "RIFF is also WAV and AVI");
  assert.equal(fileNameFor("a".repeat(64), "image/webp"), "aaaaaaaaaaaa.webp");
  assert.match(fileNameFor(createHash("sha256").update("x").digest("hex"), "image/jpeg"), /^[0-9a-f]{12}\.jpg$/);
}

// --- shrinking, and what is thrown away
{
  const big = await optimize(jpg, "image/jpeg");
  assert.equal(big.mime, "image/webp");
  assert.deepEqual([big.width, big.height], [2000, 1333], "scaled to fit inside 2000, keeping the shape");
  const meta = await sharp(big.bytes).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined, "location, author and copyright data are gone");
  assert.ok(!big.bytes.toString("latin1").includes("Hemmelig"), "and the text is nowhere in the file");
  assert.ok((await sharp(jpg).metadata()).exif !== undefined, "the test file did have metadata to remove");

  const small = await optimize(png, "image/png");
  assert.deepEqual([small.width, small.height], [200, 100], "a small picture is not enlarged");
  assert.equal((await sharp(small.bytes).metadata()).hasAlpha, true, "transparency stays");
  assert.deepEqual((await optimize(gif, "image/gif")).width, 40);
  assert.equal((await optimize(avif, "image/avif")).mime, "image/webp");
  assert.equal((await optimize(webp, "image/webp")).width, 60);

  // A file that claims a size far beyond the limit is refused before it is unpacked
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return Buffer.from([(~c >>> 24) & 255, (~c >>> 16) & 255, (~c >>> 8) & 255, ~c & 255]);
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    return Buffer.concat([len, body, crc(body)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(30000, 0);
  ihdr.writeUInt32BE(30000, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const bomb = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])), chunk("IEND", Buffer.alloc(0))]);
  assert.equal(sniffImage(bomb), "image/png", "it looks like a PNG");
  await assert.rejects(optimize(bomb, "image/png"), "but 900 million pixels are refused");
  await assert.rejects(optimize(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("garbage")]), "image/png"), "a broken file is refused");
}

// --- one step of work, with the network and the storage replaced
const bytesOf = (i: number) => solid(10 + i, 10).png().toBuffer();

function setup(files: Record<string, Buffer | Error>, over: Partial<BatchDeps> = {}) {
  const uploads: { file: string; bytes: number }[] = [];
  const downloads: string[] = [];
  let live = 0;
  let peak = 0;
  const deps: BatchDeps = {
    download: async (url) => {
      downloads.push(url);
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      const hit = files[url];
      if (hit instanceof Error) throw hit;
      if (!hit) throw new ImportFetchError("network", "finnes ikke");
      return hit;
    },
    allowed: async () => true,
    upload: async (file, bytes) => void uploads.push({ file, bytes: bytes.length }),
    ...over,
  };
  return { deps, uploads, downloads, peak: () => peak };
}
const input = (todo: string[], over: Partial<Parameters<typeof processBatch>[0]> = {}) => ({ todo, knownHashes: new Set<string>(), bytesLeft: 1e9, storageLeft: 1e9, deadline: Date.now() + 60_000, ...over });

{
  const a = await bytesOf(1);
  const b = await bytesOf(2);
  const s = setup({ "https://x/a.png": a, "https://x/a-kopi.png": a, "https://x/b.png": b });
  const r = await processBatch(input(["https://x/a.png", "https://x/a-kopi.png", "https://x/b.png"]), s.deps);
  assert.equal(r.stored.length, 3);
  assert.equal(r.stoppedBy, "done");
  assert.equal(r.remaining.length, 0);
  assert.equal(s.uploads.length, 2, "the same picture twice is stored once");
  const [one, two] = [r.stored.find((x) => x.sourceUrl.endsWith("a.png"))!, r.stored.find((x) => x.sourceUrl.endsWith("a-kopi.png"))!];
  assert.deepEqual([one.hash, one.file], [two.hash, two.file]);
  assert.match(one.file, /^[0-9a-f]{12}\.webp$/);
  assert.match(one.hash, /^[0-9a-f]{64}$/, "a hash of the stored file");
  assert.ok(s.peak() <= MEDIA_LIMITS.concurrency, "never more than four at a time");
  assert.equal(r.bytesStored, s.uploads.reduce((n, u) => n + u.bytes, 0));
  assert.equal(r.bytesDownloaded, a.length * 2 + b.length);

  // A picture already in the job is not stored again, but still gets its mapping
  const again = setup({ "https://x/a.png": a });
  const known = await processBatch(input(["https://x/a.png"], { knownHashes: new Set([one.hash]) }), again.deps);
  assert.equal(known.stored.length, 1);
  assert.equal(again.uploads.length, 0);
}

{
  const ok = await bytesOf(3);
  const s = setup(
    {
      "https://x/ok.png": ok,
      "https://x/side.html": Buffer.from("<html>nei</html>"),
      "https://x/svg.svg": Buffer.from('<svg onload="x()"></svg>'),
      "https://x/intern": new ImportFetchError("blocked", "intern"),
      "https://x/stor": new ImportFetchError("too-large", "stor"),
      "https://x/type": new ImportFetchError("bad-type", "type"),
      "https://x/borte": new ImportFetchError("network", "borte"),
    },
    { allowed: async (u) => !u.includes("robot") },
  );
  const urls = ["https://x/ok.png", "https://x/side.html", "https://x/svg.svg", "https://x/intern", "https://x/stor", "https://x/type", "https://x/borte", "https://x/robot.png", "https://x/finnes-ikke"];
  const r = await processBatch(input(urls), s.deps);
  assert.deepEqual(Object.fromEntries(r.failed.map((f) => [f.sourceUrl.split("/").pop(), f.reason])), { "side.html": "not-image", "svg.svg": "not-image", intern: "blocked", stor: "too-large", type: "not-image", borte: "network", "robot.png": "robots", "finnes-ikke": "network" });
  assert.equal(r.stored.length, 1);
  assert.ok(!s.downloads.includes("https://x/robot.png"), "a picture robots.txt forbids is never fetched");

  // Not a picture because the optimizer refuses it, and an upload that fails
  const broken = setup({ "https://x/ok.png": ok }, { optimize: async () => { throw new Error("kaput"); } });
  assert.deepEqual((await processBatch(input(["https://x/ok.png"]), broken.deps)).failed, [{ sourceUrl: "https://x/ok.png", reason: "not-image" }]);
  const down = setup({ "https://x/ok.png": ok }, { upload: async () => { throw new Error("lagring nede"); } });
  const failed = await processBatch(input(["https://x/ok.png"]), down.deps);
  assert.deepEqual([failed.stored.length, failed.failed[0]!.reason, failed.bytesStored], [0, "network", 0], "a picture that could not be stored does not count as stored");
}

{
  const imgs = await Promise.all([1, 2, 3, 4, 5, 6].map(bytesOf));
  const files = Object.fromEntries(imgs.map((b, i) => [`https://x/${i}.png`, b]));
  const urls = Object.keys(files);
  // Time: the clock has run out before the work starts, so nothing is begun and everything is left
  const late = await processBatch(input(urls, { deadline: 100 }), setup(files, { now: () => 200 }).deps);
  assert.deepEqual([late.stored.length, late.remaining.length, late.stoppedBy], [0, 6, "time"]);
  // Time again: the clock passes during the work, and the rest is left for the next step
  let t = 0;
  const mid = await processBatch(input(urls, { deadline: 3 }), setup(files, { now: () => t++ }).deps);
  assert.equal(mid.stoppedBy, "time");
  assert.ok(mid.stored.length > 0 && mid.remaining.length > 0 && mid.stored.length + mid.remaining.length === 6, "what was started is finished, what was not is left, and nothing is lost");
  // Download limit: when the job has fetched what it may, it stops and says so
  const limited = await processBatch(input(urls, { bytesLeft: imgs[0]!.length * 2 }), setup(files).deps);
  assert.equal(limited.stoppedBy, "limit");
  assert.ok(limited.remaining.length > 0);
  // Storage quota: a new picture that does not fit is refused, and the user's space is not exceeded
  const roomy = (await optimize(imgs[0]!, "image/png")).bytes.length;
  const tight = await processBatch(input(urls, { storageLeft: roomy + 1 }), setup(files).deps);
  assert.ok(tight.bytesStored <= roomy + 1, "never more than the space left");
  assert.ok(tight.failed.some((f) => f.reason === "quota") || tight.stoppedBy === "quota");
  const none = await processBatch(input(urls, { storageLeft: 0 }), setup(files).deps);
  assert.deepEqual([none.stored.length, none.stoppedBy], [0, "quota"]);
}

// --- pointing the model at the stored pictures
{
  const image = (src: string): Block => ({ type: "image", src, alt: "", });
  const page: Page = { id: "page-1", kind: "page", url: "https://x/om", path: "/om", slug: "om", title: "Om", parent: null, excerpt: "", seo: {}, featuredImage: "https://x/a.png", signals: [], blocks: [image("https://x/a.png"), { type: "columns", columns: [[image("https://x/b.png")], [image("https://x/borte.png")]] }, { type: "gallery", images: [{ src: "https://x/a.png", alt: "" }] }] };
  const media: Media[] = ["a", "b", "borte"].map((n) => ({ id: n, sourceUrl: `https://x/${n}.png`, mime: "image/png", alt: "", usedBy: ["page-1"] }));
  const model: SiteModel = { source: "wordpress", url: "https://x", name: "X", description: "", language: null, nav: [], pages: [page], media, plugins: [], warnings: [], truncated: false, stats: { pages: 1, posts: 0, media: 3, blocks: 0, unknownBlocks: 0, requests: 0, ms: 0 } };
  const row = (n: string, file: string): AssetRow => ({ source_url: `https://x/${n}.png`, hash: file.repeat(5).slice(0, 64).padEnd(64, "0"), file: `${file.repeat(12).slice(0, 12)}.webp`, mime: "image/webp", bytes: 1000, width: 400, height: 300, failed: null });
  const out = applyAssets(model, [row("a", "a"), row("b", "b"), { source_url: "https://x/borte.png", hash: null, file: null, mime: null, bytes: null, width: null, height: null, failed: "network" }]);
  const p = out.pages[0]!;
  assert.equal(p.featuredImage, "/images/aaaaaaaaaaaa.webp");
  assert.equal((p.blocks[0] as Extract<Block, { type: "image" }>).src, "/images/aaaaaaaaaaaa.webp");
  const cols = (p.blocks[1] as Extract<Block, { type: "columns" }>).columns;
  assert.equal((cols[0]![0] as Extract<Block, { type: "image" }>).src, "/images/bbbbbbbbbbbb.webp");
  assert.equal((cols[1]![0] as Extract<Block, { type: "image" }>).src, "https://x/borte.png", "a picture that could not be stored keeps its old address");
  assert.equal((p.blocks[2] as Extract<Block, { type: "gallery" }>).images[0]!.src, "/images/aaaaaaaaaaaa.webp");
  assert.deepEqual(out.media.find((m) => m.id === "a")!.stored, { file: "aaaaaaaaaaaa.webp", hash: row("a", "a").hash!, bytes: 1000, width: 400, height: 300 });
  assert.equal(out.media.find((m) => m.id === "borte")!.failed, "network");
  assert.match(out.warnings.join(" "), /1 bilder kunne ikke lagres/);
  assert.equal(model.pages[0]!.featuredImage, "https://x/a.png", "the original model is not changed");
}

// --- the job in the database, against an in-memory stand-in
function memoryDb(initialQuota = 0) {
  const tables: Record<string, Record<string, unknown>[]> = { import_jobs: [], import_assets: [] };
  const objects = new Map<string, number>();
  const calls: string[] = [];
  let used = initialQuota;
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    let patch: Record<string, unknown> | null = null;
    const rows = () => tables[table]!.filter((r) => filters.every(([k, v]) => r[k] === v));
    const chain = {
      select: () => chain,
      eq: (k: string, v: unknown) => (filters.push([k, v]), chain),
      limit: () => chain,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      insert: (row: Record<string, unknown>) => {
        const item = { id: `${table}-${tables[table]!.length + 1}`, status: "fetched", ...row };
        tables[table]!.push(item);
        return chain;
      },
      upsert: async (records: Record<string, unknown>[]) => {
        calls.push(`upsert:${records.length}`);
        for (const r of records) if (!tables[table]!.some((x) => x.job_id === r.job_id && x.source_url === r.source_url)) tables[table]!.push(r);
        return { error: null };
      },
      update: (p: Record<string, unknown>) => ((patch = p), chain),
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        if (patch) for (const r of rows()) Object.assign(r, patch);
        resolve({ data: rows(), error: null });
      },
    };
    return chain;
  };
  const db = {
    from: (table: string) => query(table),
    rpc: async (name: string) => (name === "import_bytes_used" ? { data: used, error: null } : { data: null, error: { message: "unknown" } }),
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Buffer) => {
          if (objects.has(path)) return { error: { message: "The resource already exists", statusCode: "409" } };
          objects.set(path, bytes.length);
          used += bytes.length;
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://db.example/storage/v1/object/public/pivolar-assets/${path}` } }),
      }),
    },
  };
  return { db: db as never, tables, objects, calls };
}

{
  const urls = Array.from({ length: 5 }, (_, i) => `https://x/${i}.png`);
  const imgs = await Promise.all(urls.map((_, i) => bytesOf(i + 10)));
  const files = Object.fromEntries(urls.map((u, i) => [u, imgs[i]!]));
  const media: Media[] = urls.map((u, i) => ({ id: String(i), sourceUrl: u, mime: "image/png", alt: "", usedBy: ["page-1"] }));
  const model = { source: "wordpress", url: "https://x", name: "X", description: "", language: null, nav: [], pages: [{ id: "page-1", kind: "page", url: "https://x/", path: "/", slug: "", title: "Hjem", parent: null, excerpt: "", seo: {}, featuredImage: null, signals: [], blocks: [{ type: "image", src: urls[0], alt: "" }] }], media, plugins: [], warnings: [], truncated: false, stats: { pages: 1, posts: 0, media: 5, blocks: 1, unknownBlocks: 0, requests: 1, ms: 1 } } as SiteModel;
  const { db, tables, objects } = memoryDb();
  const jobId = await saveJob(db, "u1", "https://x", model);
  assert.equal(tables.import_jobs.length, 1);
  assert.equal(tables.import_jobs[0]!.owner_id, "u1");
  assert.equal(tables.import_jobs[0]!.media_total, 5);
  const download = async (u: string) => files[u]!;
  const deps = { download, allowed: async () => true };

  // First step stops for time after the first picture, the second finishes the job
  let t = 0;
  const first = await runImagesStep(db, "u1", jobId, { ...deps, now: () => ((t += 20_000), t) });
  assert.ok(first.remaining > 0 && first.remaining < 5, "some done, some left");
  assert.equal(first.status, "fetched");
  const second = await runImagesStep(db, "u1", jobId, deps);
  assert.deepEqual([second.remaining, second.status], [0, "images_done"]);
  assert.equal(tables.import_assets.length, 5);
  assert.equal(tables.import_jobs[0]!.status, "images_done");
  assert.ok([...objects.keys()].every((k) => k.startsWith(`u1/${jobId}/`)), "files live in the user's own folder, under the job");
  const again = await runImagesStep(db, "u1", jobId, deps);
  assert.deepEqual([again.stored, again.remaining], [0, 0], "a finished job does nothing more");

  const loaded = await loadModel(db, "u1", jobId);
  assert.ok(loaded);
  assert.equal(loaded.assets.length, 5);
  assert.match(loaded.assets[0]!.url, /^https:\/\/db\.example\/storage\/v1\/object\/public\/pivolar-assets\/u1\//);
  const first0 = loaded.model.pages[0]!.blocks[0] as Extract<Block, { type: "image" }>;
  assert.match(first0.src, /^\/images\/[0-9a-f]{12}\.webp$/);
  assert.equal(await loadModel(db, "u1", "finnes-ikke"), null);
  await assert.rejects(runImagesStep(db, "u1", "finnes-ikke", deps), ImportFetchError);
}

{
  // More pictures than the limit: the rest is given up on, once, and says why
  const many = Array.from({ length: MEDIA_LIMITS.count + 3 }, (_, i) => `https://x/${i}.png`);
  const model = { source: "wordpress", url: "https://x", name: "X", description: "", language: null, nav: [], pages: [], media: many.map((u, i) => ({ id: String(i), sourceUrl: u, mime: "image/png", alt: "", usedBy: ["page-1"] })), plugins: [], warnings: [], truncated: false, stats: { pages: 0, posts: 0, media: many.length, blocks: 0, unknownBlocks: 0, requests: 0, ms: 0 } } as SiteModel;
  const { db, tables } = memoryDb();
  const jobId = await saveJob(db, "u1", "https://x", model);
  const pic = await bytesOf(50);
  let calls = 0;
  const deps = { download: async () => (calls++, pic), allowed: async () => true, quotaBytes: 1e12 };
  let guard = 0;
  while ((await runImagesStep(db, "u1", jobId, deps)).status !== "images_done" && guard++ < 200);
  const beyond = tables.import_assets.filter((r) => r.failed === "limit");
  assert.equal(beyond.length, 3, "the three beyond the limit were given up on");
  assert.equal(calls, MEDIA_LIMITS.count, "and only the pictures within the limit were fetched");
}

{
  // Pictures no page shows, and sound and video, are never fetched
  const model = { source: "wordpress", url: "https://x", name: "X", description: "", language: null, nav: [], pages: [], media: [
    { id: "1", sourceUrl: "https://x/vist.png", mime: "image/png", alt: "", usedBy: ["page-1"] },
    { id: "2", sourceUrl: "https://x/ubrukt.png", mime: "image/png", alt: "", usedBy: [] },
    { id: "3", sourceUrl: "https://x/sang.mp3", mime: "audio/mpeg", alt: "", usedBy: ["page-1"] },
    { id: "4", sourceUrl: "https://x/film.mp4", mime: "video/mp4", alt: "", usedBy: ["page-1"] },
  ], plugins: [], warnings: [], truncated: false, stats: { pages: 0, posts: 0, media: 4, blocks: 0, unknownBlocks: 0, requests: 0, ms: 0 } } as SiteModel;
  const { db } = memoryDb();
  const jobId = await saveJob(db, "u1", "https://x", model);
  const fetched: string[] = [];
  const pic = await bytesOf(50);
  const report = await runImagesStep(db, "u1", jobId, { download: async (u: string) => (fetched.push(u), pic), allowed: async () => true, quotaBytes: 1e12 });
  assert.deepEqual(fetched, ["https://x/vist.png"], "only the picture a page shows is fetched");
  assert.equal(report.total, 1);
}

{
  // The user's space: when it is used up, the job ends and the pictures that did not fit are marked
  const urls = ["https://x/1.png", "https://x/2.png"];
  const pic = await bytesOf(60);
  const model = { source: "wordpress", url: "https://x", name: "X", description: "", language: null, nav: [], pages: [], media: urls.map((u, i) => ({ id: String(i), sourceUrl: u, mime: "image/png", alt: "", usedBy: ["page-1"] })), plugins: [], warnings: [], truncated: false, stats: { pages: 0, posts: 0, media: 2, blocks: 0, unknownBlocks: 0, requests: 0, ms: 0 } } as SiteModel;
  const { db, tables } = memoryDb(1_000);
  const jobId = await saveJob(db, "u1", "https://x", model);
  const report = await runImagesStep(db, "u1", jobId, { download: async () => pic, allowed: async () => true, quotaBytes: 1_000 });
  assert.deepEqual([report.stored, report.remaining, report.status], [0, 0, "images_done"]);
  assert.deepEqual(tables.import_assets.map((r) => r.failed), ["quota", "quota"]);
}

// --- the database: who can do what
{
  const sql = read("supabase/migrations/20261024180000_pivolar_import_assets.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(code, /alter table public\.import_jobs enable row level security/);
  assert.match(code, /alter table public\.import_assets enable row level security/);
  assert.match(code, /revoke all on public\.import_jobs, public\.import_assets from anon/);
  assert.doesNotMatch(code, /to anon/i, "nothing here is open to the public");
  assert.match(code, /create policy import_assets_insert[\s\S]*exists \(select 1 from public\.import_jobs j where j\.id = job_id and j\.owner_id = \(select auth\.uid\(\)\)\)/, "a picture can only be added to the user's own job");
  assert.match(code, /allowed_mime_types = excluded\.allowed_mime_types/);
  assert.match(code, /array\['image\/webp', 'image\/png', 'image\/jpeg', 'image\/gif', 'image\/avif'\]/, "pictures only, and no SVG, which can carry script");
  assert.doesNotMatch(code, /image\/svg/);
  assert.match(code, /file_size_limit[\s\S]*10485760/);
  for (const op of ["insert", "select", "delete"]) assert.match(code, new RegExp(`create policy pivolar_assets_${op} on storage\\.objects for ${op} to authenticated[\\s\\S]*?\\(storage\\.foldername\\(name\\)\\)\\[1\\] = \\(select auth\\.uid\\(\\)\\)::text`), `${op} is limited to the user's own folder`);
  assert.match(code, /create function public\.import_bytes_used\(\)[\s\S]*security invoker set search_path = ''/);
  assert.match(code, /grant execute on function public\.import_bytes_used\(\) to authenticated/);
  assert.match(code, /file text check \(file ~ '\^\[0-9a-f\]\{12\}/, "a file name can only be a hash and an extension, so a path cannot be smuggled in");
  assert.match(code, /unique \(job_id, source_url\)/);
}

// --- the route
{
  const route = read("src/app/api/import/cms/route.ts");
  assert.match(route, /limit\(step \? "importstep" : "import"\)/);
  assert.ok(route.indexOf("limit(step") < route.indexOf("await probeWordPress"), "the allowance is counted before any fetching");
  assert.match(route, /confirmOwner: z\.literal\(true\)/);
  assert.match(route, /job: z\.string\(\)\.uuid\(\)/, "a job id is a real id");
  assert.doesNotMatch(route, /openAiGate|streamText|generateText/);
  const job = read("src/lib/import/job.ts");
  assert.match(job, /\$\{userId\}\/\$\{jobId\}\/\$\{file\}/, "files go under the user's own folder");
  assert.match(job, /safeFetch\(url/, "pictures are fetched through the safe fetcher");
  assert.match(job, /createRobots\(\)/, "robots.txt is followed for pictures too");
  assert.doesNotMatch(read("src/lib/import/media.ts"), /\bfetch\(/);
}

console.log("media: all ok");
