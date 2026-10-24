import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CONNECTORS, connectorById, ENV_NAMES } from "../src/lib/connectors/index.ts";
import { CONTACT_FUNCTION, SHEET_FUNCTION } from "../src/lib/connectors/google.ts";
import { authorizeUrl, decryptToken, emailFromIdToken, encryptToken, exchangeCode, GOOGLE_SCOPES, signState, verifyState } from "../src/lib/oauth/core.ts";

const SECRET = "x".repeat(40);
const PROJECT = "9289b02c-b50f-4889-a1e8-975f9dc426de";

// --- the signed state
{
  const state = await signState({ project: PROJECT, service: "gmail", user: "u1" }, SECRET);
  const ok = await verifyState(state, SECRET);
  assert.equal(ok?.project, PROJECT);
  assert.equal(ok?.service, "gmail");
  assert.equal(ok?.user, "u1");
  assert.equal(await verifyState(state, "y".repeat(40)), null, "another key");
  const [data, signature] = state.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data!, "base64url").toString()), project: "11111111-1111-1111-1111-111111111111" })).toString("base64url");
  assert.equal(await verifyState(`${forged}.${signature}`, SECRET), null, "altered content");
  assert.equal(await verifyState(state, SECRET, Date.now() + 11 * 60_000), null, "expired after ten minutes");
  assert.equal(await verifyState("nonsense", SECRET), null);
  assert.equal(await verifyState("", SECRET), null);
  const other = await signState({ project: PROJECT, service: "gmail", user: "u1" }, SECRET);
  assert.notEqual(other, state, "a fresh value each time");
  const bad = await signState({ project: "not-a-uuid", service: "gmail", user: "u1" }, SECRET);
  assert.equal(await verifyState(bad, SECRET), null, "only real projects");
  const badService = await signState({ project: PROJECT, service: "contacts" as never, user: "u1" }, SECRET);
  assert.equal(await verifyState(badService, SECRET), null, "only known services");
}

// --- tokens are encrypted at rest
{
  const token = "1//0gAbCdEfGhIjKlMnOpQrStUvWxYz-refresh";
  const stored = await encryptToken(token, SECRET);
  assert.match(stored, /^v1\.[\w-]+\.[\w-]+$/);
  assert.ok(!stored.includes(token) && !stored.includes("refresh"), "no plain text in what is stored");
  assert.equal(await decryptToken(stored, SECRET), token);
  assert.notEqual(await encryptToken(token, SECRET), stored, "a new random value every time");
  assert.equal(await decryptToken(stored, "y".repeat(40)), null, "wrong key");
  const [v, iv, cipher] = stored.split(".");
  assert.equal(await decryptToken(`${v}.${iv}.${cipher!.slice(0, -4)}AAAA`, SECRET), null, "tampering is noticed");
  assert.equal(await decryptToken("v2.a.b", SECRET), null);
  assert.equal(await decryptToken("garbage", SECRET), null);
}

// --- the consent address asks for one narrow permission and for a refresh token
{
  const url = new URL(authorizeUrl({ clientId: "cid", redirectUri: "https://pivolar.com/api/oauth/google/callback", service: "gmail", state: "s" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), `openid email ${GOOGLE_SCOPES.gmail}`);
  assert.match(GOOGLE_SCOPES.gmail, /gmail\.send$/, "send only, never read");
  assert.match(GOOGLE_SCOPES.drive, /drive\.file$/, "only files the app made");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("include_granted_scopes"), "false", "no scopes from other connections");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.ok(!url.toString().includes("secret"));
}

// --- the code exchange
{
  const idToken = `h.${Buffer.from(JSON.stringify({ email: "meg@gmail.com" })).toString("base64url")}.s`;
  const good = (async (_url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("client_secret"), "csecret");
    return new Response(JSON.stringify({ refresh_token: "rt-123", id_token: idToken, access_token: "at" }));
  }) as typeof fetch;
  const result = await exchangeCode({ code: "c", clientId: "cid", clientSecret: "csecret", redirectUri: "https://x/cb" }, good);
  assert.deepEqual(result, { refreshToken: "rt-123", email: "meg@gmail.com" });
  const reused = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch;
  await assert.rejects(exchangeCode({ code: "c", clientId: "a", clientSecret: "b", redirectUri: "c" }, reused), /brukt eller utløpt/);
  const noRefresh = (async () => new Response(JSON.stringify({ access_token: "at" }))) as typeof fetch;
  await assert.rejects(exchangeCode({ code: "c", clientId: "a", clientSecret: "b", redirectUri: "c" }, noRefresh), /Tillat/);
  assert.equal(emailFromIdToken(undefined), null);
  assert.equal(emailFromIdToken("a.b.c"), null);
}

// --- what the browser may and may not set as environment variables
{
  assert.ok(ENV_NAMES.includes("GOOGLE_SHEET_ID"));
  for (const secret of ["GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_REFRESH_TOKEN_GMAIL", "GOOGLE_REFRESH_TOKEN_SHEETS", "GOOGLE_ACCOUNT_EMAIL"]) assert.ok(!ENV_NAMES.includes(secret), `${secret} only comes from the server`);
  const gmail = connectorById("gmail")!;
  const sheets = connectorById("google-sheets")!;
  assert.equal(gmail.oauth?.service, "gmail");
  assert.equal(sheets.oauth?.service, "sheets");
  assert.deepEqual(Object.keys(gmail.files!({})), ["/api/contact.ts"]);
  assert.deepEqual(Object.keys(sheets.files!({})), ["/api/sheet.ts"]);
  assert.ok(!CONNECTORS.some((c) => c.kind === "soon" && (c.id === "gmail" || c.id === "google-sheets")));
}

