import * as cheerio from "cheerio";
import type { Block } from "./model.ts";

/**
 * Turns the HTML of an old page into typed blocks with plain code: no AI, and nothing from the old
 * page's scripts, styles or markup noise survives. Only what a visitor reads and sees is kept
 * (headings, text with links, pictures, lists, quotes, tables, buttons, embeds), and anything that
 * cannot be turned into a block is kept as an `unknown` block, so it is reported and not lost.
 */

type Node = { type: string; name?: string; data?: string; children?: Node[]; attribs?: Record<string, string> };

const DROP = new Set(["script", "style", "noscript", "template", "svg", "canvas", "link", "meta", "head", "title", "base", "map", "area", "dialog", "nav", "aside"]);
const INLINE = new Set(["a", "strong", "b", "em", "i", "u", "s", "del", "strike", "sub", "sup", "mark", "code", "span", "small", "abbr", "cite", "time", "br", "q", "font", "label", "big"]);

/** What a page's markup says about the plugins and builders that made it. */
const SIGNALS: [RegExp, string][] = [
  [/\belementor[-_ ]/i, "Elementor"],
  [/\bet_pb_|\bet-db\b/i, "Divi"],
  [/\bvc_row\b|\bwpb_/i, "WPBakery"],
  [/\bfusion-(?:builder|text|title)/i, "Avada (Fusion)"],
  [/\bwpcf7\b/i, "Contact Form 7"],
  [/\bgform_|\bgform-/i, "Gravity Forms"],
  [/\bwpforms-/i, "WPForms"],
  [/\bwoocommerce\b|\bwc-block-/i, "WooCommerce"],
  [/\brev_slider|\brs-module|\brevslider/i, "Slider Revolution"],
  [/\btablepress\b/i, "TablePress"],
  [/\bwpml-|\bwpml_/i, "WPML"],
  [/\bpll-|\bpolylang\b/i, "Polylang"],
  [/\bjetpack[-_]/i, "Jetpack"],
  [/\bnf-form|\bninja-forms/i, "Ninja Forms"],
];

const BUTTON = /(^|\s)(wp-block-button__link|wp-element-button|button|btn|elementor-button|et_pb_button|fusion-button|cta)(\s|$)/i;
const SHORTCODE = /\[(\/?)([a-z][a-z0-9_-]*)(\s[^\]]*)?\]/gi;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const collapse = (text: string) => text.replace(/[\s ]+/g, " ");

const tag = (n: Node) => (n.type === "tag" ? (n.name ?? "").toLowerCase() : "");
const classOf = (n: Node) => n.attribs?.class ?? "";
const kids = (n: Node) => n.children ?? [];
const isText = (n: Node) => n.type === "text";

function textOf(n: Node): string {
  if (isText(n)) return n.data ?? "";
  if (DROP.has(tag(n))) return "";
  return kids(n).map(textOf).join(tag(n) === "br" ? "\n" : "");
}
const plain = (n: Node) => collapse(textOf(n)).trim();

/** An address made absolute. Only http(s) for pictures and links, plus mail and phone for links; anything else is dropped. */
function absolute(raw: string | undefined, base: string, links = false): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.startsWith("#")) return links ? value : null;
  try {
    const url = new URL(value, base);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    if (links && (url.protocol === "mailto:" || url.protocol === "tel:")) return url.toString();
  } catch {
    /* an address that cannot be read is dropped */
  }
  return null;
}

/** The best address of a picture: lazy-loading plugins keep the real one in a data attribute, and the widest srcset entry is the sharpest. */
function imageSrc(n: Node, base: string): string | null {
  const a = n.attribs ?? {};
  const set = a.srcset ?? a["data-srcset"] ?? a["data-lazy-srcset"] ?? "";
  let widest: { url: string; w: number } | null = null;
  for (const part of set.split(",")) {
    const [url, size] = part.trim().split(/\s+/);
    const w = size?.endsWith("w") ? Number(size.slice(0, -1)) : 0;
    if (url && (!widest || w > widest.w)) widest = { url, w };
  }
  const direct = [a["data-src"], a["data-lazy-src"], a["data-original"], a.src].find((v) => v && !v.startsWith("data:"));
  return absolute(widest && widest.w > 0 ? widest.url : (direct ?? widest?.url), base);
}

