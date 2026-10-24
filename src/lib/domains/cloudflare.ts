import { parseDomain } from "./names.ts";

/**
 * Looking up and buying domains through Cloudflare Registrar (the Registrar API, beta). Buying costs real
 * money and cannot be undone, so it is built around a few rules that do not bend:
 *   - nothing is bought without the price the owner saw, re-checked against the registry just before;
 *   - the price must be unchanged, standard (not premium), in dollars and under the owner's own cap;
 *   - buying is off until the owner turns it on (DOMAIN_BUY_ENABLED), and it never renews by itself;
 *   - a purchase is never retried automatically, and a slow answer is treated as «unknown», not «failed».
 * The key is the owner's own and is only ever sent to api.cloudflare.com.
 */

const API = "https://api.cloudflare.com/client/v4";
type Fetcher = typeof fetch;

export type Availability = {
  name: string;
  registrable: boolean;
  tier?: string;
  /** What the first year costs, in `currency`. */
  price?: number;
  renewal?: number;
  currency?: string;
  /** Why it cannot be bought, in words for the owner. */
  reason?: string;
};

export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

type Envelope<T> = { success?: boolean; errors?: { code?: number; message?: string }[]; result?: T };

function explain(status: number, body: Envelope<unknown>): string {
  const detail = body.errors?.[0]?.message ? ` ${body.errors[0]!.message}` : "";
  if (status === 401 || status === 403) return `Cloudflare avviste nøkkelen. Den trenger tillatelsen til Registrar (skrive) for kontoen, og kontoen må ha en betalingsmetode.${detail}`;
  if (status === 429) return "Cloudflare sier det er for mange forespørsler akkurat nå. Vent litt og prøv igjen.";
  return `Cloudflare svarte ${status}.${detail}`;
}

async function call<T>(fetcher: Fetcher, token: string, path: string, init: RequestInit = {}): Promise<{ status: number; result: T }> {
  const response = await fetcher(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers }, signal: init.signal ?? AbortSignal.timeout(35_000) });
  const body = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || body.success === false) throw new DomainError(explain(response.status, body), response.status);
  return { status: response.status, result: body.result as T };
}

const REASONS: Record<string, string> = {
  domain_unavailable: "Er opptatt.",
  extension_not_supported_via_api: "Kan ikke kjøpes herfra. Kjøp den hos en registrar som selger endelsen (.no kjøpes hos en norsk registrar).",
  extension_not_supported: "Cloudflare selger ikke denne endelsen.",
  extension_disallows_registration: "Endelsen tillater ikke registrering nå.",
};

