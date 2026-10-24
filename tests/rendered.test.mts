import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSiteProject } from "../src/lib/import/site-project.ts";
import { crawlRendered, mainContent, pageAddress, pageFromRendered, RENDER_LIMITS, type Rendered, type Renderer } from "../src/lib/import/rendered.ts";
import { ImportFetchError, type SafeResponse } from "../src/lib/import/safe-fetch.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SITE = "https://example.no";

// --- which addresses are pages of the site
{
  assert.deepEqual(pageAddress("/om-oss/", `${SITE}/`), { url: `${SITE}/om-oss`, path: "/om-oss" });
  assert.deepEqual(pageAddress("https://www.example.no/blogg/ett?utm=1#del", `${SITE}/`), { url: "https://www.example.no/blogg/ett", path: "/blogg/ett" }, "no query or fragment");
  assert.deepEqual(pageAddress("https://example.no", `${SITE}/`), { url: `${SITE}/`, path: "/" });
  for (const bad of ["https://annen.example/side", "mailto:a@b.no", "javascript:alert(1)", "/rapport.pdf", "/bilde.jpg", "/a:b", "/vare/*", "/(gruppe)/side", "/side%20med%20mellomrom", "/%zz", "/wp-admin/options", "/administrator", "/user/login", "/cart", `/${"x".repeat(300)}`, "ftp://example.no/x"]) {
    assert.equal(pageAddress(bad, `${SITE}/`), null, bad);
  }
  assert.equal(pageAddress("/a/../b", `${SITE}/`)?.path, "/b", "dot segments are resolved before anything is kept");
  assert.equal(pageAddress("/a/%2e%2e/%2e%2e/b", `${SITE}/`)?.path, "/b");
  assert.equal(pageAddress("/side%C3%A5", `${SITE}/`)?.path, "/side%C3%A5", "an encoded letter is fine");
}

// --- the page itself, without the frame around it
const PAGE = (body: string, head = "") => `<html lang="nb"><head><title>Om oss | Kaffebar</title><meta name="description" content="Vi brenner kaffe"><meta property="og:image" content="/bilder/delt.jpg">${head}</head><body>${body}</body></html>`;
{
  const html = PAGE(`<header><a href="/">Logo</a></header><nav><a href="/">Hjem</a></nav><div id="cookie-banner">Vi bruker informasjonskapsler</div>
    <main><h1>Om oss</h1><p>Vi er et lite brenneri i sentrum som har brent kaffe siden 1990.</p><article><header><h2>Historien</h2></header><p>Alt begynte i en garasje.</p></article></main>
    <aside>Reklame</aside><footer>© Kaffebar</footer>`);
  const main = mainContent(html);
  assert.equal(main.title, "Om oss");
  assert.match(main.html, /brent kaffe/);
  assert.match(main.html, /Historien/, "the header of an article stays");
  assert.doesNotMatch(main.html, /Logo|Hjem|informasjonskapsler|Reklame|©|<h1/, "the menu, the banner, the side column, the footer and the title are not part of the content");

  const page = pageFromRendered({ url: `${SITE}/om-oss`, status: 200, html }, "/om-oss", 1, "Kaffebar")!.page;
  assert.deepEqual([page.id, page.kind, page.path, page.title, page.excerpt], ["page-1", "page", "/om-oss", "Om oss", "Vi brenner kaffe"]);
  assert.equal(page.seo.image, `${SITE}/bilder/delt.jpg`, "the share picture, as a full address");
  assert.ok(page.blocks.some((b) => b.type === "paragraph"));

  // A title without a heading comes from the title tag, without the name of the site
  const noHeading = pageFromRendered({ url: `${SITE}/x`, status: 200, html: PAGE("<main><p>Dette er en side uten overskrift, men med nok tekst til å telle som innhold.</p></main>") }, "/x", 2, "Kaffebar")!.page;
  assert.equal(noHeading.title, "Om oss");
  // A post: the page says it was published
  const post = pageFromRendered({ url: `${SITE}/blogg/ny`, status: 200, html: PAGE("<main><h1>Ny</h1><p>Her er et innlegg som er langt nok til å regnes som innhold på siden.</p></main>", '<meta property="article:published_time" content="2026-03-05T10:00:00+01:00">') }, "/blogg/ny", 3, "Kaffebar")!.page;
  assert.deepEqual([post.kind, post.date], ["post", "2026-03-05T10:00:00+01:00"]);
  // Nothing to keep
  assert.equal(pageFromRendered({ url: `${SITE}/tom`, status: 200, html: PAGE("<main></main>") }, "/tom", 4, "Kaffebar"), null);
  // Script in the page is never part of the content
  const hostile = pageFromRendered({ url: `${SITE}/h`, status: 200, html: PAGE('<main><h1>H</h1><p onclick="alert(1)">Tekst som er lang nok til å regnes som innhold <script>alert(2)</script></p></main>') }, "/h", 5, "Kaffebar")!.page;
  assert.doesNotMatch(JSON.stringify(hostile.blocks), /alert|onclick|<script/);
}

