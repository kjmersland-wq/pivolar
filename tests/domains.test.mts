import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { approvePurchase, checkDomains, DomainError, purchaseRules, registerDomain, registrationStatus, type Availability } from "../src/lib/domains/cloudflare.ts";
import { connectDomain, dnsPlan } from "../src/lib/domains/connect.ts";
import { acceptIdeas, candidates, keywordsOf, parseDomain, toLabel } from "../src/lib/domains/names.ts";
import { rankDomains } from "../src/lib/domains/rank.ts";
import { RATES } from "../src/lib/quota/config.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// --- names
assert.equal(toLabel("Lille Brenneri & Co."), "lille-brenneri-og-co");
assert.equal(toLabel("Grünerløkka Kaffé"), "grunerlokka-kaffe");
assert.equal(toLabel("  --æøå--  "), "aeoa");
for (const ok of ["kaffe.no", "lille-brenneri.com", "a1.io", "KAFFE.NO"]) assert.ok(parseDomain(ok), ok);
assert.equal(parseDomain("KAFFE.NO")?.name, "kaffe.no");
for (const bad of ["kaffe", "www.kaffe.no", "https://kaffe.no", "kaffe.no/side", "-kaffe.no", "kaffe-.no", "ka..ffe.no", "kaffe.n0", "kaffe.c", "ka ffe.no", "kaf--fe.no", "", null, 5, `${"a".repeat(64)}.no`, "kaffé.no", "kaffe.no;drop"]) assert.equal(parseDomain(bad), null, String(bad));
assert.deepEqual(keywordsOf("En landingsside for en liten kaffebar"), ["kaffebar"]);
{
  const list = candidates({ brand: "Lille Brenneri", title: "En landingsside for en liten kaffebar", description: "Vi brenner kaffe selv på Grünerløkka" });
  assert.ok(list.length > 0 && list.length <= 20 && new Set(list).size === list.length);
  assert.ok(list.every((n) => parseDomain(n)), "every candidate is a valid name");
  assert.equal(list[0], "lille-brenneri.com", "the project's own name on the best ending comes first");
  assert.ok(list.includes("lillebrenneri.no") && list.some((n) => n.startsWith("kaffebar.")));
  assert.deepEqual(candidates({ limit: 5 }), [], "no name, no candidates");
  assert.equal(candidates({ brand: "x".repeat(300) }).every((n) => n.length <= 80), true);
  assert.ok(candidates({ brand: "Kaffe", extra: ["bønne", "x"], limit: 40 }).length <= 40);
}
assert.deepEqual(acceptIdeas({ names: ["Bønnehuset", "kaffe.com", "<script>", "ab", "bønnehuset", "to ord", "x".repeat(100)] }), ["bonnehuset", "kaffe", "script", "to-ord", "x".repeat(40)]);
assert.deepEqual(acceptIdeas("ikke en liste"), []);
assert.equal(acceptIdeas(Array.from({ length: 50 }, (_, i) => `navn${i}x`)).length, 8);

// --- the ranking
const ok = (name: string, price = 10.1, over: Partial<Availability> = {}): Availability => ({ name, registrable: true, tier: "standard", price, renewal: price + 1, currency: "USD", ...over });
{
  const ranked = rankDomains([ok("lille-brenneri.xyz"), ok("lillebrenneri.com"), ok("lillebrenneri.no"), ok("lillebrenneri.net"), ok("lillebrenneri2024.com"), ok("lillebrenneri.org", 10.1, { registrable: false, reason: "Er opptatt." }), ok("kaffe-fra-lille-brenneri-pa-gruner.com")], { brand: "lille-brenneri", norwegian: true });
  assert.equal(ranked[0]!.name, "lillebrenneri.com", "the best fit is number 1");
  assert.deepEqual(ranked.slice(0, 6).map((r) => r.rank), [1, 2, 3, 4, 5, 6]);
  assert.equal(ranked.at(-1)!.name, "lillebrenneri.org");
  assert.equal(ranked.at(-1)!.rank, null, "what cannot be bought has no rank and comes last");
  const names = ranked.map((r) => r.name);
  assert.ok(names.indexOf("lillebrenneri.no") < names.indexOf("lillebrenneri.net"), ".no ranks above .net for a Norwegian project");
  assert.ok(names.indexOf("lillebrenneri.com") < names.indexOf("lillebrenneri2024.com"), "digits cost points");
  assert.ok(names.indexOf("lillebrenneri.net") < names.indexOf("lille-brenneri.xyz"), "an unusual ending and a hyphen cost points");
  assert.ok(ranked[0]!.reasons.length > 0 && ranked[0]!.reasons.length <= 3, "the order comes with reasons");
  assert.ok(ranked.every((r) => r.score >= 0 && r.score <= 100));
  assert.deepEqual(rankDomains([ok("b.com"), ok("a.com")], {}).map((r) => r.name), ["a.com", "b.com"], "ties are broken the same way every time");
  assert.equal(rankDomains([], {}).length, 0);
  // Price
  const cheap = rankDomains([ok("kaffe.com", 9), ok("kaffe.net", 9), ok("kaffe.org", 60, { renewal: 200 })], { brand: "kaffe" });
  assert.equal(cheap.at(-1)!.name, "kaffe.org");
  assert.ok(cheap.at(-1)!.reasons.some((r) => /Dyrt|Fornyelsen/.test(r)), "a price trap is named");
  assert.ok(rankDomains([ok("butikk.shop")], { shop: true })[0]!.reasons.some((r) => /nettbutikk/.test(r)));
  assert.ok(rankDomains([ok("kaffe.no")], { norwegian: false })[0]!.score < rankDomains([ok("kaffe.no")], { norwegian: true })[0]!.score);
}

