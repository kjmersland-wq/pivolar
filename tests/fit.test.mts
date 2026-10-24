import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { audit } from "../src/lib/audit.ts";
import { fitToRoom, fullMessage, projectSize, STORAGE_BUDGET, STORAGE_MARGIN, storageRoom, storageUsed } from "../src/lib/import/fit.ts";
import type { Page, SiteModel } from "../src/lib/import/model.ts";
import { quotaConfig } from "../src/lib/quota/config.ts";
import { atConcurrentLimit, ownerPrefix, sandboxName } from "../src/lib/runner/limits.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// --- the storage: what is used, and what is left
{
  const items = new Map([["a", "12345"], ["bb", "123"]]);
  const storage = { get length() { return items.size; }, key: (i: number) => [...items.keys()][i] ?? null, getItem: (k: string) => items.get(k) ?? null };
  assert.equal(storageUsed(storage), 1 + 5 + 2 + 3);
  assert.equal(storageRoom(storage), STORAGE_BUDGET - 11 - STORAGE_MARGIN);
  assert.equal(storageRoom(storage, 100), 0, "never below zero");
  assert.equal(storageRoom({ length: 1, key: () => { throw new Error("blocked"); }, getItem: () => null }), 0, "storage that cannot be read has no room");
}

// --- a site that is too big: the oldest posts go, the pages stay, and it says so
const page = (id: string, kind: "page" | "post", date: string | undefined, size: number): Page => ({ id, kind, url: "https://old.no/" + id, path: "/" + id, slug: id, parent: null, title: id, ...(date ? { date } : {}), excerpt: "", seo: {}, featuredImage: null, signals: [], blocks: [{ type: "paragraph", html: "x".repeat(size) }] });
const model = (pages: Page[]): SiteModel => ({ source: "wordpress", url: "https://old.no", name: "Test", description: "", language: null, nav: [], pages, media: [], plugins: [], warnings: [], truncated: false, stats: { pages: 0, posts: 0, media: 0, blocks: 0, unknownBlocks: 0, requests: 0, ms: 0 } });
// A stand-in for the real project builder: one file per page, with the warnings in a note.
const build = (m: SiteModel) => ({ ...Object.fromEntries(m.pages.map((p) => [`/content/${p.id}.ts`, JSON.stringify(p)])), "/IMPORT.md": m.warnings.join(" ") });
{
  const pages = [page("om-oss", "page", undefined, 5_000), ...Array.from({ length: 20 }, (_, i) => page(`post-${i}`, "post", `2026-01-${String(i + 1).padStart(2, "0")}`, 10_000))];
  const all = model(pages);
  const full = fitToRoom(all, build, 10_000_000);
  assert.deepEqual([full.dropped, full.fits, full.model.pages.length], [0, true, 21], "enough room: nothing is left out");

  const room = Math.round(projectSize(build(all)) * 0.5);
  const fit = fitToRoom(all, build, room);
  assert.ok(fit.fits && fit.size <= room, "it fits after the oldest posts are left out");
  assert.ok(fit.dropped > 0 && fit.dropped < 20);
  assert.ok(fit.model.pages.some((p) => p.id === "om-oss"), "pages are never left out");
  const kept = fit.model.pages.filter((p) => p.kind === "post").map((p) => p.id);
  assert.ok(kept.includes("post-19") && !kept.includes("post-0"), "the newest posts are the ones kept");
  assert.match(fit.model.warnings.at(-1)!, new RegExp(`^${fit.dropped} eldre innlegg ble ikke tatt med`), "and the owner is told, in the import note too");
  assert.match(fit.files["/IMPORT.md"]!, /eldre innlegg/);
  assert.equal(all.pages.length, 21, "the original model is not changed");

  // Even the pages alone do not fit
  const tiny = fitToRoom(all, build, 1_000);
  assert.equal(tiny.fits, false);
  assert.equal(tiny.model.pages.filter((p) => p.kind === "post").length, 0);
  assert.match(fullMessage(tiny.size, 1_000), /Slett gamle prosjekter/);
  // No posts at all, and too big: it says so and does not loop
  assert.equal(fitToRoom(model([page("a", "page", undefined, 50_000)]), build, 100).fits, false);
}

