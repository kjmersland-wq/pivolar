import * as cheerio from "cheerio";
import { htmlToBlocks, navFrom } from "./clean.ts";
import { countBlocks, imagesIn, rewriteImages, type Media, type Page, type SiteModel } from "./model.ts";
import { extractTheme, lostFonts, stylesheetLinks, THEME_LIMITS, type Theme } from "./theme.ts";
import { RENDER_LIMITS } from "./rendered.ts";
import { createRobots, ImportFetchError, safeFetch, type FetchLimits, type SafeResponse } from "./safe-fetch.ts";

/**
 * Reads a WordPress site through its own REST API (`/wp-json`), which gives pages, posts and
 * pictures as structured data. No AI is involved, and no page has to be scraped to get the text.
 * Everything is read with the safe fetcher, robots.txt is followed, and every step has a limit.
 */

export const IMPORT_LIMITS = {
  /** Pages and posts together. */
  pages: 150,
  media: 400,
  /** Everything one import may spend on fetching. */
  wallMs: 100_000,
  jsonBytes: 5_000_000,
  htmlBytes: 2_000_000,
  pageSize: 100,
};

export type Fetcher = (url: string, limits?: FetchLimits) => Promise<SafeResponse>;
export type Deps = { fetch?: Fetcher; allowed?: (url: string) => Promise<boolean>; now?: () => number };

export type Probe = {
  cms: "wordpress" | "joomla" | "drupal" | "wix" | "squarespace" | "unknown";
  /** Can the pages be read by drawing them in a browser? True when the front page opened and robots.txt allows it. */
  renderable: boolean;
  /** Can the content be read through the REST API? */
  rest: boolean;
  /** The start of every REST address, either `…/wp-json` or `…/?rest_route=`. */
  restBase: string | null;
  base: string;
  name: string;
  description: string;
  language: string | null;
  counts: { pages: number | null; posts: number | null; media: number | null };
  notes: string[];
};

