import assert from "node:assert/strict";
import { chatCost, DEFAULT_PRICES, imageCost, pricesFor } from "../src/lib/usage/pricing.ts";
import { dateKey, summarize, WARN_AT, type UsageRow } from "../src/lib/usage/summary.ts";

// --- pricing
assert.deepEqual(pricesFor({}), DEFAULT_PRICES);
assert.deepEqual(pricesFor({ PRICE_INPUT_PER_MTOK: "1.5", PRICE_OUTPUT_PER_MTOK: "7", PRICE_IMAGE_USD: "0.1" }), { inputPerMTok: 1.5, outputPerMTok: 7, imageUsd: 0.1 });
assert.deepEqual(pricesFor({ PRICE_INPUT_PER_MTOK: "abc", PRICE_OUTPUT_PER_MTOK: "-4", PRICE_IMAGE_USD: "" }), DEFAULT_PRICES, "bad values fall back to the defaults");
{
  const cost = chatCost(200_000, 10_000, DEFAULT_PRICES);
  assert.equal(cost.input, 0.6);
  assert.equal(cost.output, 0.15);
  assert.deepEqual(chatCost(-5, -5, DEFAULT_PRICES), { input: 0, output: 0 });
  assert.equal(imageCost(DEFAULT_PRICES), 0.04);
}

// --- dates follow Norwegian time: 23:30 UTC on 30 June is already 1 July in Oslo (UTC+2)
assert.equal(dateKey("2026-06-30T23:30:00Z"), "2026-07-01");
assert.equal(dateKey("2026-12-31T23:30:00Z"), "2027-01-01");
assert.equal(dateKey("2026-10-23T10:00:00Z"), "2026-10-23");

// --- summarize
const NOW = Date.parse("2026-10-23T12:00:00Z");
const row = (iso: string, kind: string, cost: number): UsageRow => ({ created_at: iso, kind, estimated_cost_usd: cost });
const rows: UsageRow[] = [
  row("2026-10-23T09:00:00Z", "ai_input_tokens", 0.6),
  row("2026-10-23T09:00:00Z", "ai_output_tokens", "0.15"), // numeric columns can arrive as strings
  row("2026-10-23T10:00:00Z", "ai_image", 0.04),
  row("2026-10-22T10:00:00Z", "ai_input_tokens", 1),
  row("2026-09-30T10:00:00Z", "ai_input_tokens", 2), // last month
  row("2026-10-23T11:00:00Z", "build_seconds", 99), // not AI: ignored
];

{
  const s = summarize(rows, { budgetUsd: null, period: "total", startsAt: null }, NOW);
  assert.equal(s.days.length, 30);
  assert.equal(s.days.at(-1)!.date, "2026-10-23");
  assert.deepEqual(s.days.at(-1), { date: "2026-10-23", chat: 0.75, image: 0.04, total: 0.79 });
  assert.equal(s.days.at(-2)!.total, 1);
  assert.equal(s.monthUsd, 1.79, "this month only");
  assert.equal(s.allTimeUsd, 3.79);
  assert.deepEqual(s.byKind, { chat: 3.75, image: 0.04 });
  assert.equal(s.budget.level, "none");
  assert.equal(s.budget.remainingUsd, null);
  assert.equal(s.days.every((d) => d.total >= 0), true);
}

// prepaid amount: spend counts from the day it was set up
{
  const s = summarize(rows, { budgetUsd: 10, period: "total", startsAt: "2026-10-01T00:00:00Z" }, NOW);
  assert.equal(s.budget.spentUsd, 1.79);
  assert.equal(s.budget.remainingUsd, 8.21);
  assert.equal(s.budget.fraction, 0.179);
  assert.equal(s.budget.level, "ok");
  const all = summarize(rows, { budgetUsd: 10, period: "total", startsAt: "2026-01-01T00:00:00Z" }, NOW);
  assert.equal(all.budget.spentUsd, 3.79);
}
// monthly budget: only this month's spend
{
  const s = summarize(rows, { budgetUsd: 2, period: "month", startsAt: null }, NOW);
  assert.equal(s.budget.spentUsd, 1.79);
  assert.equal(s.budget.level, "warn", "89 % used");
  assert.ok(s.budget.fraction! >= WARN_AT);
}
// the balance curve: one point per day, falling as money is spent, never above the budget
{
  const s = summarize(rows, { budgetUsd: 10, period: "total", startsAt: "2026-10-01T00:00:00Z" }, NOW);
  assert.equal(s.balance!.length, 30);
  assert.equal(s.balance!.at(-1)!.remainingUsd, 8.21);
  assert.equal(s.balance!.at(-2)!.remainingUsd, 9, "22 Oct: 1 spent so far");
  assert.equal(s.balance![0]!.remainingUsd, 10, "before any spending since the start");
  assert.ok(s.balance!.every((p, i, all) => i === 0 || p.remainingUsd <= all[i - 1]!.remainingUsd), "a prepaid balance only falls");
  assert.equal(summarize(rows, { budgetUsd: null, period: "total", startsAt: null }, NOW).balance, null);
  // a monthly budget starts over on the 1st
  const m = summarize(rows, { budgetUsd: 10, period: "month", startsAt: null }, NOW);
  assert.equal(m.balance!.find((p) => p.date === "2026-10-01")!.remainingUsd, 10);
  assert.equal(m.balance!.find((p) => p.date === "2026-10-22")!.remainingUsd, 9);
}
// levels at the edges
assert.equal(summarize(rows, { budgetUsd: 1.79, period: "month", startsAt: null }, NOW).budget.level, "over", "exactly used up counts as over");
assert.equal(summarize(rows, { budgetUsd: 100, period: "month", startsAt: null }, NOW).budget.level, "ok");
{
  const s = summarize(rows, { budgetUsd: 1, period: "month", startsAt: null }, NOW);
  assert.equal(s.budget.level, "over");
  assert.equal(s.budget.remainingUsd, -0.79, "going over shows as a negative remainder");
}
// a zero budget is used up as soon as anything is spent, and fine while nothing is
assert.equal(summarize(rows, { budgetUsd: 0, period: "month", startsAt: null }, NOW).budget.level, "over");
assert.equal(summarize([], { budgetUsd: 0, period: "month", startsAt: null }, NOW).budget.level, "ok");
// no rows at all
{
  const s = summarize([], { budgetUsd: 5, period: "total", startsAt: null }, NOW);
  assert.equal(s.allTimeUsd, 0);
  assert.equal(s.budget.remainingUsd, 5);
}

console.log("usage: all ok");
