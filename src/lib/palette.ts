// Builds a whole color scheme from one brand color with plain color math. No AI: every value is
// derived from the brand's hue, and text colors are picked by measured contrast (WCAG).

type Hsl = { h: number; s: number; l: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function isHex(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl) {
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h % 360) / 60) % 2 - 1));
  const m = lig - c / 2;
  const hue = ((h % 360) + 360) % 360;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. Body text needs at least 4.5. */
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** White or near-black, whichever reads better on the given background. */
export function readableOn(background: string) {
  return contrast("#ffffff", background) >= contrast("#0b0b0f", background) ? "#ffffff" : "#0b0b0f";
}

/** Moves a color lighter or darker until it reaches the contrast against a background. */
export function ensureContrast(color: string, background: string, minimum = 4.5) {
  if (contrast(color, background) >= minimum) return color;
  const hsl = hexToHsl(color);
  const direction = luminance(background) > 0.5 ? -1 : 1;
  for (let step = 1; step <= 100; step++) {
    const next = hslToHex({ ...hsl, l: clamp(hsl.l + direction * step, 0, 100) });
    if (contrast(next, background) >= minimum) return next;
  }
  return direction === -1 ? "#0b0b0f" : "#ffffff";
}

export type Palette = {
  dark: boolean;
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  brand: string;
  brandStrong: string;
  /** Pale tint of the brand for badges and icon tiles. */
  brandSoft: string;
  /** Readable text on top of the brand color. */
  onBrand: string;
  /** Brand color adjusted to be readable as text on the page background. */
  link: string;
  /** Second color for gradients, a neighbour of the brand on the color wheel. */
  accent: string;
};

export function makePalette(brandHex: string, dark: boolean): Palette {
  const wanted = isHex(brandHex) ? brandHex.toLowerCase() : "#6366f1";
  // Buttons need readable text. A mid-tone brand color that fails both white and black text is
  // nudged just far enough, so the chosen color stays recognisable.
  const best = readableOn(wanted);
  const brand = ensureContrast(wanted, best, 4.5);
  const { h, s, l } = hexToHsl(brand);
  const tint = Math.min(s, 14);
  const neutral = (light: number) => hslToHex({ h, s: tint, l: light });
  const bg = dark ? neutral(7) : neutral(98);
  const surface = dark ? neutral(11) : "#ffffff";
  const text = dark ? neutral(96) : neutral(10);
  return {
    dark,
    bg,
    surface,
    border: dark ? neutral(19) : neutral(90),
    text,
    muted: ensureContrast(dark ? neutral(65) : neutral(38), bg, 4.5),
    brand,
    brandStrong: hslToHex({ h, s, l: clamp(l - 9, 8, 90) }),
    brandSoft: dark ? hslToHex({ h, s: Math.min(s, 55), l: 17 }) : hslToHex({ h, s: Math.min(s, 90), l: 94 }),
    onBrand: readableOn(brand),
    link: ensureContrast(brand, bg, 4.5),
    accent: hslToHex({ h: h + 38, s: clamp(s, 45, 90), l: clamp(l + 4, 35, 65) }),
  };
}

/** Starting points for the color picker: well-spaced hues with similar saturation. */
export const BRAND_SUGGESTIONS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#a855f7", "#14b8a6", "#78350f"];
