import assert from "node:assert/strict";
import { strToU8, unzipSync, zipSync } from "fflate";
import { analyze } from "../src/lib/zip/analyze.ts";
import { buildExport } from "../src/lib/zip/export.ts";
import { checkPath, ImportError, LIMITS, readZip } from "../src/lib/zip/read.ts";
import { isSecretFile, redactSecrets, scanSecrets } from "../src/lib/zip/secrets.ts";

const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const rejects = (data: Uint8Array, match: RegExp) => assert.throws(() => readZip(data), (e) => e instanceof ImportError && match.test(e.message));

// path safety
for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/win.ini", "a\\b", "a\0b"]) assert.equal(checkPath(bad).ok, false, bad);
assert.deepEqual(checkPath("a/./b.txt"), { ok: true, path: "a/b.txt" });
rejects(zip({ "../evil.txt": "x" }), /gå ut av/);
rejects(zip({ "ok/../../evil.txt": "x" }), /gå ut av/);
rejects(zip({ "/abs.txt": "x" }), /absolutt/);
rejects(new Uint8Array([1, 2, 3]), /ZIP/);
rejects(new Uint8Array(0), /tom/);

// limits: too many entries, and a zip bomb is refused before it is decompressed
rejects(zip(Object.fromEntries(Array.from({ length: LIMITS.entries + 1 }, (_, i) => [`f${i}.txt`, "a"]))), /for mange/);
const bomb = zip({ "big.txt": "a".repeat(70_000_000) });
assert.ok(bomb.length < 1_000_000, "bomb is tiny when compressed");
rejects(bomb, /for stort/);
const hugeOne = readZip(zip({ "small.txt": "hi", "huge.txt": "a".repeat(2_000_000) }));
assert.deepEqual(Object.keys(hugeOne.files), ["/small.txt"]);
assert.ok(hugeOne.skipped.some((s) => s.path === "huge.txt"));

// GitHub-style limits: big data files stay in the repository, and the smallest files are kept first when the total is too big
{
  const opts = { fileBytes: 1_000, textBytes: 2_000, skipOverflow: true };
  const r = readZip(zip({ "src/App.tsx": "a".repeat(900), "src/b.ts": "b".repeat(800), "src/c.ts": "c".repeat(700), "data/big.json": "{" + " ".repeat(5_000) + "}" }), opts);
  assert.ok(r.skipped.some((x) => x.path === "data/big.json" && /blir i repoet/.test(x.reason)), "big data file is left in the repo");
  assert.equal(Object.keys(r.files).length, 2, "total limit drops the largest file, not the whole import");
  assert.ok(!("/src/App.tsx" in r.files) && "/src/c.ts" in r.files && "/src/b.ts" in r.files);
  assert.throws(() => readZip(zip({ "a.txt": "a".repeat(900), "b.txt": "b".repeat(900), "c.txt": "c".repeat(900) }), { fileBytes: 1_000, textBytes: 2_500 }), ImportError, "without skipOverflow a too-big total still refuses");
}

// what is kept and what is left out
const sample = zip({
  "repo-main/package.json": JSON.stringify({ name: "demo", scripts: { build: "next build", postinstall: "node x.js" }, dependencies: { next: "16", stripe: "1", "@supabase/supabase-js": "2" } }),
  "repo-main/package-lock.json": "{}",
  "repo-main/src/app/page.tsx": "const k = process.env.STRIPE_SECRET_KEY; const a = import.meta.env.VITE_API_URL; export default 1",
  "repo-main/.env": "STRIPE_SECRET_KEY=sk_live_abcdefghijklmnop1234",
  "repo-main/.env.example": "DATABASE_URL=\nSTRIPE_SECRET_KEY=\n",
  "repo-main/node_modules/x/index.js": "x",
  "repo-main/logo.png": "notreallyapng",
  "repo-main/src/config.ts": 'export const API_KEY = "abcdefghijklmnopqrstuvwxyz123456";',
  "repo-main/id_rsa": "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
});
const read = readZip(sample);
assert.deepEqual(Object.keys(read.files).sort(), ["/.env.example", "/package-lock.json", "/package.json", "/src/app/page.tsx", "/src/config.ts"]);
assert.deepEqual(read.omittedSecrets.map((o) => o.path).sort(), [".env", "id_rsa"]);
assert.ok(read.skipped.some((s) => s.path === "logo.png") && read.skipped.some((s) => s.path.startsWith("node_modules")));
assert.equal(read.secretWarnings.map((w) => w.path).join(), "src/config.ts");
assert.ok(!JSON.stringify(read).includes("sk_live_"), "the .env value never reaches the result");

