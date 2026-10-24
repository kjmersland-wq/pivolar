import type { FileMap } from "@/lib/files";

/** What the AI writes to /brand.json and the publish step turns into meta tags and a share image. */
export type Brand = {
  name: string;
  tagline: string;
  description: string;
  primary: string;
  secondary: string;
  /** Display font of the site (one of HEADING_FONTS), so the share image matches the page. */
  headingFont: string | null;
  ogStyle: OgStyle;
  /** Contents of /public/logo.svg (or the favicon) when the project has one. */
  logoSvg: string | null;
  hasFavicon: boolean;
  /** Site ownership codes from Google Search Console and Bing Webmaster Tools, written as meta tags. */
  verification: { google: string | null; bing: string | null };
};

const CODE = /^[\w-]{20,120}$/;

export type OgStyle = "aurora" | "editorial" | "vivid";
const OG_STYLES: OgStyle[] = ["aurora", "editorial", "vivid"];

/** Display fonts the share image can draw (fontsource id and weight). Keep in sync with the font list in the chat prompt. */
export const HEADING_FONTS: Record<string, { id: string; weight: number }> = {
  Fraunces: { id: "fraunces", weight: 700 },
  "Playfair Display": { id: "playfair-display", weight: 700 },
  "DM Serif Display": { id: "dm-serif-display", weight: 400 },
  "Instrument Serif": { id: "instrument-serif", weight: 400 },
  "Space Grotesk": { id: "space-grotesk", weight: 700 },
  Sora: { id: "sora", weight: 700 },
  Manrope: { id: "manrope", weight: 800 },
  "Bricolage Grotesque": { id: "bricolage-grotesque", weight: 700 },
  Syne: { id: "syne", weight: 700 },
  Inter: { id: "inter", weight: 700 },
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const DEFAULT_PRIMARY = "#6d5efc";
const DEFAULT_SECONDARY = "#f5576c";

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const color = (value: unknown, fallback: string) => (typeof value === "string" && HEX.test(value.trim()) ? value.trim() : fallback);

/** SVG goes into an <img> data address, so scripts and external references are dropped rather than trusted. */
export function safeSvg(svg: string | undefined): string | null {
  if (!svg || !/<svg[\s>]/i.test(svg) || svg.length > 60_000) return null;
  if (/<script|<foreignObject|javascript:|\son\w+\s*=|<!ENTITY|<image|xlink:href\s*=\s*["']https?:/i.test(svg)) return null;
  return svg;
}

function readVerification(value: unknown): Brand["verification"] {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const code = (x: unknown) => (typeof x === "string" && CODE.test(x.trim()) ? x.trim() : null);
  return { google: code(v.google), bing: code(v.bing) };
}

export function readBrand(files: FileMap, fallbackName: string): Brand {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(files["/brand.json"] ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    /* a broken brand.json falls back to the defaults below */
  }
  const name = text(raw.name, 60) || fallbackName;
  const tagline = text(raw.tagline, 120);
  return {
    name,
    tagline,
    description: text(raw.description, 200) || tagline || name,
    primary: color(raw.primary, DEFAULT_PRIMARY),
    secondary: color(raw.secondary, DEFAULT_SECONDARY),
    headingFont: typeof raw.headingFont === "string" && raw.headingFont in HEADING_FONTS ? raw.headingFont : null,
    ogStyle: OG_STYLES.find((style) => style === raw.ogStyle) ?? "aurora",
    logoSvg: safeSvg(files["/public/logo.svg"]) ?? safeSvg(files["/public/favicon.svg"]),
    hasFavicon: safeSvg(files["/public/favicon.svg"]) !== null,
    verification: readVerification(raw.verification),
  };
}

function channels(hex: string): [number, number, number] {
  const h = hex.length === 4 ? hex.slice(1).replace(/./g, (c) => c + c) : hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `#rrggbb` as an rgba() string, for gradients that fade to transparent. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mixes two colours; `amount` 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const part = (x: number, y: number) => Math.round(x + (y - x) * amount).toString(16).padStart(2, "0");
  return `#${part(ar, br)}${part(ag, bg)}${part(ab, bb)}`;
}

/** Text colour that stays readable on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): "#ffffff" | "#111111" {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#111111" : "#ffffff";
}

export const escapeAttr = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Schema.org data for search engines. `<` is escaped so the text can never close the script tag. */
export function structuredData(brand: Brand, title: string): string {
  const json = JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name: brand.name || title, description: brand.description, url: "__SITE_URL__/", inLanguage: "nb" }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/** Meta tags for index.html. The share image address is made absolute at build time (see siteUrl in the Vite config). */
export function metaTags(brand: Brand, title: string): string {
  const name = escapeAttr(brand.name || title);
  const description = escapeAttr(brand.description);
  return [
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="__SITE_URL__/" />`,
    brand.verification.google ? `<meta name="google-site-verification" content="${escapeAttr(brand.verification.google)}" />` : "",
    brand.verification.bing ? `<meta name="msvalidate.01" content="${escapeAttr(brand.verification.bing)}" />` : "",
    `<meta name="theme-color" content="${brand.primary}" />`,
    brand.hasFavicon ? `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${name}" />`,
    `<meta property="og:locale" content="nb_NO" />`,
    `<meta property="og:url" content="__SITE_URL__/" />`,
    `<meta property="og:title" content="${name}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="__SITE_URL__/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${name}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="__SITE_URL__/og.png" />`,
    structuredData(brand, title),
  ]
    .filter(Boolean)
    .join("\n    ");
}
