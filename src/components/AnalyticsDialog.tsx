"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Source } from "@/lib/analytics/classify";
import { summarize, type Counted, type Hit } from "@/lib/analytics/summary";
import { cn } from "@/lib/utils";

type Tab = Source | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "search", label: "Søk" },
  { id: "ai", label: "AI-søk" },
  { id: "social", label: "Sosiale" },
  { id: "referral", label: "Henvisning" },
  { id: "direct", label: "Direkte" },
  { id: "ads", label: "Annonser" },
];

function countryName(code: string) {
  if (code === "?") return "Ukjent";
  try {
    return new Intl.DisplayNames(["nb"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function Chart({ series }: { series: { date: string; count: number }[] }) {
  const width = 600;
  const height = 150;
  const max = Math.max(1, ...series.map((p) => p.count));
  const x = (i: number) => (series.length <= 1 ? width / 2 : (i / (series.length - 1)) * width);
  const y = (count: number) => height - 8 - (count / max) * (height - 24);
  const line = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(" ");
  const area = series.length > 0 ? `${line} L${x(series.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z` : "";
  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label={`Besøk per dag, høyest ${max}`} preserveAspectRatio="none">
        <path d={area} fill="currentColor" className="text-sky-400/15" />
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" className="text-sky-400" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11.5px] text-faint">
        <span>{series[0]?.date.slice(5)}</span>
        <span>høyest {max} per dag</span>
        <span>{series.at(-1)?.date.slice(5)}</span>
      </figcaption>
    </figure>
  );
}

function List({ title, rows, total, label = (n: string) => n }: { title: string; rows: Counted[]; total: number; label?: (name: string) => string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="text-[13px] font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-faint">Ingen ennå.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((row) => (
            <li key={row.name} className="relative flex items-center justify-between gap-3 overflow-hidden rounded-md px-2 py-1 text-[12.5px]">
              <span className="absolute inset-y-0 left-0 bg-sky-400/10" style={{ width: `${Math.max(3, (row.count / Math.max(1, total)) * 100)}%` }} aria-hidden />
              <span className="relative min-w-0 truncate">{label(row.name)}</span>
              <span className="relative tabular-nums text-muted">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Page views of a published site: curve, sources, pages, countries and devices. Counted without cookies. */
export function AnalyticsDialog({ open, projectId, onClose }: { open: boolean; projectId: string; onClose: () => void }) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState("");
  const [days, setDays] = useState<7 | 30>(7);
  const [tab, setTab] = useState<Tab>("all");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the data is loaded each time the dialog opens
    setHits(null);
    setError("");
    fetch(`/api/analytics?project=${encodeURIComponent(projectId)}`)
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { hits?: Hit[]; error?: string };
        if (cancelled) return;
        if (!response.ok || !data.hits) setError(data.error ?? "Fikk ikke hentet tallene.");
        else setHits(data.hits);
      })
      .catch(() => !cancelled && setError("Fikk ikke kontakt med serveren."));
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const summary = useMemo(() => (hits ? summarize(hits, { days, source: tab }) : null), [hits, days, tab]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="analytics-title">
      <div className="card flex h-[85vh] w-full max-w-2xl flex-col rounded-2xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="analytics-title" className="text-[17px] font-semibold">
              Analyse
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              {summary ? (
                <>
                  <span className="tabular-nums">{summary.views}</span> sidevisninger · <span className="tabular-nums">{summary.visitors}</span> besøkende · <span className="tabular-nums">{summary.online}</span> inne nå
                </>
              ) : (
                "Besøk på den publiserte siden, talt uten cookies."
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-line bg-surface-2 p-0.5 text-[12px]" role="group" aria-label="Periode">
              {([7, 30] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDays(d)} className={cn("rounded-md px-2 py-1 transition", days === d ? "bg-bg-soft font-medium" : "text-muted hover:text-fg")}>
                  {d} dager
                </button>
              ))}
            </div>
            <button type="button" onClick={onClose} aria-label="Lukk" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-line bg-surface-2 p-4 text-[13.5px]">{error}</p>
        ) : !summary ? (
          <p className="mt-6 flex items-center gap-2 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin" /> Henter tall …
          </p>
        ) : (
          <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-auto">
            <div className="flex flex-wrap gap-1.5">
              {TABS.map((t) => (
                <button key={t.id} type="button" onClick={() => setTab(t.id)} className={cn("rounded-full border px-2.5 py-1 text-[12px] transition", tab === t.id ? "border-line-strong bg-bg-soft font-medium" : "border-line text-muted hover:text-fg")}>
                  {t.label} <span className="tabular-nums text-faint">{summary.bySource[t.id]}</span>
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <Chart series={summary.series} />
            </div>
            {summary.bySource.all === 0 && (
              <p className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] text-muted">
                Ingen besøk ennå. Publiser siden med «Tell besøk» på, og åpne den selv. Det kan ta et øyeblikk før tallene vises. Besøk fra roboter og fra nettlesere som ber om «Do Not Track» telles ikke.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <List title="Kilder" rows={summary.sources} total={summary.views} />
              <List title="Sider" rows={summary.pages} total={summary.views} />
              <List title="Land" rows={summary.countries} total={summary.views} label={countryName} />
              <div className="rounded-xl border border-line bg-surface-2 p-3">
                <p className="text-[13px] font-medium">Enheter</p>
                <ul className="mt-2 space-y-1 text-[12.5px]">
                  {([["desktop", "Datamaskin"], ["mobile", "Mobil"], ["tablet", "Nettbrett"]] as const).map(([id, label]) => (
                    <li key={id} className="flex items-center justify-between gap-3 px-2 py-1">
                      <span>{label}</span>
                      <span className="tabular-nums text-muted">{summary.devices[id]} %</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-[12px] text-muted">En besøkende telles én gang per dag og kan ikke følges fra dag til dag, og ingen IP-adresser lagres. Det gjør at slik telling vanligvis ikke krever samtykkebanner, men reglene varierer, så sjekk det som gjelder for din side.</p>
          </div>
        )}
      </div>
    </div>
  );
}
