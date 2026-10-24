import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CATEGORIES, CONNECTORS, connectorById, ENV_NAMES, envFor, missingFields, pickEnv, publicValues, searchConnectors, SUBSCRIBE_FUNCTION, validate } from "../src/lib/connectors/index.ts";
import { metaTags, readBrand } from "../src/lib/publish/brand.ts";
import { buildDeployableProject } from "../src/lib/publish/project.ts";

const paddle = connectorById("paddle")!;
const stripe = connectorById("stripe")!;
const resend = connectorById("resend")!;
const goodPaddle = { token: "test_0123456789abcdef", priceId: "pri_01abcdefghij", label: "Kjøp" };
const goodResend = { apiKey: "re_abcdefghijklmnop", audienceId: "78261eea-8f8b-4381-83c6-79fa7120f1cf" };

// --- registry
assert.deepEqual(CONNECTORS.slice(0, 3).map((c) => c.id), ["paddle", "stripe", "resend"]);
assert.equal(new Set(CONNECTORS.map((c) => c.id)).size, CONNECTORS.length, "ids are unique");
for (const c of CONNECTORS) {
  assert.ok(CATEGORIES.includes(c.category), `${c.id} has a known category`);
  if (c.kind === "soon") assert.equal(c.fields.length, 0, `${c.id} is only listed`);
  else {
    assert.ok(c.fields.length > 0 && c.docs.startsWith("https://"), `${c.id} has fields and docs`);
    assert.ok(c.request(Object.fromEntries(c.fields.map((f) => [f.key, "x"]))).length > 40, `${c.id} has a request`);
  }
  for (const f of c.fields) {
    if (f.env) assert.match(f.env, /^[A-Z][A-Z0-9_]+$/, `${c.id}/${f.key} env name`);
    if (f.secret) assert.ok(f.env, `${c.id}/${f.key} is secret, so it must reach the site as an env var`);
  }
  // Nothing a connector asks the model to build may contain a secret: the prompt sees public values only.
  const secrets = Object.fromEntries(c.fields.filter((f) => f.secret).map((f) => [f.key, `SECRET-${f.key}-VALUE`]));
  assert.doesNotMatch(c.request(publicValues(c, secrets)), /SECRET-/, `${c.id} prompt has no secrets`);
}
assert.ok(ENV_NAMES.includes("RESEND_API_KEY") && ENV_NAMES.includes("BREVO_API_KEY") && ENV_NAMES.includes("TELEGRAM_BOT_TOKEN"));
assert.ok(!ENV_NAMES.includes("GITHUB_TOKEN") && !ENV_NAMES.includes("VERCEL_TOKEN"), "Pivolar's own keys can never be passed on");
assert.equal(new Set(ENV_NAMES).size, ENV_NAMES.length);

// --- search
assert.deepEqual(searchConnectors("paddle").map((c) => c.id), ["paddle"]);
assert.ok(searchConnectors("sms").map((c) => c.id).includes("twilio"));
assert.ok(searchConnectors("sms").map((c) => c.id).includes("gatewayapi"));
assert.equal(searchConnectors("").length, CONNECTORS.length);
assert.deepEqual(searchConnectors("finnes ikke xyz"), []);

// --- assisted connectors: the prompt names the env vars and the function file, never a value
{
  const slack = connectorById("slack")!;
  assert.equal(slack.kind, "assisted");
  const text = slack.request({});
  assert.match(text, /\/api\/slack\.ts/);
  assert.match(text, /SLACK_WEBHOOK_URL/);
  assert.match(text, /process\.env/);
  assert.equal(validate(slack, { url: "https://hooks.slack.com/services/T0/B0/abc" }), null);
  assert.match(validate(slack, { url: "https://evil.example/hooks.slack.com/services/x" })!, /hooks\.slack\.com/);
  assert.equal(validate(connectorById("telegram")!, { token: "123456789:AAH-abcdefghijklmnopqrstuvwxyz12345", chat: "-100123456" }), null);
  assert.match(validate(connectorById("twilio")!, { sid: "AC123", token: "x", from: "12345" })!, /Account SID/);
  assert.deepEqual(envFor({ mailgun: { apiKey: "key-abcdefghijklmnopqrst", domain: "mg.eksempel.no", to: "a@b.no" } }), { MAILGUN_API_KEY: "key-abcdefghijklmnopqrst", MAILGUN_DOMAIN: "mg.eksempel.no", MAILGUN_TO: "a@b.no" });
}

