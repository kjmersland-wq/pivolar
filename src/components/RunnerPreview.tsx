"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Play, RefreshCw, Square } from "lucide-react";
import type { FileMap } from "@/lib/files";
import type { RunEvent } from "@/lib/runner/run";

type Phase = "idle" | "starting" | "ready" | "error";

const ENV_KEY = (id: string) => `atelier:runenv:${id}`;

function readEnv(id: string): string {
  try {
    return window.localStorage.getItem(ENV_KEY(id)) ?? "";
  } catch {
    return "";
  }
}

const STEPS: { key: RunEvent["step"]; label: string }[] = [
  { key: "files", label: "Legger filene i et isolert miljø" },
  { key: "install", label: "Installerer pakkene (rundt ett minutt)" },
  { key: "start", label: "Starter prosjektet" },
];

/**
 * Shows a project the in-browser preview cannot run (TanStack Start, Next.js, anything with a
 * server) by running it for real in an isolated Vercel Sandbox. Changes made in Pivolar are sent
 * to the running project, so its own hot reload updates the page.
 */
export function RunnerPreview({ projectId, files, github }: { projectId: string; files: FileMap; github: { owner: string; repo: string; sha: string } | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState<RunEvent["step"] | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [env, setEnv] = useState(() => readEnv(projectId));
  const [available, setAvailable] = useState(true);
  const sent = useRef<FileMap | null>(null);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    fetch("/api/runner")
      .then((r) => r.json())
      .then((data: { available?: boolean }) => setAvailable(data.available !== false))
      .catch(() => {});
  }, []);

  const start = useCallback(async () => {
    setPhase("starting");
    setError("");
    setStep(null);
    try {
      window.localStorage.setItem(ENV_KEY(projectId), env);
    } catch {
      /* the text is only a convenience */
    }
    const snapshot = filesRef.current;
    try {
      const response = await fetch("/api/runner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", id: projectId, files: snapshot, env, ...(github ? { github: { owner: github.owner, repo: github.repo, sha: github.sha } } : {}) }) });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Kunne ikke starte forhåndsvisningen.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        buffer += decoder.decode(chunk.value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as RunEvent;
          if (event.step === "error") throw new Error(event.message);
          if (event.step === "ready") {
            sent.current = snapshot;
            setUrl(event.url);
            setPhase("ready");
          } else setStep(event.step);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt.");
      setPhase("error");
    }
  }, [projectId, env, github]);

  // Changes are sent to the running project shortly after they settle.
  useEffect(() => {
    if (phase !== "ready") return;
    const timer = window.setTimeout(() => {
      const previous = sent.current;
      if (!previous || previous === files) return;
      fetch("/api/runner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", id: projectId, files, previous }) })
        .then((r) => r.json())
        .then((data: { running?: boolean }) => {
          if (data.running === false) setPhase("idle");
          else sent.current = files;
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [files, phase, projectId]);

  async function stop() {
    setPhase("idle");
    setUrl("");
    await fetch("/api/runner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop", id: projectId }) }).catch(() => {});
  }

  if (phase === "ready") {
    return (
      <div className="absolute inset-0 z-10 flex flex-col bg-bg-soft">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-400" />
            Kjører i et isolert miljø. Endringer vises automatisk.
          </span>
          <span className="flex gap-1">
            <button type="button" onClick={start} className="flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-surface-2 hover:text-fg">
              <RefreshCw className="size-3" />
              Start på nytt
            </button>
            <button type="button" onClick={stop} className="flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-surface-2 hover:text-fg">
              <Square className="size-3" />
              Stopp
            </button>
          </span>
        </div>
        <iframe src={url} title="Forhåndsvisning av prosjektet" className="min-h-0 flex-1 bg-white" />
      </div>
    );
  }

  const activeIndex = STEPS.findIndex((s) => s.key === step);
  return (
    <div className="absolute inset-0 z-10 grid place-items-center overflow-auto bg-bg-soft p-6">
      <div className="w-full max-w-md space-y-4 text-left">
        <div>
          <p className="text-[15px] font-medium">Kjør prosjektet for å se det</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Dette prosjektet trenger en ekte server, så Pivolar kjører det i et isolert, midlertidig miljø på Vercel. Første oppstart tar rundt ett til to minutter. Miljøet stopper av seg selv etter en halvtime.
          </p>
        </div>

        {phase === "starting" ? (
          <ul className="space-y-2 text-[13px]">
            {STEPS.map((s, i) => (
              <li key={s.key} className={i > activeIndex && activeIndex >= 0 ? "text-faint" : ""}>
                <span className="flex items-center gap-2">
                  {i < activeIndex ? <CheckCircle2 className="size-4 text-emerald-400" /> : i === Math.max(activeIndex, 0) ? <Loader2 className="size-4 animate-spin" /> : <span className="size-4" />}
                  {s.label}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <details className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px]">
              <summary className="cursor-pointer text-muted">Miljøvariabler (valgfritt)</summary>
              <p className="mt-2 text-muted">Mange prosjekter trenger adresser og nøkler for å vise data, for eksempel VITE_SUPABASE_URL. Skriv én per linje. Bruk bare offentlige nøkler eller testnøkler.</p>
              <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={5} spellCheck={false} placeholder={"VITE_SUPABASE_URL=https://…\nVITE_SUPABASE_PUBLISHABLE_KEY=…"} className="mt-2 w-full rounded-lg border border-line bg-bg-soft p-2 font-mono text-[12px] outline-none" />
            </details>
            {!available && <p className="text-[12.5px] text-amber-400">Isolerte miljøer er ikke satt opp her. Det fungerer på pivolar.com, eller lokalt etter «vercel env pull».</p>}
            {phase === "error" && (
              <div className="flex gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
                <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12px] text-red-300">{error}</pre>
              </div>
            )}
            <button type="button" onClick={start} className="bg-brand flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-white transition hover:brightness-110">
              <Play className="size-4" />
              {phase === "error" ? "Prøv igjen" : "Start forhåndsvisning"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