// --- Cloudflare Registrar, with a fake of the API
type Seen = { method: string; url: string; auth: string | null; body?: string };
function registrar(options: { check?: unknown; register?: { status: number; body: unknown } | "timeout" | "denied"; statusBody?: unknown } = {}) {
  const seen: Seen[] = [];
  const envelope = (result: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, errors: status < 400 ? [] : [{ message: "Authentication error" }], result }), { status });
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ method: init.method ?? "GET", url, auth: new Headers(init.headers).get("authorization"), ...(typeof init.body === "string" ? { body: init.body } : {}) });
    if (url.endsWith("/registrar/domain-check")) return envelope(options.check ?? { domains: [] });
    if (url.endsWith("/registrar/registrations")) {
      if (options.register === "timeout") throw new DOMException("timeout", "TimeoutError");
      if (options.register === "denied") return envelope(null, 403);
      return envelope(options.register?.body ?? { state: "succeeded", completed: true }, options.register?.status ?? 201);
    }
    if (url.includes("/registration-status")) return envelope(options.statusBody ?? { state: "succeeded", completed: true });
    return envelope(null, 404);
  }) as typeof fetch;
  return { fetcher, seen };
}
{
  const api = registrar({ check: { domains: [{ name: "kaffe.com", registrable: true, tier: "standard", pricing: { currency: "USD", registration_cost: "10.11", renewal_cost: "10.11" } }, { name: "kaffe.no", registrable: false, reason: "extension_not_supported_via_api" }, { name: "opptatt.com", registrable: false, reason: "domain_unavailable" }, { name: "https://evil.example", registrable: true }] } });
  const result = await checkDomains("tok", "acc", ["kaffe.com", "kaffe.no", "opptatt.com", "ugyldig", "kaffe.com", "http://x.no"], api.fetcher);
  assert.deepEqual(JSON.parse(api.seen[0]!.body!), { domains: ["kaffe.com", "kaffe.no", "opptatt.com"] }, "only valid, distinct names are sent");
  assert.deepEqual(result.map((r) => r.name), ["kaffe.com", "kaffe.no", "opptatt.com"], "a name that is not a domain in the answer is dropped");
  assert.deepEqual(result[0], { name: "kaffe.com", registrable: true, tier: "standard", price: 10.11, renewal: 10.11, currency: "USD" });
  assert.match(result[1]!.reason!, /norsk registrar/, ".no is explained");
  assert.equal(result[2]!.reason, "Er opptatt.");
  assert.ok(api.seen.every((s) => s.url.startsWith("https://api.cloudflare.com/") && s.auth === "Bearer tok"));
  assert.equal((await checkDomains("tok", "acc", Array.from({ length: 50 }, (_, i) => `navn${i}.com`), registrar().fetcher)).length, 0);
  const many = registrar();
  await checkDomains("tok", "acc", Array.from({ length: 50 }, (_, i) => `navn${i}.com`), many.fetcher);
  assert.equal(JSON.parse(many.seen[0]!.body!).domains.length, 20, "at most twenty per call");
  assert.equal((await checkDomains("tok", "acc", ["ugyldig"], many.fetcher)).length, 0);
}

