import type { Block, Page, SiteModel } from "./model.ts";
import { HEAD_MODULE } from "../publish/prerender.ts";
import { FONT_PAIRS, sanitizeDesign, type Design } from "./design.ts";
import { googleFamilies, isFontLink, resolveTokens, type Tokens } from "./theme.ts";

/**
 * Turns an imported site into a Pivolar project, with fixed templates and no AI: the content stays
 * as data (one module per page), and a small set of ready-made components shows it. Every old
 * address keeps working, since each page is served on the path it had. The result is complete but
 * plain on purpose; the AI is for the design, later, and it works on these components, not on the texts.
 *
 * The generated code writes no HTML from text: inline markup is read by a small parser that only
 * knows links and emphasis, and everything else is shown as text.
 */

type Files = Record<string, string>;

export type SiteProject = {
  files: Files;
  report: { pages: number; posts: number; routes: number; images: number; unknownBlocks: number; homeFromPosts: boolean };
};

const TYPES = `export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; html: string }
  | { type: "image"; src: string; alt: string; width?: number; height?: number; caption?: string; href?: string }
  | { type: "gallery"; images: { src: string; alt: string }[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; html: string; cite?: string }
  | { type: "button"; label: string; href: string }
  | { type: "columns"; columns: Block[][] }
  | { type: "table"; header: boolean; rows: string[][] }
  | { type: "embed"; provider: "youtube" | "vimeo" | "map" | "other"; src: string }
  | { type: "code"; text: string }
  | { type: "divider" }
  | { type: "unknown"; reason: string; text: string };

export type NavItem = { label: string; href: string };

export type Site = { name: string; description: string; language: string | null; nav: NavItem[]; hero?: { headline: string; subline: string; cta?: { label: string; href: string } } };

export type PageData = {
  id: string;
  kind: "page" | "post";
  path: string;
  title: string;
  date?: string;
  excerpt: string;
  seo: { title?: string; description?: string; image?: string };
  featuredImage: string | null;
  blocks: Block[];
};
`;

const INLINE = `import { createElement, type ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Text with links and emphasis, from the small piece of markup the importer keeps. Only a, strong,
 * em, u, s, sub, sup, mark, code and br are known; anything else is shown as plain text, and no
 * markup is ever written into the page as HTML.
 */

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' };
const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot);/g, (m) => ENTITIES[m] ?? m);
const TAGS = new Set(["strong", "em", "u", "s", "sub", "sup", "mark", "code"]);

type Open = { tag: string; href: string | undefined; children: ReactNode[] };

/** Only addresses that stay on the site, or go to the web, a mail address or a phone. */
function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (href.startsWith("#")) return href;
  return /^(https?:|mailto:|tel:)/i.test(href) ? href : null;
}

function wrap(node: Open, key: number): ReactNode {
  if (node.tag === "a") {
    const href = safeHref(node.href);
    if (!href) return createElement("span", { key }, ...node.children);
    if (href.startsWith("/")) return createElement(Link, { key, to: href, className: "underline underline-offset-2 hover:no-underline" }, ...node.children);
    const outside = /^https?:/i.test(href);
    return createElement("a", { key, href, className: "underline underline-offset-2 hover:no-underline", ...(outside ? { target: "_blank", rel: "noopener noreferrer" } : {}) }, ...node.children);
  }
  return createElement(node.tag, { key }, ...node.children);
}

export function Inline({ html }: { html: string }) {
  const root: ReactNode[] = [];
  const stack: Open[] = [{ tag: "root", href: undefined, children: root }];
  const top = () => stack[stack.length - 1]!;
  const re = /<(\\/?)([a-z]+)((?:\\s[^>]*)?)>|([^<]+)/gi;
  let key = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[4] !== undefined) {
      top().children.push(decode(m[4]));
      continue;
    }
    const closing = m[1] === "/";
    const tag = (m[2] ?? "").toLowerCase();
    if (tag === "br" && !closing) {
      top().children.push(createElement("br", { key: key++ }));
    } else if (tag === "a" || TAGS.has(tag)) {
      if (!closing) {
        const href = /href="([^"]*)"/.exec(m[3] ?? "")?.[1];
        stack.push({ tag, href: href === undefined ? undefined : decode(href), children: [] });
      } else if (stack.length > 1 && top().tag === tag) {
        const done = stack.pop()!;
        top().children.push(wrap(done, key++));
      }
    }
  }
  while (stack.length > 1) {
    const done = stack.pop()!;
    top().children.push(wrap(done, key++));
  }
  return <>{root}</>;
}
`;

