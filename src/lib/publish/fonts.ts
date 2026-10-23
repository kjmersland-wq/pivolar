import { HEADING_FONTS } from "./brand.ts";

type SatoriFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 700 | 800; style: "normal" };

const cache = new Map<string, Promise<ArrayBuffer | null>>();

/** Fontsource serves Google Fonts as plain files, which the image renderer can read. Latin covers æ, ø and å. */
function fetchFont(id: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${id}-${weight}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = fetch(`https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${weight}-normal.woff`, { signal: AbortSignal.timeout(8000) })
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .catch(() => null);
    cache.set(key, hit);
  }
  return hit;
}

/**
 * The share image's fonts: the site's display font for the name, Inter for the small text.
 * A font that cannot be fetched is left out and the renderer's built-in font takes over, so a
 * network hiccup never blocks publishing.
 */
export async function loadOgFonts(headingFont: string | null): Promise<{ heading: string; fonts: SatoriFont[] }> {
  const spec = headingFont ? HEADING_FONTS[headingFont] : undefined;
  const [heading, body] = await Promise.all([spec ? fetchFont(spec.id, spec.weight) : null, fetchFont("inter", 400)]);
  const fonts: SatoriFont[] = [];
  if (heading && spec) fonts.push({ name: "Heading", data: heading, weight: spec.weight as 400 | 700 | 800, style: "normal" });
  if (body) fonts.push({ name: "Body", data: body, weight: 400, style: "normal" });
  // Without a display font the name falls back to Inter, which reads fine and keeps the image consistent.
  if (!heading && body) fonts.push({ name: "Heading", data: body, weight: 400, style: "normal" });
  return { heading: "Heading", fonts };
}