// --- the rules for buying
{
  assert.deepEqual(purchaseRules({}), { enabled: false, maxUsd: 30 }, "off until the owner turns it on");
  assert.equal(purchaseRules({ DOMAIN_BUY_ENABLED: "true" }).enabled, true);
  assert.equal(purchaseRules({ DOMAIN_BUY_ENABLED: "no" }).enabled, false);
  assert.equal(purchaseRules({ DOMAIN_MAX_USD: "15" }).maxUsd, 15);
  assert.equal(purchaseRules({ DOMAIN_MAX_USD: "99999" }).maxUsd, 200, "never more than 200");
  assert.equal(purchaseRules({ DOMAIN_MAX_USD: "-3" }).maxUsd, 30);
  const now = ok("kaffe.com", 10.11);
  assert.deepEqual(approvePurchase({ seen: 10.11, now, maxUsd: 30 }), { ok: true, price: 10.11 });
  const no = (r: ReturnType<typeof approvePurchase>) => (r.ok ? "ok" : r.message);
  assert.match(no(approvePurchase({ seen: 10.11, now: undefined, maxUsd: 30 })), /Prøv igjen/);
  assert.match(no(approvePurchase({ seen: 10.11, now: { ...now, registrable: false, reason: "Er opptatt." }, maxUsd: 30 })), /opptatt/);
  assert.match(no(approvePurchase({ seen: 10.11, now: { ...now, tier: "premium" }, maxUsd: 30 })), /premium/);
  assert.match(no(approvePurchase({ seen: 10.11, now: { ...now, currency: "EUR" }, maxUsd: 30 })), /dollar/);
  assert.match(no(approvePurchase({ seen: 10.11, now: { ...now, price: undefined }, maxUsd: 30 })), /dollar/);
  assert.match(no(approvePurchase({ seen: 10.11, now: { ...now, price: 0 }, maxUsd: 30 })), /ikke riktig/);
  assert.match(no(approvePurchase({ seen: 120, now: { ...now, price: 120 }, maxUsd: 30 })), /over taket/);
  assert.match(no(approvePurchase({ seen: 10.11, now: { ...now, price: 12.5 }, maxUsd: 30 })), /endret seg fra 10\.11 til 12\.50/, "a price that moved is never bought without a new confirmation");
  assert.match(no(approvePurchase({ seen: Number.NaN, now, maxUsd: 30 })), /endret seg/);
}

// --- buying itself: one try, no auto-renew
{
  const done = registrar({ register: { status: 201, body: { state: "succeeded", completed: true, context: { registration: { expires_at: "2027-10-24" } } } } });
  const result = await registerDomain("tok", "acc", "kaffe.com", done.fetcher);
  assert.deepEqual(result, { state: "succeeded", done: true, expiresAt: "2027-10-24" });
  assert.deepEqual(JSON.parse(done.seen[0]!.body!), { domain_name: "kaffe.com", auto_renew: false }, "never renews by itself");
  assert.equal(done.seen.length, 1);
  const slow = await registerDomain("tok", "acc", "kaffe.com", registrar({ register: { status: 202, body: { state: "in_progress", completed: false } } }).fetcher);
  assert.deepEqual([slow.state, slow.done], ["in_progress", false]);
  const lost = registrar({ register: "timeout" });
  const unknown = await registerDomain("tok", "acc", "kaffe.com", lost.fetcher);
  assert.equal(unknown.state, "unknown");
  assert.match(unknown.message!, /ikke kjøper to ganger/);
  assert.equal(lost.seen.length, 1, "no answer is never retried");
  await assert.rejects(registerDomain("tok", "acc", "kaffe.com", registrar({ register: "denied" }).fetcher), (e) => e instanceof DomainError && /tillatelsen til Registrar/.test(e.message));
  await assert.rejects(registerDomain("tok", "acc", "ikke et domene", done.fetcher), /Ugyldig/);
  assert.equal(done.seen.length, 1, "an invalid name is stopped before anything is sent");
  const failed = await registerDomain("tok", "acc", "kaffe.com", registrar({ register: { status: 202, body: { state: "failed", error: { message: "Betaling avvist" } } } }).fetcher);
  assert.deepEqual([failed.state, failed.message], ["failed", "Betaling avvist"]);
  assert.equal((await registrationStatus("tok", "acc", "kaffe.com", registrar({ statusBody: { state: "action_required" } }).fetcher)).state, "action_required");
}

