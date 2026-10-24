import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifySource, cleanPath, deviceOf, isBot, referrerHost, visitorId } from "../src/lib/analytics/classify.ts";
import { trackingSnippet } from "../src/lib/analytics/snippet.ts";
import { summarize, type Hit } from "../src/lib/analytics/summary.ts";
import { buildDeployableProject } from "../src/lib/publish/project.ts";

const ID = "9289b02c-b50f-4889-a1e8-975f9dc426de";

// --- where a visit came from
{
  assert.equal(referrerHost("https://www.google.com/search?q=x"), "google.com");
  assert.equal(referrerHost("not a url"), null);
  assert.equal(referrerHost(""), null);
  assert.equal(referrerHost("https://minside.no/pris", "minside.no"), null, "the site itself is not a source");
  assert.equal(classifySource(null), "direct");
  assert.equal(classifySource("google.com"), "search");
  assert.equal(classifySource("www.bing.com"), "search");
  assert.equal(classifySource("duckduckgo.com"), "search");
  assert.equal(classifySource("ecosia.org"), "search");
  assert.equal(classifySource("chatgpt.com"), "ai");
  assert.equal(classifySource("perplexity.ai"), "ai");
  assert.equal(classifySource("gemini.google.com"), "ai", "AI wins over the search engine it belongs to");
  assert.equal(classifySource("l.facebook.com"), "social");
  assert.equal(classifySource("t.co"), "social");
  assert.equal(classifySource("linkedin.com"), "social");
  assert.equal(classifySource("blogg.example.no"), "referral");
  assert.equal(classifySource(null, "social"), "social", "links from the social tab carry utm_medium=social");
  assert.equal(classifySource("l.facebook.com", "cpc"), "ads", "paid wins over the referrer");
  assert.equal(classifySource(null, "email"), "referral");
  assert.equal(classifySource("evilgoogle.com"), "referral", "only the real domains count as search");
}

