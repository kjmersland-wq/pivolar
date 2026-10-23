import assert from "node:assert/strict";
import { LIMITS, detectLoop, withNoteBeforeFinish, type StepLike } from "../src/lib/guard/loop.ts";
import { CACHE_READ_FACTOR, CACHE_WRITE_FACTOR, DEFAULT_PRICES, chatCostDetailed } from "../src/lib/usage/pricing.ts";

const step = (...results: { tool: string; path?: string; ok?: boolean; input?: Record<string, unknown> }[]): StepLike => ({
  toolResults: results.map((r) => ({ toolName: r.tool, input: r.input ?? { path: r.path }, output: { ok: r.ok ?? true, message: "m" } })),
});
const edit = (path: string, ok = true) => ({ tool: "editFile", path, ok });
const write = (path: string, ok = true) => ({ tool: "writeFile", path, ok });

// --- a normal request is never stopped
assert.equal(detectLoop([]), null);
assert.equal(detectLoop([step(write("/App.tsx")), step(write("/a.tsx"), write("/b.tsx")), step(edit("/a.tsx"))]), null);
assert.equal(detectLoop([step(edit("/a.tsx", false)), step(edit("/a.tsx"))]), null, "one failure that is then fixed is fine");

// --- the same edit failing again and again
{
  const found = detectLoop([step(edit("/Hero.tsx", false)), step(write("/x.tsx")), step(edit("/Hero.tsx", false)), step(edit("/Hero.tsx", false))]);
  assert.equal(found?.kind, "repeat-failure");
  assert.match(found!.message, /endringen på \/Hero\.tsx har mislyktes 3 ganger/);
  assert.match(found!.message, /spare kreditten/);
  assert.equal(detectLoop([step(edit("/A.tsx", false)), step(edit("/B.tsx", false)), step(edit("/C.tsx", false))]), null, "three different files are not the same loop");
}

// --- a run of failures on different files
{
  const found = detectLoop([step(edit("/a", false), edit("/b", false)), step(write("/c", false)), step(edit("/d", false))]);
  assert.equal(found?.kind, "failure-streak");
  assert.equal(detectLoop([step(edit("/a", false), edit("/b", false)), step(write("/c")), step(edit("/d", false))]), null, "a success breaks the streak");
}

// --- the same change written over and over
{
  const same = { tool: "writeFile", input: { path: "/App.tsx", content: "same" } };
  const found = detectLoop([step(same), step(same), step(same)]);
  assert.equal(found?.kind, "no-progress");
  assert.match(found!.message, /\/App\.tsx er gjort 3 ganger/);
  assert.equal(detectLoop([step(same), step({ tool: "writeFile", input: { path: "/App.tsx", content: "other" } }), step(same)]), null, "different content is progress");
  assert.equal(LIMITS.sameCall, 3);
}

// --- searches and image tools are not file failures
{
  const noisy = [1, 2, 3, 4, 5].map(() => ({ toolResults: [{ toolName: "searchFiles", input: { query: "x" }, output: { ok: false } }] }));
  assert.equal(detectLoop(noisy), null);
}

// --- a request that has used far more than a request normally does
{
  const heavy: StepLike = { usage: { inputTokens: LIMITS.tokens, outputTokens: 10 } };
  assert.equal(detectLoop([heavy])?.kind, "token-cap");
  assert.equal(detectLoop([{ usage: { inputTokens: 200_000, outputTokens: 20_000 } }]), null);
}

// --- the note is added just before the finish chunk, as a step of its own
{
  const input = [{ type: "start" }, { type: "start-step" }, { type: "text-start", id: "t1" }, { type: "text-end", id: "t1" }, { type: "finish-step" }, { type: "finish" }];
  const read = async (note: string | null) => {
    const stream = new ReadableStream({ start(c) { input.forEach((x) => c.enqueue(x)); c.close(); } });
    const out: { type: string; delta?: string }[] = [];
    const reader = withNoteBeforeFinish(stream, () => note).getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; out.push(value as { type: string; delta?: string }); }
    return out;
  };
  const withNote = await read("Stoppet.");
  assert.deepEqual(withNote.map((c) => c.type), ["start", "start-step", "text-start", "text-end", "finish-step", "start-step", "text-start", "text-delta", "text-end", "finish-step", "finish"]);
  assert.match(withNote.find((c) => c.type === "text-delta")!.delta!, /⚠️ Stoppet\./);
  assert.deepEqual((await read(null)).map((c) => c.type), input.map((c) => c.type), "nothing is added when there was no loop");
}

// --- cost with prompt caching
{
  const plain = chatCostDetailed({ inputTokens: 1_000_000, outputTokens: 100_000 }, DEFAULT_PRICES);
  assert.equal(plain.input, 3);
  assert.equal(plain.output, 1.5);
  assert.equal(plain.total, 4.5);
  const cached = chatCostDetailed({ inputTokens: 1_000_000, outputTokens: 0, inputTokenDetails: { noCacheTokens: 100_000, cacheReadTokens: 800_000, cacheWriteTokens: 100_000 } }, DEFAULT_PRICES);
  assert.equal(cached.input, Math.round(((100_000 + 800_000 * CACHE_READ_FACTOR + 100_000 * CACHE_WRITE_FACTOR) / 1_000_000) * 3 * 1e6) / 1e6);
  assert.ok(cached.input < plain.input / 2, "mostly cached input is much cheaper");
  assert.equal(cached.cachedTokens, 800_000);
  // details missing for the plain part: it is what is left after the cached parts
  const derived = chatCostDetailed({ inputTokens: 1_000, inputTokenDetails: { cacheReadTokens: 400 } }, DEFAULT_PRICES);
  assert.equal(derived.input, Math.round(((600 + 40) / 1_000_000) * 3 * 1e6) / 1e6);
  assert.equal(chatCostDetailed({}, DEFAULT_PRICES).total, 0);
  assert.equal(CACHE_WRITE_FACTOR, 1.25);
}

console.log("guard: all ok");