// --- connecting the domain
function dnsApi(options: { zone?: boolean; existing?: boolean; pagesConflict?: boolean } = {}) {
  const seen: Seen[] = [];
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const envelope = (result: unknown, status = 200) => reply({ success: status < 400, errors: status < 400 ? [] : [{ message: "nei" }], result }, status);
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ method: init.method ?? "GET", url, auth: new Headers(init.headers).get("authorization"), ...(typeof init.body === "string" ? { body: init.body } : {}) });
    if (url.startsWith("https://api.cloudflare.com/client/v4/")) {
      const path = url.replace("https://api.cloudflare.com/client/v4", "");
      if (path.startsWith("/zones?name=")) return envelope(options.zone === false ? [] : [{ id: "zone-1" }]);
      if (path === "/zones" && init.method === "POST") return envelope({ id: "zone-new", name_servers: ["anna.ns.cloudflare.com", "bob.ns.cloudflare.com"] });
      if (path.includes("/dns_records?")) return envelope(options.existing ? [{ id: "rec-1" }] : []);
      if (path.includes("/dns_records")) return envelope({ id: "rec" });
      if (path.endsWith("/domains")) return options.pagesConflict ? envelope(null, 409) : envelope({ name: "x" });
    }
    if (url.startsWith("https://api.netlify.com/api/v1/sites?")) return reply([{ id: "net-1", name: "kaffe" }]);
    if (url === "https://api.netlify.com/api/v1/sites/net-1" && init.method === "PATCH") return reply({});
    if (url.startsWith("https://api.vercel.com/v10/projects/")) return reply({}, 200);
    return reply({ message: `unexpected ${url}` }, 500);
  }) as typeof fetch;
  return { fetcher, seen };
}
const env = { CLOUDFLARE_API_TOKEN: "cf-tok", CLOUDFLARE_ACCOUNT_ID: "acc", NETLIFY_TOKEN: "net-tok", VERCEL_TOKEN: "ver-tok", VERCEL_TEAM_ID: "team_1" };
{
  assert.deepEqual(dnsPlan("cloudflare", "kaffe.com", "kaffe.pages.dev").map((r) => [r.type, r.name, r.proxied]), [["CNAME", "kaffe.com", true], ["CNAME", "www.kaffe.com", true]]);
  assert.ok(dnsPlan("netlify", "kaffe.com", "kaffe.netlify.app").every((r) => !r.proxied), "the proxy is off where the host makes the certificate");
  assert.ok(dnsPlan("vercel", "kaffe.com", "x").every((r) => !r.proxied));

  const cf = dnsApi();
  const result = await connectDomain({ host: "cloudflare", domain: "KAFFE.com", site: "kaffe", env, fetcher: cf.fetcher });
  assert.deepEqual([result.dnsWritten, result.manual, result.domain], [true, null, "kaffe.com"]);
  const pages = cf.seen.filter((s) => s.url.endsWith("/pages/projects/kaffe/domains")).map((s) => JSON.parse(s.body!).name);
  assert.deepEqual(pages, ["kaffe.com", "www.kaffe.com"]);
  const posted = cf.seen.filter((s) => s.method === "POST" && s.url.endsWith("/zones/zone-1/dns_records")).map((s) => JSON.parse(s.body!));
  assert.deepEqual(posted.map((p) => [p.type, p.name, p.content, p.proxied]), [["CNAME", "kaffe.com", "kaffe.pages.dev", true], ["CNAME", "www.kaffe.com", "kaffe.pages.dev", true]]);
  assert.ok(cf.seen.every((s) => s.url.startsWith("https://api.cloudflare.com/") && s.auth === "Bearer cf-tok"), "only the Cloudflare key, only to Cloudflare");

  // A record that exists is replaced, and a domain that is already on the project is fine
  const again = dnsApi({ existing: true, pagesConflict: true });
  await connectDomain({ host: "cloudflare", domain: "kaffe.com", site: "kaffe", env, fetcher: again.fetcher });
  assert.ok(again.seen.some((s) => s.method === "PUT" && s.url.endsWith("/dns_records/rec-1")));

  const net = dnsApi();
  const n = await connectDomain({ host: "netlify", domain: "kaffe.com", site: "kaffe", env, fetcher: net.fetcher });
  assert.deepEqual(n.records.map((r) => [r.type, r.content]), [["A", "75.2.60.5"], ["CNAME", "kaffe.netlify.app"]]);
  assert.deepEqual(JSON.parse(net.seen.find((s) => s.method === "PATCH")!.body!), { custom_domain: "kaffe.com", domain_aliases: ["www.kaffe.com"] });
  assert.ok(net.seen.filter((s) => s.url.includes("netlify")).every((s) => s.auth === "Bearer net-tok"));
  assert.ok(net.seen.filter((s) => s.url.includes("cloudflare")).every((s) => s.auth === "Bearer cf-tok"), "each key goes only to its own service");

  const ver = dnsApi();
  await connectDomain({ host: "vercel", domain: "kaffe.com", site: "kaffe", env, fetcher: ver.fetcher });
  assert.ok(ver.seen.some((s) => s.url === "https://api.vercel.com/v10/projects/kaffe/domains?teamId=team_1"));

  // A domain that is not in the account: listed by hand, or added to Cloudflare with the name servers to set
  const manual = await connectDomain({ host: "netlify", domain: "kaffe.no", site: "kaffe", env, fetcher: dnsApi({ zone: false }).fetcher });
  assert.equal(manual.dnsWritten, false);
  assert.match(manual.manual!, /A kaffe\.no → 75\.2\.60\.5/);
  const added = dnsApi({ zone: false });
  const withZone = await connectDomain({ host: "netlify", domain: "kaffe.no", site: "kaffe", env, fetcher: added.fetcher, addZone: true });
  assert.deepEqual([withZone.zoneCreated, withZone.dnsWritten, withZone.nameservers], [true, true, ["anna.ns.cloudflare.com", "bob.ns.cloudflare.com"]]);
  assert.ok(withZone.steps.some((s) => /Bytt navnetjenere/.test(s)));
  assert.deepEqual(JSON.parse(added.seen.find((s) => s.method === "POST" && s.url.endsWith("/zones"))!.body!), { name: "kaffe.no", account: { id: "acc" }, type: "full" });

  await assert.rejects(connectDomain({ host: "cloudflare", domain: "ikke-et-domene", site: "kaffe", env, fetcher: cf.fetcher }), /Ugyldig/);
  await assert.rejects(connectDomain({ host: "netlify", domain: "kaffe.com", site: "kaffe", env: { CLOUDFLARE_API_TOKEN: "x", CLOUDFLARE_ACCOUNT_ID: "y" }, fetcher: cf.fetcher }), /NETLIFY_TOKEN/);
  await assert.rejects(connectDomain({ host: "cloudflare", domain: "kaffe.com", site: "kaffe", env: {}, fetcher: cf.fetcher }), /CLOUDFLARE_API_TOKEN/);
}

