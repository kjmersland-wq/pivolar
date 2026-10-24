/** Turns what a browser sends about a page view into the few values that are stored. Nothing here keeps an address or a browser string. */

export type Source = "direct" | "search" | "ai" | "social" | "referral" | "ads";
export type Device = "desktop" | "mobile" | "tablet";

const SEARCH = /(^|\.)(google|bing|duckduckgo|ecosia|yahoo|brave|startpage|qwant|yandex|baidu|kagi|search\.brave)\.[a-z.]+$|(^|\.)search\.[a-z.]+$/i;
const AI = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com)$/i;
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|l\.facebook\.com|instagram\.com|l\.instagram\.com|x\.com|twitter\.com|t\.co|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|reddit\.com|tiktok\.com|pinterest\.[a-z.]+|threads\.net|bsky\.app|snapchat\.com|whatsapp\.com|wa\.me|t\.me|telegram\.org|discord\.com)$/i;
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|go-http|java\/|facebookexternalhit|embedly|whatsapp|telegram/i;

export const isBot = (userAgent: string) => !userAgent || BOT.test(userAgent);

export function deviceOf(userAgent: string): Device {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(userAgent)) return "mobile";
  return "desktop";
}

/** Host of a referrer address without "www.", or null when it is empty, broken or the site itself. */
export function referrerHost(referrer: string, ownHost?: string): string | null {
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
    if (!host || host.length > 120) return null;
    if (ownHost && host === ownHost.replace(/^www\./, "").toLowerCase()) return null;
    return host;
  } catch {
    return null;
  }
}

/** utm_medium from a link Pivolar made (social) or an ad (cpc, paid) wins over the referrer, since many apps send none. */
export function classifySource(host: string | null, utmMedium = ""): Source {
  const medium = utmMedium.trim().toLowerCase();
  if (/^(cpc|ppc|paid|paidsocial|paid_social|display|ads?)$/.test(medium)) return "ads";
  if (medium === "social") return "social";
  if (medium === "email" || medium === "newsletter") return "referral";
  if (!host) return "direct";
  if (AI.test(host)) return "ai";
  if (SEARCH.test(host)) return "search";
  if (SOCIAL.test(host)) return "social";
  return "referral";
}

/** Only the path is kept: no query string, no fragment, nothing that could hold a name or an e-mail address. */
export function cleanPath(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const clean = path.split(/[?#]/)[0]!.replace(/\/{2,}/g, "/");
  if (clean.length === 0 || clean.length > 200 || /[\u0000-\u001f]/.test(clean)) return null;
  return clean.length > 1 ? clean.replace(/\/$/, "") : clean;
}

/** Same person, same browser, same day, same site: the same value. Tomorrow it is a different one, and it cannot be turned back into an address. */
export async function visitorId(parts: { ip: string; userAgent: string; project: string; day: string; salt: string }): Promise<string> {
  const data = new TextEncoder().encode([parts.salt, parts.project, parts.day, parts.ip, parts.userAgent].join("|"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
