import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CONNECTORS, connectorById, envFor, missingFields, pickEnv, publicValues, SUBSCRIBE_FUNCTION, validate } from "../src/lib/connectors/index.ts";
import { buildDeployableProject } from "../src/lib/publish/project.ts";

const paddle = connectorById("paddle")!;
const stripe = connectorById("stripe")!;
const resend = connectorById("resend")!;
const goodPaddle = { token: "test_0123456789abcdef", priceId: "pri_01abcdefghij", label: "Kjøp" };
const goodResend = { apiKey: "re_abcdefghijklmnop", audienceId: "78261eea-8f8b-4381-83c6-79fa7120f1cf" };

// --- registry
assert.deepEqual(CONNECTORS.map((c) => c.id), ["paddle", "stripe", "resend"]);
assert.equal(new Set(CONNECTORS.map((c) => c.id)).size, CONNECTORS.length);

// --- validation catches typos before they reach the code
assert.equal(validate(paddle, goodPaddle), null);
assert.match(validate(paddle, { ...goodPaddle, token: "abc" })!, /test_ eller live_/);
assert.match(validate(paddle, { ...goodPaddle, priceId: "prod_123" })!, /pri_/);
assert.equal(validate(stripe, { link: "https://buy.stripe.com/test_abc123" }), null);
assert.match(validate(stripe, { link: "https://evil.example/buy.stripe.com/x" })!, /buy\.stripe\.com/);
assert.equal(validate(resend, goodResend), null);
assert.match(validate(resend, { ...goodResend, apiKey: "sk_live_x" })!, /re_/);
assert.deepEqual(missingFields(paddle, { token: "x" }), ["Pris-ID"], "the label is optional");
assert.deepEqual(missingFields(resend, {}), ["API-nøkkel", "Liste-ID (Audience)"]);

// --- prompts get public values only; secrets never leave the browser except as environment variables
{
  assert.deepEqual(publicValues(resend, goodResend), {}, "both Resend values are secret");
  const request = paddle.request(publicValues(paddle, goodPaddle));
  assert.match(request, /pri_01abcdefghij/);
  assert.match(request, /Paddle\.Environment\.set\("sandbox"\)/);
  const live = paddle.request({ ...goodPaddle, token: "live_0123456789abcdef" });
  assert.match(live, /ikke kall Paddle\.Environment\.set/);
  assert.doesNotMatch(live, /Environment\.set\("(sandbox|production)"\)/);
  assert.doesNotMatch(resend.request(publicValues(resend, goodResend)), /re_abcdefghijklmnop|78261eea/);
  assert.match(stripe.request({ link: "https://buy.stripe.com/x", label: "Kjøp" }), /<a href="https:\/\/buy\.stripe\.com\/x" target="_blank" rel="noopener noreferrer">/);
}

// --- environment variables: only the allowed names, trimmed, never empty
{
  assert.deepEqual(envFor({ resend: goodResend }), { RESEND_API_KEY: "re_abcdefghijklmnop", RESEND_AUDIENCE_ID: "78261eea-8f8b-4381-83c6-79fa7120f1cf" });
  assert.deepEqual(envFor({ paddle: goodPaddle }), {});
  assert.deepEqual(pickEnv({ RESEND_API_KEY: " re_x ", GITHUB_TOKEN: "ghp_secret", VERCEL_TOKEN: "x", RESEND_AUDIENCE_ID: "" }), { RESEND_API_KEY: "re_x" });
  assert.deepEqual(pickEnv(null), {});
  assert.deepEqual(pickEnv({ RESEND_API_KEY: "x".repeat(600) }), {});
}

// --- the subscribe function ships under /api, not /src/api
{
  const project = buildDeployableProject({ "/App.tsx": "export default function App() { return <h1>x</h1>; }\n", ...resend.files!({}) }, "Test");
  assert.equal(project["api/subscribe.ts"], SUBSCRIBE_FUNCTION);
  assert.ok(!("src/api/subscribe.ts" in project));
}

// --- the subscribe function behaves
{
  const dir = mkdtempSync(join(tmpdir(), "subscribe-"));
  const file = join(dir, "subscribe.mts");
  writeFileSync(file, SUBSCRIBE_FUNCTION);
  const { POST } = (await import(pathToFileURL(file).href)) as { POST: (r: Request) => Promise<Response> };
  const post = (body: unknown) => POST(new Request("https://x.test/api/subscribe", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_AUDIENCE_ID;
    assert.equal((await post({ email: "a@b.no" })).status, 500, "not set up");
    process.env.RESEND_API_KEY = "re_key";
    process.env.RESEND_AUDIENCE_ID = "aud-1";
    assert.equal((await post("not json")).status, 400);
    assert.equal((await post({ email: "nope" })).status, 400);
    assert.equal(calls.length, 0, "bad input never reaches Resend");
    assert.equal((await post({ email: "bot@b.no", website: "http://spam" })).status, 200, "honeypot looks like success");
    assert.equal(calls.length, 0, "but nothing is stored");
    const ok = await post({ email: " Navn@Eksempel.NO " });
    assert.equal(ok.status, 200);
    assert.equal(calls[0]!.url, "https://api.resend.com/audiences/aud-1/contacts");
    assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer re_key");
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { email: "navn@eksempel.no", unsubscribed: false });
    globalThis.fetch = (async () => new Response("{}", { status: 422 })) as typeof fetch;
    const failed = await post({ email: "a@b.no" });
    assert.equal(failed.status, 502);
    assert.doesNotMatch(await failed.text(), /re_key/, "the key never appears in a reply");
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("connectors: all ok");