// --- the route: money rules in the order they must hold
{
  const route = read("src/app/api/domains/route.ts");
  const at = (text: string) => route.indexOf(text);
  assert.ok(at("rules.enabled") > 0 && at("rules.enabled") < at('confirm.trim().toLowerCase() !== domain') && at('confirm.trim().toLowerCase() !== domain') < at('limit("domainbuy")') && at('limit("domainbuy")') < at("inflight.add(domain)"), "off switch, typed confirmation, daily allowance, lock");
  assert.ok(at("checkDomains(token, account, [domain])") < at("approvePurchase(") && at("approvePurchase(") < at('audit(db, "domain_purchase_attempt"') && at('audit(db, "domain_purchase_attempt"') < at("registerDomain("), "re-check, approve, write to the log, and only then buy");
  assert.match(route, /if \(!recorded\) return fail\(503/, "no log, no purchase");
  assert.match(route, /inflight\.delete\(domain\)/);
  assert.equal((route.match(/registerDomain\(/g) ?? []).length, 1, "bought from one place only");
  assert.match(route, /content-length/);
  assert.ok(RATES.domainbuy.max <= 5 && RATES.domainbuy.windowSeconds === 86400);
  const ideas = read("src/app/api/domains/ideas/route.ts");
  assert.doesNotMatch(ideas, /registerDomain|domains\/cloudflare/, "the AI step can never buy");
  assert.match(ideas, /acceptIdeas\(result\.output\)/);
  assert.match(ideas, /finally \{\s*await gate\.release\(\)/);
  const sql = read("supabase/migrations/20261024220000_pivolar_audit_domains.sql");
  assert.match(sql, /'import_owner_confirmed', 'domain_purchase_attempt', 'domain_purchase'/);
  assert.match(sql, /security definer set search_path = ''/);
  const dialog = read("src/components/DomainDialog.tsx");
  assert.match(dialog, /Kjøpet kan ikke refunderes/);
  assert.match(dialog, /confirm\.trim\(\)\.toLowerCase\(\) !== choice\.name/, "the button waits for the typed name");
  assert.match(dialog, /Beste forslag/);
  assert.match(dialog, /Det fornyes ikke av seg selv/);
}

console.log("domains: all ok");
