/** Turns logged usage rows and the budget setting into the numbers and the curve the usage page shows. */

export type UsageRow = { created_at: string; kind: string; estimated_cost_usd: number | string };
export type BudgetSettings = { budgetUsd: number | null; period: "month" | "total"; startsAt: string | null };

export type Day = { date: string; chat: number; image: number; total: number };
export type BudgetLevel = "none" | "ok" | "warn" | "over";
export type Budget = {
  budgetUsd: number | null;
  period: "month" | "total";
  startsAt: string | null;
  spentUsd: number;
  remainingUsd: number | null;
  /** 0 to 1 and beyond: how much of the budget is used. Null without a budget. */
  fraction: number | null;
  level: BudgetLevel;
};
export type Summary = {
  days: Day[];
  /** What is left of the budget at the end of each day. Null without a budget. */
  balance: { date: string; remainingUsd: number }[] | null;
  monthUsd: number;
  allTimeUsd: number;
  byKind: { chat: number; image: number };
  budget: Budget;
};

export const WARN_AT = 0.8;
const TIME_ZONE = "Europe/Oslo";

/** Calendar date (yyyy-mm-dd) in Norwegian time, so "today" matches the user's day. */
export function dateKey(time: number | string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
}

const monthKey = (time: number | string | Date) => dateKey(time).slice(0, 7);
const isImage = (kind: string) => kind === "ai_image";
const isAi = (kind: string) => kind === "ai_input_tokens" || kind === "ai_output_tokens" || kind === "ai_image";
const round = (n: number) => Math.round(n * 10_000) / 10_000;

export function summarize(rows: UsageRow[], settings: BudgetSettings, now: number = Date.now(), dayCount = 30): Summary {
  const aiRows = rows.filter((row) => isAi(row.kind));
  const byDate = new Map<string, Day>();
  for (let i = dayCount - 1; i >= 0; i--) {
    const date = dateKey(now - i * 86_400_000);
    byDate.set(date, { date, chat: 0, image: 0, total: 0 });
  }

  let monthUsd = 0;
  let allTimeUsd = 0;
  const byKind = { chat: 0, image: 0 };
  const thisMonth = monthKey(now);
  const startMs = settings.startsAt ? Date.parse(settings.startsAt) : 0;
  let budgetSpent = 0;

  for (const row of aiRows) {
    const cost = Number(row.estimated_cost_usd) || 0;
    const at = Date.parse(row.created_at);
    allTimeUsd += cost;
    byKind[isImage(row.kind) ? "image" : "chat"] += cost;
    if (monthKey(at) === thisMonth) monthUsd += cost;
    const day = byDate.get(dateKey(at));
    if (day) {
      day[isImage(row.kind) ? "image" : "chat"] += cost;
      day.total += cost;
    }
    if (settings.period === "month" ? monthKey(at) === thisMonth : at >= startMs) budgetSpent += cost;
  }

  const { budgetUsd } = settings;
  const balance =
    budgetUsd === null
      ? null
      : [...byDate.keys()].map((date) => {
          // Spend that counts towards the budget up to the end of this day.
          let spent = 0;
          for (const row of aiRows) {
            const at = Date.parse(row.created_at);
            const counts = settings.period === "month" ? monthKey(at) === date.slice(0, 7) : at >= startMs;
            if (counts && dateKey(at) <= date) spent += Number(row.estimated_cost_usd) || 0;
          }
          return { date, remainingUsd: round(budgetUsd - spent) };
        });
  const fraction = budgetUsd === null ? null : budgetUsd === 0 ? (budgetSpent > 0 ? 1 : 0) : budgetSpent / budgetUsd;
  const level: BudgetLevel = fraction === null ? "none" : fraction >= 1 ? "over" : fraction >= WARN_AT ? "warn" : "ok";

  return {
    balance,
    days: [...byDate.values()].map((day) => ({ date: day.date, chat: round(day.chat), image: round(day.image), total: round(day.total) })),
    monthUsd: round(monthUsd),
    allTimeUsd: round(allTimeUsd),
    byKind: { chat: round(byKind.chat), image: round(byKind.image) },
    budget: {
      budgetUsd,
      period: settings.period,
      startsAt: settings.startsAt,
      spentUsd: round(budgetSpent),
      remainingUsd: budgetUsd === null ? null : round(budgetUsd - budgetSpent),
      fraction: fraction === null ? null : round(fraction),
      level,
    },
  };
}
