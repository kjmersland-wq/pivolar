import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { strToU8, Zip, ZipDeflate, zipSync } from "fflate";
import { downloadBranchThin, GITHUB_READ_OPTIONS, isPublicRepo } from "../src/lib/github/repo.ts";
import { THIN_LIMITS, thinArchive } from "../src/lib/github/thin.ts";
import { ImportError, readZip } from "../src/lib/zip/read.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ROOT = "owner-repo-abc123/";

/** The bytes of a stream in pieces of the given sizes, as a network would deliver them. */
function stream(bytes: Uint8Array, sizes: number[] = [64 * 1024]): ReadableStream<Uint8Array> {
  let at = 0;
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      const size = sizes[i++ % sizes.length]!;
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

/** A repository the way GitHub packs it: one folder, entries written as a stream with sizes after the data. */
function github(files: Record<string, Uint8Array>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  for (const [name, data] of Object.entries(files)) {
    const entry = new ZipDeflate(`${ROOT}${name}`, { level: 0 });
    zip.add(entry);
    entry.push(data, true);
  }
  zip.end();
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) (out.set(c, at), (at += c.length));
  return out;
}

const text = (s: string) => strToU8(s);
const noise = (size: number) => {
  // Not compressible, so the archive really is as big as its content.
  const out = new Uint8Array(size);
  let x = 12345;
  for (let i = 0; i < size; i++) (x = (x * 1103515245 + 12345) & 0x7fffffff), (out[i] = x >> 16);
  return out;
};

const repo = {
  "package.json": text('{"scripts":{"dev":"vite"}}'),
  "src/App.tsx": text("export default function App() { return <h1>Hei</h1>; }\n"),
  "README.md": text("# Slow blues\n"),
  "public/logo.png": noise(30_000),
  "assets/song.mp3": noise(60_000),
  "node_modules/dep/index.js": text("module.exports = 1;\n"),
  "data/big.json": text(JSON.stringify({ rows: "x".repeat(200_000) })),
  "src/huge.ts": text("// " + "y".repeat(400_000)),
  ".env": text("API_KEY=abc\n"),
  "src/empty.ts": new Uint8Array(0),
};

// --- a big repository is read as it arrives, and only what can be kept is held
{
  const archive = github(repo);
  const big = github({ ...repo, "assets/film.mp4": noise(11_000_000) });
  assert.ok(big.length > 11_000_000, "a repository bigger than the old limit of 10 MB for the archive");
  const bigThin = await thinArchive(stream(big, [64 * 1024]), { fileBytes: GITHUB_READ_OPTIONS.fileBytes });
  assert.ok(bigThin.zip.length < 5_000, "and still only the small files are kept");
  assert.deepEqual(Object.keys(readZip(bigThin.zip, GITHUB_READ_OPTIONS).files).sort(), ["/README.md", "/package.json", "/src/App.tsx", "/src/empty.ts"]);
  assert.equal(bigThin.stats.downloadedBytes, big.length);
  for (const sizes of [[64 * 1024], [1], [7, 4000, 33], [archive.length]]) {
    const thin = await thinArchive(stream(archive, sizes), { fileBytes: GITHUB_READ_OPTIONS.fileBytes });
    assert.ok(thin.zip.length < 5_000, `only the small files are kept (${thin.zip.length} bytes)`);
    const result = readZip(thin.zip, GITHUB_READ_OPTIONS);
    assert.deepEqual(Object.keys(result.files).sort(), ["/README.md", "/package.json", "/src/App.tsx", "/src/empty.ts"], JSON.stringify(sizes));
    assert.deepEqual(result.omittedSecrets.map((s) => s.path), [".env"], "files that may hold secrets go through the same check");
    const reasons = Object.fromEntries(thin.dropped.map((d) => [d.path, d.reason]));
    assert.match(reasons["public/logo.png"]!, /binærfil/);
    assert.match(reasons["assets/song.mp3"]!, /binærfil/);
    assert.match(reasons["node_modules/dep/index.js"]!, /avhengighetsmappe/);
    assert.match(reasons["data/big.json"]!, /stor datafil/);
    assert.match(reasons["src/huge.ts"]!, /stor datafil/);
    assert.equal(thin.droppedCount, 5);
    assert.equal(thin.stats.downloadedBytes, archive.length);
  }
}

// --- an archive packed the usual way (sizes in the headers) reads the same
{
  const packed = zipSync(Object.fromEntries(Object.entries(repo).map(([name, data]) => [`${ROOT}${name}`, data])));
  const thin = await thinArchive(stream(packed, [4096]), { fileBytes: GITHUB_READ_OPTIONS.fileBytes });
  assert.deepEqual(Object.keys(readZip(thin.zip, GITHUB_READ_OPTIONS).files).sort(), ["/README.md", "/package.json", "/src/App.tsx", "/src/empty.ts"]);
}

