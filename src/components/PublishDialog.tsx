"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, CircleDashed, Copy, ExternalLink, GitBranch, Globe, Loader2, Lock, Rocket, X } from "lucide-react";
import type { FileMap } from "@/lib/files";
import { loadPublish, savePublish, type PublishInfo } from "@/lib/projects";
import { slugify } from "@/lib/publish/project";
import { cn } from "@/lib/utils";

type Config = { github: boolean; vercel: boolean };
type StepState = { status: "idle" | "running" | "done" | "error" | "skipped"; message?: string; url?: string; detail?: string };
type Steps = { project: StepState; github: StepState; vercel: StepState };

const IDLE: Steps = { project: { status: "idle" }, github: { status: "idle" }, vercel: { status: "idle" } };

const VERCEL_STATES: Record<string, string> = {
  QUEUED: "I kø hos Vercel …",
  INITIALIZING: "Starter bygging …",
  BUILDING: "Bygger siden …",
  DEPLOYING: "Legger ut …",
  READY: "Klar",
};

function StepRow({ icon: Icon, title, state }: { icon: typeof GitBranch; title: string; state: StepState }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface/60 p-3">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center">
        {state.status === "running" ? (
          <Loader2 className="size-4 animate-spin text-accent" />
        ) : state.status === "done" ? (
          <Check className="size-4 text-emerald-400" />
        ) : state.status === "error" ? (
          <AlertTriangle className="size-4 text-red-400" />
        ) : (
          <CircleDashed className="size-4 text-faint" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13.5px] font-medium">
          <Icon className="size-3.5 text-muted" />
          {title}
        </p>
        {state.detail && state.status === "running" && <p className="mt-0.5 text-[12.5px] text-muted">{state.detail}</p>}
        {state.status === "error" && state.message && <p className="mt-1 text-[12.5px] leading-relaxed text-red-400">{state.message}</p>}
        {state.status === "skipped" && <p className="mt-0.5 text-[12.5px] text-faint">Hoppet over</p>}
        {state.status === "done" && state.url && (
          <a href={state.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 break-all text-[12.5px] text-accent hover:underline">
            {state.url.replace("https://", "")}
            <ExternalLink className="size-3 shrink-0" />
          </a>
        )}
      </div>
    </div>
  );
}

function Setup({ config }: { config: Config }) {
  const [copied, setCopied] = useState("");
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
    window.setTimeout(() => setCopied(""), 1500);
  };
  const missing: { name: string; why: string; href: string; hint: string }[] = [];
  if (!config.github) {
    missing.push({
      name: "GITHUB_TOKEN",
      why: "lar Pivolar lage repoet og legge koden der",
      href: "https://github.com/settings/tokens/new?scopes=repo&description=Pivolar",
      hint: "Åpne lenken, trykk «Generate token» (tillatelsen «repo» er forhåndsvalgt) og kopier nøkkelen.",
    });
  }
  if (!config.vercel) {
    missing.push({
      name: "VERCEL_TOKEN",
      why: "lar Pivolar legge siden ut på Vercel",
      href: "https://vercel.com/account/tokens",
      hint: "Lag en nøkkel med navnet «Pivolar» og kopier den. Legg også inn VERCEL_TEAM_ID (team_…) hvis prosjektene skal ligge under et team.",
    });
  }
  if (missing.length === 0) return null;
  return (
    <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="text-[13.5px] font-medium text-amber-400">Publisering må settes opp én gang</p>
      <p className="text-[12.5px] leading-relaxed text-muted">
        Legg nøklene som nye linjer i filen <code className="font-mono text-fg">.env.local</code> i prosjektmappen, lagre, og start Pivolar på nytt. Nøklene blir værende på din maskin og vises aldri her.
      </p>
      <ul className="space-y-2.5">
        {missing.map((item) => (
          <li key={item.name} className="space-y-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => copy(`${item.name}=`)}
                className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-[12px] transition hover:text-fg"
                title="Kopier"
              >
                {item.name}=
                {copied === `${item.name}=` ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3 text-faint" />}
              </button>
              <span className="text-[12.5px] text-muted">{item.why}</span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-faint">
              {item.hint}{" "}
              <a href={item.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                Åpne
                <ExternalLink className="size-3" />
              </a>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PublishDialog({ open, onClose, projectId, projectName, files }: { open: boolean; onClose: () => void; projectId: string; projectName: string; files: FileMap }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [steps, setSteps] = useState<Steps>(IDLE);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<PublishInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    const info = loadPublish(projectId);
    setLast(info);
    setName(info?.name ?? slugify(projectName));
    setSteps(IDLE);
    fetch("/api/publish")
      .then((response) => response.json() as Promise<Config>)
      .then(setConfig)
      .catch(() => setConfig({ github: false, vercel: false }));
  }, [open, projectId, projectName]);

  const ready = Boolean(config?.github && config?.vercel);
  const slug = slugify(name);

  async function publish() {
    setRunning(true);
    setSteps({ project: { status: "running" }, github: { status: "idle" }, vercel: { status: "idle" } });
    let githubUrl: string | undefined;
    let liveUrl: string | undefined;
    let ok = false;
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: slug, files, isPrivate }),
      });
      if (!response.ok || !response.body) throw new Error("Publisering startet ikke.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as Record<string, string | number | boolean | undefined>;
          const step = event.step as keyof Steps | "finished";
          if (step === "finished") {
            ok = Boolean(event.ok);
            continue;
          }
          const status = event.status as StepState["status"];
          const detail = step === "vercel" && typeof event.state === "string" ? VERCEL_STATES[event.state] ?? event.state : undefined;
          if (step === "github" && status === "done") githubUrl = event.url as string;
          if (step === "vercel" && status === "done") liveUrl = event.url as string;
          setSteps((prev) => ({
            ...prev,
            [step]: {
              status,
              ...(typeof event.message === "string" ? { message: event.message } : {}),
              ...(typeof event.url === "string" ? { url: event.url } : {}),
              ...(detail ? { detail } : {}),
            },
            ...(step === "project" ? { github: { status: "running" as const } } : {}),
          }));
        }
      }
    } catch (error) {
      setSteps((prev) => ({ ...prev, github: { status: "error", message: error instanceof Error ? error.message : "Noe gikk galt." } }));
    } finally {
      setRunning(false);
      if (githubUrl || liveUrl) {
        const info: PublishInfo = { name: slug, at: Date.now(), ...(githubUrl ? { githubUrl } : {}), ...(liveUrl ? { liveUrl } : {}) };
        savePublish(projectId, info);
        setLast(info);
      }
      void ok;
    }
  }

  const finished = steps.vercel.status === "done" || steps.github.status === "done" || steps.github.status === "error" || steps.vercel.status === "error";

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}>
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            className="card max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl p-6"
            role="dialog"
            aria-label="Publiser"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
                  <Rocket className="size-[18px] text-accent" />
                  Publiser
                </h2>
                <p className="mt-1 text-[13px] text-muted">Legger koden på GitHub og siden live på Vercel, med ett klikk.</p>
              </div>
              <button type="button" onClick={onClose} disabled={running} className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40" aria-label="Lukk">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {config && !ready && <Setup config={config} />}

              <div className="space-y-1.5">
                <label htmlFor="publish-name" className="text-[12.5px] font-medium text-muted">
                  Navn på repo og nettsted
                </label>
                <input
                  id="publish-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={running}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 font-mono text-[13.5px] outline-none transition focus:border-line-strong disabled:opacity-60"
                />
                <p className="text-[12px] text-faint">
                  Blir <span className="font-mono text-muted">{slug}</span>.vercel.app
                  {last ? " (samme sted som sist, så siden oppdateres)" : ""}
                </p>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} disabled={running || Boolean(last?.githubUrl)} className="size-4 accent-[var(--accent)]" />
                <Lock className="size-3.5" />
                Privat GitHub-repo{last?.githubUrl ? " (kan ikke endres etter første publisering)" : ""}
              </label>

              {(running || finished) && (
                <div className="space-y-2">
                  <StepRow icon={Rocket} title="Gjør prosjektet klart" state={steps.project} />
                  <StepRow icon={GitBranch} title="GitHub" state={steps.github} />
                  <StepRow icon={Globe} title="Vercel" state={steps.vercel} />
                </div>
              )}

              {!running && last?.liveUrl && !finished && (
                <a href={last.liveUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-line bg-surface/60 p-3 text-[13px] text-accent hover:underline">
                  <Globe className="size-4" />
                  Sist publisert: {last.liveUrl.replace("https://", "")}
                  <ExternalLink className="ml-auto size-3.5" />
                </a>
              )}

              <button
                type="button"
                onClick={publish}
                disabled={!ready || running || !slug}
                className="bg-brand flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14.5px] font-medium text-white shadow-[0_8px_24px_-10px_var(--accent)] transition enabled:hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
              >
                {running ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                {running ? "Publiserer …" : last ? "Publiser på nytt" : "Publiser"}
              </button>
              <p className={cn("text-center text-[11.5px] text-faint", ready && "hidden")}>Knappen låses opp når begge nøklene er lagt inn.</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
