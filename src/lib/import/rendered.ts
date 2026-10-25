import * as cheerio from "cheerio";
import { htmlToBlocks, navFrom } from "./clean.ts";
import { countBlocks, imagesIn, type Media, type Page, type SiteModel } from "./model.ts";
import { enrichEmbeds, linkedMediaNote } from "./embeds.ts";
import { createRobots, ImportFetchError, safeFetch } from "./safe-fetch.ts";
import { lostFonts } from "./theme.ts";
import { readTheme, siteBase, type Fetcher } from "./wordpress.ts";

/**
 * Reads a website that has no open API (Joomla, Drupal, Wix, Squarespace, or WordPress with the API
 * shut) by drawing its pages in a headless browser and reading the finished page. The same cleaning
 * as for WordPress turns the main content into blocks. No AI is involved.
 *
 * The browser is the risky part, so it is kept small: public addresses only (checked on every request
 * it makes), the site's own pages only, robots.txt followed, no pictures or fonts downloaded (the
 * pictures are fetched later by the picture step, which checks every file), and a fixed number of
 * pages and seconds.
 */

/** `attempts` counts pages opened, kept or not, so a site full of broken links cannot keep the browser busy. */
export const RENDER_LIMITS = { pages: 40, attempts: 60, wallMs: 90_000, sitemapFiles: 4, sitemapUrls: 400, htmlBytes: 2_000_000, linksFromHome: 60 };

export type Rendered = { /** The address the page ended up on, after redirects. */ url: string; status: number; html: string };
export type Renderer = { render(url: string): Promise<Rendered | null>; close(): Promise<void> };
export type RenderDeps = { fetch?: Fetcher; allowed?: (url: string) => Promise<boolean>; open?: () => Promise<Renderer>; now?: () => number };

const SKIP_EXTENSION = /\.(?:pdf|zip|rar|7z|gz|docx?|xlsx?|pptx?|csv|xml|json|txt|rss|atom|jpe?g|png|gif|webp|avif|svg|ico|bmp|mp[34]|mov|avi|wmv|webm|woff2?|ttf|otf|css|js)$/i;
const sameSite = (a: string, b: string) => new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, "");

/**
 * The address of a page on the site as the model keeps it: no query, no fragment, no trailing slash.
 * Returns null for anything that is not an ordinary page of this site, or whose path would be read as
 * a pattern by the router of the new site.
 */