const BLOCKS = `import { Link } from "react-router-dom";
import { Inline } from "../lib/inline";
import type { Block } from "../lib/types";

/** Every kind of content block, shown with plain Tailwind classes. The design is changed here, in one place. */

const HEADING = {
  1: "text-3xl font-semibold tracking-tight",
  2: "text-2xl font-semibold tracking-tight",
  3: "text-xl font-semibold",
  4: "text-lg font-semibold",
  5: "text-base font-semibold",
  6: "text-sm font-semibold uppercase tracking-wide",
} as const;

function Picture({ src, alt, width, height }: { src: string; alt: string; width?: number | undefined; height?: number | undefined }) {
  return <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" className="h-auto max-w-full rounded-xl" />;
}

function Embed({ provider, src }: { provider: "youtube" | "vimeo" | "map" | "other"; src: string }) {
  // Only video and maps are shown inside the page. Anything else is a link, so a page cannot bring in a frame of its own choosing.
  if (provider === "other") {
    return (
      <p>
        <a href={src} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          Åpne innholdet
        </a>
      </p>
    );
  }
  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-100">
      <iframe src={src} title={provider === "map" ? "Kart" : "Video"} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full border-0" />
    </div>
  );
}

function One({ block }: { block: Block }) {
  switch (block.type) {
    case "heading": {
      // A page has one main heading, its title, so a heading of the first level in the text becomes the second.
      const level = block.level === 1 ? 2 : block.level;
      const Tag = ("h" + level) as "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag className={HEADING[level] + " mt-8 first:mt-0"}>{block.text}</Tag>;
    }
    case "paragraph":
      return (
        <p className="leading-relaxed">
          <Inline html={block.html} />
        </p>
      );
    case "image": {
      const picture = <Picture src={block.src} alt={block.alt} width={block.width} height={block.height} />;
      const linked = block.href ? (block.href.startsWith("/") ? <Link to={block.href}>{picture}</Link> : <a href={block.href} target="_blank" rel="noopener noreferrer">{picture}</a>) : picture;
      return (
        <figure className="space-y-2">
          {linked}
          {block.caption ? <figcaption className="text-sm text-slate-500">{block.caption}</figcaption> : null}
        </figure>
      );
    }
    case "gallery":
      return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {block.images.map((image, i) => (
            <Picture key={i} src={image.src} alt={image.alt} />
          ))}
        </div>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className={(block.ordered ? "list-decimal" : "list-disc") + " space-y-1 pl-6"}>
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline html={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="border-l-4 border-slate-300 pl-4 italic text-slate-600">
          <Inline html={block.html} />
          {block.cite ? <footer className="mt-1 text-sm not-italic text-slate-500">{block.cite}</footer> : null}
        </blockquote>
      );
    case "button": {
      const classes = "pv-button inline-block rounded-lg px-5 py-2.5 text-sm font-medium";
      return block.href.startsWith("/") ? (
        <Link to={block.href} className={classes}>
          {block.label}
        </Link>
      ) : (
        <a href={block.href} target={block.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className={classes}>
          {block.label}
        </a>
      );
    }
    case "columns":
      return (
        <div className={"grid gap-8 " + (block.columns.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
          {block.columns.map((column, i) => (
            <div key={i} className="space-y-4">
              <Blocks blocks={column} />
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-slate-200">
                  {row.map((cell, c) => (block.header && r === 0 ? <th key={c} className="px-3 py-2 font-semibold">{cell}</th> : <td key={c} className="px-3 py-2">{cell}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "embed":
      return <Embed provider={block.provider} src={block.src} />;
    case "code":
      return <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100"><code>{block.text}</code></pre>;
    case "divider":
      return <hr className="border-slate-200" />;
    default:
      // Content the importer could not turn into a block is not shown. It is listed in IMPORT.md.
      return null;
  }
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => (
        <One key={i} block={block} />
      ))}
    </>
  );
}
`;