/** Text for an attribute: markup characters are removed, since a picture description has no use for them and they only cause trouble. */
const attrText = (text: string | undefined) => collapse(text ?? "").replace(/[<>]/g, "").trim();

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 20000 ? Math.round(n) : undefined;
};

function imageBlock(n: Node, base: string, href?: string | null, caption?: string): Block | null {
  const src = imageSrc(n, base);
  if (!src) return null;
  const width = num(n.attribs?.width);
  const height = num(n.attribs?.height);
  return { type: "image", src, alt: attrText(n.attribs?.alt), ...(width ? { width } : {}), ...(height ? { height } : {}), ...(caption ? { caption } : {}), ...(href ? { href } : {}) };
}

/** Text with links and emphasis, and nothing else. Every other tag is unwrapped, and every attribute but href is gone. */
function inline(nodes: Node[], base: string): string {
  let out = "";
  for (const n of nodes) {
    if (isText(n)) {
      out += escapeHtml(collapse((n.data ?? "").replace(SHORTCODE, "")));
      continue;
    }
    const name = tag(n);
    if (!name || DROP.has(name) || name === "img") continue;
    if (name === "br") {
      out += "<br>";
      continue;
    }
    const inner = inline(kids(n), base);
    if (!inner.trim()) continue;
    if (name === "a") {
      const href = absolute(n.attribs?.href, base, true);
      out += href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
    } else if (name === "strong" || name === "b") out += `<strong>${inner}</strong>`;
    else if (name === "em" || name === "i" || name === "cite") out += `<em>${inner}</em>`;
    else if (["u", "sub", "sup", "mark", "code"].includes(name)) out += `<${name}>${inner}</${name}>`;
    else if (name === "s" || name === "del" || name === "strike") out += `<s>${inner}</s>`;
    else out += inner;
  }
  return out;
}

const tidy = (html: string) => html.replace(/(<br>\s*){3,}/g, "<br><br>").replace(/^(\s|<br>)+|(\s|<br>)+$/g, "").trim();

type Ctx = { base: string; signals: Set<string>; images: string[] };

