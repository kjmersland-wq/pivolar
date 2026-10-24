/**
 * Limits that hold on the server. Everything can be changed with environment variables, and the
 * defaults are on the careful side: a number that is missing or does not make sense falls back to the default.
 */

export type RateRoute = "chat" | "analyze" | "runner" | "import" | "publish" | "export" | "pr";

/** Requests allowed per signed-in user in a window. */
export const RATES: Record<RateRoute, { windowSeconds: number; max: number }> = {
  chat: { windowSeconds: 60, max: 20 },
  analyze: { windowSeconds: 600, max: 10 },
  runner: { windowSeconds: 3600, max: 10 },
  import: { windowSeconds: 3600, max: 20 },
  publish: { windowSeconds: 3600, max: 20 },
  export: { windowSeconds: 600, max: 30 },
  pr: { windowSeconds: 3600, max: 30 },
};

export type QuotaConfig = {
  /** Emergency brake: no AI requests at all. */
  aiDisabled: boolean;
  /** Emergency brake: no imports from a web address or from GitHub. */
  importDisabled: boolean;
  /** The most one request may cost, in dollars, and what is set aside for it. */
  requestCapUsd: number;
  /** Most tokens the model may write in one step. */
  maxOutputTokens: number;
  /** A request is cut off after this long. Must be below the platform's own limit (300 s). */
  timeoutMs: number;
  /** The longest a run of an imported project may live, counted from when it was started. */
  sandboxMaxMs: number;
  /** What the whole service may spend on AI in a day, in dollars. Null means no cap. */
  globalDailyUsd: number | null;
  /** Let requests through when the quota functions are missing in the database. Only for the time between a deploy and its migration. */
  allowUnset: boolean;
};

const positive = (value: string | undefined) => {
  const n = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
};
const on = (value: string | undefined) => /^(1|true|yes|on)$/i.test((value ?? "").trim());

export const MAX_TIMEOUT_MS = 280_000;

export function quotaConfig(env: Record<string, string | undefined> = process.env): QuotaConfig {
  return {
    aiDisabled: on(env.AI_DISABLED),
    importDisabled: on(env.IMPORT_DISABLED),
    requestCapUsd: Math.min(positive(env.REQUEST_CAP_USD) ?? 1.5, 50),
    maxOutputTokens: Math.min(Math.round(positive(env.MAX_OUTPUT_TOKENS) ?? 16_000), 64_000),
    timeoutMs: Math.min(Math.round(positive(env.REQUEST_TIMEOUT_MS) ?? 240_000), MAX_TIMEOUT_MS),
    sandboxMaxMs: Math.min(Math.round(positive(env.SANDBOX_MAX_MINUTES) ?? 120), 480) * 60_000,
    globalDailyUsd: positive(env.GLOBAL_DAILY_USD) ?? null,
    allowUnset: on(env.QUOTA_ALLOW_UNSET),
  };
}
