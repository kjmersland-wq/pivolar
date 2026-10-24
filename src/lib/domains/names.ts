/**
 * Domain names for a project: candidates made from its own name, and the checks every name must pass
 * before it is sent anywhere. A name that comes from the owner or from the AI is only ever used after
 * `parseDomain` has accepted it, since it ends up in requests that can cost money.
 */

/** TLDs offered by default, cheapest and most common first. Cloudflare says itself which ones it cannot sell. */
export const TLDS = ["com", "no", "net", "org", "app", "dev", "io", "co", "site", "online", "shop", "store", "studio", "xyz", "eu"] as const;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^[a-z]{2,24}$/;

/** A name as one domain label: lowercase letters, digits and hyphens, with Norwegian letters written out. */
export function toLabel(input: string): string {
  return input
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " og ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export type ParsedDomain = { label: string; tld: string; name: string };

/** A full domain name (`kaffe.no`, not `www.kaffe.no`, no scheme and no path), or null. */
export function parseDomain(input: unknown): ParsedDomain | null {
  if (typeof input !== "string") return null;
  const text = input.trim().toLowerCase();
  if (text.length < 4 || text.length > 80) return null;
  const parts = text.split(".");
  if (parts.length !== 2) return null;
  const [label, tld] = parts as [string, string];
  if (!LABEL.test(label) || !TLD.test(tld) || label.includes("--")) return null;
  return { label, tld, name: text };
}

const GENERIC = new Set(["app", "nettside", "nettsted", "side", "web", "website", "siden", "min", "mitt", "en", "et", "for", "og", "en-liten", "liten", "lille"]);

/** Words in the project's name without the filler: «En landingsside for en liten kaffebar» gives «kaffebar». */
export function keywordsOf(text: string): string[] {
  return toLabel(text)
    .split("-")
    .filter((word) => word.length > 2 && !GENERIC.has(word) && !/^(landingsside|nettbutikk|portefolje|dashbord)$/.test(word));
}

/**
 * Candidate domain names for a project: its brand name, the keywords of its description, and a few
 * plain variations, each with the preferred TLDs. At most `limit`, without repeats, all valid.
 */
export function candidates(options: { brand?: string; title?: string; description?: string; extra?: string[]; limit?: number; tlds?: readonly string[] }): string[] {
  const { limit = 20, tlds = TLDS } = options;
  const labels: string[] = [];
  const add = (value: string) => {
    const label = toLabel(value);
    if (label && LABEL.test(label) && !label.includes("--") && !labels.includes(label)) labels.push(label);
  };
  for (const extra of options.extra ?? []) add(extra);
  const brand = toLabel(options.brand ?? "");
  const title = keywordsOf(options.title ?? "");
  add(brand);
  add(brand.replace(/-/g, ""));
  if (title.length) {
    add(title.join("-"));
    add(title.join(""));
  }
  const words = keywordsOf(options.description ?? "").slice(0, 3);
  for (const word of words) add(word);
  const base = brand.replace(/-/g, "") || title.join("");
  if (base) {
    add(`get${base}`);
    add(`${base}hq`);
    add(`min${base}`);
  }
  const out: string[] = [];
  // The best names get all the preferred endings before the weaker ones are tried.
  const first = tlds.slice(0, 4);
  for (const tld of first) for (const label of labels.slice(0, 3)) out.push(`${label}.${tld}`);
  for (const label of labels) for (const tld of tlds) out.push(`${label}.${tld}`);
  return [...new Set(out)].filter((name) => parseDomain(name)).slice(0, limit);
}

/** The labels an AI suggested, cleaned and valid, without repeats. Anything else it wrote is dropped. */
export function acceptIdeas(raw: unknown, limit = 8): string[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { names?: unknown }).names) ? (raw as { names: unknown[] }).names : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const label = toLabel(item.replace(/\.[a-z]{2,24}$/i, ""));
    if (label.length >= 3 && LABEL.test(label) && !label.includes("--") && !out.includes(label)) out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}
