import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { UIMessage } from "ai";
import { applyTool, deriveFiles, TEMPLATE, UPLOADS_PATH, visibleFiles, PROTECTED_PATHS } from "../src/lib/files.ts";
import { openPullRequest } from "../src/lib/github/pr.ts";
import { buildDeployableProject } from "../src/lib/publish/project.ts";
import { bundleStorageImages } from "../src/lib/publish/storage-images.ts";
import { RATES } from "../src/lib/quota/config.ts";
import { collectUploads, COLLECT_LIMITS } from "../src/lib/uploads/collect.ts";
import { BUCKET, checkUpload, localizeUploads, MIME_TYPES, publicUrl, safeName, storagePath, TYPES, UPLOAD_LIMITS, uploadsOf, uploadsSection, withUploads, type Upload } from "../src/lib/uploads/rules.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DB = "https://abc.supabase.co";
const url = (path: string) => publicUrl(DB, path);
const up = (name: string, over: Partial<Upload> = {}): Upload => ({ name, url: url(`u1/p1/ab12-${name}`), mime: TYPES[name.split(".").pop()!]!, bytes: 5000, ...over });

// --- names
assert.equal(safeName("Mitt Bilde (1).JPG"), "mitt-bilde-1.jpg");
assert.equal(safeName("Grünerløkka åpning.png"), "grunerlokka-apning.png");
assert.equal(safeName("../../etc/passwd.mp3"), "passwd.mp3");
assert.equal(safeName("C:\\folder\\lyd.WAV"), "lyd.wav");
assert.match(safeName("***.pdf"), /^fil\.pdf$/);
assert.equal(safeName("x".repeat(200) + ".png").length <= 65, true);

// --- what may be added
{
  for (const ok of ["a.png", "A.JPG", "b.jpeg", "c.webp", "d.gif", "e.avif", "f.mp3", "g.m4a", "h.aac", "i.ogg", "j.wav", "k.webm", "l.pdf"]) assert.equal(checkUpload({ name: ok, size: 1000 }).ok, true, ok);
  for (const bad of ["a.svg", "a.html", "a.htm", "a.js", "a.exe", "a.php", "a.zip", "a.mp4", "a", "x.png.exe", "x.html.svg", ".htaccess"]) assert.equal(checkUpload({ name: bad, size: 1000 }).ok, false, bad);
  const evil = checkUpload({ name: "x.html.png", size: 1000 });
  assert.ok(evil.ok && evil.name === "x-html.png" && evil.mime === "image/png", "a double ending cannot hide a page");
  assert.equal(checkUpload({ name: "a.png", size: 0 }).ok, false);
  assert.equal(checkUpload({ name: "a.png", size: -5 }).ok, false);
  assert.equal(checkUpload({ name: "a.png", size: Number.NaN }).ok, false);
  assert.equal(checkUpload({ name: "a.png", size: UPLOAD_LIMITS.fileBytes + 1 }).ok, false);
  assert.equal(checkUpload({ name: "a.png", size: UPLOAD_LIMITS.fileBytes }).ok, true);
  assert.equal(checkUpload({ name: "a.png", size: 10, type: "text/html" }).ok, false, "the browser says it is a page");
  assert.equal(checkUpload({ name: "a.png", size: 10, type: "image/png" }).ok, true);
  assert.equal(checkUpload({ name: "a.wav", size: 10, type: "audio/x-wav" }).ok, true);
  assert.equal(checkUpload({ name: "a.mp3", size: 10, type: "" }).ok, true, "some browsers give no type");
  assert.equal(checkUpload({ name: 5, size: 10 }).ok, false);
  assert.ok(MIME_TYPES.every((m) => /^(image|audio)\/|^application\/pdf$/.test(m)) && !MIME_TYPES.some((m) => /svg|html|javascript|xml/.test(m)));
  assert.equal(storagePath("u1", "p1", "a.png", "ab12"), "u1/p1/ab12-a.png");
  assert.equal(publicUrl("https://abc.supabase.co/", "u1/p1/x.png"), `https://abc.supabase.co/storage/v1/object/public/${BUCKET}/u1/p1/x.png`);
}

