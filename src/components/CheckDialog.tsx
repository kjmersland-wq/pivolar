"use client";

import { useMemo, useState } from "react";
import { Loader2, Package, ScanSearch, Search, Share2, ShieldCheck, Sparkles, Wand2, X } from "lucide-react";
import { SocialPanel } from "@/components/SocialPanel";
import { cleanupRequest, qualityFindings, type Finding } from "@/lib/checks/quality";
import { securityFindings, securityRequest } from "@/lib/checks/security";
import { seoFindings, seoRequest } from "@/lib/checks/seo";
import { deepScanRequest } from "@/lib/checks/security-more";
import { SANDBOX_DEPENDENCIES, type FileMap } from "@/lib/files";
import { cn } from "@/lib/utils";

const SEVERITY = { high: 0, medium: 1, low: 2 } as const;

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
export function CheckDialog({ open, files, busy, onClose, onFix, onReview }: { open: boolean; files: FileMap; busy: boolean; onClose: () => void; onFix: (text: string) => void; onReview: (text: string) => void }) {
  const [tab, setTab] = useState<Tab>("quality");
  const [packages, setPackages] = useState<{ findings: Finding[]; checked: number; skipped: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [packageError, setPackageError] = useState("");
  const quality = useMemo(() => (open ? qualityFindings(files) : []), [open, files]);
  const code = useMemo(() => (open ? securityFindings(files) : []), [open, files]);
  const security = useMemo(() => [...code, ...(packages?.findings ?? [])].sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]), [code, packages]);
  const seo = useMemo(() => (open ? seoFindings(files) : []), [open, files]);
  if (!open) return null;

  // Projects made in Pivolar have no package.json until they are published; the packages that will be published are checked instead.
  async function checkPackages() {
    setChecking(true);
    setPackageError("");
    try {
      const packageJson = files["/package.json"] ?? JSON.stringify({ dependencies: SANDBOX_DEPENDENCIES });
      const response = await fetch("/api/security/deps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageJson }) });
      const data = (await response.json()) as { findings?: Finding[]; checked?: number; skipped?: number; error?: string };
      if (!response.ok || !data.findings) setPackageError(data.error ?? "Pakkesjekken feilet.");
      else setPackages({ findings: data.findings, checked: data.checked ?? 0, skipped: data.skipped ?? 0 });
    } catch {
      setPackageError("Fikk ikke kontakt med serveren.");
    } finally {
      setChecking(false);
    }
  }

  const findings = tab === "quality" ? quality : tab === "security" ? security : tab === "seo" ? seo : [];
  const send = (text: string) => {
    onFix(text);
    onClose();
  };
  const review = () => {
    onReview(deepScanRequest(files));
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

        {tab === "security" && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-[13px] font-medium">Rask skanning</p>
              <p className="mt-0.5 text-[12px] text-muted">Leser koden etter nøkler, åpne databaseregler, usikker HTML og svake serverfunksjoner. Kjører hver gang du åpner Kontroll.</p>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-[13px] font-medium">Dyp skanning (AI)</p>
              <p className="mt-0.5 text-[12px] text-muted">AI-en går gjennom innlogging, tilgang, input, hemmeligheter og serverfunksjoner. Den rapporterer i chatten og endrer ikke noe.</p>
              <button type="button" disabled={busy} onClick={review} className="mt-2 flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] transition enabled:hover:border-line-strong disabled:opacity-50">
                <ScanSearch className="size-3.5" />
                Kjør dyp skanning
              </button>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-3 sm:col-span-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium">Pakker</p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {packages
                      ? `${packages.checked} pakker sjekket mot den åpne sårbarhetsdatabasen OSV${packages.skipped > 0 ? `, ${packages.skipped} hoppet over (ikke vanlige versjoner)` : ""}. ${packages.findings.length === 0 ? "Ingen kjente feil." : `${packages.findings.length} med kjente feil, under.`}`
                      : "Sjekker om pakkene har kjente sikkerhetsfeil. Uten låsefil brukes laveste versjon i hvert spenn, så svaret er et verste tilfelle."}
                  </p>
                  {packageError && <p className="mt-1 text-[12.5px] text-red-400">{packageError}</p>}
                </div>
                <button type="button" disabled={checking} onClick={() => void checkPackages()} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] transition enabled:hover:border-line-strong disabled:opacity-50">
                  {checking ? <Loader2 className="size-3.5 animate-spin" /> : <Package className="size-3.5" />}
                  {checking ? "Sjekker …" : packages ? "Sjekk på nytt" : "Sjekk pakker"}
                </button>
              </div>
            </div>
          </div>
        )}

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