const num = (value: unknown) => {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Live availability and price, straight from the registry. Up to 20 names per call, and only well-formed ones are sent. */
export async function checkDomains(token: string, accountId: string, names: string[], fetcher: Fetcher = fetch): Promise<Availability[]> {
  const valid = [...new Set(names.filter((n) => parseDomain(n)))].slice(0, 20);
  if (valid.length === 0) return [];
  const { result } = await call<{ domains?: { name: string; registrable?: boolean; tier?: string; reason?: string; pricing?: { currency?: string; registration_cost?: string; renewal_cost?: string } }[] }>(fetcher, token, `/accounts/${encodeURIComponent(accountId)}/registrar/domain-check`, { method: "POST", body: JSON.stringify({ domains: valid }) });
  return (result?.domains ?? []).flatMap((d) => {
    if (typeof d.name !== "string" || !parseDomain(d.name)) return [];
    const price = num(d.pricing?.registration_cost);
    const renewal = num(d.pricing?.renewal_cost);
    const item: Availability = { name: d.name.toLowerCase(), registrable: d.registrable === true };
    if (d.tier) item.tier = d.tier;
    if (price !== undefined) item.price = price;
    if (renewal !== undefined) item.renewal = renewal;
    if (d.pricing?.currency) item.currency = d.pricing.currency;
    if (!item.registrable) item.reason = REASONS[d.reason ?? ""] ?? "Kan ikke kjøpes.";
    return [item];
  });
}

/** The owner's settings for buying, from the environment. Off by default. */
export function purchaseRules(env: Record<string, string | undefined> = process.env): { enabled: boolean; maxUsd: number } {
  const max = Number(env.DOMAIN_MAX_USD);
  return { enabled: /^(1|true|yes|on)$/i.test((env.DOMAIN_BUY_ENABLED ?? "").trim()), maxUsd: Number.isFinite(max) && max > 0 ? Math.min(max, 200) : 30 };
}

/**
 * Whether a purchase may go ahead: what the owner saw against what the registry says right now.
 * Returns the reason in words when it may not.
 */
export function approvePurchase(options: { seen: number; now: Availability | undefined; maxUsd: number }): { ok: true; price: number } | { ok: false; message: string } {
  const { seen, now, maxUsd } = options;
  if (!now) return { ok: false, message: "Fikk ikke sjekket domenet akkurat nå. Prøv igjen." };
  if (!now.registrable) return { ok: false, message: now.reason ?? "Domenet kan ikke kjøpes nå." };
  if (now.tier && now.tier !== "standard") return { ok: false, message: "Dette er et premium-domene. Det kjøpes ikke herfra." };
  if (now.currency !== "USD" || now.price === undefined) return { ok: false, message: "Fikk ikke en tydelig pris i dollar, så domenet kjøpes ikke herfra." };
  if (!(now.price > 0)) return { ok: false, message: "Prisen ser ikke riktig ut, så domenet kjøpes ikke." };
  if (now.price > maxUsd) return { ok: false, message: `Prisen er ${now.price.toFixed(2)} USD, over taket ditt på ${maxUsd} USD (DOMAIN_MAX_USD).` };
  if (!Number.isFinite(seen) || Math.abs(now.price - seen) > 0.005) return { ok: false, message: `Prisen har endret seg fra ${Number.isFinite(seen) ? seen.toFixed(2) : "?"} til ${now.price.toFixed(2)} USD. Sjekk på nytt og bekreft den nye prisen.` };
  return { ok: true, price: now.price };
}

export type Registration = { state: "in_progress" | "succeeded" | "failed" | "action_required" | "blocked" | "unknown"; done: boolean; message?: string; expiresAt?: string };

function toRegistration(status: number, result: { state?: string; completed?: boolean; error?: { message?: string }; context?: { registration?: { expires_at?: string } } } | null): Registration {
  const state = (["in_progress", "succeeded", "failed", "action_required", "blocked"] as const).find((s) => s === result?.state) ?? (status === 201 ? "succeeded" : "in_progress");
  const out: Registration = { state, done: state === "succeeded" || result?.completed === true };
  if (result?.error?.message) out.message = result.error.message;
  if (result?.context?.registration?.expires_at) out.expiresAt = result.context.registration.expires_at;
  return out;
}

/**
 * Buys the domain. One try only: Cloudflare answers 201 when it is done, 202 while it is still working
 * (poll the status, never send it again), and it charges the account's default payment method.
 * No renewal, and the registrant is the account's default contact.
 */
export async function registerDomain(token: string, accountId: string, name: string, fetcher: Fetcher = fetch): Promise<Registration> {
  if (!parseDomain(name)) throw new DomainError("Ugyldig domenenavn.");
  try {
    const { status, result } = await call<Parameters<typeof toRegistration>[1]>(fetcher, token, `/accounts/${encodeURIComponent(accountId)}/registrar/registrations`, { method: "POST", body: JSON.stringify({ domain_name: name, auto_renew: false }) });
    return toRegistration(status, result);
  } catch (error) {
    // No answer in time means the purchase may or may not have gone through. Say so, and never try again by itself.
    if (error instanceof DomainError) throw error;
    return { state: "unknown", done: false, message: "Fikk ikke svar fra Cloudflare i tide. Sjekk statusen før du prøver igjen, så du ikke kjøper to ganger." };
  }
}

export async function registrationStatus(token: string, accountId: string, name: string, fetcher: Fetcher = fetch): Promise<Registration> {
  if (!parseDomain(name)) throw new DomainError("Ugyldig domenenavn.");
  const { status, result } = await call<Parameters<typeof toRegistration>[1]>(fetcher, token, `/accounts/${encodeURIComponent(accountId)}/registrar/registrations/${encodeURIComponent(name)}/registration-status`);
  return toRegistration(status, result);
}
