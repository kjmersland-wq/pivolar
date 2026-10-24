import * as cheerio from "cheerio";

/**
 * Reads the look of the old site (the main colour, the page colours and the fonts) from its own
 * code: the theme colour, the colour variables and the font rules of its style sheets. No AI is
 * involved. Everything that ends up in the new site is checked to be a plain colour or a plain
 * font name first, because the values come from another site and are written into CSS.
 */

export type Theme = {
  primary?: string;
  text?: string;
  background?: string;
  headingFont?: string;
  bodyFont?: string;
  /** Google Fonts style sheets the old site loaded, the only font files that can follow along without being copied. */
  fontLinks: string[];
};

export const THEME_LIMITS = { sheets: 3, sheetBytes: 400_000, cssBytes: 800_000, fontLinks: 2 };

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*(?:1|1\.0+|100%)\s*)?\)$/i;

/** A colour as `#rrggbb`, or null for anything that is not a plain colour (names, gradients, variables, transparency). */
export function parseColor(value: string | undefined): string | null {
  const text = (value ?? "").trim().replace(/\s*!important$/i, "");
  if (HEX.test(text)) {
    const hex = text.slice(1).toLowerCase();
    return "#" + (hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex);
  }
  const rgb = RGB.exec(text);
  if (rgb) {
    const parts = [rgb[1], rgb[2], rgb[3]].map(Number);
    if (parts.every((n) => n <= 255)) return "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  return null;
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c: number[]) => "#" + c.map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0")).join("");

export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes two colours; `amount` is how much of `to` there is in the result. */
export function mix(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  return toHex(a.map((v, i) => v + (b[i]! - v) * amount));
}

/** Darkens (or lightens, on a dark ground) a colour until it can be read on the ground, keeping its hue as far as possible. */
export function readable(color: string, ground: string, minimum = 4.5): string {
  const target = luminance(ground) > 0.5 ? "#000000" : "#ffffff";
  let out = color;
  for (let step = 1; step <= 20 && contrast(out, ground) < minimum; step++) out = mix(color, target, step * 0.05);
  return out;
}

const CSS_PRESET = (slug: string) => `--wp--preset--color--${slug}`;

/** The style sheets worth reading: the site's own, from its own address, in the order the page loads them. */
export function stylesheetLinks(html: string, base: string): string[] {
  const $ = cheerio.load(html);
  const origin = new URL(base).origin;
  const out: string[] = [];
  $("link[rel~='stylesheet']").each((_, el) => {
    try {
      const url = new URL($(el).attr("href") ?? "", base + "/");
      if (url.origin === origin && url.protocol === "https:" && !out.includes(url.href)) out.push(url.href);
    } catch {
      // an address that is not an address
    }
  });
  return out.slice(0, THEME_LIMITS.sheets);
}

/** True only for a plain Google Fonts style sheet address, the one kind that is written into the new site's CSS. */
export function isFontLink(link: unknown): link is string {
  return typeof link === "string" && /^https:\/\/fonts\.googleapis\.com\/css2?\?[A-Za-z0-9:;,@.&=+%_\-/?|]+$/.test(link);
}

function googleLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $("link[href*='fonts.googleapis.com']").each((_, el) => {
    try {
      const url = new URL($(el).attr("href") ?? "", "https://x.invalid/");
      if (url.protocol !== "https:" || url.hostname !== "fonts.googleapis.com" || !url.pathname.startsWith("/css")) return;
      if (!/^[A-Za-z0-9:;,@.&=+%_\-/?]+$/.test(url.href.slice("https://fonts.googleapis.com".length))) return;
      if (!out.includes(url.href)) out.push(url.href);
    } catch {
      // not an address
    }
  });
  return out.slice(0, THEME_LIMITS.fontLinks);
}

/** The families a Google Fonts address asks for. */
export function googleFamilies(links: string[]): string[] {
  const out: string[] = [];
  for (const link of links) {
    // css2?family=A:wght@400&family=B, and the older css?family=A|B
    for (const param of new URL(link).searchParams.getAll("family")) for (const part of param.split("|")) out.push((part.split(":")[0] ?? "").trim());
  }
  return [...new Set(out.filter(Boolean))];
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded"]);
const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 \-]{0,40}$/;

/** A font stack made of plain names only, written back in a safe form, or undefined. */
export function cleanFont(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const names: string[] = [];
  for (const raw of value.replace(/\s*!important$/i, "").split(",").slice(0, 6)) {
    const name = raw.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
    if (!FAMILY.test(name)) continue;
    names.push(GENERIC.has(name.toLowerCase()) ? name.toLowerCase() : /\s/.test(name) ? `"${name}"` : name);
  }
  if (!names.length) return undefined;
  if (!names.some((n) => GENERIC.has(n))) names.push("sans-serif");
  return names.join(", ");
}

type Vars = Map<string, string>;

function collectVars(css: string): Vars {
  const vars: Vars = new Map();
  for (const match of css.matchAll(/(--[a-z0-9_-]+)\s*:\s*([^;}]+)/gi)) if (!vars.has(match[1]!)) vars.set(match[1]!, match[2]!.trim());
  return vars;
}