// --- the limits hold
{
  const small = github({ "a.ts": text("export const a = 1;\n"), "b.ts": text("export const b = 2;\n") });
  const original = { ...THIN_LIMITS };
  try {
    THIN_LIMITS.downloadBytes = 50;
    await assert.rejects(thinArchive(stream(small, [10]), { fileBytes: 150_000 }), (e) => e instanceof ImportError && /for stort/.test(e.message), "reading stops at the limit");
    THIN_LIMITS.downloadBytes = original.downloadBytes;
    THIN_LIMITS.entries = 1;
    await assert.rejects(thinArchive(stream(small), { fileBytes: 150_000 }), /for mange filer/);
    THIN_LIMITS.entries = original.entries;
    THIN_LIMITS.keptFiles = 1;
    const thin = await thinArchive(stream(small), { fileBytes: 150_000 });
    assert.equal(thin.stats.kept, 1);
    assert.match(thin.dropped[0]!.reason, /for mange filer/);
    THIN_LIMITS.keptFiles = original.keptFiles;
    THIN_LIMITS.keptBytes = 25;
    const bytes = await thinArchive(stream(small), { fileBytes: 150_000 });
    assert.equal(bytes.stats.kept, 1, "what does not fit is left out, not the whole import");
    assert.match(bytes.dropped[0]!.reason, /for mye tekst/);
    THIN_LIMITS.keptBytes = original.keptBytes;
    THIN_LIMITS.listed = 1;
    const many = await thinArchive(stream(github({ "node_modules/a.js": text("1"), "node_modules/b.js": text("2"), "node_modules/c.js": text("3"), "x.ts": text("x") })), { fileBytes: 150_000 });
    assert.deepEqual([many.dropped.length, many.droppedCount], [1, 3], "a long list is cut, and the rest is counted");
  } finally {
    Object.assign(THIN_LIMITS, original);
  }
  let t = 0;
  await assert.rejects(thinArchive(stream(small, [10]), { fileBytes: 150_000, now: () => (t += 60_000) }), /tok for lang tid/);
  // Paths that try to leave the folder, and broken data
  const evil = zipSync({ [`${ROOT}../../etc/passwd`]: text("x") });
  await assert.rejects(thinArchive(stream(evil), { fileBytes: 150_000 }), (e) => e instanceof ImportError && /avvist/.test(e.message));
  await assert.rejects(thinArchive(stream(strToU8("dette er ikke en zip-fil, men lang nok til å prøves ".repeat(20))), { fileBytes: 150_000 }).then((t2) => readZip(t2.zip)), ImportError);
}

// --- the whole download, against a fake GitHub
function fakeGitHub(options: { sizeKb?: number; body?: ReadableStream<Uint8Array> | null; isPrivate?: boolean } = {}) {
  const calls: { url: string; auth: string | null }[] = [];
  const archive = github(repo);
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init.headers).get("authorization") });
    if (url.endsWith("/repos/owner/repo")) return Response.json({ default_branch: "main", private: options.isPrivate ?? false, size: options.sizeKb ?? 127_000, html_url: "https://github.com/owner/repo" });
    if (url.includes("/commits/")) return Response.json({ sha: "a".repeat(40) });
    if (url.includes("/zipball/")) return new Response(options.body === undefined ? stream(archive, [32 * 1024]) : options.body);
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}
{
  const api = fakeGitHub();
  const { source, thin } = await downloadBranchThin({ owner: "owner", repo: "repo" }, "tok", GITHUB_READ_OPTIONS.fileBytes, api.fetcher);
  assert.deepEqual([source.branch, source.sha, source.private], ["main", "a".repeat(40), false]);
  assert.equal(thin.stats.kept, 5, "the four text files and the secrets file, which the ZIP reader then leaves out");
  assert.ok(api.calls.some((c) => c.url.endsWith(`/zipball/${"a".repeat(40)}`)), "that exact commit is read");
  assert.ok(api.calls.every((c) => c.url.startsWith("https://api.github.com/") && c.auth === "Bearer tok"));
  // A repository of 127 MB is no longer refused for its size; one over 500 MB still is
  await assert.rejects(downloadBranchThin({ owner: "owner", repo: "repo" }, undefined, 150_000, fakeGitHub({ sizeKb: 600_000 }).fetcher), (e: Error & { status?: number }) => /for stort \(600 MB, maks 500 MB\)/.test(e.message) && e.status === 413);
  await assert.rejects(downloadBranchThin({ owner: "owner", repo: "repo" }, undefined, 150_000, fakeGitHub({ body: null }).fetcher), /sendte ikke noe innhold/);
}

// --- who can read a repository without a key
{
  const seen: (string | null)[] = [];
  const answer = (status: number, body: unknown) => (async (_url: string | URL | Request, init: RequestInit = {}) => (seen.push(new Headers(init.headers).get("authorization")), new Response(JSON.stringify(body), { status }))) as typeof fetch;
  assert.equal(await isPublicRepo({ owner: "o", repo: "r" }, answer(200, { private: false })), true);
  assert.equal(await isPublicRepo({ owner: "o", repo: "r" }, answer(200, { private: true })), false);
  assert.equal(await isPublicRepo({ owner: "o", repo: "r" }, answer(404, {})), false, "a repository that cannot be seen is treated as private");
  assert.equal(await isPublicRepo({ owner: "o", repo: "r" }, (async () => { throw new Error("down"); }) as typeof fetch), false);
  assert.ok(seen.every((a) => a === null), "asked without the key");
}

// --- the preview of a big repository, and the import route
{
  const runner = read("src/app/api/runner/route.ts");
  assert.match(runner, /isPublicRepo\(\{ owner: body\.github\.owner, repo: body\.github\.repo \}\)/);
  assert.match(runner, /source: \{ type: "git" as const, url: `https:\/\/github\.com\/\$\{body\.github\.owner\}\/\$\{body\.github\.repo\}\.git`, revision: body\.github\.sha \}/, "a public repository is cloned inside the machine");
  assert.doesNotMatch(runner, /password|username/, "no credential goes into the machine");
  assert.match(runner, /if \(body\.github && !publicRepo\) \{[\s\S]*downloadBranch\(/, "a private one is still copied in from here");
  const route = read("src/app/api/github/import/route.ts");
  assert.match(route, /downloadBranchThin\(/);
  assert.doesNotMatch(route, /downloadBranch\(/, "the import no longer downloads the whole archive in one piece");
  assert.match(route, /\.\.\.thin\.dropped/, "what was left out is reported");
}

console.log("github-thin: all ok");
