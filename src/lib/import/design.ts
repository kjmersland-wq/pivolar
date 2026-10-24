import { z } from "zod";

/**
 * The one thing the AI decides in an import: a small design brief. It picks between fixed options and
 * writes a short heading and a line of text. It never writes code, addresses or styles. Whatever comes
 * back is cut down to these fields and checked again before it is used, here and when the project is built.
 */

export const RADII = ["none", "soft", "round"] as const;
export const DENSITIES = ["airy", "regular"] as const;
export const HEADERS = ["simple", "centered"] as const;
export const FOOTERS = ["minimal", "columns"] as const;

/** The font pairs the brief may choose from. The addresses are ours, never the model's. */
export const FONT_PAIRS = {
  editorial: { label: "Redaksjonell (Fraunces og Inter)", heading: '"Fraunces", serif', body: "Inter, sans-serif", link: "https://fonts.googleapis.com/css2?family=Fraunces:wght@600;800&family=Inter:wght@400;500;600&display=swap" },
  classic: { label: "Klassisk (Playfair Display og Source Sans 3)", heading: '"Playfair Display", serif', body: '"Source Sans 3", sans-serif', link: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Source+Sans+3:wght@400;600&display=swap" },
  modern: { label: "Moderne (Manrope og Inter)", heading: "Manrope, sans-serif", body: "Inter, sans-serif", link: "https://fonts.googleapis.com/css2?family=Manrope:wght@600;800&family=Inter:wght@400;500;600&display=swap" },
  friendly: { label: "Vennlig (Sora og DM Sans)", heading: "Sora, sans-serif", body: '"DM Sans", sans-serif', link: "https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=DM+Sans:wght@400;500;700&display=swap" },
} as const;
export type FontPairId = keyof typeof FONT_PAIRS;
const FONT_IDS = Object.keys(FONT_PAIRS) as [FontPairId, ...FontPairId[]];

export type Design = {
  radius: (typeof RADII)[number];
  density: (typeof DENSITIES)[number];
  header: (typeof HEADERS)[number];
  footer: (typeof FOOTERS)[number];
  /** Used only when the old site had no fonts of its own that could follow along. */
  fonts?: FontPairId;
  /** A heading at the top of the front page, with a line of text and perhaps one button to a page on the site. */
  hero?: { headline: string; subline: string; cta?: { label: string; href: string } };
};

export const LIMITS = { headline: 90, subline: 220, label: 32 };

/** What the model is asked to fill in. The same shape is checked again by `sanitizeDesign`. */
export const designSchema = z.object({
  radius: z.enum(RADII).describe("Hjørner: none (skarpe), soft (litt avrundet) eller round (tydelig avrundet)."),
  density: z.enum(DENSITIES).describe("Luft: airy (romslig) eller regular."),
  header: z.enum(HEADERS).describe("Toppen: simple (navn til venstre, meny til høyre) eller centered (navn over menyen, midtstilt)."),
  footer: z.enum(FOOTERS).describe("Bunnen: minimal (én linje) eller columns (navn, beskrivelse og meny i kolonner)."),
  fonts: z.enum(FONT_IDS).describe("Skriftpar som passer stemningen. Brukes bare hvis det gamle nettstedet ikke har egne skrifter."),
  hero: z
    .object({
      headline: z.string().describe(`Overskrift for forsiden, høyst ${LIMITS.headline} tegn, med ord fra nettstedet selv.`),
      subline: z.string().describe(`Én til to setninger, høyst ${LIMITS.subline} tegn, med ord fra nettstedet selv.`),
      cta: z.object({ label: z.string(), path: z.string().describe("Må være en av adressene i listen over sider.") }).optional(),
    })
    .optional(),
});

const clean = (value: unknown, max: number) =>
  (typeof value === "string" ? value : "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();

const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T => (options as readonly string[]).includes(value as string) ? (value as T) : fallback;

/**
 * Cuts anything into a valid design. Unknown choices become the plain default, texts lose control
 * characters and angle brackets and are cut to length, and a button is kept only when it points at
 * a page that exists on the site. `paths` are the addresses of the imported pages.
 */
export function sanitizeDesign(raw: unknown, paths: readonly string[]): Design | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const design: Design = {
    radius: pick(RADII, r.radius, "soft"),
    density: pick(DENSITIES, r.density, "regular"),
    header: pick(HEADERS, r.header, "simple"),
    footer: pick(FOOTERS, r.footer, "minimal"),
  };
  if (typeof r.fonts === "string" && Object.hasOwn(FONT_PAIRS, r.fonts)) design.fonts = r.fonts as FontPairId;
  const hero = r.hero && typeof r.hero === "object" ? (r.hero as Record<string, unknown>) : null;
  const headline = clean(hero?.headline, LIMITS.headline);
  if (hero && headline) {
    const cta = hero.cta && typeof hero.cta === "object" ? (hero.cta as Record<string, unknown>) : null;
    const target = typeof cta?.href === "string" ? cta.href : typeof cta?.path === "string" ? cta.path : "";
    const label = clean(cta?.label, LIMITS.label);
    design.hero = { headline, subline: clean(hero.subline, LIMITS.subline), ...(label && paths.includes(target) ? { cta: { label, href: target } } : {}) };
  }
  return design;
}
