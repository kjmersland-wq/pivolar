"use client";

import { useMemo, useState } from "react";
import { Search, Share2, ShieldCheck, Sparkles, Wand2, X } from "lucide-react";
import { SocialPanel } from "@/components/SocialPanel";
import { cleanupRequest, qualityFindings, type Finding } from "@/lib/checks/quality";
import { securityFindings, securityRequest } from "@/lib/checks/security";
import { seoFindings, seoRequest } from "@/lib/checks/seo";
import type { FileMap } from "@/lib/files";
import { cn } from "@/lib/utils";

const TONE = { high: "bg-red-500/15 text-red-400", medium: "bg-amber-500/15 text-amber-400", low: "bg-surface-2 text-muted" } as const;
const LABEL = { high: "Alvorlig", medium: "Bør rettes", low: "Liten" } as const;

type Tab = "quality" | "security" | "seo" | "social";

const EMPTY = {
  quality: "Ingen store filer eller kopiert kode funnet. Koden er lett å jobbe videre med.",
  security: "Ingen kjente sikkerhetsproblemer funnet i koden.",
  seo: "Ingen SEO-problemer funnet. Tittel, beskrivelse, deling, sitemap og strukturerte data lages automatisk når du publiserer.",
} as const;

const FOOTER = {
  quality: "En opprydding endrer koden, ikke utseendet.",
  security: "Sjekken leser bare koden i prosjektet. Den ser ikke selve databasen, så sjekk reglene i Supabase også før du åpner for andre.",
  seo: "Ved publisering lager Pivolar også delingsbilde, canonical-adresse, sitemap.xml, robots.txt og strukturerte data (schema.org).",
  social: "Pivolar skriver ikke ut til kontoene dine. Du kopierer teksten og legger den ut selv.",
} as const;

/** Reads the project and lists what is hard to maintain, unsafe or weak for search, each with a one-click fix. */
export function CheckDialog({ open, files, busy, onClose, onFix }: { open: boolean; files: FileMap; busy: boolean; onClose: () => void; onFix: (text: string) => void }) {
  const [tab, setTab] = useState<Tab>("quality");
  const quality = useMemo(() => (open ? qualityFindings(files) : []), [open, files]);
  const security = useMemo(() => (open ? securityFindings(files) : []), [open, files]);
  const seo = useMemo(() => (open ? seoFindings(files) : []), [open, files]);
  if (!open) return null;

  const findings = tab === "quality" ? quality : tab === "security" ? security : tab === "seo" ? seo : [];
  const send = (text: string) => {
    onFix(text);
    onClose();
  };
  const all = tab === "quality" ? cleanupRequest(findings) : tab === "security" ? securityRequest(findings) : seoRequest(findings);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="check-title">
      <div className="card flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="check-title" className="text-[17px] font-semibold">
              Kontroll av prosjektet
            </h2>
            <p className="mt-1 text-[13px] text-muted">Pivolar leser koden og sier fra om det som er vanskelig å vedlikeholde, utrygt eller svakt for søk og deling.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Lukk" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface-2 p-1 text-[13px]">
          {(
            [
              ["quality", "Kode", quality.length, Sparkles],
              ["security", "Sikkerhet", security.length, ShieldCheck],
              ["seo", "SEO", seo.length, Search],
              ["social", "SoMe", null, Share2],
            ] as const
          ).map(([value, label, count, Icon]) => (
            <button key={value} type="button" onClick={() => setTab(value)} className={cn("flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 transition", tab === value ? "bg-bg-soft font-medium" : "text-muted hover:text-fg")}>
              <Icon className="size-3.5" />
              {label}
              {count !== null && <span className={cn("rounded-full px-1.5 text-[11px]", count > 0 ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400")}>{count}</span>}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-auto">
          {tab === "social" ? (
            <SocialPanel files={files} busy={busy} onFix={send} />
          ) : findings.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface-2 p-4 text-[13.5px]">{EMPTY[tab]}</p>
          ) : (
            findings.map((f: Finding) => (
              <div key={f.id} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", TONE[f.severity])}>{LABEL[f.severity]}</span>
                    <p className="mt-1.5 text-[13.5px] font-medium">{f.title}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted">{f.detail}</p>
                    {f.path ? (
                      <p className="mt-1 font-mono text-[11.5px] text-muted">
                        {f.path}
                        {f.line ? `:${f.line}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <button type="button" disabled={busy} onClick={() => send(f.fix)} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] transition enabled:hover:border-line-strong disabled:opacity-50">
                    <Wand2 className="size-3.5" />
                    Fiks
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <p className="mt-3 text-[12px] text-muted">{FOOTER[tab]}</p>
        {tab !== "social" && findings.length > 1 && (
          <button type="button" disabled={busy} onClick={() => send(all)} className="bg-brand mt-3 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50">
            <Wand2 className="size-4" />
            {tab === "quality" ? "Rydd opp i alt" : "Fiks alt"}
          </button>
        )}
      </div>
    </div>
  );
}
