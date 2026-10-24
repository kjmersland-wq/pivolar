import { chatCostDetailed, type ChatUsage, type Prices } from "../usage/pricing.ts";

/** The rules that do not need a database: when a budget period starts, what a request has cost, and what to tell the user. */

const TIME_ZONE = "Europe/Oslo";

/** How far Norwegian time is ahead of UTC at a given moment, in milliseconds. */
function osloOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(at / 1000) * 1000;
}

/** Midnight at the start of a calendar month in Norwegian time, as the budget counts months. */
export function startOfOsloMonth(now: number): Date {
  const local = new Date(now + osloOffsetMs(now));
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  // The offset can differ at the start of the month from now (summer time), so it is read again there.
  return new Date(guess - osloOffsetMs(guess - osloOffsetMs(guess)));
}

export type BudgetSettings = { budgetUsd: number | null; period: "month" | "total"; startsAt: string | null };

/** From when spending counts against the budget. */
export function budgetSince(settings: BudgetSettings, now: number = Date.now()): Date {
  if (settings.period === "month") return startOfOsloMonth(now);
  const start = settings.startsAt ? Date.parse(settings.startsAt) : NaN;
  return new Date(Number.isFinite(start) ? start : 0);
}

export type StepUsage = { usage?: ChatUsage | undefined };

/** What the steps of one request have cost so far. */
export function costOfSteps(steps: StepUsage[], prices: Prices): number {
  let total = 0;
  for (const step of steps) if (step.usage) total += chatCostDetailed(step.usage, prices).total;
  return Math.round(total * 1_000_000) / 1_000_000;
}

/** True when a request has used up what was set aside for it. */
export const overCap = (steps: StepUsage[], capUsd: number, prices: Prices) => costOfSteps(steps, prices) >= capUsd;

export const CAP_NOTE = "Jeg stoppet her fordi denne meldingen hadde brukt opp det den fikk lov til å koste. Det som er gjort er beholdt. Skriv «fortsett» hvis du vil at jeg tar det videre.";

export type Denial = { status: 401 | 402 | 429 | 503; message: string };

export const DENIALS = {
  signedOut: { status: 401, message: "Du må logge inn." },
  aiDisabled: { status: 503, message: "AI er slått av midlertidig. Prøv igjen senere." },
  importDisabled: { status: 503, message: "Import er slått av midlertidig. Prøv igjen senere." },
  rate: { status: 429, message: "For mange forespørsler på kort tid. Vent litt og prøv igjen." },
  budget: { status: 402, message: "AI-budsjettet ditt er brukt opp. Fyll på under Forbruk, så kan du fortsette." },
  global: { status: 503, message: "Tjenesten har brukt dagens AI-grense. Prøv igjen i morgen." },
  unset: { status: 503, message: "Kvotesystemet er ikke satt opp. Kjør migrasjonen 20261024160000_pivolar_quota.sql i Supabase." },
} as const satisfies Record<string, Denial>;