// binary content under a text name is skipped
const binary = readZip(zipSync({ "a.txt": strToU8("ok"), "b.dat": new Uint8Array([1, 0, 2, 0, 3]) }));
assert.deepEqual(Object.keys(binary.files), ["/a.txt"]);

// analysis
const report = analyze(read.files);
assert.equal(report.framework.id, "nextjs");
assert.equal(report.packageManager, "npm");
assert.deepEqual(report.envVars, ["DATABASE_URL", "STRIPE_SECRET_KEY", "VITE_API_URL"]);
assert.ok(report.services.some((s) => s.includes("Stripe")) && report.services.some((s) => s.includes("Supabase")));
assert.ok(report.risks.some((r) => r.includes("postinstall")));
assert.equal(report.previewable, false);
assert.equal(analyze({ "/App.tsx": "x" }).previewable, true);
assert.match(analyze({ "/package.json": JSON.stringify({ dependencies: { react: "18", vite: "5" } }), "/src/App.tsx": "x" }).previewNote, /forenklet forhåndsvisning/);
assert.match(analyze({ "/package.json": JSON.stringify({ dependencies: { "@tanstack/react-start": "1", react: "19", vite: "7" } }), "/src/App.tsx": "x" }).previewNote, /ikke vises/);
assert.equal(analyze({ "/wp-config.php": "<?php" }).framework.id, "wordpress");
assert.equal(analyze({ "/index.html": "<p>" }).framework.id, "static");

// secrets
assert.ok(scanSecrets('const t = "ghp_' + "a".repeat(36) + '"').length > 0);
assert.equal(scanSecrets('const x = process.env.API_KEY; const y = "your-api-key-here-1234"').length, 0);
assert.equal(redactSecrets('TOKEN = "supersecretvalue12345"').text, 'TOKEN="REDACTED_BY_PIVOLAR"');
assert.ok(isSecretFile("/.env.production") && isSecretFile("keys/server.pem") && !isSecretFile(".env.example"));

// export round trip: extract it and compare
const exported = buildExport({ name: "Demo", files: { ...read.files, "/.env": "A=sk_live_abcdefghijklmnop1234" }, mode: "source", notes: { skippedBinaries: ["logo.png"] }, now: new Date("2026-01-01T00:00:00Z") });
const unpacked = unzipSync(exported.zip);
const names = Object.keys(unpacked).sort();
for (const expected of ["package.json", "src/app/page.tsx", ".env.example", "EXPORT-REPORT.md", "PIVOLAR-MANIFEST.json", "README.md"]) assert.ok(names.includes(expected), expected);
assert.ok(!names.includes(".env"), ".env is omitted");
const all = names.map((n) => new TextDecoder().decode(unpacked[n])).join("\n");
assert.ok(!all.includes("sk_live_") && !all.includes("abcdefghijklmnopqrstuvwxyz123456"), "no secret in the archive");
assert.ok(all.includes("REDACTED_BY_PIVOLAR"));
const manifest = JSON.parse(new TextDecoder().decode(unpacked["PIVOLAR-MANIFEST.json"]));
assert.equal(manifest.validation.ok, false);
assert.ok(manifest.manualSteps.some((s: string) => s.includes("logo.png")));
assert.ok(manifest.omitted.some((o: { path: string }) => o.path === ".env"));
assert.equal(manifest.included.find((f: { path: string }) => f.path === "package.json").bytes, unpacked["package.json"]!.length);
console.log("zip: all ok");