// --- stores, content and AI: formats are checked, and costly calls are asked to be guarded
{
  const shopify = connectorById("shopify")!;
  assert.equal(shopify.kind, "client");
  assert.equal(validate(shopify, { domain: "min-butikk.myshopify.com", token: "abcdefghijklmnopqrstuvwx" }), null);
  assert.match(validate(shopify, { domain: "https://min-butikk.myshopify.com", token: "abcdefghijklmnopqrstuvwx" })!, /myshopify\.com/);
  assert.match(shopify.request({ domain: "min-butikk.myshopify.com", token: "abc" }), /Storefront API[\s\S]*cartCreate[\s\S]*Bruk aldri Admin-API-et/);
  assert.equal(connectorById("storyblok")!.kind, "client");
  const woo = connectorById("woocommerce")!;
  assert.deepEqual(envFor({ woocommerce: { url: "https://b.no", key: "ck_" + "a".repeat(30), secret: "cs_" + "b".repeat(30) } }), { WOOCOMMERCE_URL: "https://b.no", WOOCOMMERCE_KEY: "ck_" + "a".repeat(30), WOOCOMMERCE_SECRET: "cs_" + "b".repeat(30) });
  assert.match(validate(woo, { url: "http://b.no", key: "ck_" + "a".repeat(30), secret: "cs_" + "b".repeat(30) })!, /https/);
  assert.match(connectorById("gemini")!.request({}), /én forespørsel per besøkende per minutt/);
  assert.match(connectorById("semrush")!.request({}), /koster API-enheter/);
  assert.match(connectorById("apollo")!.request({}), /koster kreditter/);
  assert.equal(connectorById("shopify")!.kind === "client" && CONNECTORS.filter((c) => c.kind === "soon").length, 20, "the rest still needs a sign-in flow");
}

// --- client connectors: public values go straight into the request
{
  const ga = connectorById("google-analytics")!;
  assert.equal(validate(ga, { id: "G-ABC123XYZ9" }), null);
  assert.match(validate(ga, { id: "UA-123" })!, /G-/);
  assert.match(ga.request({ id: "G-ABC123XYZ9" }), /Godta/, "analytics waits for consent");
  assert.match(connectorById("google-maps")!.request({ key: "AIza" + "x".repeat(35), address: "Karl Johans gate 1, Oslo" }), /Karl%20Johans%20gate%201%2C%20Oslo/);
  assert.match(connectorById("tally")!.request({ url: "https://tally.so/r/abc123" }), /tally\.so\/embed\/abc123/);
  assert.match(validate(connectorById("logo-dev")!, { token: "sk_secret_value_here" })!, /pk_/, "the secret key is refused");
}

// --- site verification goes into /brand.json and out as meta tags
{
  const gsc = connectorById("google-search-console")!;
  assert.match(gsc.request({ token: "abcdefghij0123456789_-" }), /"verification": \{ "google": "abcdefghij0123456789_-" \}/);
  const brand = readBrand({ "/brand.json": JSON.stringify({ name: "A", verification: { google: "abcdefghij0123456789_-", bing: "short" } }) }, "A");
  assert.equal(brand.verification.google, "abcdefghij0123456789_-");
  assert.equal(brand.verification.bing, null, "a code that does not look right is ignored");
  const tags = metaTags(brand, "A");
  assert.match(tags, /name="google-site-verification" content="abcdefghij0123456789_-"/);
  assert.doesNotMatch(tags, /msvalidate/);
  const hostile = readBrand({ "/brand.json": JSON.stringify({ verification: { google: 'abcdefghij0123456789"><script>' } }) }, "A");
  assert.equal(hostile.verification.google, null, "markup never gets into the page");
}

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
