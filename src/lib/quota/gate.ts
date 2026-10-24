import type { SupabaseClient } from "@supabase/supabase-js";
import { RATES, quotaConfig, type QuotaConfig, type RateRoute } from "./config.ts";
import { budgetSince, DENIALS, type BudgetSettings, type Denial } from "./decide.ts";

/**
 * The checks every AI request goes through on the server, in this order: signed in, not switched
 * off, not too many requests, the service's daily cap, and then the user's own budget, where an
 * amount is set aside before the work starts. Anything that cannot be checked is refused, because
 * "not sure" must never mean "free".
 */

export type Denied = { ok: false } & Denial;
export type AiGate = { ok: true; /** The most this request may cost, in dollars. */ capUsd: number; /** Gives the amount back. Call it when the request has ended. */ release: () => Promise<void> };

type Db = Pick<SupabaseClient, "rpc" | "from">;
type User = { id: string } | null | undefined;

const denied = (denial: Denial): Denied => ({ ok: false, ...denial });
type Failure = { code?: string; message?: string } | null;
/**
 * The quota system could not be used. The answer says which step failed and what the database said,
 * so the owner can tell a missing migration from a stale schema cache. Only the signed-in user sees it,
 * and it is a database error text, never a value or a key.
 */
const unsetBecause = (step: string, error: Failure): Denied => denied({ ...DENIALS.unset, message: `${DENIALS.unset.message}${error ? ` (${step}: ${[error.code, error.message].filter(Boolean).join(" ").slice(0, 200)})` : ` (${step})`}` });
// The messages say what is wrong; the function is missing when PostgREST answers one of these.
const missing = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? "")));

/** Counts one request against the user's allowance for the route. */
export async function checkRate(db: Db, route: RateRoute, config: QuotaConfig = quotaConfig()): Promise<{ ok: true } | Denied> {
  const { windowSeconds, max } = RATES[route];
  const { data, error } = await db.rpc("rate_limit", { p_route: route, p_window_seconds: windowSeconds, p_max: max });
  if (error) return missing(error) && config.allowUnset ? { ok: true } : unsetBecause("rate_limit", error);
  return data === true ? { ok: true } : denied(DENIALS.rate);
}

async function readBudget(db: Db, userId: string): Promise<{ settings: BudgetSettings } | { error: Failure }> {
  const { data, error } = await db.from("user_settings").select("budget_usd, budget_period, budget_starts_at").eq("owner_id", userId).maybeSingle();
  if (error) return { error };
  return { settings: {
    budgetUsd: data?.budget_usd === null || data?.budget_usd === undefined ? null : Number(data.budget_usd),
    period: data?.budget_period === "month" ? "month" : "total",
    startsAt: data?.budget_starts_at ?? null,
  } };
}

/** What may be spent on pictures in one request, set aside on top of the text: three pictures at the default price. */
export const IMAGE_ALLOWANCE_USD = 0.12;

export async function openAiGate(db: Db, user: User, config: QuotaConfig = quotaConfig(), now: number = Date.now()): Promise<AiGate | Denied> {
  if (!user) return denied(DENIALS.signedOut);
  if (config.aiDisabled) return denied(DENIALS.aiDisabled);

  const rate = await checkRate(db, "chat", config);
  if (!rate.ok) return rate;

  if (config.globalDailyUsd !== null) {
    const { data, error } = await db.rpc("global_spend_today");
    if (error) return missing(error) && config.allowUnset ? await reserve() : unsetBecause("global_spend_today", error);
    if (Number(data) >= config.globalDailyUsd) return denied(DENIALS.global);
  }
  return reserve();

  async function reserve(): Promise<AiGate | Denied> {
    const read = await readBudget(db, user!.id);
    if ("error" in read) return config.allowUnset ? { ok: true, capUsd: config.requestCapUsd, release: async () => {} } : unsetBecause("user_settings", read.error);
    const settings = read.settings;
    const { data, error } = await db.rpc("reserve_usage", {
      p_estimate: config.requestCapUsd + IMAGE_ALLOWANCE_USD,
      p_budget: settings.budgetUsd,
      p_since: budgetSince(settings, now).toISOString(),
    });
    if (error) return missing(error) && config.allowUnset ? { ok: true, capUsd: config.requestCapUsd, release: async () => {} } : unsetBecause("reserve_usage", error);
    const result = data as { ok?: boolean; id?: number; granted?: number } | null;
    if (!result?.ok || typeof result.id !== "number") return denied(DENIALS.budget);
    const id = result.id;
    // What was set aside also covers the pictures, so the text may use what is left of it.
    const capUsd = Math.max(Math.min(config.requestCapUsd, (result.granted ?? config.requestCapUsd) - IMAGE_ALLOWANCE_USD), 0.01);
    return {
      ok: true,
      capUsd,
      release: async () => {
        try {
          await db.rpc("release_reservation", { p_id: id });
        } catch {
          /* the reservation runs out by itself after 15 minutes */
        }
      },
    };
  }
}