export function pageAddress(href: string, base: string): { url: string; path: string } | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !sameSite(url.href, base)) return null;
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (SKIP_EXTENSION.test(path) || /[:*?()\\<>"'\s]/.test(decoded) || path.length > 200 || decoded.split("/").some((s) => s === "." || s === "..")) return null;
  // Admin and login areas are not content.
  if (/^\/(?:wp-admin|wp-login|administrator|user\/login|user\/register|admin|login|logout|cart|checkout|account)(?:\/|$)/i.test(path)) return null;
  return { url: `${url.origin}${path === "/" ? "/" : path}`, path };
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml" };
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** The part of the page that is the page itself: not the menu, the header and footer of the site, side columns or cookie banners. */
export function mainContent(html: string): { title: string; html: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, template").remove();
  $("nav, aside, [role='navigation'], [role='banner'], [role='contentinfo'], [role='complementary']").remove();
  // A site's own header and footer, but not the header of an article.
  $("header, footer").filter((_, el) => $(el).closest("main, article").length === 0).remove();
  $("[id*='cookie' i], [class*='cookie' i], [id*='consent' i], [class*='consent' i], [aria-label*='cookie' i]").remove();
  const pick = ["main", "[role='main']", "article", "#content", "#main", "#primary", ".content", ".main"].map((s) => $(s).first()).find((e) => e.length && collapse(e.text()).length > 40);
  const area = pick ?? $("body").first();
  const h1 = area.find("h1").first();
  const heading = collapse(h1.text());
  if (heading) h1.remove();
  return { title: heading, html: area.html() ?? "" };
}

const cleanTitle = (title: string, site: string) => {
  const parts = collapse(title).split(/\s+[|–—·-]\s+/);
  const first = parts.length > 1 ? parts.filter((p) => p.toLowerCase() !== site.toLowerCase())[0] : undefined;
  return first || collapse(title);
};

/** One drawn page as a page of the model, or null when there is nothing in it to keep. */
export function pageFromRendered(rendered: Rendered, path: string, n: number, siteName: string): { page: Page; signals: string[] } | null {
  const $ = cheerio.load(rendered.html);
  const meta = (selector: string) => collapse($(selector).first().attr("content") ?? "");
  const main = mainContent(rendered.html);
  const cleaned = htmlToBlocks(main.html, rendered.url);
  if (cleaned.blocks.length === 0) return null;
  const title = main.title || meta("meta[property='og:title']") || cleanTitle($("title").first().text(), siteName) || path;
  const description = meta("meta[name='description']") || meta("meta[property='og:description']");
  const published = meta("meta[property='article:published_time']");
  const kind = published || meta("meta[property='og:type']") === "article" ? "post" : "page";
  let image = "";
  try {
    const og = meta("meta[property='og:image']");
    if (og) image = new URL(og, rendered.url).href;
  } catch {
    image = "";
  }
  const page: Page = {
    id: `${kind}-${n}`,
    kind,
    url: rendered.url,
    path,
    slug: path.split("/").pop() ?? "",
    title: title.slice(0, 200),
    ...(published && !Number.isNaN(Date.parse(published)) ? { date: published } : {}),
    parent: null,
    excerpt: description.slice(0, 300),
    seo: { ...(meta("meta[property='og:title']") ? { title: meta("meta[property='og:title']").slice(0, 200) } : {}), ...(description ? { description: description.slice(0, 300) } : {}), ...(/^https?:\/\//.test(image) ? { image } : {}) },
    featuredImage: null,
    blocks: cleaned.blocks,
    signals: cleaned.signals,
  };
  return { page, signals: cleaned.signals };
}

/** The addresses a sitemap lists, following an index to a few of its files. */
async function sitemapUrls(fetcher: Fetcher, allowed: (u: string) => Promise<boolean>, base: string, requests: { n: number }): Promise<string[]> {
  const out: string[] = [];
  const queue = [`${base}/sitemap.xml`];
  const seen = new Set(queue);
  for (let files = 0; queue.length && files < RENDER_LIMITS.sitemapFiles; files++) {
    const url = queue.shift()!;
    try {
      if (!(await allowed(url))) continue;
      requests.n++;
      const res = await fetcher(url, { accept: /xml|text/i, maxBytes: 3_000_000, timeoutMs: 10_000 });
      if (!res.ok) continue;
      const $ = cheerio.load(res.text(), { xml: true });
      const index = $("sitemapindex").length > 0;
      $("loc").each((_, el) => {
        const loc = collapse($(el).text());
        if (index) {
          if (!seen.has(loc) && sameSite(loc, base) && seen.size < RENDER_LIMITS.sitemapFiles + 1) {
            seen.add(loc);
            queue.push(loc);
          }
        } else if (out.length < RENDER_LIMITS.sitemapUrls) out.push(loc);
      });
    } catch (error) {
      if (error instanceof ImportFetchError && error.code === "blocked") continue;
    }
  }
  return out;
}

export type RenderProbe = { name: string; description: string; language: string | null };

/** Draws the site's pages and reads them into the same model as a WordPress import. */
export async function crawlRendered(input: string, probe: RenderProbe, deps: RenderDeps = {}): Promise<SiteModel> {
  const fetcher: Fetcher = deps.fetch ?? ((url, limits) => safeFetch(url, limits));
  const allowed = deps.allowed ?? createRobots(fetcher);
  const now = deps.now ?? Date.now;
  const started = now();
  const deadline = started + RENDER_LIMITS.wallMs;
  const base = siteBase(input);
  const requests = { n: 0 };
  const warnings: string[] = ["Sidene er lest ved å tegne dem i en nettleser, så bare det som vises uten innlogging er med. Skjemaer, søk og handlekurv følger ikke med."];
  const renderer = await (deps.open ?? (async () => (await import("./rendered-browser.ts")).openRenderer()))();
  try {
    if (!(await allowed(`${base}/`))) throw new ImportFetchError("blocked", "Nettstedet ber roboter holde seg unna (robots.txt), så Pivolar henter ingenting herfra.");
    requests.n++;
    const home = await renderer.render(`${base}/`);
    if (!home || home.status >= 400 || !home.html) throw new ImportFetchError("network", "Fikk ikke åpnet forsiden.");
    if (!sameSite(home.url, base)) throw new ImportFetchError("blocked", "Nettstedet sender deg videre til et annet domene, så det blir ikke hentet.");
    const origin = new URL(home.url).origin;

    // Which pages: the front page, the menu, the sitemap, and then other links on the front page.
    const wanted = new Map<string, string>();
    const want = (href: string | undefined) => {
      const address = href ? pageAddress(href, `${origin}/`) : null;
      if (address && !wanted.has(address.path)) wanted.set(address.path, address.url);
    };
    want(`${origin}/`);
    const nav = navFrom(home.html, home.url);
    for (const item of nav) want(item.href);
    for (const loc of await sitemapUrls(fetcher, allowed, origin, requests)) want(loc);
    const $home = cheerio.load(home.html);
    $home("a[href]").slice(0, RENDER_LIMITS.linksFromHome).each((_, el) => want($home(el).attr("href")));

    const pages: Page[] = [];
    const signals = new Map<string, number>();
    const done = new Set<string>();
    let truncated = false;
    let n = 0;
    let skippedRobots = 0;
    let opened = 1;
    for (const [path, url] of wanted) {
      if (pages.length >= RENDER_LIMITS.pages || opened >= RENDER_LIMITS.attempts || now() > deadline) {
        truncated = true;
        break;
      }
      if (!(await allowed(url))) {
        skippedRobots++;
        continue;
      }
      let drawn: Rendered | null;
      if (path === "/") drawn = home;
      else {
        requests.n++;
        opened++;
        drawn = await renderer.render(url).catch(() => null);
      }
      if (!drawn || drawn.status >= 400 || drawn.html.length > RENDER_LIMITS.htmlBytes) continue;
      // A page that ended up somewhere else (a redirect) is kept once, on the address it ended on.
      const landed = pageAddress(drawn.url, `${origin}/`);
      if (!landed || (landed.path !== path && done.has(landed.path))) continue;
      done.add(landed.path);
      const made = pageFromRendered(drawn, landed.path, ++n, probe.name);
      if (!made) continue;
      pages.push(made.page);
      for (const s of made.signals) signals.set(s, (signals.get(s) ?? 0) + 1);
    }
    if (truncated) warnings.push(`Grensen på ${RENDER_LIMITS.pages} sider (eller tidsgrensen) ble nådd, så ikke alt er hentet.`);
    if (skippedRobots > 0) warnings.push(`${skippedRobots} sider ble hoppet over fordi robots.txt ber roboter holde seg unna dem.`);
    if (pages.length <= 1) warnings.push("Fant bare én side. Menyen eller nettstedskartet kunne ikke leses, så resten må legges til for hånd.");

    // Pictures: every picture a page shows, once, with the pages that use it.
    const media = new Map<string, Media>();
    for (const page of pages) {
      for (const src of new Set([...imagesIn(page.blocks), ...(page.seo.image ? [page.seo.image] : [])])) {
        if (!/^https?:\/\//.test(src)) continue;
        let item = media.get(src);
        if (!item) {
          const ext = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(src)?.[1]?.toLowerCase() ?? "";
          item = { id: `ext-${media.size + 1}`, sourceUrl: src, mime: MIME[ext] ?? "", alt: "", usedBy: [] };
          media.set(src, item);
        }
        item.usedBy.push(page.id);
      }
    }

    // The look: the front page and its style sheets, as for WordPress.
    const theme = await readTheme(fetcher, allowed, home.html, origin, deadline, now, requests).catch(() => undefined);
    if (theme) {
      const lost = lostFonts(theme);
      if (lost.length) warnings.push(`Skrifttypene ${lost.join(", ")} lastes fra det gamle nettstedet og følger ikke med. Nettstedet bruker en lignende i stedet.`);
    }

    await enrichEmbeds(pages, fetcher).catch(() => 0);
    const linked = linkedMediaNote(pages);
    if (linked) warnings.push(linked);

    let blocks = 0;
    let unknownBlocks = 0;
    for (const page of pages) {
      const c = countBlocks(page.blocks);
      blocks += c.total;
      unknownBlocks += c.unknown;
    }
    if (unknownBlocks > 0) warnings.push(`${unknownBlocks} deler (skjemaer, video, kortskoder og lignende) kunne ikke gjøres om til innhold, og må lages på nytt.`);
    const name = probe.name || cleanTitle(cheerio.load(home.html)("title").first().text(), "");
    return {
      source: "rendered",
      url: origin,
      name,
      description: probe.description,
      language: probe.language,
      nav,
      ...(theme ? { theme } : {}),
      pages,
      media: [...media.values()],
      plugins: [...signals.entries()].map(([pluginName, count]) => ({ name: pluginName, pages: count })).sort((a, b) => b.pages - a.pages),
      warnings,
      truncated,
      stats: { pages: pages.filter((p) => p.kind === "page").length, posts: pages.filter((p) => p.kind === "post").length, media: media.size, blocks, unknownBlocks, requests: requests.n, ms: now() - started },
    };
  } finally {
    await renderer.close().catch(() => undefined);
  }
}
