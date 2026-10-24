import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MAX_TIMEOUT_MS, quotaConfig, RATES } from "../src/lib/quota/config.ts";
import { budgetSince, CAP_NOTE, costOfSteps, DENIALS, overCap, startOfOsloMonth } from "../src/lib/quota/decide.ts";
import { checkRate, IMAGE_ALLOWANCE_USD, openAiGate } from "../src/lib/quota/gate.ts";
import { extensionFor, isPastLimit, sandboxName } from "../src/lib/runner/limits.ts";
import { DEFAULT_PRICES } from "../src/lib/usage/pricing.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// --- configuration: careful defaults, nonsense falls back, nothing can be set above the platform's limits
{
  const d = quotaConfig({});
  assert.deepEqual(d, { aiDisabled: false, importDisabled: false, requestCapUsd: 1.5, maxOutputTokens: 16_000, timeoutMs: 240_000, sandboxMaxConcurrent: 2, sandboxMaxMs: 120 * 60_000, globalDailyUsd: null, allowUnset: false });
  const c = quotaConfig({ AI_DISABLED: "1", IMPORT_DISABLED: "true", REQUEST_CAP_USD: "0.5", MAX_OUTPUT_TOKENS: "8000", REQUEST_TIMEOUT_MS: "60000", SANDBOX_MAX_MINUTES: "30", SANDBOX_MAX_CONCURRENT: "3", GLOBAL_DAILY_USD: "25", QUOTA_ALLOW_UNSET: "yes" });
  assert.deepEqual(c, { aiDisabled: true, importDisabled: true, requestCapUsd: 0.5, maxOutputTokens: 8000, timeoutMs: 60_000, sandboxMaxConcurrent: 3, sandboxMaxMs: 30 * 60_000, globalDailyUsd: 25, allowUnset: true });
  assert.equal(quotaConfig({ SANDBOX_MAX_MINUTES: "99999" }).sandboxMaxMs, 480 * 60_000, "a run can never be allowed more than eight hours");
  assert.equal(quotaConfig({ SANDBOX_MAX_MINUTES: "abc" }).sandboxMaxMs, 120 * 60_000);
  for (const bad of ["", "abc", "-3", "0", "NaN", "Infinity"]) assert.equal(quotaConfig({ REQUEST_CAP_USD: bad }).requestCapUsd, 1.5, `cap "${bad}" falls back`);
  assert.equal(quotaConfig({ REQUEST_TIMEOUT_MS: "9999999" }).timeoutMs, MAX_TIMEOUT_MS, "never above what the platform allows");
  assert.ok(MAX_TIMEOUT_MS < 300_000);
  assert.equal(quotaConfig({ REQUEST_CAP_USD: "5000" }).requestCapUsd, 50);
  assert.equal(quotaConfig({ MAX_OUTPUT_TOKENS: "999999" }).maxOutputTokens, 64_000);
  assert.equal(quotaConfig({ AI_DISABLED: "no" }).aiDisabled, false);
  assert.equal(quotaConfig({ GLOBAL_DAILY_USD: "0" }).globalDailyUsd, null, "zero is not a cap");
  for (const route of Object.keys(RATES) as (keyof typeof RATES)[]) assert.ok(RATES[route].max > 0 && RATES[route].windowSeconds > 0);
}

// --- when a budget period starts, in Norwegian time and across summer time
{
  const iso = (ms: number) => new Date(ms).toISOString();
  assert.equal(iso(+startOfOsloMonth(Date.parse("2026-10-24T10:00:00Z"))), "2026-09-30T22:00:00.000Z", "October starts in summer time");
  assert.equal(iso(+startOfOsloMonth(Date.parse("2026-11-15T12:00:00Z"))), "2026-10-31T23:00:00.000Z", "November starts in winter time");
  assert.equal(iso(+startOfOsloMonth(Date.parse("2026-03-15T12:00:00Z"))), "2026-02-28T23:00:00.000Z");
  assert.equal(iso(+startOfOsloMonth(Date.parse("2026-10-31T23:30:00Z"))), "2026-10-31T23:00:00.000Z", "half past midnight on 1 November in Norway is already November");
  assert.equal(iso(+startOfOsloMonth(Date.parse("2026-03-31T22:30:00Z"))), "2026-03-31T22:00:00.000Z", "and 1 April");
  const now = Date.parse("2026-10-24T10:00:00Z");
  assert.equal(iso(+budgetSince({ budgetUsd: 5, period: "month", startsAt: null }, now)), "2026-09-30T22:00:00.000Z");
  assert.equal(iso(+budgetSince({ budgetUsd: 5, period: "total", startsAt: "2026-10-01T08:00:00Z" }, now)), "2026-10-01T08:00:00.000Z");
  assert.equal(+budgetSince({ budgetUsd: 5, period: "total", startsAt: null }, now), 0, "no start means everything counts");
  assert.equal(+budgetSince({ budgetUsd: 5, period: "total", startsAt: "not a date" }, now), 0);
}

