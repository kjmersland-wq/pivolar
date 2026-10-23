"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ExternalLink, Loader2 } from "lucide-react";
import { BalanceChart, DailyChart } from "@/components/UsageCharts";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { invalidateUsage, kroner, money, useUsage } from "@/lib/usage/client";
import { cn } from "@/lib/utils";

const BILLING = [
  { label: "Anthropic (chatten)", href: "https://console.anthropic.com/settings/billing", note: "Her legger du inn Visa-kortet og fyller på kreditt for chatten." },
  { label: "Vercel AI Gateway (bilder)", href: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card", note: "Kort og kreditt for bildegenerering." },
];

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card rounded-2xl p-4">
      <p className="text-[12px] uppercase tracking-wider text-faint">{label}</p>
      <p className={cn("mt-1.5 text-[26px] font-semibold tracking-tight", tone)}>{value}</p>
      {sub && <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p>}
    </div>
  );
}

const inputClass = "w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-[14px] outline-none transition focus:border-line-strong";

export function UsagePage() {
  const { summary, error, loading } = useUsage();
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<"total" | "month" | null>(null);
  const [topUp, setTopUp] = useState("");
  const [busy, setBusy] = useState<"set" | "add" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(kind: "set" | "add") {
    const body =
      kind === "set"
        ? { budgetUsd: amount.trim() === "" ? null : Number(amount.replace(",", ".")), period: period ?? summary?.budget.period ?? "total" }
        : { addUsd: Number(topUp.replace(",", ".")) };
    if ((kind === "set" && amount.trim() !== "" && !Number.isFinite(body.budgetUsd)) || (kind === "add" && !(Number(body.addUsd) > 0))) {
      return setMessage({ ok: false, text: "Skriv inn et beløp i dollar, for eksempel 25." });
    }
    setBusy(kind);
    setMessage(null);
    const response = await fetch("/api/usage", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) return setMessage({ ok: false, text: result.error ?? "Kunne ikke lagre." });
    setMessage({ ok: true, text: kind === "add" ? "Påfyll registrert." : "Budsjettet er lagret." });
    if (kind === "add") setTopUp("");
    invalidateUsage();
  }

  const budget = summary?.budget;
  const level = budget?.level;
  const barColor = level === "over" ? "bg-red-500" : level === "warn" ? "bg-amber-500" : "bg-[var(--accent)]";

  return (
    <div className="ambient min-h-dvh">
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <Link href="/" className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Til forsiden">
            <ChevronLeft className="size-5" />
          </Link>
          <Logo />
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-5 pb-24 pt-6">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Forbruk</h1>
          <p className="mt-1 text-[14px] text-muted">Hva AI-bruken koster, og hvor mye som er igjen av budsjettet ditt.</p>
        </div>

        {loading && <div className="shimmer h-24 rounded-2xl" />}
        {error && <p className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-[13.5px] text-amber-400">{error}</p>}

        {summary && budget && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {budget.remainingUsd !== null ? (
                <Stat
                  label="Igjen"
                  value={budget.level === "over" ? `−${money(Math.abs(budget.remainingUsd))}` : money(budget.remainingUsd)}
                  sub={`${kroner(Math.max(budget.remainingUsd, 0))} · ${budget.period === "month" ? "denne måneden" : "av påfylt beløp"}`}
                  tone={level === "over" ? "text-red-400" : level === "warn" ? "text-amber-400" : undefined}
                />
              ) : (
                <Stat label="Budsjett" value="Ikke satt" sub="Sett ett nedenfor" />
              )}
              <Stat label="Brukt denne måneden" value={money(summary.monthUsd)} sub={kroner(summary.monthUsd)} />
              <Stat label="Brukt totalt" value={money(summary.allTimeUsd)} sub={`Chat ${money(summary.byKind.chat)} · bilder ${money(summary.byKind.image)}`} />
            </div>

            {budget.budgetUsd !== null && budget.fraction !== null && (
              <div className="card rounded-2xl p-4">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-muted">
                    {money(budget.spentUsd)} av {money(budget.budgetUsd)} brukt
                  </span>
                  <span className={cn("font-medium", level === "over" ? "text-red-400" : level === "warn" ? "text-amber-400" : "text-muted")}>{Math.round(budget.fraction * 100)} %</span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2">
                  <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${Math.min(budget.fraction, 1) * 100}%` }} />
                </div>
                {level === "warn" && <p className="mt-2 text-[12.5px] text-amber-400">Du nærmer deg slutten av budsjettet. Fyll på hos leverandøren og registrer påfyllet under.</p>}
                {level === "over" && <p className="mt-2 text-[12.5px] text-red-400">Budsjettet er brukt opp. Pivolar spør hva som skal skje med nye meldinger.</p>}
              </div>
            )}

            <section className="card rounded-2xl p-5">
              <h2 className="text-[15px] font-medium">{summary.balance ? "Gjenstående budsjett, siste 30 dager" : "Forbruk, siste 30 dager"}</h2>
              <p className="mb-3 text-[12.5px] text-muted">{summary.balance ? "Den stiplede linjen er der advarselen starter (20 % igjen)." : "Sett et budsjett nedenfor for å se kurven for hva som er igjen."}</p>
              {summary.balance && budget.budgetUsd !== null ? <BalanceChart balance={summary.balance} budgetUsd={budget.budgetUsd} /> : <DailyChart days={summary.days} />}
            </section>

            {summary.balance && (
              <section className="card rounded-2xl p-5">
                <h2 className="text-[15px] font-medium">Forbruk per dag</h2>
                <p className="mb-3 text-[12.5px] text-muted">
                  <span className="mr-3 inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-[var(--accent)]" /> Chat
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-[var(--accent-3)]" /> Bilder
                  </span>
                </p>
                <DailyChart days={summary.days} />
              </section>
            )}

            <section className="grid gap-4 md:grid-cols-2">
              <div className="card rounded-2xl p-5">
                <h2 className="text-[15px] font-medium">Budsjett</h2>
                <p className="mb-3 mt-1 text-[12.5px] text-muted">Beløpet i dollar, siden det er det leverandørene fakturerer i. Et nytt beløp begynner å telle fra null.</p>
                <label className="block text-[12.5px] text-muted">
                  Beløp ($)
                  <input
                    inputMode="decimal"
                    className={cn(inputClass, "mt-1")}
                    placeholder={budget.budgetUsd === null ? "for eksempel 25" : String(budget.budgetUsd)}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                  {(
                    [
                      ["total", "Påfylt beløp"],
                      ["month", "Hver måned"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPeriod(value)}
                      className={cn("rounded-xl border px-3 py-2 transition", (period ?? budget.period) === value ? "border-accent bg-accent/10 text-fg" : "border-line bg-surface-2 text-muted hover:text-fg")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => save("set")}
                  disabled={busy !== null}
                  className="bg-brand mt-4 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-60"
                >
                  {busy === "set" && <Loader2 className="size-4 animate-spin" />}
                  Lagre budsjett
                </button>
              </div>

              <div className="card rounded-2xl p-5">
                <h2 className="text-[15px] font-medium">Jeg har fylt på</h2>
                <p className="mb-3 mt-1 text-[12.5px] text-muted">Fyller du på kreditt hos leverandøren, legg inn beløpet her, så øker budsjettet uten å nullstille det du har brukt.</p>
                <label className="block text-[12.5px] text-muted">
                  Påfylt ($)
                  <input inputMode="decimal" className={cn(inputClass, "mt-1")} placeholder="for eksempel 20" value={topUp} onChange={(e) => setTopUp(e.target.value)} />
                </label>
                <button
                  type="button"
                  onClick={() => save("add")}
                  disabled={busy !== null}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 py-2.5 text-[13.5px] transition enabled:hover:border-line-strong disabled:opacity-60"
                >
                  {busy === "add" && <Loader2 className="size-4 animate-spin" />}
                  Legg til påfyll
                </button>
              </div>
            </section>

            {message && <p className={cn("text-[13px]", message.ok ? "text-emerald-400" : "text-red-400")}>{message.text}</p>}

            <section className="card rounded-2xl p-5">
              <h2 className="text-[15px] font-medium">Fyll på</h2>
              <p className="mb-4 mt-1 text-[12.5px] text-muted">
                Kortet legger du alltid inn hos leverandøren selv, aldri i Pivolar. Pivolar viser bare hvor mye du har brukt, og lar deg registrere påfyll.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {BILLING.map((link) => (
                  <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="rounded-xl border border-line bg-surface-2 p-3.5 transition hover:border-line-strong">
                    <span className="flex items-center justify-between text-[13.5px] font-medium">
                      {link.label}
                      <ExternalLink className="size-3.5 text-muted" />
                    </span>
                    <span className="mt-1 block text-[12.5px] text-muted">{link.note}</span>
                  </a>
                ))}
              </div>
            </section>

            <p className="text-[12px] leading-relaxed text-faint">
              Tallene er estimater fra antall tokens og en prisliste i Pivolar, ikke fakturaer. De kan avvike litt, og tallet hos leverandøren er alltid det som gjelder. Kronebeløp er omtrentlige.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