const SEO = `import { useEffect } from "react";

function setMeta(attribute: "name" | "property", key: string, content: string | undefined) {
  let tag = document.head.querySelector<HTMLMetaElement>("meta[" + attribute + '="' + key + '"]');
  if (!content) return tag?.remove();
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

/** The title and the description of the page for the browser tab and for sharing. The words are the old site's own. */
export function Seo({ title, description, image }: { title: string; description?: string | undefined; image?: string | undefined }) {
  useEffect(() => {
    document.title = title;
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:image", image);
  }, [title, description, image]);
  return null;
}
`;

const NAV_SIMPLE = `<nav aria-label="Hovedmeny" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">`;
const NAV_CENTERED = `<nav aria-label="Hovedmeny" className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm">`;

/** The frame around every page: the name, the menu from the old site, and the footer. The header and footer come in two fixed variants. */
function layoutFor(design: Design | null): string {
  const centered = design?.header === "centered";
  const columns = design?.footer === "columns";
  const hero = Boolean(design?.hero);
  return `import { useEffect, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { site } from "../content/site";${hero ? '\nimport { Hero } from "./Hero";' : ""}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    if (site.language) document.documentElement.lang = site.language;
  }, []);
  return (
    <div className="pv-page flex min-h-screen flex-col">
      <header className="border-b border-slate-200">
        <div className="${centered ? "mx-auto flex max-w-5xl flex-col items-center gap-3 px-5 py-5 text-center" : "mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-4"}">
          <Link to="/" className="${centered ? "text-2xl" : "text-lg"} font-semibold tracking-tight">
            {site.name}
          </Link>
          ${centered ? NAV_CENTERED : NAV_SIMPLE}
            {site.nav.map((item) => (
              <NavLink key={item.href} to={item.href} end={item.href === "/"} className={({ isActive }) => (isActive ? "font-semibold" : "text-slate-600 hover:text-slate-900")}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
${hero ? '      {pathname === "/" ? <Hero /> : null}\n' : ""}      <main className="pv-main mx-auto w-full max-w-3xl flex-1 px-5">{children}</main>
${
  columns
    ? `      <footer className="border-t border-slate-200 py-10 text-sm text-slate-600">
        <div className="mx-auto grid max-w-5xl gap-8 px-5 sm:grid-cols-2">
          <div>
            <p className="font-semibold">{site.name}</p>
            {site.description ? <p className="mt-2">{site.description}</p> : null}
          </div>
          <nav aria-label="Bunnmeny" className="flex flex-col gap-1 sm:items-end">
            {site.nav.map((item) => (
              <Link key={item.href} to={item.href} className="hover:underline">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>`
    : `      <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-500">
        {site.name}
        {site.description ? " · " + site.description : ""}
      </footer>`
}
    </div>
  );
}
`;
}

const HERO = `import { Link } from "react-router-dom";
import { site } from "../content/site";

/** A heading and a line at the top of the front page. It is a paragraph, not a heading, so the page keeps one main heading. */
export function Hero() {
  const hero = site.hero;
  if (!hero) return null;
  return (
    <section className="pv-hero">
      <div className="mx-auto max-w-3xl space-y-4 px-5 py-14">
        <p className="pv-hero-title text-4xl font-semibold tracking-tight">{hero.headline}</p>
        {hero.subline ? <p className="text-lg opacity-80">{hero.subline}</p> : null}
        {hero.cta ? (
          <p>
            <Link to={hero.cta.href} className="pv-button inline-block px-5 py-2.5 text-sm font-medium">
              {hero.cta.label}
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
`;

const PAGE_VIEW = `import { Blocks } from "./Blocks";
import { Seo } from "./Seo";
import { pageHead } from "../lib/head";
import type { PageData } from "../lib/types";

// The day as written on the old site, the same on the server that draws the page and in the browser.
const formatDate = (date: string) => {
  const day = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(date);
  const parsed = day ? new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))) : new Date(date);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

/** One page or post: the title, the date for a post, the picture and the content. */
export function PageView({ page }: { page: PageData }) {
  const firstImage = page.blocks.find((b) => b.type === "image");
  const showFeatured = page.featuredImage && !(firstImage && firstImage.type === "image" && firstImage.src === page.featuredImage);
  const head = pageHead(page);
  return (
    <article className="space-y-5">
      <Seo title={head.title} description={head.description} image={head.image} />
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">{page.title}</h1>
        {page.kind === "post" && page.date ? <p className="text-sm text-slate-500">{formatDate(page.date)}</p> : null}
      </header>
      {showFeatured ? <img src={page.featuredImage ?? ""} alt="" loading="lazy" decoding="async" className="h-auto max-w-full rounded-xl" /> : null}
      <Blocks blocks={page.blocks} />
    </article>
  );
}
`;

const HOME = `import { Link } from "react-router-dom";
import { Seo } from "./Seo";
import { pages } from "../content";
import { site } from "../content/site";

/** The front page when the old site had no page of its own for it: the name, the description and the latest posts. */
export function Home() {
  const posts = pages.filter((p) => p.kind === "post").sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 12);
  return (
    <div className="space-y-8">
      <Seo title={site.name} description={site.description || undefined} />
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">{site.name}</h1>
        {site.description ? <p className="text-lg text-slate-600">{site.description}</p> : null}
      </header>
      <ul className="space-y-6">
        {posts.map((post) => (
          <li key={post.id}>
            <h2 className="text-xl font-semibold">
              <Link to={post.path} className="hover:underline">
                {post.title}
              </Link>
            </h2>
            {post.excerpt ? <p className="mt-1 text-slate-600">{post.excerpt}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
`;

const ROUTES = `import { Link, Route, Routes } from "react-router-dom";
import { Home } from "./Home";
import { Layout } from "./Layout";
import { PageView } from "./PageView";
import { Seo } from "./Seo";
import { pages } from "../content";

function NotFound() {
  return (
    <div className="space-y-3">
      <Seo title="Fant ikke siden" />
      <h1 className="text-3xl font-semibold">Fant ikke siden</h1>
      <p>
        <Link to="/" className="underline">
          Gå til forsiden
        </Link>
      </p>
    </div>
  );
}

/** Every page on the path it had on the old site, so old links, bookmarks and search results keep working. */
export function SiteRoutes() {
  const hasFront = pages.some((p) => p.path === "/");
  return (
    <Layout>
      <Routes>
        {hasFront ? null : <Route path="/" element={<Home />} />}
        {pages.map((page) => (
          <Route key={page.id} path={page.path} element={<PageView page={page} />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
`;

const APP = `import { BrowserRouter } from "react-router-dom";
import { SiteRoutes } from "./components/SiteRoutes";

export default function App() {
  return (
    <BrowserRouter>
      <SiteRoutes />
    </BrowserRouter>
  );
}
`;

/** The look of the old site as CSS variables, so the fixed layout carries its colours and fonts. */
const RADIUS = { none: "0", soft: "0.5rem", round: "1rem" } as const;
const PADDING = { regular: "2.5rem", airy: "4rem" } as const;

function stylesFor(tokens: Tokens, fontLinks: string[], design: Design | null): string {
  return [
    ...fontLinks.map((href) => `@import url("${href}");`),
    `:root { --pv-primary: ${tokens.primary}; --pv-on-primary: ${tokens.onPrimary}; --pv-bg: ${tokens.background}; --pv-text: ${tokens.text}; --pv-radius: ${RADIUS[design?.radius ?? "soft"]}; --pv-pad: ${PADDING[design?.density ?? "regular"]}; }`,
    "html, body, #root { margin: 0; min-height: 100%; }",
    `body { background: var(--pv-bg); color: var(--pv-text); font-family: ${tokens.bodyFont}; -webkit-font-smoothing: antialiased; }`,
    ...(tokens.headingFont ? [`h1, h2, h3, h4, h5, h6 { font-family: ${tokens.headingFont}; }`] : []),
    ".pv-page { background: var(--pv-bg); color: var(--pv-text); }",
    ".pv-main { padding-block: var(--pv-pad); }",
    ".pv-button, main img { border-radius: var(--pv-radius); }",
    ".pv-hero { background: color-mix(in srgb, var(--pv-primary) 8%, var(--pv-bg)); }",
    ".pv-hero-title { font-family: var(--pv-heading, inherit); }",
    "main a { color: var(--pv-primary); text-decoration: underline; text-underline-offset: 2px; }",
    ".pv-button, main a.pv-button { background: var(--pv-primary); color: var(--pv-on-primary); text-decoration: none; }",
    "a.pv-button:hover { filter: brightness(1.12); }",
    "",
  ].join("\n");
}


// --- links and pictures that point back at the old site

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

/** An address on the old site becomes a path on the new one; an address elsewhere is left alone. */
export function localizeHref(href: string, origin: string): string {
  try {
    const url = new URL(href);
    if (url.origin !== origin) return href;
    return trimSlash(url.pathname) + url.search + url.hash;
  } catch {
    return href;
  }
}

const localizeHtml = (html: string, origin: string) => html.replace(/href="([^"]*)"/g, (_, h: string) => `href="${localizeHref(h.replace(/&amp;/g, "&"), origin).replace(/&/g, "&amp;")}"`);

function localizeBlocks(blocks: Block[], origin: string, image: (src: string) => string): Block[] {
  return blocks.map((block): Block => {
    switch (block.type) {
      case "paragraph":
      case "quote":
        return { ...block, html: localizeHtml(block.html, origin) };
      case "list":
        return { ...block, items: block.items.map((i) => localizeHtml(i, origin)) };
      case "button":
        return { ...block, href: localizeHref(block.href, origin) };
      case "image":
        return { ...block, src: image(block.src), ...(block.href ? { href: localizeHref(block.href, origin) } : {}) };
      case "gallery":
        return { ...block, images: block.images.map((i) => ({ ...i, src: image(i.src) })) };
      case "columns":
        return { ...block, columns: block.columns.map((c) => localizeBlocks(c, origin, image)) };
      default:
        return block;
    }
  });
}

const moduleName = (id: string) => id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "side";

type PageData = { id: string; kind: "page" | "post"; path: string; title: string; date?: string; excerpt: string; seo: { title?: string; description?: string; image?: string }; featuredImage: string | null; blocks: Block[] };

function countUnknown(blocks: Block[]): { reason: string; text: string }[] {
  return blocks.flatMap((b) => (b.type === "unknown" ? [{ reason: b.reason, text: b.text }] : b.type === "columns" ? b.columns.flatMap(countUnknown) : []));
}

const NAV_DEPTH_LIMIT = 12;

/** What an owner needs to know before the site is ready: what was not carried over, and why. */
function importNotes(model: SiteModel, pages: Page[], images: number): string {
  const lines = [`# Import fra ${model.url}`, "", `${pages.length} sider og innlegg og ${images} bilder er hentet inn. Hver side ligger på adressen den hadde, så gamle lenker virker.`, ""];
  const unknown = pages.flatMap((p) => countUnknown(p.blocks).map((u) => ({ page: p.title, ...u })));
  if (unknown.length > 0) {
    lines.push("## Det som ikke kom med", "Disse delene kunne ikke gjøres om til innhold. De vises ikke på siden og må lages på nytt:", "");
    for (const u of unknown.slice(0, 80)) lines.push(`- ${u.page}: ${u.reason}${u.text ? ` (${u.text.slice(0, 80)})` : ""}`);
    if (unknown.length > 80) lines.push(`- … og ${unknown.length - 80} til`);
    lines.push("");
  }
  if (model.plugins.length > 0) lines.push("## Programtillegg og byggere som er brukt", "", ...model.plugins.map((p) => `- ${p.name} (${p.pages} sider)`), "");
  if (model.warnings.length > 0) lines.push("## Merknader", "", ...model.warnings.map((w) => `- ${w}`), "");
  return lines.join("\n") + "\n";
}

/**
 * The files of the project. \`imageUrl\` turns a stored picture (/images/<file>) into its address in
 * storage, which the publish step later downloads into the site.
 */
export function buildSiteProject(model: SiteModel, imageUrl: (file: string) => string | null = () => null): SiteProject {
  const origin = (() => {
    try {
      return new URL(model.url).origin;
    } catch {
      return "";
    }
  })();
  const image = (src: string) => {
    const file = /^\/images\/([0-9a-f]{12}\.[a-z]+)$/.exec(src)?.[1];
    return (file ? imageUrl(file) : null) ?? src;
  };

  const used = new Map<string, number>();
  const modules = model.pages.map((page) => {
    const base = moduleName(page.id);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const name = n > 1 ? `${base}-${n}` : base;
    const data: PageData = {
      id: page.id,
      kind: page.kind,
      path: page.path,
      title: page.title,
      ...(page.date ? { date: page.date } : {}),
      excerpt: page.excerpt,
      seo: { ...(page.seo.title ? { title: page.seo.title } : {}), ...(page.seo.description ? { description: page.seo.description } : {}), ...(page.seo.image ? { image: image(page.seo.image) } : {}) },
      featuredImage: page.featuredImage ? image(page.featuredImage) : null,
      blocks: localizeBlocks(page.blocks, origin, image),
    };
    return { name, data };
  });

  // The menu keeps the old order, on the new paths, and the front page comes first.
  const nav = model.nav.slice(0, NAV_DEPTH_LIMIT).map((item) => ({ label: item.label, href: localizeHref(item.href, origin) }));
  if (!nav.some((n) => n.href === "/")) nav.unshift({ label: "Forside", href: "/" });

  // The brief is checked again here: it has been through storage and the browser since the server made it.
  const design = sanitizeDesign(model.design, ["/", ...model.pages.map((p) => p.path)]);
  let tokens = resolveTokens(model.theme);
  let fontLinks = (model.theme?.fontLinks ?? []).filter((l) => isFontLink(l) && googleFamilies([l]).length > 0).slice(0, 2);
  // The chosen font pair is used only when the old site had no fonts of its own to carry over.
  if (design?.fonts && !model.theme?.bodyFont && !model.theme?.headingFont) {
    const pair = FONT_PAIRS[design.fonts];
    tokens = { ...tokens, bodyFont: pair.body, headingFont: pair.heading };
    fontLinks = [pair.link];
  }
  const site = { name: model.name || "Nettsted", description: model.description, language: model.language, nav, ...(design?.hero ? { hero: design.hero } : {}) };
  const files: Files = {
    "/App.tsx": APP,
    "/styles.css": stylesFor(tokens, fontLinks, design),
    "/lib/types.ts": TYPES,
    "/lib/inline.tsx": INLINE,
    "/lib/head.ts": HEAD_MODULE,
    "/components/Blocks.tsx": BLOCKS,
    "/components/Seo.tsx": SEO,
    "/components/Layout.tsx": layoutFor(design),
    "/components/PageView.tsx": PAGE_VIEW,
    "/components/Home.tsx": HOME,
    ...(design?.hero ? { "/components/Hero.tsx": HERO } : {}),
    "/components/SiteRoutes.tsx": ROUTES,
    "/content/site.ts": `import type { Site } from "../lib/types";\n\nexport const site: Site = ${JSON.stringify(site)};\n`,
    "/content/index.ts": [
      `import type { PageData } from "../lib/types";`,
      ...modules.map((m) => `import ${m.name.replace(/-/g, "_").replace(/^(\d)/, "_$1")} from "./pages/${m.name}";`),
      "",
      `export const pages: PageData[] = [${modules.map((m) => m.name.replace(/-/g, "_").replace(/^(\d)/, "_$1")).join(", ")}];`,
      "",
    ].join("\n"),
    "/brand.json": JSON.stringify({ name: site.name, tagline: site.description.slice(0, 120), description: site.description.slice(0, 200) || site.name, primary: tokens.primary, secondary: "#475569", ogStyle: "editorial" }, null, 2),
    "/IMPORT.md": importNotes(model, model.pages, model.media.filter((m) => m.stored).length),
  };
  for (const m of modules) files[`/content/pages/${m.name}.ts`] = `import type { PageData } from "../../lib/types";\n\nconst page: PageData = ${JSON.stringify(m.data)};\n\nexport default page;\n`;

  const unknownBlocks = model.pages.reduce((n, p) => n + countUnknown(p.blocks).length, 0);
  return {
    files,
    report: {
      pages: model.pages.filter((p) => p.kind === "page").length,
      posts: model.pages.filter((p) => p.kind === "post").length,
      routes: model.pages.length,
      images: model.media.filter((m) => m.stored).length,
      unknownBlocks,
      homeFromPosts: !model.pages.some((p) => p.path === "/"),
    },
  };
}
