"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Download, Loader2, X } from "lucide-react";
import type { FileMap } from "@/lib/files";
import { loadImportInfo } from "@/lib/projects";
import type { Manifest } from "@/lib/zip/export";
import { cn } from "@/lib/utils";

type Mode = "source" | "vite";
type Dry = { manifest: Manifest; report: string };

/** Downloads the whole project as a ZIP after showing what is missing and what was left out. */
export function ExportDialog({ open, onClose, projectId, name, files }: { open: boolean; onClose: () => void; projectId: string; name: string; files: FileMap }) {
  const native = "/App.tsx" in files && !("/package.json" in files);
  const [mode, setMode] = useState<Mode>("source");
  const [dry, setDry] = useState<Dry | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const request = (extra: object) =>
    fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, files, mode: native ? mode : "source", notes: { skippedBinaries: loadImportInfo(projectId)?.skippedBinaries ?? [], omittedSecrets: loadImportInfo(projectId)?.omittedSecrets ?? [] }, ...extra }) });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- the report is loaded each time the dialog opens or the format changes */
    setDry(null);
    setError("");
    /* eslint-enable react-hooks/set-state-in-effect */
    request({ dryRun: true })
      .then(async (response) => {
        const body = (await response.json()) as Dry & { error?: string };
        if (cancelled) return;
        if (!response.ok) setError(body.error ?? "Kunne ikke lage rapport.");
        else setDry(body);
      })
      .catch(() => !cancelled && setError("Fikk ikke kontakt med serveren."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- request reads the current files and mode
  }, [open, mode]);

  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await request({});
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Nedlasting feilet.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "prosjekt"}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nedlasting feilet.");
    } finally {
      setBusy(false);
    }
  }

  const manifest = dry?.manifest;
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }} className="card max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl p-6" role="dialog" aria-label="Eksporter">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
                  <Download className="size-[18px] text-accent" />
                  Eksporter prosjektet
                </h2>
                <p className="mt-1 text-[13px] text-muted">Alle filer i én ZIP, med oppskrift og en liste over hva som er utelatt. Ingen nøkler følger med.</p>
              </div>
              <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Lukk">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {native && (
                <div className="flex rounded-xl border border-line bg-surface-2 p-0.5">
                  {([["source", "Filene slik de er"], ["vite", "Ferdig Vite-prosjekt"]] as const).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setMode(value)} className={cn("flex-1 rounded-[10px] px-3 py-1.5 text-[12.5px] transition", mode === value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}>
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {!manifest && !error && (
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <Loader2 className="size-4 animate-spin" />
                  Kontrollerer prosjektet …
                </p>
              )}

              {manifest && (
                <div className="space-y-3 text-[12.5px] text-muted">
                  <p>
                    {manifest.analysis.framework.label}, {manifest.included.length} filer i arkivet.
                  </p>
                  {manifest.validation.ok ? (
                    <p className="flex items-center gap-2 text-emerald-400">
                      <Check className="size-4" />
                      Ingen kjente mangler. Dette er ingen garanti for at prosjektet bygger eller er sikkert.
                    </p>
                  ) : (
                    <div className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                      <p className="flex items-center gap-2 font-medium text-amber-400">
                        <AlertTriangle className="size-4" />
                        Har mangler
                      </p>
                      {manifest.validation.issues.map((issue) => (
                        <p key={issue}>{issue}</p>
                      ))}
                    </div>
                  )}
                  {manifest.manualSteps.length > 0 && (
                    <div className="space-y-1">
                      <p className="font-medium">Gjør dette selv</p>
                      {manifest.manualSteps.map((step) => (
                        <p key={step} className="leading-relaxed">
                          {step}
                        </p>
                      ))}
                    </div>
                  )}
                  {manifest.omitted.length > 0 && <p>Utelatt: {manifest.omitted.map((o) => o.path).join(", ")}</p>}
                </div>
              )}
              {error && <p className="text-[13px] text-red-400">{error}</p>}

              <button type="button" onClick={download} disabled={!manifest || busy} className="bg-brand flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                Last ned ZIP
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
