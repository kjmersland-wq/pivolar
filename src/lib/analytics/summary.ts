import type { Source } from "./classify.ts";

export type Hit = { created_at: string; path: string; source: Source; referrer_host: string | null; country: string | null; device: string; visitor: string };

export type Counted = { name: string; count: number };

export type Summary = {
  /** Page views in the period, after the source filter. */
  views: number;
  /** Different visitors in the period (a visitor is counted once per day). */
  visitors: number;
  /** Page views per source before the filter, for the tabs. */
  bySource: Record<Source | "all", number>;
  /** One value per day, oldest first, with days without visits as zero. */
  series: { date: string; count: number }[];
  sources: Counted[];
  pages: Counted[];
  countries: Counted[];
  /** Share of page views per device, in percent. */
  devices: { desktop: number; mobile: number; tablet: number };
  /** Different visitors in the last five minutes. */
  online: number;
};

const SOURCES: Source[] = ["direct", "search", "ai", "social", "referral", "ads"];
const DAY = 86_400_000;

/** The day a time falls in, as Oslo sees it, so a night visit lands on the right date. */
const dayKey = (time: number) => new Date(time).toLocaleDateString("sv-SE", { timeZone: "Europe/Oslo" });

function top(map: Map<string, number>, limit: number): Counted[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name, count]) => ({ name, count }));
}

export function summarize(hits: Hit[], options: { days: number; now?: number; source?: Source | "all" }): Summary {
  const now = options.now ?? Date.now();
  const filter = options.source ?? "all";
  const since = now - options.days * DAY;
  const inPeriod = hits.filter((h) => Date.parse(h.created_at) >= since && Date.parse(h.created_at) <= now);

  const bySource = { all: inPeriod.length, direct: 0, search: 0, ai: 0, social: 0, referral: 0, ads: 0 } as Summary["bySource"];
  for (const hit of inPeriod) if (SOURCES.includes(hit.source)) bySource[hit.source]++;

  const shown = filter === "all" ? inPeriod : inPeriod.filter((h) => h.source === filter);
  const perDay = new Map<string, number>();
  for (let i = options.days - 1; i >= 0; i--) perDay.set(dayKey(now - i * DAY), 0);
  const sources = new Map<string, number>();
  const pages = new Map<string, number>();
  const countries = new Map<string, number>();
  const devices = { desktop: 0, mobile: 0, tablet: 0 };
  const visitors = new Set<string>();

  for (const hit of shown) {
    const key = dayKey(Date.parse(hit.created_at));
    if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + 1);
    const label = hit.referrer_host ?? (hit.source === "direct" ? "Direkte" : hit.source);
    sources.set(label, (sources.get(label) ?? 0) + 1);
    pages.set(hit.path, (pages.get(hit.path) ?? 0) + 1);
    countries.set(hit.country ?? "?", (countries.get(hit.country ?? "?") ?? 0) + 1);
    if (hit.device === "mobile" || hit.device === "tablet" || hit.device === "desktop") devices[hit.device]++;
    visitors.add(`${key}:${hit.visitor}`);
  }

  const total = shown.length || 1;
  const percent = (n: number) => Math.round((n / total) * 1000) / 10;
  const recent = new Set(inPeriod.filter((h) => Date.parse(h.created_at) >= now - 5 * 60_000).map((h) => h.visitor));

  return {
    views: shown.length,
    visitors: visitors.size,
    bySource,
    series: [...perDay.entries()].map(([date, count]) => ({ date, count })),
    sources: top(sources, 8),
    pages: top(pages, 10),
    countries: top(countries, 10),
    devices: shown.length === 0 ? { desktop: 0, mobile: 0, tablet: 0 } : { desktop: percent(devices.desktop), mobile: percent(devices.mobile), tablet: percent(devices.tablet) },
    online: recent.size,
  };
}