// --- the crawl, with a stand-in for the browser
const HOME = PAGE(`<header><nav><a href="/">Hjem</a><a href="/om-oss/">Om oss</a><a href="/tjenester">Tjenester</a><a href="https://annen.example/">Ekstern</a></nav></header>
  <main><h1>Kaffebar</h1><p>Velkommen til oss. Vi brenner kaffe lokalt, og du finner alt om oss her på nettstedet vårt.</p><img src="/bilder/hjem.jpg" alt="Kaffe"><a href="/kontakt">Kontakt</a><a href="/skjult-i-robots">Skjult</a></main>`,
  '<style>:root{--wp--preset--color--primary:#b45309}</style><link rel="stylesheet" href="/tema.css"><meta property="og:site_name" content="Kaffebar">');
const bodyOf = (title: string, text = "Dette er en side med nok tekst til å regnes som innhold, skrevet for testen.") => PAGE(`<main><h1>${title}</h1><p>${text}</p><img src="/bilder/${title.toLowerCase()}.png" alt=""></main>`);
const pagesBySite: Record<string, Rendered> = {
  "/": { url: `${SITE}/`, status: 200, html: HOME },
  "/om-oss": { url: `${SITE}/om-oss`, status: 200, html: bodyOf("Om oss") },
  "/tjenester": { url: `${SITE}/tjenester`, status: 200, html: bodyOf("Tjenester") },
  "/kontakt": { url: `${SITE}/kontakt`, status: 200, html: bodyOf("Kontakt") },
  "/blogg/ett": { url: `${SITE}/blogg/ett`, status: 200, html: bodyOf("Ett") },
  "/finnes-ikke": { url: `${SITE}/finnes-ikke`, status: 404, html: bodyOf("Borte") },
  "/tom": { url: `${SITE}/tom`, status: 200, html: PAGE("<main></main>") },
  "/flytter": { url: "https://ond.example/side", status: 200, html: bodyOf("Ond") },
  "/skjult-i-robots": { url: `${SITE}/skjult-i-robots`, status: 200, html: bodyOf("Skjult") },
};
const sitemap = (locs: string[]) => `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

function fakeSite(options: { pages?: Record<string, Rendered>; sitemap?: string; robots?: string; fail?: boolean } = {}) {
  const pages = options.pages ?? pagesBySite;
  const drawn: string[] = [];
  const fetched: string[] = [];
  let closed = 0;
  const reply = (body: string, type = "text/plain", status = 200): SafeResponse => ({ url: "", status, ok: status < 300, contentType: type, headers: {}, body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) });
  const fetch = async (u: string) => {
    fetched.push(u);
    const { pathname } = new URL(u);
    if (pathname === "/robots.txt") return reply(options.robots ?? "User-agent: *\nDisallow: /skjult-i-robots\n");
    if (pathname === "/sitemap.xml") return options.sitemap ? reply(options.sitemap, "application/xml") : reply("", "text/plain", 404);
    if (pathname === "/tema.css") return reply("body{font-family:Lora,serif}", "text/css");
    return reply("", "text/plain", 404);
  };
  const open = async (): Promise<Renderer> => ({
    async render(url) {
      if (options.fail) throw new Error("browser crashed");
      drawn.push(url);
      return pages[new URL(url).pathname] ?? null;
    },
    async close() {
      closed++;
    },
  });
  return { fetch: fetch as never, open, drawn, fetched, closed: () => closed };
}

{
  const site = fakeSite({ sitemap: sitemap([`${SITE}/blogg/ett`, `${SITE}/rapport.pdf`, "https://annen.example/x", `${SITE}/wp-admin/x`, `${SITE}/a:b`, `${SITE}/finnes-ikke`, `${SITE}/tom`, `${SITE}/flytter`, `${SITE}/om-oss?ref=1`]) });
  const model = await crawlRendered(SITE, { name: "Kaffebar", description: "Brent lokalt", language: "nb" }, { fetch: site.fetch, open: site.open });
  assert.equal(model.source, "rendered");
  assert.deepEqual(model.pages.map((p) => p.path).sort(), ["/", "/blogg/ett", "/kontakt", "/om-oss", "/tjenester"], "the menu, the sitemap and the links of the front page; no file, no other site, no admin, no missing, empty or moved page");
  assert.ok(!site.drawn.some((u) => /skjult-i-robots|pdf|wp-admin|annen\.example|a:b/.test(u)), "pages robots.txt rules out, files, other sites and admin areas are never opened");
  assert.ok(model.warnings.some((w) => /robots\.txt/.test(w)), "the owner is told about the page that was left out");
  assert.ok(model.warnings.some((w) => /tegne dem i en nettleser/.test(w)));
  assert.equal(site.closed(), 1, "the browser is closed");
  assert.deepEqual(model.nav.map((n) => n.label), ["Hjem", "Om oss", "Tjenester"], "the menu is the site's own, on its own domain");
  assert.equal(model.theme?.primary, "#b45309");
  assert.equal(model.theme?.bodyFont, "Lora, serif", "the style sheet of the site is read too");
  assert.ok(model.media.some((m) => m.sourceUrl === `${SITE}/bilder/hjem.jpg` && m.usedBy.length === 1) && model.media.every((m) => /^https:\/\//.test(m.sourceUrl)));
  assert.deepEqual([model.stats.pages + model.stats.posts, model.truncated], [5, false]);

  // It goes on into a project like any other import
  const project = buildSiteProject(model, () => null);
  assert.ok("/content/pages/page-1.ts" in project.files || Object.keys(project.files).some((f) => f.startsWith("/content/pages/")));
  assert.equal(project.report.routes, 5);
}

{
  // A big site stops at the limit, and says so
  const many: Record<string, Rendered> = { "/": pagesBySite["/"]! };
  for (let i = 0; i < 100; i++) many[`/side-${i}`] = { url: `${SITE}/side-${i}`, status: 200, html: bodyOf(`Side ${i}`) };
  const site = fakeSite({ pages: many, sitemap: sitemap(Array.from({ length: 100 }, (_, i) => `${SITE}/side-${i}`)) });
  const model = await crawlRendered(SITE, { name: "Stor", description: "", language: null }, { fetch: site.fetch, open: site.open });
  assert.equal(model.pages.length, RENDER_LIMITS.pages);
  assert.equal(model.truncated, true);
  assert.ok(site.drawn.length <= RENDER_LIMITS.attempts, "no more pages are opened than the limit");

  // And it stops at the time limit
  const clock = { t: 0 };
  const slow = fakeSite({ pages: many, sitemap: sitemap(Array.from({ length: 100 }, (_, i) => `${SITE}/side-${i}`)) });
  const timed = await crawlRendered(SITE, { name: "Stor", description: "", language: null }, { fetch: slow.fetch, open: slow.open, now: () => (clock.t += 20_000) });
  assert.ok(timed.pages.length < 10 && timed.truncated);
}

{
  // Refused or broken: nothing is read, and the browser is still closed
  const refused = fakeSite({ robots: "User-agent: *\nDisallow: /\n" });
  await assert.rejects(crawlRendered(SITE, { name: "", description: "", language: null }, { fetch: refused.fetch, open: refused.open }), (e: unknown) => e instanceof ImportFetchError && e.code === "blocked");
  assert.equal(refused.drawn.length, 0, "a site that says no is never opened");
  assert.equal(refused.closed(), 1);

  const away = fakeSite({ pages: { "/": { url: "https://ond.example/", status: 200, html: HOME } } });
  await assert.rejects(crawlRendered(SITE, { name: "", description: "", language: null }, { fetch: away.fetch, open: away.open }), (e: unknown) => e instanceof ImportFetchError && /annet domene/.test(e.message), "a front page that sends the visitor to another domain is not followed");
  assert.equal(away.closed(), 1);

  const broken = fakeSite({ fail: true });
  await assert.rejects(crawlRendered(SITE, { name: "", description: "", language: null }, { fetch: broken.fetch, open: broken.open }));
  assert.equal(broken.closed(), 1, "a crash does not leave the browser running");

  const down = fakeSite({ pages: {} });
  await assert.rejects(crawlRendered(SITE, { name: "", description: "", language: null }, { fetch: down.fetch, open: down.open }), /forsiden/);
}

// --- what the real browser is allowed to do
{
  const browser = read("src/lib/import/rendered-browser.ts");
  assert.match(browser, /isPublicHost\(target\.hostname\)/, "every request it makes goes to a public address");
  assert.match(browser, /BLOCKED_TYPES = new Set\(\["image", "media", "font", "websocket", "eventsource", "other"\]\)/, "no pictures, fonts or media are downloaded");
  assert.match(browser, /request\.isNavigationRequest\(\) && site && bare\(target\.hostname\) !== site/, "a page cannot send it to another domain");
  assert.match(browser, /Browser\.setDownloadBehavior", \{ behavior: "deny" \}/);
  assert.match(browser, /dialog\.dismiss\(\)/);
  assert.match(browser, /LIFETIME_MS/, "it is closed after a fixed time");
  const route = read("src/app/api/import/cms/route.ts");
  assert.ok(route.indexOf('limit("render")') < route.indexOf("crawlRendered(data.url"), "the allowance is counted before the browser is started");
  assert.ok(route.indexOf("confirmOwner") > 0, "the owner's confirmation is still required");
  const ui = read("src/components/ImportCms.tsx");
  assert.match(ui, /probe\?\.rest \|\| probe\?\.renderable/);
}

console.log("rendered: all ok");