// --- the generated functions behave
async function load(source: string) {
  const dir = mkdtempSync(join(tmpdir(), "google-fn-"));
  const file = join(dir, "fn.mts");
  writeFileSync(file, source);
  return (await import(pathToFileURL(file).href)) as { POST: (r: Request) => Promise<Response> };
}
const post = (fn: { POST: (r: Request) => Promise<Response> }, body: unknown) => fn.POST(new Request("https://x.test/api", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const form = { name: "Kari", email: "kari@eksempel.no", message: "Hei, jeg lurer på noe." };
const realFetch = globalThis.fetch;

for (const key of ["GOOGLE_REFRESH_TOKEN_GMAIL", "GOOGLE_REFRESH_TOKEN_SHEETS", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ACCOUNT_EMAIL", "GOOGLE_SHEET_ID"]) delete process.env[key];

{
  const fn = await load(CONTACT_FUNCTION);
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return url.includes("oauth2.googleapis.com") ? new Response(JSON.stringify({ access_token: "at-1" })) : new Response("{}");
  }) as typeof fetch;
  try {
    assert.equal((await post(fn, form)).status, 500, "not set up");
    process.env.GOOGLE_ACCOUNT_EMAIL = "meg@gmail.com";
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "csecret";
    process.env.GOOGLE_REFRESH_TOKEN_GMAIL = "rt-gmail";
    assert.equal((await post(fn, "not json")).status, 400);
    assert.equal((await post(fn, { ...form, email: "nope" })).status, 400);
    assert.equal((await post(fn, { ...form, message: "x".repeat(3001) })).status, 400);
    assert.equal((await post(fn, { ...form, name: "" })).status, 400);
    assert.equal(calls.length, 0, "bad input never reaches Google");
    assert.equal((await post(fn, { ...form, website: "spam" })).status, 200, "honeypot looks like success");
    assert.equal(calls.length, 0, "but nothing is sent");

    const ok = await post(fn, { ...form, name: "Kari\r\nBcc: offer@example.com", message: "Hei på deg æøå" });
    assert.equal(ok.status, 200);
    assert.equal(calls.length, 2);
    assert.match(calls[0]!.url, /oauth2\.googleapis\.com\/token/);
    assert.equal(new URLSearchParams(String(calls[0]!.init.body)).get("refresh_token"), "rt-gmail", "only the gmail token");
    assert.match(calls[1]!.url, /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/);
    assert.equal((calls[1]!.init.headers as Record<string, string>).Authorization, "Bearer at-1");
    const raw = Buffer.from(JSON.parse(String(calls[1]!.init.body)).raw, "base64url").toString("utf8");
    const [head, ...rest] = raw.split("\r\n\r\n");
    assert.match(head!, /^To: meg@gmail\.com\r\n/);
    assert.match(head!, /Reply-To: kari@eksempel\.no/);
    assert.ok(!/^Bcc:/im.test(head!), "a visitor cannot add headers");
    assert.match(Buffer.from(rest.join("\r\n\r\n"), "base64").toString("utf8"), /Hei på deg æøå/);

    globalThis.fetch = (async (url: string) => (url.includes("oauth2") ? new Response("{}", { status: 400 }) : new Response("{}"))) as typeof fetch;
    const denied = await post(fn, form);
    assert.equal(denied.status, 502);
    assert.doesNotMatch(await denied.text(), /rt-gmail|csecret|at-1/, "no secret in a reply");
  } finally {
    globalThis.fetch = realFetch;
  }
}

{
  const fn = await load(SHEET_FUNCTION);
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return url.includes("oauth2.googleapis.com") ? new Response(JSON.stringify({ access_token: "at-2" })) : new Response("{}");
  }) as typeof fetch;
  try {
    process.env.GOOGLE_REFRESH_TOKEN_SHEETS = "rt-sheets";
    assert.equal((await post(fn, form)).status, 500, "no sheet chosen");
    process.env.GOOGLE_SHEET_ID = "../../evil";
    assert.equal((await post(fn, form)).status, 500, "a sheet id with slashes is refused");
    process.env.GOOGLE_SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    const ok = await post(fn, { ...form, name: "=HYPERLINK(\"http://evil\")", message: "+1 til alle" });
    assert.equal(ok.status, 200);
    assert.equal(new URLSearchParams(String(calls[0]!.init.body)).get("refresh_token"), "rt-sheets", "only the sheets token");
    assert.match(calls[1]!.url, /spreadsheets\/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789\/values\/A:D:append\?valueInputOption=RAW/);
    const row = JSON.parse(String(calls[1]!.init.body)).values[0] as string[];
    assert.equal(row.length, 4);
    assert.match(row[0]!, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(row[1], "'=HYPERLINK(\"http://evil\")", "a formula is stored as text");
    assert.equal(row[3], "'+1 til alle");
    assert.equal(row[2], "kari@eksempel.no");
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("oauth: all ok");