/** Follows `var(--x)` a few steps, so a colour or font set through a variable is found. */
function resolve(value: string | undefined, vars: Vars): string | undefined {
  let out = value?.trim();
  for (let i = 0; i < 4 && out; i++) {
    const ref = /^var\(\s*(--[a-z0-9_-]+)\s*(?:,\s*([^)]*))?\)$/i.exec(out);
    if (!ref) break;
    out = vars.get(ref[1]!) ?? ref[2]?.trim();
  }
  return out;
}

const firstColor = (vars: Vars, names: string[]) => {
  for (const name of names) {
    const color = parseColor(resolve(vars.get(name), vars));
    if (color) return color;
  }
  return null;
};

/** The value of one property in the first rule whose selector matches, or undefined. */
function ruleValue(css: string, selector: RegExp, property: string): string | undefined {
  const rules = /(?:^|[}\s])([^{}@]+)\{([^{}]*)\}/g;
  const prop = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;}]+)`, "i");
  for (const match of css.matchAll(rules)) {
    if (!selector.test(match[1]!.trim())) continue;
    const found = prop.exec(match[2]!)?.[1];
    if (found) return found.trim();
  }
  return undefined;
}

/** Reads the theme from the front page and the style sheets it names. */
export function extractTheme(html: string, sheets: string[] = []): Theme {
  const $ = cheerio.load(html);
  const inline = $("style")
    .map((_, el) => $(el).text())
    .get()
    .join("\n");
  const css = [inline, ...sheets].join("\n").slice(0, THEME_LIMITS.cssBytes);
  const vars = collectVars(css);
  const theme: Theme = { fontLinks: googleLinks(html) };

  const primary =
    firstColor(vars, [CSS_PRESET("primary"), CSS_PRESET("accent"), CSS_PRESET("brand"), "--primary", "--color-primary", "--brand", "--accent", "--e-global-color-accent"]) ??
    parseColor($("meta[name='theme-color']").first().attr("content")) ??
    parseColor(resolve(ruleValue(css, /^a$/, "color"), vars));
  if (primary) theme.primary = primary;

  const background = parseColor(resolve(ruleValue(css, /^body$/, "background(?:-color)?"), vars)) ?? firstColor(vars, [CSS_PRESET("base"), CSS_PRESET("background"), "--background", "--bg"]);
  const text = parseColor(resolve(ruleValue(css, /^body$/, "color"), vars)) ?? firstColor(vars, [CSS_PRESET("contrast"), CSS_PRESET("foreground"), "--foreground", "--text"]);
  if (background) theme.background = background;
  if (text) theme.text = text;

  const body = cleanFont(resolve(ruleValue(css, /^body$/, "font-family"), vars));
  const heading = cleanFont(resolve(ruleValue(css, /(?:^|,)\s*h1\b/, "font-family"), vars) ?? vars.get("--wp--preset--font-family--heading"));
  if (body) theme.bodyFont = body;
  if (heading) theme.headingFont = heading;
  return theme;
}

export type Tokens = { primary: string; onPrimary: string; background: string; text: string; bodyFont: string; headingFont: string };

export const DEFAULT_TOKENS: Tokens = { primary: "#0f172a", onPrimary: "#ffffff", background: "#ffffff", text: "#1e293b", bodyFont: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif', headingFont: "" };

/**
 * The values the new site uses. Page colours are taken only when the old site was light with readable text
 * (the fixed layout is made for that); the main colour is darkened until it can be read as a link.
 */
export function resolveTokens(raw: Theme | undefined): Tokens {
  const out = { ...DEFAULT_TOKENS };
  if (!raw) return out;
  // The theme travels through storage and the browser, so every value is checked again here.
  const background = parseColor(raw.background);
  const textColor = parseColor(raw.text);
  const primary = parseColor(raw.primary);
  if (background && luminance(background) > 0.7) {
    out.background = background;
    if (textColor && contrast(textColor, background) >= 7) out.text = textColor;
    else if (contrast(out.text, out.background) < 7) out.text = readable(out.text, out.background, 7);
  }
  if (primary) out.primary = readable(primary, out.background);
  out.onPrimary = contrast("#ffffff", out.primary) >= contrast("#000000", out.primary) ? "#ffffff" : "#000000";
  out.bodyFont = cleanFont(raw.bodyFont) ?? out.bodyFont;
  out.headingFont = cleanFont(raw.headingFont) ?? "";
  return out;
}

/** The fonts the site asks for that are neither generic nor in a Google Fonts address, so they cannot follow along. */
export function lostFonts(theme: Theme): string[] {
  const loaded = new Set(googleFamilies(theme.fontLinks).map((f) => f.toLowerCase()));
  const lost = new Set<string>();
  for (const stack of [theme.bodyFont, theme.headingFont]) {
    const first = stack?.split(",")[0]?.trim().replace(/"/g, "");
    if (first && !GENERIC.has(first.toLowerCase()) && !loaded.has(first.toLowerCase())) lost.add(first);
  }
  return [...lost];
}