// --- what a request has cost, and when it must stop
{
  const step = (inputTokens: number, outputTokens: number) => ({ usage: { inputTokens, outputTokens } });
  // 100k in at $3/M = 0.30, 10k out at $15/M = 0.15
  assert.equal(costOfSteps([step(100_000, 10_000)], DEFAULT_PRICES), 0.45);
  assert.equal(costOfSteps([step(100_000, 10_000), step(100_000, 10_000)], DEFAULT_PRICES), 0.9);
  assert.equal(costOfSteps([{}, step(0, 0)], DEFAULT_PRICES), 0, "a step without usage costs nothing");
  assert.equal(overCap([step(100_000, 10_000)], 0.5, DEFAULT_PRICES), false);
  assert.equal(overCap([step(100_000, 10_000)], 0.45, DEFAULT_PRICES), true, "reaching the cap stops it");
  assert.equal(overCap([step(100_000, 10_000), step(100_000, 10_000)], 0.5, DEFAULT_PRICES), true);
  const cached = { usage: { inputTokens: 100_000, outputTokens: 0, inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 100_000, cacheWriteTokens: 0 } } };
  assert.equal(costOfSteps([cached], DEFAULT_PRICES), 0.03, "cached input is a tenth of the price");
  assert.match(CAP_NOTE, /skriv «fortsett»/i);
  for (const d of Object.values(DENIALS)) assert.ok(d.message.length > 10 && [401, 402, 429, 503].includes(d.status));
}

// --- the gate, with the database replaced by a stand-in
type Call = { name: string; args: Record<string, unknown> };
function fakeDb(options: { rate?: unknown; rateError?: { code: string; message: string }; global?: unknown; globalError?: { code: string; message: string }; settings?: Record<string, unknown> | null; settingsError?: boolean; reserve?: unknown; reserveError?: { code: string; message: string }; releaseThrows?: boolean } = {}) {
  const calls: Call[] = [];
  const db = {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      if (name === "rate_limit") return options.rateError ? { data: null, error: options.rateError } : { data: options.rate ?? true, error: null };
      if (name === "global_spend_today") return options.globalError ? { data: null, error: options.globalError } : { data: options.global ?? 0, error: null };
      if (name === "reserve_usage") return options.reserveError ? { data: null, error: options.reserveError } : { data: options.reserve ?? { ok: true, id: 7, granted: 1.62 }, error: null };
      if (name === "release_reservation") {
        if (options.releaseThrows) throw new Error("down");
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from() {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => (options.settingsError ? { data: null, error: { message: "x" } } : { data: options.settings === undefined ? null : options.settings, error: null }) };
      return chain;
    },
  };
  return { db: db as never, calls };
}
const noFunction = { code: "PGRST202", message: "Could not find the function public.rate_limit" };
const user = { id: "u1" };
const base = quotaConfig({});
const now = Date.parse("2026-10-24T10:00:00Z");