function embedFor(src: string): Block {
  const host = (() => {
    try {
      return new URL(src).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const provider = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host) ? "youtube" : /(^|\.)vimeo\.com$/.test(host) ? "vimeo" : /(^|\.)google\.[a-z.]+$/.test(host) && /maps/.test(src) ? "map" : "other";
  return { type: "embed", provider, src };
}

function listItems(n: Node, base: string): string[] {
  const items: string[] = [];
  for (const li of kids(n).filter((c) => tag(c) === "li")) {
    const own = kids(li).filter((c) => !["ul", "ol"].includes(tag(c)));
    const text = tidy(inline(own, base));
    if (text) items.push(text);
    // A list inside a list item is flattened into more items of the same list.
    for (const nested of kids(li).filter((c) => ["ul", "ol"].includes(tag(c)))) items.push(...listItems(nested, base));
  }
  return items;
}

const asList = (b: Block | null): Block[] => (b ? [b] : []);

function tableBlock(n: Node): Block | null {
  const rows: string[][] = [];
  let header = false;
  const visit = (node: Node) => {
    for (const c of kids(node)) {
      if (tag(c) === "tr") {
        const cells = kids(c).filter((x) => tag(x) === "td" || tag(x) === "th");
        if (cells.some((x) => tag(x) === "th") && rows.length === 0) header = true;
        const row = cells.map(plain);
        if (row.some(Boolean)) rows.push(row);
      } else if (["thead", "tbody", "tfoot"].includes(tag(c))) visit(c);
    }
  };
  visit(n);
  return rows.length ? { type: "table", header, rows } : null;
}

function walkChildren(nodes: Node[], ctx: Ctx): Block[] {
  const out: Block[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const html = tidy(inline(run, ctx.base));
    // A piece of text that is only a shortcode leaves nothing behind but a note in the report.
    for (const n of run) if (isText(n)) for (const m of (n.data ?? "").matchAll(SHORTCODE)) if (!m[1]) {
      ctx.signals.add(`shortcode:${m[2]!.toLowerCase()}`);
      out.push({ type: "unknown", reason: `shortcode:${m[2]!.toLowerCase()}`, text: m[0] });
    }
    run = [];
    if (html && html.replace(/<br>/g, "").trim()) out.push({ type: "paragraph", html });
  };
  for (const n of nodes) {
    if (isText(n)) {
      run.push(n);
      continue;
    }
    const name = tag(n);
    if (!name || DROP.has(name)) continue;
    // Inline tags join the running text, unless they hold a picture or look like a button.
    const hasImg = INLINE.has(name) && kids(n).some((c) => tag(c) === "img");
    if (INLINE.has(name) && !hasImg && !(name === "a" && BUTTON.test(classOf(n)))) {
      run.push(n);
      continue;
    }
    flush();
    out.push(...block(n, ctx));
  }
  flush();
  return out;
}

function block(n: Node, ctx: Ctx): Block[] {
  const name = tag(n);
  const cls = classOf(n);
  const level = /^h([1-6])$/.exec(name)?.[1];
  if (level) {
    const text = plain(n);
    return text ? [{ type: "heading", level: Number(level) as 1 | 2 | 3 | 4 | 5 | 6, text }] : [];
  }
  switch (name) {
    case "p":
      // The text of a paragraph becomes one paragraph block, and pictures inside it become blocks of their own, in order.
      return walkChildren(kids(n), ctx);
    case "img": {
      const b = imageBlock(n, ctx.base);
      if (b && b.type === "image") ctx.images.push(b.src);
      return b ? [b] : [];
    }
    case "a": {
      const href = absolute(n.attribs?.href, ctx.base, true);
      const img = kids(n).find((c) => tag(c) === "img");
      if (BUTTON.test(cls) && href && plain(n)) return [{ type: "button", label: plain(n), href }];
      if (img) {
        const b = imageBlock(img, ctx.base, href);
        if (b && b.type === "image") ctx.images.push(b.src);
        const rest = walkChildren(kids(n).filter((c) => c !== img), ctx);
        return [...(b ? [b] : []), ...rest];
      }
      // A link made to look like a button, but without an address or a label: only its content counts.
      return walkChildren(kids(n), ctx);
    }
    case "figure": {
      const imgs = descendants(n, "img");
      const caption = kids(n).find((c) => tag(c) === "figcaption");
      if (/wp-block-gallery|gallery/.test(cls) || imgs.length > 1) {
        const images = imgs.flatMap((i) => {
          const src = imageSrc(i, ctx.base);
          return src ? [{ src, alt: attrText(i.attribs?.alt) }] : [];
        });
        ctx.images.push(...images.map((i) => i.src));
        return images.length ? [{ type: "gallery", images }] : [];
      }
      const iframe = descendants(n, "iframe")[0];
      if (iframe) return embedBlocks(iframe);
      const table = descendants(n, "table")[0];
      if (table) return asList(tableBlock(table));
      if (imgs[0]) {
        const link = kids(n).find((c) => tag(c) === "a");
        const b = imageBlock(imgs[0], ctx.base, link ? absolute(link.attribs?.href, ctx.base, true) : null, caption ? plain(caption) : undefined);
        if (b && b.type === "image") ctx.images.push(b.src);
        return b ? [b] : [];
      }
      return walkChildren(kids(n), ctx);
    }
    case "ul":
    case "ol": {
      const items = listItems(n, ctx.base);
      return items.length ? [{ type: "list", ordered: name === "ol", items }] : [];
    }
    case "blockquote": {
      const cite = kids(n).find((c) => tag(c) === "cite");
      const html = tidy(inline(kids(n).filter((c) => c !== cite), ctx.base));
      return html ? [{ type: "quote", html, ...(cite ? { cite: plain(cite) } : {}) }] : [];
    }
    case "table":
      return asList(tableBlock(n));
    case "pre": {
      const text = textOf(n).replace(/\s+$/, "");
      return text ? [{ type: "code", text }] : [];
    }
    case "hr":
      return [{ type: "divider" }];
    case "iframe":
      return embedBlocks(n);
    case "video":
    case "audio":
    case "object":
    case "embed":
      return [{ type: "unknown", reason: name, text: "" }];
    case "form": {
      ctx.signals.add("form");
      const label = plain(n);
      return [{ type: "unknown", reason: "form", text: label.slice(0, 200) }];
    }
    case "button": {
      const text = plain(n);
      return text ? [{ type: "unknown", reason: "button", text }] : [];
    }
    default: {
      if (/\bwp-block-columns\b/.test(cls)) {
        const columns = kids(n)
          .filter((c) => /\bwp-block-column\b/.test(classOf(c)))
          .map((c) => walkChildren(kids(c), ctx))
          .filter((c) => c.length > 0);
        if (columns.length > 1) return [{ type: "columns", columns }];
        return columns.flat();
      }
      if (/\bwp-block-gallery\b/.test(cls) || /\bgallery\b/.test(cls)) {
        const imgs = descendants(n, "img");
        const images = imgs.flatMap((i) => {
          const src = imageSrc(i, ctx.base);
          return src ? [{ src, alt: attrText(i.attribs?.alt) }] : [];
        });
        if (images.length > 1) {
          ctx.images.push(...images.map((i) => i.src));
          return [{ type: "gallery", images }];
        }
      }
      // Any other container is only wrapping: the layout it stood for is rebuilt later, so only its content counts.
      return walkChildren(kids(n), ctx);
    }
  }
}

function embedBlocks(n: Node): Block[] {
  const src = n.attribs?.src ?? n.attribs?.["data-src"] ?? n.attribs?.["data-lazy-src"] ?? "";
  try {
    const url = new URL(src.startsWith("//") ? `https:${src}` : src);
    if (url.protocol === "http:" || url.protocol === "https:") return [embedFor(url.toString())];
  } catch {
    /* no usable address */
  }
  return [{ type: "unknown", reason: "iframe", text: "" }];
}

function descendants(n: Node, name: string): Node[] {
  const out: Node[] = [];
  for (const c of kids(n)) {
    if (tag(c) === name) out.push(c);
    out.push(...descendants(c, name));
  }
  return out;
}

export type Cleaned = { blocks: Block[]; signals: string[]; images: string[] };

/** One page of HTML to blocks. `base` is the page's own address, so every relative address can be made absolute. */
export function htmlToBlocks(html: string, base: string): Cleaned {
  const signals = new Set<string>();
  for (const [re, name] of SIGNALS) if (re.test(html)) signals.add(name);
  const $ = cheerio.load(html, null, false);
  const root = $.root().get(0) as unknown as Node;
  const ctx: Ctx = { base, signals, images: [] };
  const blocks = walkChildren(kids(root), ctx);
  return { blocks, signals: [...signals], images: [...new Set(ctx.images)] };
}

/** The links of a menu or header: a short list of label and address on the same site. */
export function navFrom(html: string, base: string, max = 30): { label: string; href: string }[] {
  const $ = cheerio.load(html);
  const origin = new URL(base).origin;
  const area = $("nav, header").first();
  const scope = area.length ? area : $("body");
  const seen = new Set<string>();
  const items: { label: string; href: string }[] = [];
  scope.find("a[href]").each((_, el) => {
    const href = absolute($(el).attr("href"), base, true);
    const label = collapse($(el).text()).trim();
    if (!href || !label || href.startsWith("#") || label.length > 60) return;
    try {
      if (new URL(href).origin !== origin) return;
    } catch {
      return;
    }
    const key = href.replace(/\/$/, "");
    if (seen.has(key) || items.length >= max) return;
    seen.add(key);
    items.push({ label, href });
  });
  return items;
}