// --- runs at the same time
{
  const me = "user-1";
  const mine = (id: string, status: string) => ({ name: sandboxName(me, id), status });
  assert.ok(ownerPrefix(me).startsWith("pv-") && sandboxName(me, "abc").startsWith(ownerPrefix(me)));
  assert.notEqual(ownerPrefix(me), ownerPrefix("user-2"));
  const own = sandboxName(me, "new-project");
  assert.equal(atConcurrentLimit([mine("a", "running"), mine("b", "running")], own, 2), true, "two are going: no third");
  assert.equal(atConcurrentLimit([mine("a", "running")], own, 2), false);
  assert.equal(atConcurrentLimit([mine("a", "running"), mine("b", "stopped"), mine("c", "failed")], own, 2), false, "a run that has stopped is not going");
  assert.equal(atConcurrentLimit([mine("a", "running"), mine("b", "pending")], own, 2), true, "one that is starting counts");
  assert.equal(atConcurrentLimit([mine("a", "running"), { name: own, status: "running" }], own, 2), false, "reopening a project's own run is not a new one");
  assert.equal(atConcurrentLimit([{ name: own, status: "running" }, { name: own, status: "running" }], own, 1), false, "and the same name is never counted twice");
  assert.equal(quotaConfig({}).sandboxMaxConcurrent, 2);
  assert.equal(quotaConfig({ SANDBOX_MAX_CONCURRENT: "500" }).sandboxMaxConcurrent, 10, "never more than ten");
  assert.equal(quotaConfig({ SANDBOX_MAX_CONCURRENT: "x" }).sandboxMaxConcurrent, 2);

  const runner = read("src/app/api/runner/route.ts");
  assert.ok(runner.indexOf("Sandbox.list(") > runner.indexOf('limit("runner")') && runner.indexOf("Sandbox.list(") < runner.indexOf("Sandbox.getOrCreate"), "the count is made after the allowance and before anything is started");
  assert.match(runner, /namePrefix: ownerPrefix\(userId\)/, "only the user's own runs are counted");
  assert.match(runner, /Kunne ikke sjekke kjøringene[\s\S]*?503/, "if the list cannot be read, nothing is started");
}

// --- the record of the owner's confirmation
{
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = (error: unknown = null) => ({ rpc: async (fn: string, args: Record<string, unknown>) => (calls.push({ fn, args }), { data: null, error }) }) as never;
  assert.equal(await audit(db(), "import_owner_confirmed", { url: "https://old.no", pages: 3 }), true);
  assert.deepEqual(calls[0], { fn: "log_audit", args: { p_action: "import_owner_confirmed", p_detail: { url: "https://old.no", pages: 3 } } });
  assert.equal(await audit(db({ code: "42883" }), "import_owner_confirmed", {}), false, "a missing function is reported, not thrown");
  assert.equal(await audit({ rpc: async () => { throw new Error("down"); } } as never, "import_owner_confirmed", {}), false);
  await audit(db(), "import_owner_confirmed", { url: "x".repeat(1000) });
  assert.equal((calls.at(-1)!.args.p_detail as { url: string }).url.length, 300, "long text is cut");

  const route = read("src/app/api/import/cms/route.ts");
  assert.match(route, /await audit\(db, "import_owner_confirmed"/);
  assert.ok(route.indexOf("saveJob(") < route.indexOf("audit(db"), "it is recorded once the import exists");

  const sql = read("supabase/migrations/20261024200000_pivolar_audit.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(code, /security definer set search_path = ''/);
  assert.match(code, /uid uuid := \(select auth\.uid\(\)\)/, "writes for the caller only");
  assert.match(code, /p_action not in \('import_owner_confirmed'\)/, "only listed actions");
  assert.match(code, /char_length\(p_detail::text\) > 2000/);
  assert.match(code, /revoke all on function public\.log_audit\(text, jsonb\) from public, anon/);
  assert.match(code, /grant execute on function public\.log_audit\(text, jsonb\) to authenticated/);
  assert.doesNotMatch(code, /grant (?:insert|update|delete)[^;]*audit_log/i, "the table itself stays closed");
}

// --- the import uses the check
{
  const client = read("src/lib/import/client.ts");
  assert.match(client, /storageRoom\(window\.localStorage\)/);
  assert.match(client, /if \(!fit\.fits\) return \{ ok: false, error: fullMessage/);
}

console.log("fit: all ok");