// --- the list in the project
{
  const good = [up("hero.jpg"), up("song.mp3"), up("brosjyre.pdf", { bytes: 2_000_000 })];
  const edits = withUploads([{ at: 3, path: "/App.tsx", content: "x" }], good);
  assert.deepEqual(edits[0]!.at, 0);
  assert.equal(edits.length, 2, "the other edits are untouched");
  assert.equal(withUploads(edits, []).length, 1, "an empty list removes it");
  assert.equal(withUploads(edits, good).filter((e) => e.path === UPLOADS_PATH).length, 1, "one list, replaced");
  const files = deriveFiles([{ id: "1", role: "user", parts: [{ type: "text", text: "hei" }] } as UIMessage], edits);
  assert.deepEqual(uploadsOf(files, DB).map((u) => u.name), ["hero.jpg", "song.mp3", "brosjyre.pdf"], "the list is part of the project");

  // A list that has been tampered with is cut down to what is valid
  const dirty = JSON.stringify([
    up("ok.png"),
    { ...up("a.png"), url: "https://evil.example/x.png" },
    { ...up("b.png"), url: `${DB}/storage/v1/object/public/other-bucket/u1/b.png` },
    { ...up("c.png"), url: `${DB}/storage/v1/object/public/${BUCKET}/../../x.png` },
    { ...up("d.png"), url: `${url("u1/p1/d.png")}"onerror="x` },
    { ...up("e.png"), mime: "text/html" },
    { ...up("f.png"), bytes: UPLOAD_LIMITS.fileBytes + 1 },
    { ...up("g.png"), name: "../g.png" },
    { ...up("h.png"), name: "H.PNG" },
    "text",
    null,
    { name: "i.png" },
  ]);
  assert.deepEqual(uploadsOf({ [UPLOADS_PATH]: dirty }, DB).map((u) => u.name), ["ok.png"]);
  assert.deepEqual(uploadsOf({ [UPLOADS_PATH]: "ikke json" }, DB), []);
  assert.deepEqual(uploadsOf({ [UPLOADS_PATH]: "{}" }, DB), []);
  assert.deepEqual(uploadsOf({}, DB), []);
  assert.equal(uploadsOf({ [UPLOADS_PATH]: JSON.stringify(Array.from({ length: 300 }, (_, i) => up(`f${i}.png`))) }, DB).length, UPLOAD_LIMITS.perProject);
}

// --- hidden and protected, like the standing instructions
{
  assert.ok(PROTECTED_PATHS.has(UPLOADS_PATH));
  const files = deriveFiles([], withUploads([], [up("hero.jpg")]));
  assert.ok(UPLOADS_PATH in files && !(UPLOADS_PATH in visibleFiles(files)), "not shown to the AI or in the editor");
  assert.equal(applyTool({ ...TEMPLATE }, "writeFile", { path: UPLOADS_PATH, content: "[]" }).ok, false, "the AI cannot change it");
  const published = buildDeployableProject({ ...files, "/App.tsx": "export default function App(){return null}" }, "Test");
  assert.ok(!JSON.stringify(published).includes("hero.jpg") && !Object.keys(published).some((p) => /uploads/i.test(p)), "never published");
  assert.match(read("src/app/api/export/route.ts"), /!PROTECTED_PATHS\.has\(path\)/);
}

// --- what the AI is told
{
  assert.equal(uploadsSection({}, DB), "");
  const section = uploadsSection(deriveFiles([], withUploads([], [up("hero.jpg"), up("song.mp3")])), DB);
  assert.match(section, /^FILER EIEREN HAR LAGT TIL/);
  assert.ok(section.includes(url("u1/p1/ab12-hero.jpg")) && section.includes("audio/mpeg"));
  assert.match(section, /Ikke finn på filnavn/);
  assert.match(read("src/app/api/chat/route.ts"), /\$\{uploadsSection\(all, process\.env\.NEXT_PUBLIC_SUPABASE_URL\)\}\$\{section\}/);
}

