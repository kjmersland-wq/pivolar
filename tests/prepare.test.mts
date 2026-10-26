import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareCloudflare } from "../src/lib/move/prepare.ts";

const pkg = (extra: object) => JSON.stringify({ name: "Min App", scripts: { build: "vite build" }, ...extra });

// A Vite single-page app gets the front-page fallback and a Node version
{
  const r = prepareCloudflare({ "/package.json": pkg({ devDependencies: { vite: "5" }, dependencies: { react: "18" } }) });
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(Object.keys(r.write).sort(), ["/.nvmrc", "/public/_redirects"]);
    assert.equal(r.write["/public/_redirects"], "/*  /index.html  200\n");
    assert.equal(r.write["/.nvmrc"], "22\n");
    assert.ok(r.manual.some((m) => m.includes("flere låsefiler")));
    assert.ok(r.next.length === 4 && /pull request/.test(r.next[0]!));
  }
  // What the project already has is left alone
  const done = prepareCloudflare({ "/package.json": pkg({ devDependencies: { vite: "5" }, engines: { node: ">=20" } }), "/public/_redirects": "x" });
  assert.ok(done.ok && Object.keys(done.write).length === 0);
  const pinned = prepareCloudflare({ "/package.json": pkg({ devDependencies: { vite: "5" } }), "/_redirects": "x", "/.nvmrc": "20" });
  assert.ok(pinned.ok && Object.keys(pinned.write).length === 0);
}

// TanStack Start gets a Workers config, and what needs npm on the owner's machine is listed, not edited
{
  const files = { "/package.json": pkg({ name: "DoggMatch!", dependencies: { "@tanstack/react-start": "1" }, devDependencies: { vite: "7" } }), "/vite.config.ts": "export default {};" };
  const r = prepareCloudflare(files);
  assert.ok(r.ok);
  if (r.ok) {
    const config = JSON.parse(r.write["/wrangler.jsonc"]!) as Record<string, unknown>;
    assert.deepEqual(config, { name: "doggmatch", compatibility_date: "2025-09-02", compatibility_flags: ["nodejs_compat"], main: "@tanstack/react-start/server-entry" });
    assert.ok(!("/package.json" in r.write), "package.json is never changed, because the lock file would no longer match");
    assert.ok(r.manual.some((m) => m.includes("npm install -D @cloudflare/vite-plugin wrangler")));
    assert.ok(r.manual.some((m) => m.includes("vite.config")));
  }
  const ready = prepareCloudflare({ ...files, "/package.json": pkg({ dependencies: { "@tanstack/react-start": "1" }, devDependencies: { "@cloudflare/vite-plugin": "1", wrangler: "4" } }), "/wrangler.jsonc": "{}", "/vite.config.ts": "plugins: [cloudflare({})]" });
  assert.ok(ready.ok);
  if (ready.ok) {
    assert.deepEqual(Object.keys(ready.write), ["/.nvmrc"]);
    assert.ok(!ready.manual.some((m) => m.includes("npm install") || m.includes("vite.config")));
  }
}

// Other frameworks, and broken input, are refused with a reason
{
  const next = prepareCloudflare({ "/package.json": pkg({ dependencies: { next: "16" } }) });
  assert.ok(!next.ok && /Next\.js støttes ikke/.test(next.message));
  const none = prepareCloudflare({ "/package.json": "{}" });
  assert.ok(!none.ok && /Fant ikke rammeverket/.test(none.message));
  assert.ok(!prepareCloudflare({ "/package.json": "ikke json" }).ok);
}

// The panel passes the files on as the owner's own edits
{
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.match(read("src/components/Workspace.tsx"), /onPrepare=\{compose\}/);
  assert.match(read("src/components/ProjectPanel.tsx"), /<MoveCheck[^>]*onPrepare=\{onPrepare\}/);
  assert.match(read("src/components/MoveCheck.tsx"), /onPrepare\(prep\.write\)/);
}

console.log("prepare: all ok");
