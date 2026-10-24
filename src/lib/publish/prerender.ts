import type { FileMap } from "../files.ts";

/**
 * An imported site is shown by a router, so a search engine that does not run JavaScript would see an empty page.
 * For those sites the build also draws every page to plain HTML. Visitors still get the live site: the browser
 * takes over the finished page. No AI is involved; it is the same code that draws the page in the browser.
 */

/** True for a site made by the import, which keeps its pages as data and draws them with one router. */
export function isPrerenderable(files: FileMap): boolean {
  return "/components/SiteRoutes.tsx" in files && "/content/index.ts" in files && "/content/site.ts" in files;
}

export const BUILD_COMMAND = "vite build && vite build --ssr src/entry-server.tsx --outDir .ssr && node scripts/prerender.mjs";

/** The title and description of a page for search results and sharing. Used by the page itself and by the pre-rendering, so they never differ. */
export const HEAD_MODULE = `import type { PageData } from "./types";
import { site } from "../content/site";

export type Head = { title: string; description: string | undefined; image: string | undefined };

export function pageHead(page: PageData): Head {
  return {
    title: page.seo.title ?? page.title + " – " + site.name,
    description: page.seo.description ?? (page.excerpt || undefined),
    image: page.seo.image ?? page.featuredImage ?? undefined,
  };
}

export function frontHead(): Head {
  return { title: site.name, description: site.description || undefined, image: undefined };
}
`;

/** Draws one address to HTML. Used by the build only. */
export const ENTRY_SERVER = `import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { SiteRoutes } from "./components/SiteRoutes";
import { pages } from "./content";
import { site } from "./content/site";
import { frontHead, pageHead } from "./lib/head";

/** Every address the site has a page for, once each. */
export const paths: string[] = [...new Set(["/", ...pages.map((p) => p.path)])];

export function render(url: string) {
  const page = pages.find((p) => p.path === url);
  const head = page ? pageHead(page) : frontHead();
  const html = renderToString(
    <StaticRouter location={url}>
      <SiteRoutes />
    </StaticRouter>,
  );
  return { html, head, lang: site.language };
}
`;

/** The browser takes over a drawn page when it is the page for this address, and draws from scratch otherwise (an unknown address, or an old copy). */
export const MAIN_TSX = `import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

const root = document.getElementById("root")!;
const same = (path: string | undefined) => {
  let value = path ?? "";
  try {
    value = decodeURIComponent(value);
  } catch {
    // an address that is not valid text never matches
  }
  return value.replace(/\\/+$/, "") || "/";
};
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);
if (root.hasChildNodes() && same(root.dataset.path) === same(location.pathname)) {
  hydrateRoot(root, app);
} else {
  root.replaceChildren();
  createRoot(root).render(app);
}

// Makes the site installable and lets it open without a connection.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
`;

/**
 * Runs after the build. Takes the built index.html as the frame and writes one finished page per address,
 * with its own title, description, canonical address and picture, plus a sitemap with every page.
 * The addresses come from another site, so each one is checked before a file is written.
 */
export const PRERENDER_SCRIPT = String.raw`import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { pathToFileURL } from "node:url";

const dist = resolve("dist");
const base = (process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "")).replace(/\/+$/, "");
const { render, paths } = await import(pathToFileURL(resolve(".ssr/entry-server.js")).href);
const shell = await readFile(resolve(dist, "index.html"), "utf8");

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const RESERVED = new Set(["assets", "images", "api"]);

/** Where the finished page for an address is written, or null when the address cannot be a safe folder. */
function target(path) {
  if (path === "/") return resolve(dist, "index.html");
  const parts = path.split("/").filter(Boolean);
  const names = [];
  for (const part of parts) {
    let name;
    try {
      name = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (!name || name === "." || name === ".." || /[\\/:*?"<>|\0]/.test(name)) return null;
    names.push(name);
  }
  if (RESERVED.has(names[0])) return null;
  const file = resolve(dist, ...names, "index.html");
  return file.startsWith(dist + sep) ? file : null;
}

function withMeta(doc, attribute, key, value) {
  if (!value) return doc;
  const pattern = new RegExp("<meta " + attribute + '="' + key + '" content="[^"]*" />');
  return pattern.test(doc) ? doc.replace(pattern, () => "<meta " + attribute + '="' + key + '" content="' + escape(value) + '" />') : doc;
}

function finish(path, result) {
  const { html, head, lang } = result;
  let doc = shell.replace(/<title>[\s\S]*?<\/title>/, () => "<title>" + escape(head.title) + "</title>");
  if (lang && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang)) doc = doc.replace(/<html lang="[^"]*"/, () => '<html lang="' + lang + '"');
  const image = head.image && base && head.image.startsWith("/") ? base + head.image : head.image && /^https:\/\//.test(head.image) ? head.image : "";
  doc = withMeta(doc, "name", "description", head.description);
  for (const key of ["og:title", "twitter:title"]) doc = withMeta(doc, key.startsWith("og") ? "property" : "name", key, head.title);
  for (const key of ["og:description", "twitter:description"]) doc = withMeta(doc, key.startsWith("og") ? "property" : "name", key, head.description);
  doc = withMeta(doc, "property", "og:image", image);
  doc = withMeta(doc, "name", "twitter:image", image);
  // The frame names the front page as the address of every page. Each page gets its own, or none when the site's address is not known.
  const address = base + (path === "/" ? "/" : path);
  if (base) {
    doc = doc.replace(/<link rel="canonical" href="[^"]*" \/>/, () => '<link rel="canonical" href="' + escape(address) + '" />');
    doc = withMeta(doc, "property", "og:url", address);
  } else if (path !== "/") {
    doc = doc.replace(/\s*<link rel="canonical" href="[^"]*" \/>/, "").replace(/\s*<meta property="og:url" content="[^"]*" \/>/, "");
  }
  return doc.replace('<div id="root"></div>', () => '<div id="root" data-path="' + escape(path) + '">' + html + "</div>");
}

const written = [];
let failed = 0;
// The front page last, because it replaces the frame the other pages are made from. The frame is read once above.
for (const path of [...paths].sort((a, b) => (a === "/") - (b === "/"))) {
  const file = target(path);
  if (!file) {
    console.warn("prerender: skipped " + JSON.stringify(path));
    continue;
  }
  try {
    const doc = finish(path, render(path));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, doc);
    written.push(path);
  } catch (error) {
    failed++;
    console.warn("prerender: " + JSON.stringify(path) + " failed: " + (error instanceof Error ? error.message : error));
  }
}
if (!written.length) {
  console.error("prerender: no page was written");
  process.exit(1);
}

if (base) {
  const list = written.map((path) => "  <url><loc>" + escape(base + (path === "/" ? "/" : path)) + "</loc></url>").join("\n");
  await writeFile(resolve(dist, "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + list + "\n</urlset>\n");
}
console.log("prerender: " + written.length + " pages" + (failed ? ", " + failed + " failed" : ""));
`;
