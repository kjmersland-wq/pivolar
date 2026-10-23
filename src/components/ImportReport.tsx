"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, KeyRound, X } from "lucide-react";
import { importProject, type ImportInfo } from "@/lib/projects";
import type { Report } from "@/lib/zip/analyze";
import type { ReadResult } from "@/lib/zip/read";

export type Imported = ReadResult & { report: Report };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12.5px] font-medium text-muted">{title}</p>
      {children}
    </div>
  );
}

const List = ({ items }: { items: string[] }) => (
  <ul className="space-y-1 text-[12.5px] leading-relaxed text-muted">
    {items.map((item) => (
      <li key={item} className="flex gap-2">
        <span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />
        <span className="min-w-0 break-words">{item}</span>
      </li>
    ))}
  </ul>
);

/** What was found in an import, shown before anything is saved. Used for both ZIP files and GitHub repositories. */
export function ImportReport({ result, label, defaultName, info, note, onClose }: { result: Imported | null; label: string; defaultName: string; info: Omit<ImportInfo, "skippedBinaries" | "omittedSecrets" | "at"> | null; note: string; onClose: () => void }) {
  const router = useRouter();
  const [saveError, setSaveError] = useState("");
  const report = result?.report;

  function open() {
    if (!result || !info) return;
    let name = defaultName || "Importert prosjekt";
    try {
      const pkg = JSON.parse(result.files["/package.json"] ?? "{}") as { name?: string };
      if (pkg.name) name = pkg.name;
    } catch {
      /* keep the default name */
    }
    const saved = importProject(
      name,
      result.files,
      { ...info, at: Date.now(), skippedBinaries: result.skipped.filter((s) => /binær/.test(s.reason)).map((s) => s.path), omittedSecrets: result.omittedSecrets.map((o) => o.path) },
      result.report.framework.label,
    );
    if (!saved.ok) return setSaveError(saved.error);
    router.push(`/p/${saved.project.id}`);
  }

  return (
    <AnimatePresence>
      {result && report && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="card max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl p-6 text-left" role="dialog" aria-label="Importrapport">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-semibold tracking-tight">Importrapport</h2>
                <p className="mt-1 text-[13px] text-muted">
                  {label}: {report.framework.label}, {result.stats.kept} filer
                </p>
              </div>
              <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Lukk">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <p className="rounded-xl border border-line bg-surface/60 p-3 text-[13px] leading-relaxed text-muted">{report.previewNote}</p>
              {report.packageManager && <Section title="Pakkebehandler">{<p className="text-[12.5px] text-muted">{report.packageManager}</p>}</Section>}
              {Object.keys(report.scripts).length > 0 && <Section title="Skript">{<List items={Object.entries(report.scripts).map(([k, v]) => `${k}: ${v}`)} />}</Section>}
              {report.services.length > 0 && <Section title="Eksterne tjenester">{<List items={report.services} />}</Section>}
              {report.envVars.length > 0 && <Section title="Miljøvariabler prosjektet bruker">{<p className="break-words font-mono text-[12px] text-muted">{report.envVars.join(", ")}</p>}</Section>}
              {report.risks.length > 0 && (
                <Section title="Risiko">
                  <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                    <List items={report.risks} />
                  </div>
                </Section>
              )}
              {result.omittedSecrets.length > 0 && (
                <Section title="Holdt utenfor fordi de kan inneholde hemmeligheter">
                  <div className="flex gap-2">
                    <KeyRound className="mt-0.5 size-4 shrink-0 text-faint" />
                    <List items={result.omittedSecrets.map((o) => o.path)} />
                  </div>
                </Section>
              )}
              {result.secretWarnings.length > 0 && (
                <Section title="Ser ut til å inneholde nøkler i koden (bli i filen, men fjernes ved eksport)">
                  <List items={result.secretWarnings.map((w) => `${w.path}, linje ${w.line} (${w.kinds.join(", ")})`)} />
                </Section>
              )}
              {result.skipped.length > 0 && (
                <Section title={`Ikke importert (${result.skipped.length})`}>
                  <List items={result.skipped.slice(0, 8).map((s) => `${s.path}: ${s.reason}`)} />
                  {result.skipped.length > 8 && <p className="text-[12px] text-faint">og {result.skipped.length - 8} til</p>}
                </Section>
              )}
              <p className="text-[12px] leading-relaxed text-faint">{note}</p>
              {saveError && <p className="text-[13px] text-red-400">{saveError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-line bg-surface-2 py-3 text-[14px] text-muted transition hover:text-fg">
                  Avbryt
                </button>
                <button type="button" onClick={open} className="bg-brand flex-1 rounded-xl py-3 text-[14px] font-medium text-white transition hover:brightness-110">
                  Åpne i Pivolar
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