// --- browsers and bots
{
  assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
  assert.equal(isBot("facebookexternalhit/1.1"), true);
  assert.equal(isBot(""), true);
  assert.equal(isBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"), false);
  assert.equal(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"), "mobile");
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36"), "mobile");
  assert.equal(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "tablet");
  assert.equal(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126"), "desktop");
}

// --- only a clean path is kept
{
  assert.equal(cleanPath("/pris"), "/pris");
  assert.equal(cleanPath("/pris/?epost=a@b.no#x"), "/pris", "no query string, no fragment");
  assert.equal(cleanPath("/"), "/");
  assert.equal(cleanPath("//a//b/"), "/a/b");
  assert.equal(cleanPath("pris"), null);
  assert.equal(cleanPath("/" + "x".repeat(300)), null);
  assert.equal(cleanPath("/a\nb"), null);
  assert.equal(cleanPath(42), null);
}

// --- a visitor is a hash that changes every day and says nothing about the person
{
  const base = { ip: "203.0.113.7", userAgent: "Chrome", project: ID, day: "2026-10-24", salt: "s" };
  const a = await visitorId(base);
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.equal(await visitorId(base), a, "stable within a day");
  assert.notEqual(await visitorId({ ...base, day: "2026-10-25" }), a, "new tomorrow");
  assert.notEqual(await visitorId({ ...base, ip: "203.0.113.8" }), a);
  assert.notEqual(await visitorId({ ...base, project: "11111111-1111-1111-1111-111111111111" }), a, "not the same person across sites");
  assert.ok(!a.includes("203"), "no address in it");
}

// --- the counter on the published site
{
  const snippet = trackingSnippet("https://pivolar.com", ID);
  assert.match(snippet, /^<script>/);
  assert.match(snippet, /https:\/\/pivolar\.com\/api\/collect/);
  assert.match(snippet, new RegExp(ID));
  assert.match(snippet, /doNotTrack/);
  assert.match(snippet, /sendBeacon/);
  assert.doesNotMatch(snippet, /cookie|localStorage|sessionStorage/i, "no storage of any kind");
  assert.equal(trackingSnippet("http://pivolar.com", ID), "", "https only");
  assert.equal(trackingSnippet("https://x.com/\"><script>", ID), "", "no markup through the address");
  assert.equal(trackingSnippet("https://pivolar.com", "not-a-uuid"), "");
  const files = { "/App.tsx": "export default function App() { return <h1>x</h1>; }\n" };
  assert.match(buildDeployableProject(files, "T", { analytics: { origin: "https://pivolar.com", projectId: ID } })["index.html"]!, /api\/collect/);
  assert.doesNotMatch(buildDeployableProject(files, "T")["index.html"]!, /api\/collect/, "off unless asked for");
}

// --- the summary
{
  const now = Date.parse("2026-10-24T12:00:00Z");
  const at = (offsetHours: number) => new Date(now - offsetHours * 3_600_000).toISOString();
  const hit = (over: Partial<Hit>): Hit => ({ created_at: at(1), path: "/", source: "direct", referrer_host: null, country: "NO", device: "desktop", visitor: "v1", ...over });
  const hits: Hit[] = [
    hit({ created_at: at(0.05), visitor: "v1" }),
    hit({ created_at: at(0.05), visitor: "v1", path: "/pris" }),
    hit({ created_at: at(2), visitor: "v2", source: "search", referrer_host: "google.com", device: "mobile", country: "US" }),
    hit({ created_at: at(30), visitor: "v3", source: "social", referrer_host: "l.facebook.com", country: null }),
    hit({ created_at: at(24 * 10), visitor: "v4", source: "ai", referrer_host: "chatgpt.com" }),
    hit({ created_at: at(24 * 40), visitor: "v5" }),
  ];
  const week = summarize(hits, { days: 7, now });
  assert.equal(week.views, 4, "only the last 7 days");
  assert.equal(week.visitors, 3);
  assert.equal(week.online, 1, "seen in the last five minutes");
  assert.equal(week.series.length, 7);
  assert.equal(week.series.reduce((n, p) => n + p.count, 0), 4);
  assert.deepEqual({ all: week.bySource.all, direct: week.bySource.direct, search: week.bySource.search, social: week.bySource.social, ai: week.bySource.ai }, { all: 4, direct: 2, search: 1, social: 1, ai: 0 });
  assert.deepEqual(week.pages.map((p) => [p.name, p.count]), [["/", 3], ["/pris", 1]]);
  assert.deepEqual(week.sources.map((s) => s.name), ["Direkte", "google.com", "l.facebook.com"]);
  assert.deepEqual(week.countries.map((c) => c.name), ["NO", "?", "US"].sort((a, b) => (a === "NO" ? -1 : b === "NO" ? 1 : a.localeCompare(b))));
  assert.deepEqual(week.devices, { desktop: 75, mobile: 25, tablet: 0 });

  const month = summarize(hits, { days: 30, now });
  assert.equal(month.views, 5);
  assert.equal(month.bySource.ai, 1);
  const search = summarize(hits, { days: 7, now, source: "search" });
  assert.equal(search.views, 1);
  assert.equal(search.bySource.all, 4, "the tabs keep their counts when one is chosen");
  assert.deepEqual(search.devices, { desktop: 0, mobile: 100, tablet: 0 });
  const none = summarize([], { days: 7, now });
  assert.equal(none.views, 0);
  assert.deepEqual(none.devices, { desktop: 0, mobile: 0, tablet: 0 });
  assert.equal(none.series.length, 7);
}

// --- the database: only record_hit is open to visitors, and it checks everything
{
  const sql = readFileSync(new URL("../supabase/migrations/20261024120000_pivolar_analytics.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.site_hits from anon/);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]*site_hits/i, "visitors cannot write to the table directly");
  assert.match(sql, /security definer set search_path = ''/, "a definer function with a fixed search path");
  assert.match(sql, /grant execute on function public\.record_hit[^;]*to anon/);
  assert.match(sql, /interval '1 minute'/, "throttled");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code, /\bip\b|ip_address|user_agent/i, "no address or browser string is stored");
}

console.log("analytics: all ok");
