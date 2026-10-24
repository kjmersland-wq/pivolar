import type { Availability } from "./cloudflare.ts";
import { parseDomain } from "./names.ts";

/**
 * Ranks domain suggestions, best first. Plain scoring, no AI: a name that is the project's own name, short,
 * easy to say and on a well-known ending scores high; hyphens, digits and endings few people trust score
 * low; a cheap first year helps and a renewal that jumps hurts. Names that cannot be bought come last,
 * without a rank. Every score comes with the reasons in words, so the order can be checked.
 */

export type RankContext = {
  /** The project's own name, as a domain label. */
  brand?: string;
  /** Norwegian users get .no ranked high where it can be bought. */
  norwegian?: boolean;
  /** A shop: shop and store endings fit. */
  shop?: boolean;
  /** An app or a tool: app and dev fit. */
  tech?: boolean;
};

export type Ranked = Availability & { rank: number | null; score: number; reasons: string[] };

const TLD_POINTS: Record<string, number> = { com: 14, net: 6, org: 6, io: 4, co: 3, eu: 3, xyz: -3, site: -2, online: -2 };

function score(item: Availability, context: RankContext): { score: number; reasons: string[] } {
  const parsed = parseDomain(item.name);
  if (!parsed) return { score: 0, reasons: [] };
  const { label, tld } = parsed;
  const reasons: string[] = [];
  let points = 50;
  const brand = (context.brand ?? "").replace(/-/g, "");
  const plain = label.replace(/-/g, "");

  if (brand && plain === brand) {
    points += label === plain ? 20 : 12;
    reasons.push("Samme som navnet på prosjektet");
  } else if (brand && plain.includes(brand)) {
    points += 8;
    reasons.push("Inneholder navnet på prosjektet");
  }

  const length = plain.length;
  if (length <= 6) {
    points += 12;
    reasons.push("Kort og lett å huske");
  } else if (length <= 10) points += 8;
  else if (length <= 14) points += 3;
  else if (length <= 20) {
    points -= 4;
    reasons.push("Ganske langt");
  } else {
    points -= 10;
    reasons.push("Langt og vanskelig å skrive");
  }

  const hyphens = (label.match(/-/g) ?? []).length;
  if (hyphens) {
    points -= 6 * hyphens;
    reasons.push("Bindestrek gjør det vanskeligere å si og skrive");
  }
  const digits = (label.match(/\d/g) ?? []).length;
  if (digits) {
    points -= Math.min(9, 3 * digits);
    reasons.push("Tall i navnet");
  }
  const vowels = (plain.match(/[aeiouyæøå]/g) ?? []).length;
  const ratio = plain.length ? vowels / plain.length : 0;
  points += ratio >= 0.25 && ratio <= 0.6 ? 4 : -4;

  let ending = TLD_POINTS[tld] ?? 0;
  if (tld === "com") reasons.push(".com er mest kjent");
  if (tld === "no" && context.norwegian) {
    ending = 12;
    reasons.push(".no gir tillit hos norske besøkende");
  }
  if ((tld === "app" || tld === "dev") && context.tech) ending = 4;
  if ((tld === "shop" || tld === "store") && context.shop) {
    ending = 5;
    reasons.push("Endingen passer for en nettbutikk");
  }
  points += ending;

  if (item.currency === "USD" && item.price !== undefined) {
    if (item.price <= 12) {
      points += 5;
      reasons.push("Billig første år");
    } else if (item.price <= 25) points += 2;
    else if (item.price > 40) {
      points -= 6;
      reasons.push("Dyrt");
    }
    if (item.renewal !== undefined && item.price > 0 && item.renewal > item.price * 2) {
      points -= 3;
      reasons.push("Fornyelsen koster mye mer enn første år");
    }
  }
  return { score: Math.max(0, Math.min(100, Math.round(points))), reasons: reasons.slice(0, 3) };
}

/** Best first. Names that can be bought get rank 1, 2, 3 …; the rest follow without a rank. */
export function rankDomains(items: Availability[], context: RankContext = {}): Ranked[] {
  const scored = items.map((item) => ({ item, ...score(item, context) }));
  const buyable = scored.filter((s) => s.item.registrable).sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length || a.item.name.localeCompare(b.item.name));
  const rest = scored.filter((s) => !s.item.registrable).sort((a, b) => a.item.name.localeCompare(b.item.name));
  return [
    ...buyable.map((s, index): Ranked => ({ ...s.item, rank: index + 1, score: s.score, reasons: s.reasons })),
    ...rest.map((s): Ranked => ({ ...s.item, rank: null, score: s.score, reasons: [] })),
  ];
}