// --- when the files leave Pivolar, the code stops depending on Pivolar's storage
{
  const list = [up("hero.jpg"), up("song.mp3"), up("ubrukt.pdf")];
  const code = { "/App.tsx": `<img src="${list[0]!.url}" /><audio src="${list[1]!.url}" /><img src="${list[0]!.url}" />`, "/styles.css": "body{}" };
  const { files, used } = localizeUploads(code, list);
  assert.equal(files["/App.tsx"], '<img src="/uploads/hero.jpg" /><audio src="/uploads/song.mp3" /><img src="/uploads/hero.jpg" />');
  assert.deepEqual(used.map((u) => u.path), ["public/uploads/hero.jpg", "public/uploads/song.mp3"], "only files that are used follow along");
  assert.ok(!Object.values(files).join("").includes("supabase.co"));
  assert.equal(code["/App.tsx"].includes("supabase.co"), true, "the input is not changed");

  const bytes = (n: number) => new Response(new Uint8Array(n).fill(7));
  const got = await collectUploads(used, (async (u: string | URL | Request) => (String(u).endsWith("hero.jpg") ? bytes(100) : bytes(200))) as typeof fetch);
  assert.deepEqual(got.map((g) => [g.path, g.content.length]), [["public/uploads/hero.jpg", 100], ["public/uploads/song.mp3", 200]]);
  await assert.rejects(collectUploads(used, (async () => new Response("nei", { status: 404 })) as typeof fetch), /Fikk ikke hentet hero\.jpg \(404\)/);
  await assert.rejects(collectUploads(used, (async () => { throw new Error("down"); }) as typeof fetch), /Fikk ikke hentet/);
  await assert.rejects(collectUploads(used, (async () => new Response(new Uint8Array(0))) as typeof fetch), /uventet størrelse/);
  await assert.rejects(collectUploads(used, (async () => new Response("x", { headers: { "content-length": String(UPLOAD_LIMITS.fileBytes + 1) } })) as typeof fetch), /for stor/);
  const big = Array.from({ length: 4 }, (_, i) => ({ upload: up(`s${i}.mp3`), path: `public/uploads/s${i}.mp3` }));
  await assert.rejects(collectUploads(big, (async () => new Response(new Uint8Array(COLLECT_LIMITS.totalBytes / 3))) as typeof fetch), /til sammen/);
}