{
  const signedOut = await openAiGate(fakeDb().db, null, base, now);
  assert.deepEqual(signedOut.ok === false && signedOut.status, 401);

  const off = fakeDb();
  const switched = await openAiGate(off.db, user, quotaConfig({ AI_DISABLED: "1" }), now);
  assert.equal(switched.ok === false && switched.status, 503);
  assert.equal(off.calls.length, 0, "an emergency stop does not even ask the database");

  const limited = fakeDb({ rate: false });
  const tooMany = await openAiGate(limited.db, user, base, now);
  assert.equal(tooMany.ok === false && tooMany.status, 429);
  assert.deepEqual(limited.calls.map((c) => c.name), ["rate_limit"], "nothing is set aside for a refused request");
  assert.deepEqual(limited.calls[0]!.args, { p_route: "chat", p_window_seconds: RATES.chat.windowSeconds, p_max: RATES.chat.max });

  const dayCap = fakeDb({ global: 25 });
  const global = await openAiGate(dayCap.db, user, quotaConfig({ GLOBAL_DAILY_USD: "25" }), now);
  assert.equal(global.ok === false && global.status, 503);
  assert.ok(!dayCap.calls.some((c) => c.name === "reserve_usage"));
  const underCap = await openAiGate(fakeDb({ global: 24.99 }).db, user, quotaConfig({ GLOBAL_DAILY_USD: "25" }), now);
  assert.equal(underCap.ok, true);
  const noGlobalCheck = fakeDb({ global: 999 });
  assert.equal((await openAiGate(noGlobalCheck.db, user, base, now)).ok, true, "without a daily cap the number is not even read");
  assert.ok(!noGlobalCheck.calls.some((c) => c.name === "global_spend_today"));
}

{
  // No budget: a request is still set aside, but nothing can be refused for budget reasons
  const open = fakeDb({ settings: { budget_usd: null, budget_period: "total", budget_starts_at: null }, reserve: { ok: true, id: 7, granted: 1.62 } });
  const gate = await openAiGate(open.db, user, base, now);
  assert.ok(gate.ok);
  if (gate.ok) {
    assert.equal(gate.capUsd, 1.5);
    const reserve = open.calls.find((c) => c.name === "reserve_usage")!.args;
    assert.equal(reserve.p_budget, null);
    assert.equal(reserve.p_estimate, 1.5 + IMAGE_ALLOWANCE_USD, "the estimate covers text and pictures");
    await gate.release();
    assert.deepEqual(open.calls.at(-1), { name: "release_reservation", args: { p_id: 7 } });
  }

  // Little left: the request gets what is left, minus what pictures may take
  const low = fakeDb({ settings: { budget_usd: "5", budget_period: "month", budget_starts_at: null }, reserve: { ok: true, id: 9, granted: 0.62 } });
  const small = await openAiGate(low.db, user, base, now);
  assert.ok(small.ok);
  if (small.ok) assert.equal(Math.round(small.capUsd * 100) / 100, 0.5);
  const args = low.calls.find((c) => c.name === "reserve_usage")!.args;
  assert.equal(args.p_budget, 5);
  assert.equal(args.p_since, "2026-09-30T22:00:00.000Z", "a monthly budget counts from the start of the month in Norwegian time");

  // So little left that the cap would be below zero: still a tiny positive cap, never zero or negative
  const sliver = await openAiGate(fakeDb({ settings: { budget_usd: 1, budget_period: "total", budget_starts_at: "2026-10-01T00:00:00Z" }, reserve: { ok: true, id: 1, granted: 0.05 } }).db, user, base, now);
  assert.ok(sliver.ok && sliver.capUsd > 0 && sliver.capUsd <= 0.05);

  // Used up
  const spent = fakeDb({ settings: { budget_usd: 5, budget_period: "total", budget_starts_at: null }, reserve: { ok: false, granted: 0, spent: 5, held: 0 } });
  const refused = await openAiGate(spent.db, user, base, now);
  assert.equal(refused.ok === false && refused.status, 402);
  assert.equal(refused.ok === false && refused.message, DENIALS.budget.message);
  assert.deepEqual(spent.calls.map((c) => c.name), ["rate_limit", "reserve_usage"]);

  // An answer the database should never give is refused, not guessed at
  const odd = fakeDb({ settings: { budget_usd: null, budget_period: "total", budget_starts_at: null }, reserve: "garbage" });
  assert.equal((await openAiGate(odd.db, user, base, now)).ok, false, "a malformed answer from the database is refused");

  // A reservation that cannot be given back must not break the request that has already finished
  const stuck = fakeDb({ settings: { budget_usd: null, budget_period: "total", budget_starts_at: null }, reserve: { ok: true, id: 3, granted: 1.62 }, releaseThrows: true });
  const gate2 = await openAiGate(stuck.db, user, base, now);
  assert.ok(gate2.ok);
  if (gate2.ok) await assert.doesNotReject(gate2.release());
}

