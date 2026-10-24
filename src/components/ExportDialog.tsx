"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Download, ExternalLink, GitBranch, Loader2, X } from "lucide-react";
import type { FileMap } from "@/lib/files";
import { loadImportInfo } from "@/lib/projects";
import { slugify } from "@/lib/publish/project";
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
  // Sending the project to a GitHub repository, without publishing it anywhere.
  const [repo, setRepo] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [github, setGithub] = useState<{ ready: boolean } | null>(null);
  const [push, setPush] = useState<{ status: "idle" | "running" | "done" | "error"; url?: string; message?: string }>({ status: "idle" });

  const request = (extra: object) =>
    fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, files, mode: native ? mode : "source", notes: { skippedBinaries: loadImportInfo(projectId)?.skippedBinaries ?? [], omittedSecrets: loadImportInfo(projectId)?.omittedSecrets ?? [] }, ...extra }) });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- the report is loaded each time the dialog opens or the format changes */
    setDry(null);
    setError("");
    /* eslint-enable react-hooks/set-state-in-effect */
    setRepo(slugify(name));
    setPush({ status: "idle" });
    fetch("/api/publish")
      .then((r) => r.json() as Promise<{ github?: boolean }>)
      .then((c) => !cancelled && setGithub({ ready: Boolean(c.github) }))
      .catch(() => !cancelled && setGithub({ ready: false }));
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

  /** Builds the project as a normal Vite project and puts it in one commit in a GitHub repository. Nothing is deployed. */
  async function sendToGitHub() {
    setPush({ status: "running" });
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: slugify(repo), files, isPrivate, host: "vercel", targets: { github: true, vercel: false }, projectId }),
      });
      if (!response.ok || !response.body) {
        const text = response.status === 429 ? "For mange forsøk. Vent litt og prøv igjen." : "Kunne ikke sende til GitHub.";
        return setPush({ status: "error", message: text });
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: { status: "done" | "error"; url?: string; message?: string } | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as { step?: string; status?: string; url?: string; message?: string };
          if (event.step === "github" && (event.status === "done" || event.status === "error")) result = { status: event.status, ...(event.url ? { url: event.url } : {}), ...(event.message ? { message: event.message } : {}) };
        }
      }
      setPush(result ?? { status: "error", message: "Fikk ikke svar fra GitHub." });
    } catch (e) {
      setPush({ status: "error", message: e instanceof Error ? e.message : "Noe gikk galt." });
    }
  }

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

              {native && (
                <div className="space-y-3 border-t border-line pt-4">
                  <p className="flex items-center gap-2 text-[13.5px] font-medium">
                    <GitBranch className="size-4" />
                    Eksporter til GitHub
                  </p>
                  <p className="text-[12.5px] text-muted">Legger prosjektet som et ferdig Vite-prosjekt i et GitHub-repo, i én commit. Ingenting publiseres noe sted, og ingen nøkler følger med.</p>
                  {github && !github.ready ? (
                    <p className="text-[12.5px] text-amber-400">GitHub er ikke koblet til. Legg inn GITHUB_TOKEN i miljøvariablene.</p>
                  ) : (
                    <>
                      <label className="block text-[12.5px] text-muted">
                        Navn på repoet
                        <input value={repo} onChange={(e) => setRepo(e.target.value)} disabled={push.status === "running"} spellCheck={false} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-[14px] text-fg outline-none transition focus:border-line-strong" />
                      </label>
                      <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-muted">
                        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} disabled={push.status === "running"} className="size-4 accent-[var(--accent)]" />
                        Privat repo
                      </label>
                      <button type="button" onClick={() => void sendToGitHub()} disabled={!github || push.status === "running" || slugify(repo).length < 1} className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 py-2.5 text-[13.5px] font-medium transition enabled:hover:border-line-strong disabled:opacity-50">
                        {push.status === "running" ? <Loader2 className="size-4 animate-spin" /> : <GitBranch className="size-4" />}
                        Send til GitHub
                      </button>
                    </>
                  )}
                  {push.status === "done" && push.url && (
                    <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-emerald-400">
                      <Check className="size-4" />
                      Lagt i repoet.
                      <a href={push.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-accent hover:underline">
                        {push.url}
                        <ExternalLink className="size-3" />
                      </a>
                    </p>
                  )}
                  {push.status === "done" && push.message && <p className="text-[12.5px] text-amber-400">{push.message}</p>}
                  {push.status === "error" && <p className="text-[12.5px] text-red-400">{push.message}</p>}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