// --- a pull request carries the new files as blobs
{
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input).replace("https://api.github.com/repos/o/r", "");
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ path, ...(body ? { body } : {}) });
    const ok = (data: unknown) => new Response(JSON.stringify(data));
    if (path.startsWith("/git/commits/")) return ok({ tree: { sha: "t0" } });
    if (path === "/git/blobs") return ok({ sha: `blob-${calls.filter((c) => c.path === "/git/blobs").length}` });
    if (path === "/git/trees") return ok({ sha: "t1" });
    if (path === "/git/commits") return ok({ sha: "c1" });
    if (path === "/git/refs") return ok({});
    if (path === "/pulls") return ok({ html_url: "https://github.com/o/r/pull/1", number: 1 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const sha = "a".repeat(40);
  const result = await openPullRequest("tok", { owner: "o", repo: "r", baseBranch: "main", baseSha: sha, write: { "/src/App.tsx": "x" }, remove: [], binary: [{ path: "public/uploads/hero.jpg", content: new Uint8Array([1, 2, 3]) }], title: "Endringer", body: "" }, fetcher);
  assert.equal(result.number, 1);
  const blob = calls.find((c) => c.path === "/git/blobs")!;
  assert.deepEqual(blob.body, { content: Buffer.from([1, 2, 3]).toString("base64"), encoding: "base64" });
  const tree = (calls.find((c) => c.path === "/git/trees")!.body as { tree: { path: string; sha?: string; content?: string }[] }).tree;
  assert.deepEqual(tree.find((t) => t.path === "public/uploads/hero.jpg"), { path: "public/uploads/hero.jpg", mode: "100644", type: "blob", sha: "blob-1" });
  assert.ok(tree.some((t) => t.path === "src/App.tsx" && t.content === "x"));
  // Only new files and no text changes is a pull request too
  const onlyFiles = await openPullRequest("tok", { owner: "o", repo: "r", baseBranch: "main", baseSha: sha, write: {}, remove: [], binary: [{ path: "public/uploads/a.png", content: new Uint8Array([9]) }], title: "Bare filer", body: "" }, fetcher);
  assert.equal(onlyFiles.number, 1);
  await assert.rejects(openPullRequest("tok", { owner: "o", repo: "r", baseBranch: "main", baseSha: sha, write: {}, remove: [], title: "Ingenting", body: "" }, fetcher), /Ingen endringer/);
  const route = read("src/app/api/github/pull-request/route.ts");
  assert.match(route, /uploadsOf\(files, process\.env\.NEXT_PUBLIC_SUPABASE_URL\)/, "the list is checked against Pivolar's own bucket");
  assert.match(route, /localizeUploads\(current, list\)/);
  assert.match(route, /collectUploads\(localized\.used\)/);
}

// --- publishing copies them into the site, pictures and other files in their own folders
{
  const mp3 = url("u1/p1/ab12-song.mp3");
  const png = url("u1/p1/ab12-hero.png");
  const fetched: string[] = [];
  const bundled = await bundleStorageImages({ "/App.tsx": `<audio src="${mp3}"/><img src="${png}"/>`, "/x.ts": `${DB}/storage/v1/object/public/ukjent-bucket/u1/y.mp3` }, DB, async (u) => (fetched.push(u), new Response("data")));
  assert.deepEqual(Object.keys(bundled.images).map((p) => p.replace(/[0-9a-f]{10}/, "H")).sort(), ["public/files/H.mp3", "public/images/H.png"]);
  assert.match(bundled.files["/App.tsx"]!, /<audio src="\/files\/[0-9a-f]{10}\.mp3"\/><img src="\/images\/[0-9a-f]{10}\.png"\/>/);
  assert.ok(fetched.every((u) => u.startsWith(DB)) && !fetched.some((u) => u.includes("ukjent-bucket")), "another bucket is never touched");
}

// --- the route, the migration and the panel
{
  const route = read("src/app/api/uploads/route.ts");
  assert.ok(route.indexOf('limit("uploads")') > 0 && route.indexOf('limit("uploads")') < route.indexOf("checkUpload("), "the allowance comes first");
  assert.ok(route.indexOf("checkUpload(") < route.indexOf('rpc("upload_bytes_used")') && route.indexOf('rpc("upload_bytes_used")') < route.indexOf("createSignedUploadUrl("), "checked, room found, and only then an address");
  assert.match(route, /if \(usedError\) return fail\(503/, "if the room cannot be checked, nothing is added");
  assert.match(route, /startsWith\(`\$\{auth\.user\.id\}\/`\)/, "only the user's own files can be removed");
  assert.match(route, /storagePath\(auth\.user\.id,/, "files go in the user's own folder");
  assert.ok(RATES.uploads.max > 0);
  const sql = read("supabase/migrations/20261024240000_pivolar_uploads.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(code, /'pivolar-uploads', 'pivolar-uploads', true, 26214400/);
  assert.doesNotMatch(code, /svg|html|javascript|xml/i, "no type that can run");
  for (const action of ["insert", "select", "delete"]) assert.match(code, new RegExp(`pivolar_uploads_${action} on storage\\.objects for ${action} to authenticated`));
  assert.equal((code.match(/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g) ?? []).length, 4, "every rule is limited to the user's own folder");
  assert.match(code, /upload_bytes_used\(\) returns bigint[\s\S]*security invoker set search_path = ''/);
  const panel = read("src/components/ProjectPanel.tsx");
  assert.match(panel, /id="filer" title="Filer"/);
  assert.match(panel, /aria-label="Legg til filer"/);
  assert.match(read("src/components/Workspace.tsx"), /onUploads=\{\(list\) => setEdits\(\(prev\) => withUploads\(prev, list\)\)\}/);
  assert.match(read("src/components/PullRequestDialog.tsx"), /fil du la til/);
}

console.log("uploads: all ok");
