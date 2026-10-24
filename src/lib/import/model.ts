import type { Design } from "./design.ts";
import type { Theme } from "./theme.ts";
/**
 * What an import produces, whatever the website was built with. Content is cut into typed blocks
 * and kept as data; nothing here is code. The AI step later only has to make components that show
 * these blocks, so the number of pages hardly changes what it costs.
 */

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  /** Inline HTML limited to links, bold, italics, line breaks and a few more. Nothing else gets through. */
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
  /** Something that could not be turned into a block. It stays in the model, so nothing disappears without being reported. */
  | { type: "unknown"; reason: string; text: string };

export type NavItem = { label: string; href: string; children?: NavItem[] };

export type Seo = { title?: string; description?: string; image?: string; canonical?: string };

export type Page = {
  id: string;
  kind: "page" | "post";
  /** The address on the old site. Used to keep the old addresses working (redirects). */
  url: string;
  /** The path part of it, with a leading slash. */
  path: string;
  slug: string;
  title: string;
  date?: string;
  modified?: string;
  /** The id of the parent page, for pages in a hierarchy. */
  parent: string | null;
  excerpt: string;
  seo: Seo;
  /** The address of the picture shown with the page, when the site names one. */
  featuredImage: string | null;
  blocks: Block[];
  /** Plugins and page builders the content points to (class names, shortcodes). */
  signals: string[];
};

export type Media = {
  id: string;
  sourceUrl: string;
  mime: string;
  alt: string;
  width?: number;
  height?: number;
  /** The ids of the pages that show it. */
  usedBy: string[];
  /** Set once the picture is stored in Pivolar: the file name in the project (/images/<file>) and what it became. */
  stored?: { file: string; hash: string; bytes: number; width: number; height: number };
  /** Set when it could not be stored, and why. */
  failed?: string;
};

export type SiteModel = {
  source: "wordpress";
  /** The address that was imported. */
  url: string;
  name: string;
  description: string;
  language: string | null;
  nav: NavItem[];
  /** Colours and fonts read from the old site's own code. Missing on imports made before this was read. */
  theme?: Theme;
  /** The design brief, when the owner asked for one. Chosen from fixed options. */
  design?: Design;
  pages: Page[];
  media: Media[];
  /** Plugins and builders found anywhere, with the number of pages each was seen on. */
  plugins: { name: string; pages: number }[];
  /** What was left out or could not be read, in words the owner can act on. */
  warnings: string[];
  /** True when a limit was reached before everything was fetched. */
  truncated: boolean;
  stats: { pages: number; posts: number; media: number; blocks: number; unknownBlocks: number; requests: number; ms: number };
};

/** Every address a block refers to, so the pictures of a page can be found without reading the text. */
export function imagesIn(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.type === "image") out.push(block.src);
    else if (block.type === "gallery") out.push(...block.images.map((i) => i.src));
    else if (block.type === "columns") out.push(...block.columns.flatMap(imagesIn));
  }
  return out;
}

/** The same blocks with every picture address passed through `map`, for example to point at the original file. */
export function rewriteImages(blocks: Block[], map: (src: string) => string): Block[] {
  return blocks.map((block): Block => {
    if (block.type === "image") return { ...block, src: map(block.src) };
    if (block.type === "gallery") return { ...block, images: block.images.map((i) => ({ ...i, src: map(i.src) })) };
    if (block.type === "columns") return { ...block, columns: block.columns.map((c) => rewriteImages(c, map)) };
    return block;
  });
}

export function countBlocks(blocks: Block[]): { total: number; unknown: number } {
  let total = 0;
  let unknown = 0;
  for (const block of blocks) {
    total++;
    if (block.type === "unknown") unknown++;
    if (block.type === "columns") {
      for (const column of block.columns) {
        const inner = countBlocks(column);
        total += inner.total;
        unknown += inner.unknown;
      }
    }
  }
  return { total, unknown };
}
