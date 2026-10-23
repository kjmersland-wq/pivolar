"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, FileArchive, KeyRound, Loader2, X } from "lucide-react";
import { importProject } from "@/lib/projects";
import type { Report } from "@/lib/zip/analyze";
import type { ReadResult } from "@/lib/zip/read";

type Imported = ReadResult & { report: Report };

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

/** Uploads a ZIP, shows what was found and only then creates the project. */
export function ImportZip() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<Imported | null>(null);
  const [saveError, setSaveError] = useState("");

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setFileName(file.name);
    try {
      const response = await fetch("/api/import/zip", { method: "POST", headers: { "Content-Type": "application/zip" }, body: file });
      const body = (await response.json().catch(() => ({}))) as Imported & { error?: string };
      if (!response.ok) setError(body.error ?? "Importen feilet.");
      else {
        setSaveError("");
        setResult(body);
      }
    } catch {
      setError("Fikk ikke kontakt med serveren.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function open() {
    if (!result) return;
    let name = fileName.replace(/\.zip$/i, "") || "Importert prosjekt";
    try {
      const pkg = JSON.parse(result.files["/package.json"] ?? "{}") as { name?: string };
      if (pkg.name) name = pkg.name;
    } catch {
      /* keep the file name */
    }
    const saved = importProject(
      name,
      result.files,
      { source: "zip", fileName, at: Date.now(), skippedBinaries: result.skipped.filter((s) => /binær/.test(s.reason)).map((s) => s.path), omittedSecrets: result.omittedSecrets.map((o) => o.path) },
      result.report.framework.label,
    );
    if (!saved.ok) return setSaveError(saved.error);
    router.push(`/p/${saved.project.id}`);
  }

  const report = result?.report;
  return (
    <>
      <input ref={input} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Velg ZIP-fil" />
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl border border-line bg-surface/60 px-4 py-2.5 text-[13.5px] text-muted backdrop-blur transition enabled:hover:border-line-strong enabled:hover:text-fg disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FileArchive className="size-4" />}
          {busy ? "Leser arkivet …" : "Importer et prosjekt fra ZIP"}
        </button>
        {error && <p className="max-w-md text-center text-[13px] text-red-400">{error}</p>}
      </div>

      <AnimatePresence>
        {result && report && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="card max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl p-6 text-left" role="dialog" aria-label="Importrapport">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-tight">Importrapport</h2>
                  <p className="mt-1 text-[13px] text-muted">
                    {fileName}: {report.framework.label}, {result.stats.kept} filer
                  </p>
                </div>
                <button type="button" onClick={() => setResult(null)} className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Lukk">
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
                <p className="text-[12px] leading-relaxed text-faint">Originalarkivet er ikke endret. AI-redigering av importerte prosjekter er ikke bygget ennå. Du kan lese, redigere for hånd og eksportere.</p>
                {saveError && <p className="text-[13px] text-red-400">{saveError}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setResult(null)} className="flex-1 rounded-xl border border-line bg-surface-2 py-3 text-[14px] text-muted transition hover:text-fg">
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
    </>
  );
}