{
  // Missing database functions: refused, unless the owner has said to let things through between a deploy and its migration
  assert.equal((await openAiGate(fakeDb({ rateError: noFunction }).db, user, base, now)).ok, false);
  const blocked = await openAiGate(fakeDb({ rateError: noFunction }).db, user, base, now);
  assert.equal(blocked.ok === false && blocked.message, DENIALS.unset.message);
  const through = await openAiGate(fakeDb({ rateError: noFunction, reserveError: noFunction, settings: null }).db, user, quotaConfig({ QUOTA_ALLOW_UNSET: "1" }), now);
  assert.equal(through.ok, true);
  assert.equal((await openAiGate(fakeDb({ settingsError: true }).db, user, base, now)).ok, false, "unreadable budget: refused");
  assert.equal((await openAiGate(fakeDb({ settings: { budget_usd: null }, reserveError: { code: "XX000", message: "boom" } }).db, user, quotaConfig({ QUOTA_ALLOW_UNSET: "1" }), now)).ok, false, "other errors are never let through");
  assert.equal((await checkRate(fakeDb({ rateError: { code: "XX000", message: "boom" } }).db, "import", base)).ok, false);
  assert.equal((await checkRate(fakeDb({ rate: true }).db, "import", base)).ok, true);
  const rated = fakeDb({ rate: false });
  const r = await checkRate(rated.db, "runner", base);
  assert.equal(r.ok === false && r.status, 429);
  assert.deepEqual(rated.calls[0]!.args, { p_route: "runner", p_window_seconds: RATES.runner.windowSeconds, p_max: RATES.runner.max });
}

// --- runs of imported projects: one user's, and not for ever
{
  const a = sandboxName("user-a", "9289b02c-b50f-4889-a1e8-975f9dc426de");
  assert.equal(a, sandboxName("user-a", "9289b02c-b50f-4889-a1e8-975f9dc426de"), "the same user and project always get the same name");
  assert.notEqual(a, sandboxName("user-b", "9289b02c-b50f-4889-a1e8-975f9dc426de"), "another user gets another name for the same project id");
  assert.notEqual(a, sandboxName("user-a", "11111111-1111-1111-1111-111111111111"));
  assert.match(a, /^pv-[0-9a-f]{10}-9289b02c/);
  assert.ok(a.length <= 80);
  assert.ok(!a.includes("user-a"), "the user id itself is not in the name");

  const min = 60_000;
  const max = 120 * min;
  const base = { createdAt: 0, maxMs: max, wantMs: 10 * min };
  // Early in a run: keep it alive 10 minutes from now
  assert.deepEqual(extensionFor({ ...base, now: 5 * min, expiresAt: 30 * min }), { action: "keep" }, "already alive for long enough, so nothing is added");
  assert.deepEqual(extensionFor({ ...base, now: 25 * min, expiresAt: 30 * min }), { action: "extend", ms: 5 * min }, "topped up to 10 minutes from now, not 10 minutes on top");
  assert.deepEqual(extensionFor({ ...base, now: 25 * min, expiresAt: null }), { action: "extend", ms: 10 * min });
  // The same call again right after changes nothing, so many syncs cannot pile up time
  assert.deepEqual(extensionFor({ ...base, now: 25.1 * min, expiresAt: 35 * min }), { action: "keep" });
  // Near the end it is never extended past the limit
  assert.deepEqual(extensionFor({ ...base, now: 115 * min, expiresAt: 118 * min }), { action: "extend", ms: 2 * min }, "only up to the limit");
  assert.deepEqual(extensionFor({ ...base, now: 119.9 * min, expiresAt: 120 * min }), { action: "keep" });
  // At the limit it is stopped, however often files are sent
  assert.deepEqual(extensionFor({ ...base, now: 120 * min, expiresAt: 125 * min }), { action: "stop" });
  assert.deepEqual(extensionFor({ ...base, now: 500 * min, expiresAt: null }), { action: "stop" });
  assert.equal(isPastLimit(0, 119 * min, max), false);
  assert.equal(isPastLimit(0, 120 * min, max), true);
  // Whatever the sequence of syncs, the end of life never moves past the limit
  let expires: number | null = 30 * min;
  for (let now = 1; now < 200; now++) {
    const step = extensionFor({ ...base, now: now * min, expiresAt: expires });
    if (step.action === "stop") break;
    if (step.action === "extend") expires = (expires ?? now * min) + step.ms;
    assert.ok((expires ?? 0) <= Math.max(max, 30 * min), `at minute ${now} the end is ${expires! / min}`);
  }
}