/** An address typed by the owner, made into the base of the site: https, no query, no trailing slash. */
export function siteBase(input: string): string {
  const text = input.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function tools(deps: Deps) {
  const fetcher: Fetcher = deps.fetch ?? ((url, limits) => safeFetch(url, limits));
  const allowed = deps.allowed ?? createRobots(fetcher);
  return { fetcher, allowed, now: deps.now ?? Date.now };
}

const restUrl = (restBase: string, route: string, params: Record<string, string | number> = {}) => {
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return restBase.endsWith("rest_route=") ? `${restBase}${route}${query ? `&${query}` : ""}` : `${restBase}${route}${query ? `?${query}` : ""}`;
};

const decode = (html: unknown) => cheerio.load(typeof html === "string" ? html : "", null, false).text().replace(/\s+/g, " ").trim();
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

async function getJson(fetcher: Fetcher, allowed: (u: string) => Promise<boolean>, url: string): Promise<{ data: unknown; headers: SafeResponse["headers"] } | null> {
  if (!(await allowed(url))) return null;
  try {
    const res = await fetcher(url, { accept: /json/i, maxBytes: IMPORT_LIMITS.jsonBytes, timeoutMs: 15_000, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return { data: res.json(), headers: res.headers };
  } catch (error) {
    // A site that cannot be reached at all, or an address that is not allowed, stops the import; a missing or broken API only means it is not there.
    if (error instanceof ImportFetchError && (error.code === "blocked" || error.code === "network")) throw error;
    return null;
  }
}

const CMS_NAMES: Record<Probe["cms"], string> = { wordpress: "Dette WordPress-nettstedet", joomla: "Dette Joomla-nettstedet", drupal: "Dette Drupal-nettstedet", wix: "Dette Wix-nettstedet", squarespace: "Dette Squarespace-nettstedet", unknown: "Dette nettstedet" };

/** Which system made the page, from the generator tag and the addresses it loads from. */
export function detectCms(generator: string, html: string): Probe["cms"] {
  if (/^WordPress/i.test(generator) || /\/wp-content\//.test(html)) return "wordpress";
  if (/joomla/i.test(generator)) return "joomla";
  if (/drupal/i.test(generator) || /\/sites\/default\/files\//.test(html)) return "drupal";
  if (/wix/i.test(generator) || /wixstatic\.com|parastorage\.com/.test(html)) return "wix";
  if (/squarespace/i.test(generator) || /static1\.squarespace\.com|squarespace-cdn\.com/.test(html)) return "squarespace";
  return "unknown";
}

/** Finds out whether the site is WordPress and whether its content can be read through the API, and how much there is. */
export async function probeWordPress(input: string, deps: Deps = {}): Promise<Probe> {
  const { fetcher, allowed } = tools(deps);
  const base = siteBase(input);
  const probe: Probe = { cms: "unknown", renderable: false, rest: false, restBase: null, base, name: "", description: "", language: null, counts: { pages: null, posts: null, media: null }, notes: [] };

  if (!(await allowed(`${base}/`))) {
    probe.notes.push("Nettstedet ber roboter holde seg unna (robots.txt), så Pivolar henter ingenting herfra.");
    return probe;
  }

  for (const candidate of [`${base}/wp-json`, `${base}/?rest_route=`]) {
    const root = await getJson(fetcher, allowed, `${candidate}/`);
    const data = asRecord(root?.data);
    if (Array.isArray(data.namespaces) && data.namespaces.includes("wp/v2")) {
      probe.cms = "wordpress";
      probe.rest = true;
      probe.restBase = candidate;
      probe.name = decode(data.name);
      probe.description = decode(data.description);
      break;
    }
  }

  // The front page tells the language, and says WordPress even when the API is closed.
  try {
    const home = await fetcher(`${base}/`, { accept: /html/i, maxBytes: IMPORT_LIMITS.htmlBytes });
    if (home.ok) {
      const html = home.text();
      const $ = cheerio.load(html);
      probe.language = $("html").attr("lang") ?? null;
      if (!probe.name) probe.name = $("meta[property='og:site_name']").attr("content") ?? decode($("title").first().text());
      probe.renderable = true;
      if (probe.cms === "unknown") probe.cms = detectCms($("meta[name='generator']").attr("content") ?? "", html);
    }
  } catch (error) {
    if (error instanceof ImportFetchError && error.code === "blocked") throw error;
    probe.notes.push("Fikk ikke hentet forsiden.");
  }

  if (!probe.rest && probe.renderable) probe.notes.push(`${CMS_NAMES[probe.cms]} kan ikke leses direkte, men sidene kan leses ved å tegne dem i en nettleser. Det tar lengre tid og henter inntil ${RENDER_LIMITS.pages} sider.`);
  else if (probe.cms === "wordpress" && !probe.rest) probe.notes.push("Dette er WordPress, men REST-API-et er stengt eller blokkert, og forsiden kunne ikke åpnes. Du kan eksportere fra WordPress (Verktøy → Eksporter).");
  else if (!probe.rest && probe.notes.length === 0) probe.notes.push("Fikk ikke åpnet forsiden, så innholdet kan ikke leses herfra.");

  if (probe.rest && probe.restBase) {
    for (const [key, route] of [["pages", "/wp/v2/pages"], ["posts", "/wp/v2/posts"], ["media", "/wp/v2/media"]] as const) {
      const res = await getJson(fetcher, allowed, restUrl(probe.restBase, route, { per_page: 1, _fields: "id" }));
      const total = Number(res?.headers["x-wp-total"]);
      probe.counts[key] = Number.isFinite(total) ? total : null;
    }
  }
  return probe;
}

type Collected = { items: Record<string, unknown>[]; truncated: boolean };

/** All pages of one list, up to a limit and a deadline. */
async function collect(fetcher: Fetcher, allowed: (u: string) => Promise<boolean>, restBase: string, route: string, fields: string, cap: number, deadline: number, now: () => number, count: { n: number }): Promise<Collected> {
  const items: Record<string, unknown>[] = [];
  let truncated = false;
  for (let page = 1; ; page++) {
    if (now() > deadline) {
      truncated = true;
      break;
    }
    count.n++;
    const res = await getJson(fetcher, allowed, restUrl(restBase, route, { per_page: IMPORT_LIMITS.pageSize, page, _fields: fields }));
    if (!res || !Array.isArray(res.data)) break;
    for (const raw of res.data) {
      if (items.length >= cap) {
        truncated = true;
        break;
      }
      items.push(asRecord(raw));
    }
    const totalPages = Number(res.headers["x-wp-totalpages"]);
    if (truncated || !Number.isFinite(totalPages) || page >= totalPages) break;
  }
  return { items, truncated };
}

/** The colours and fonts of the front page and of the first few style sheets it loads. A sheet that cannot be read is skipped; the theme then rests on what could be. */
export async function readTheme(fetcher: Fetcher, allowed: (u: string) => Promise<boolean>, html: string, base: string, deadline: number, now: () => number, requests: { n: number }): Promise<Theme> {
  const sheets: string[] = [];
  for (const href of stylesheetLinks(html, base)) {
    if (now() > deadline) break;
    try {
      if (!(await allowed(href))) continue;
      requests.n++;
      const res = await fetcher(href, { accept: /css/i, maxBytes: THEME_LIMITS.sheetBytes, timeoutMs: 10_000 });
      if (res.ok) sheets.push(res.text());
    } catch (error) {
      if (error instanceof ImportFetchError && error.code === "blocked") continue;
    }
  }
  return extractTheme(html, sheets);
}

/** A resized picture (`name-300x200.jpg`) is the original (`name.jpg`) when the original is a known file. */
export function originalOf(src: string, known: Set<string>): string {
  if (known.has(src)) return src;
  const stripped = src.replace(/-(?:scaled|\d{2,5}x\d{2,5})(?=\.[a-z0-9]+(?:\?.*)?$)/i, "");
  return known.has(stripped) ? stripped : src;
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml" };

export async function fetchWordPress(input: string, probe: Probe, deps: Deps = {}): Promise<SiteModel> {
  const { fetcher, allowed, now } = tools(deps);
  if (!probe.rest || !probe.restBase) throw new ImportFetchError("network", "REST-API-et er ikke tilgjengelig for dette nettstedet.");
  const started = now();
  const deadline = started + IMPORT_LIMITS.wallMs;
  const base = siteBase(input);
  const restBase = probe.restBase;
  const requests = { n: 0 };
  const warnings: string[] = [];
  let truncated = false;

  // Pictures first, so the pictures in the text can be matched to the originals.
  requests.n++;
  const mediaList = await collect(fetcher, allowed, restBase, "/wp/v2/media", "id,source_url,mime_type,alt_text,media_details", IMPORT_LIMITS.media, deadline, now, requests);
  if (mediaList.truncated) {
    truncated = true;
    warnings.push(`Bare de første ${IMPORT_LIMITS.media} bildene i mediebiblioteket ble hentet.`);
  }
  const mediaById = new Map<string, Media>();
  const bySource = new Map<string, Media>();
  for (const raw of mediaList.items) {
    const sourceUrl = typeof raw.source_url === "string" ? raw.source_url : "";
    if (!sourceUrl) continue;
    const details = asRecord(raw.media_details);
    const width = Number(details.width);
    const height = Number(details.height);
    const media: Media = { id: String(raw.id), sourceUrl, mime: typeof raw.mime_type === "string" ? raw.mime_type : "", alt: decode(raw.alt_text), usedBy: [], ...(width > 0 ? { width } : {}), ...(height > 0 ? { height } : {}) };
    mediaById.set(media.id, media);
    bySource.set(sourceUrl, media);
  }
  const known = new Set(bySource.keys());

  const fields = "id,slug,link,title,content,excerpt,parent,date,modified,featured_media,yoast_head_json";
  const pageList = await collect(fetcher, allowed, restBase, "/wp/v2/pages", fields, IMPORT_LIMITS.pages, deadline, now, requests);
  const postList = await collect(fetcher, allowed, restBase, "/wp/v2/posts", fields, Math.max(IMPORT_LIMITS.pages - pageList.items.length, 0), deadline, now, requests);
  if (pageList.truncated || postList.truncated) {
    truncated = true;
    warnings.push(`Grensen på ${IMPORT_LIMITS.pages} sider og innlegg (eller tidsgrensen) ble nådd, så ikke alt er hentet.`);
  }

  const pages: Page[] = [];
  const pluginCount = new Map<string, number>();
  let skippedRobots = 0;
  let skippedProtected = 0;
  for (const [kind, list] of [["page", pageList.items], ["post", postList.items]] as const) {
    for (const raw of list) {
      const link = typeof raw.link === "string" ? raw.link : "";
      const content = asRecord(raw.content);
      if (content.protected === true) {
        skippedProtected++;
        continue;
      }
      if (!link) continue;
      // A page the site tells robots to stay away from is not copied, even though the API handed it over.
      if (!(await allowed(link))) {
        skippedRobots++;
        continue;
      }
      const cleaned = htmlToBlocks(typeof content.rendered === "string" ? content.rendered : "", link);
      const blocks = rewriteImages(cleaned.blocks, (src) => originalOf(src, known));
      const yoast = asRecord(raw.yoast_head_json);
      const ogImage = Array.isArray(yoast.og_image) ? asRecord(yoast.og_image[0]).url : undefined;
      const url = new URL(link);
      const id = `${kind}-${String(raw.id)}`;
      const featured = mediaById.get(String(raw.featured_media));
      const parent = Number(raw.parent);
      const page: Page = {
        id,
        kind,
        url: link,
        path: url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/",
        slug: typeof raw.slug === "string" ? raw.slug : "",
        title: decode(asRecord(raw.title).rendered),
        ...(typeof raw.date === "string" ? { date: raw.date } : {}),
        ...(typeof raw.modified === "string" ? { modified: raw.modified } : {}),
        parent: parent > 0 ? `page-${parent}` : null,
        excerpt: decode(asRecord(raw.excerpt).rendered).slice(0, 300),
        seo: {
          ...(typeof yoast.title === "string" ? { title: yoast.title } : {}),
          ...(typeof yoast.description === "string" ? { description: yoast.description } : {}),
          ...(typeof ogImage === "string" ? { image: ogImage } : {}),
          ...(typeof yoast.canonical === "string" ? { canonical: yoast.canonical } : {}),
        },
        featuredImage: featured?.sourceUrl ?? null,
        blocks,
        signals: cleaned.signals,
      };
      pages.push(page);
      for (const signal of page.signals) pluginCount.set(signal, (pluginCount.get(signal) ?? 0) + 1);
    }
  }
  if (skippedProtected > 0) warnings.push(`${skippedProtected} passordbeskyttede sider ble hoppet over.`);
  if (skippedRobots > 0) warnings.push(`${skippedRobots} sider ble hoppet over fordi robots.txt ber roboter holde seg unna dem.`);

  // Which page shows which picture, and pictures that are on a page but not in the library.
  const media = [...mediaById.values()];
  const extra = new Map<string, Media>();
  for (const page of pages) {
    for (const src of new Set([...imagesIn(page.blocks), ...(page.featuredImage ? [page.featuredImage] : [])])) {
      let item = bySource.get(src) ?? extra.get(src);
      if (!item) {
        const ext = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(src)?.[1]?.toLowerCase() ?? "";
        item = { id: `ext-${extra.size + 1}`, sourceUrl: src, mime: MIME[ext] ?? "", alt: "", usedBy: [] };
        extra.set(src, item);
      }
      item.usedBy.push(page.id);
    }
  }
  const allMedia = [...media, ...extra.values()];

  // The menu and the language come from the front page. The API does not give menus without a login.
  let nav: SiteModel["nav"] = [];
  let theme: Theme | undefined;
  try {
    requests.n++;
    const home = await fetcher(`${base}/`, { accept: /html/i, maxBytes: IMPORT_LIMITS.htmlBytes });
    if (home.ok) {
      const html = home.text();
      nav = navFrom(html, `${base}/`);
      theme = await readTheme(fetcher, allowed, html, base, deadline, now, requests);
    }
  } catch {
    warnings.push("Fikk ikke hentet menyen fra forsiden.");
  }
  if (theme) {
    const lost = lostFonts(theme);
    if (lost.length) warnings.push(`Skrifttypene ${lost.join(", ")} lastes fra det gamle nettstedet og følger ikke med. Nettstedet bruker en lignende i stedet.`);
  }
  if (nav.length === 0) warnings.push("Fant ingen meny. Den må lages for hånd.");

  let blocks = 0;
  let unknownBlocks = 0;
  for (const page of pages) {
    const c = countBlocks(page.blocks);
    blocks += c.total;
    unknownBlocks += c.unknown;
  }
  if (unknownBlocks > 0) warnings.push(`${unknownBlocks} deler (skjemaer, video, kortkoder og lignende) kunne ikke gjøres om til innhold, og må lages på nytt.`);
  const plugins = [...pluginCount.entries()].map(([name, n]) => ({ name, pages: n })).sort((a, b) => b.pages - a.pages);

  return {
    source: "wordpress",
    url: base,
    name: probe.name,
    description: probe.description,
    language: probe.language,
    nav,
    ...(theme ? { theme } : {}),
    pages,
    media: allMedia,
    plugins,
    warnings,
    truncated,
    stats: { pages: pages.filter((p) => p.kind === "page").length, posts: pages.filter((p) => p.kind === "post").length, media: allMedia.length, blocks, unknownBlocks, requests: requests.n, ms: now() - started },
  };
}
