import type { Brand } from "../publish/brand.ts";

/**
 * Social media helpers: ready-to-post texts per platform, share links and tagged addresses (UTM).
 * Everything is built from /brand.json with plain templates, so it works without an account on
 * any platform; posting itself stays with the owner.
 */

export type Platform = "x" | "facebook" | "instagram" | "linkedin";

export type Post = { platform: Platform; label: string; text: string; limit: number };

export const POST_LIMITS: Record<Platform, number> = { x: 280, facebook: 600, instagram: 2200, linkedin: 700 };
const LABELS: Record<Platform, string> = { x: "X", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" };

const STOP = new Set(["med", "som", "til", "den", "det", "the", "and", "your", "with", "from", "that", "this", "også", "eller"]);

/** #Tags from the name and tagline: one per word, capitalised, so they stay readable for screen readers. */
export function hashtags(brand: Pick<Brand, "name" | "tagline">, max = 4): string[] {
  const words = `${brand.name} ${brand.tagline}`.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase()));
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(`#${word[0]!.toUpperCase()}${word.slice(1)}`);
    if (tags.length >= max) break;
  }
  return tags;
}

/** Adds utm_ parameters so visits from a post show up under that platform in analytics. */
export function withUtm(url: string, source: string, campaign = "innlegg"): string {
  if (!url.trim()) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    u.searchParams.set("utm_source", source);
    u.searchParams.set("utm_medium", "social");
    u.searchParams.set("utm_campaign", campaign);
    return u.toString();
  } catch {
    return url.trim();
  }
}

const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`);

/** One post per platform. The address and the tags are never cut: the text before them is what gets shortened. */
export function socialPosts(brand: Pick<Brand, "name" | "tagline" | "description">, url: string): Post[] {
  const tags = hashtags(brand);
  const about = brand.tagline || brand.description;
  const make = (platform: Platform, body: string, tail = ""): Post => {
    const link = withUtm(url, platform);
    const reserved = (link ? link.length + 2 : 0) + (tail ? tail.length + 2 : 0);
    const text = [clip(body, Math.max(40, POST_LIMITS[platform] - reserved)), link, tail].filter(Boolean).join("\n\n");
    return { platform, label: LABELS[platform], text, limit: POST_LIMITS[platform] };
  };
  return [
    make("x", `${brand.name}: ${about}`, tags.slice(0, 2).join(" ")),
    make("facebook", `Nytt fra ${brand.name}\n${brand.description}`),
    make("instagram", `${brand.name}\n${brand.description}${url.trim() ? "\n\nLenke i bio." : ""}`, tags.join(" ")),
    make("linkedin", `${brand.name} – ${about}\n\n${brand.description}`, tags.slice(0, 3).join(" ")),
  ];
}

/** Plain share links that open each platform's own share window, with no scripts on the page. */
export function shareLinks(url: string, text: string): { label: string; href: string }[] {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  return [
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { label: "X", href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${t}%20${u}` },
    { label: "E-post", href: `mailto:?subject=${t}&body=${u}` },
  ];
}

export const SHARE_BUTTONS_REQUEST =
  'Legg til en liten rad med delingsknapper (Facebook, X, LinkedIn, WhatsApp og e-post) nederst på forsiden. Bruk vanlige <a>-lenker med target="_blank" og rel="noopener noreferrer" til delingsadressene (https://www.facebook.com/sharer/sharer.php?u=<siden>, https://twitter.com/intent/tweet?url=<siden>&text=<tittel>, https://www.linkedin.com/sharing/share-offsite/?url=<siden>, https://wa.me/?text=<tittel>%20<siden>, mailto:?subject=<tittel>&body=<siden>) der <siden> er encodeURIComponent(window.location.href). Ingen eksterne skript. Knappene skal ha aria-label og følge fargene og stilen siden har fra før.';