// --- no route that spends money may skip the checks
{
  const files: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") files.push(full);
    }
  })(new URL("../src/app/api", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  assert.ok(files.length >= 10, "the routes were found");
  const body = (f: string) => readFileSync(f, "utf8");
  for (const f of files) {
    const text = body(f);
    const name = f.replace(/.*src[\\/]app[\\/]api[\\/]/, "");
    if (/\b(streamText|generateText|generateImage|generateObject)\b/.test(text)) assert.match(text, /openAiGate\(/, `${name} uses the model, so it must use the gate`);
  }
  const chat = read("src/app/api/chat/route.ts");
  assert.match(chat, /openAiGate\(supabase, auth\.user, quota\)/);
  assert.match(chat, /maxOutputTokens: quota\.maxOutputTokens/);
  assert.match(chat, /abortSignal: AbortSignal\.timeout\(quota\.timeoutMs\)/);
  assert.match(chat, /overCap\(steps as unknown as StepUsage\[\], gate\.capUsd/);
  assert.match(chat, /await gate\.release\(\)/);
  assert.ok(chat.indexOf("openAiGate(") < chat.indexOf("await request.json()"), "the checks come before the body is read");
  assert.match(chat, /content-length/);
  for (const [path, route] of [["analyze", "analyze"], ["import/zip", "import"], ["import/cms", "import"], ["github/import", "import"], ["export", "export"], ["github/pull-request", "pr"], ["publish", "publish"], ["runner", "runner"]] as const) {
    assert.match(read(`src/app/api/${path}/route.ts`), new RegExp(`limit\\((?:step \\? "importstep" : )?"${route}"\\)`), `${path} is rate limited`);
  }
  const runner = read("src/app/api/runner/route.ts");
  assert.match(runner, /sandboxName\(userId, id\)/, "the run is named after the user");
  assert.doesNotMatch(runner, /`pivolar-\$\{/, "the old name without the user is gone");
  assert.match(runner, /extensionFor\(/);
  assert.doesNotMatch(runner, /extendTimeout\(10 \* 60_000\)/, "no fixed extension that can pile up");
  assert.ok(runner.indexOf("signedInUserId()") < runner.indexOf("Sandbox.get"), "the user is known before any run is looked up");
  assert.ok(runner.indexOf('limit("runner")') > runner.indexOf('body.action === "sync"'), "stopping and syncing are not counted, only starting");
}

// --- the database side: what is open to whom
{
  const sql = read("supabase/migrations/20261024160000_pivolar_quota.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(code, /'ai_reserved'/);
  assert.match(code, /pg_advisory_xact_lock/, "requests from one user are decided one at a time");
  assert.match(code, /interval '15 minutes'/, "a dead request does not hold money forever");
  assert.match(code, /create policy usage_delete_reserved[\s\S]*kind = 'ai_reserved'/, "only reservations can be deleted, never real usage");
  assert.doesNotMatch(code, /grant (?:update|delete)[^;]*usage[^;]*to anon/i);
  for (const fn of ["reserve_usage", "release_reservation"]) assert.match(code, new RegExp(`create function public\\.${fn}[\\s\\S]*?security invoker set search_path = ''`), `${fn} runs with the caller's own rights`);
  for (const fn of ["rate_limit", "global_spend_today"]) {
    assert.match(code, new RegExp(`create function public\\.${fn}[\\s\\S]*?security definer set search_path = ''`), `${fn} has a fixed search path`);
    assert.match(code, new RegExp(`revoke all on function public\\.${fn}[^;]*from public`), `${fn} is closed to everyone first`);
    assert.match(code, new RegExp(`grant execute on function public\\.${fn}[^;]*to authenticated;`), `${fn} is open to signed-in users`);
  }
  assert.doesNotMatch(code, /grant execute on function[^;]*to[^;]*anon/i, "nothing here is open to the public");
  assert.match(code, /revoke all on public\.rate_limits from anon, authenticated/, "the counters cannot be read or written directly");
  assert.match(code, /uid::text \|\| ':' \|\| p_route/, "the key always contains the caller's own id");
  assert.match(code, /not between 1 and 86400/, "the limits it is given are checked");
}

console.log("quota: all ok");
