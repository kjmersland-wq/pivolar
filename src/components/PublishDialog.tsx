"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, CircleDashed, Copy, ExternalLink, GitBranch, Globe, Loader2, Lock, Rocket, X } from "lucide-react";
import { HostingPicker } from "@/components/HostingPicker";
import { envFor } from "@/lib/connectors";
import { hostById, type HostId } from "@/lib/hosting/catalog";
import { deployLink } from "@/lib/hosting/files";
import { profileOf, recommended } from "@/lib/hosting/recommend";
import { loadConnectors } from "@/lib/connectors/store";
import type { FileMap } from "@/lib/files";
import { loadPublish, savePublish, type PublishInfo } from "@/lib/projects";
import { slugify } from "@/lib/publish/project";
import { cn } from "@/lib/utils";

type Config = { github: boolean; vercel: boolean; netlify?: boolean; cloudflare?: boolean };
type StepState = { status: "idle" | "running" | "done" | "error" | "skipped"; message?: string; url?: string; detail?: string };
type Steps = { project: StepState; github: StepState; vercel: StepState; host: StepState };

const IDLE: Steps = { project: { status: "idle" }, github: { status: "idle" }, vercel: { status: "idle" }, host: { status: "idle" } };

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
        {state.status === "done" && state.message && <p className="mt-1 text-[12.5px] leading-relaxed text-amber-400">{state.message}</p>}
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

function Setup({ config, needsVercel }: { config: Config; needsVercel: boolean }) {
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
  if (needsVercel && !config.vercel) {
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
  const [analytics, setAnalytics] = useState(true);
  const [host, setHost] = useState<HostId>("vercel");
  const [steps, setSteps] = useState<Steps>(IDLE);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<PublishInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    const info = loadPublish(projectId);
    setLast(info);
    setName(info?.name ?? slugify(projectName));
    setSteps(IDLE);
    setHost(recommended(profileOf(files)));
    fetch("/api/publish")
      .then((response) => response.json() as Promise<Config>)
      .then(setConfig)
      .catch(() => setConfig({ github: false, vercel: false }));
    // The host is chosen once when the dialog opens; later edits to the files do not move the choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, projectName]);

  const ready = Boolean(config?.github && (host !== "vercel" || config?.vercel));
  const slug = slugify(name);
  const hostInfo = hostById(host);
  const link = host !== "vercel" && steps.github.status === "done" && steps.github.url ? deployLink(host, steps.github.url) : null;
  // Netlify and Cloudflare are rolled out from here when their keys are set; otherwise only the code goes to GitHub and the host's own page does the rest.
  const auto = (host === "netlify" && config?.netlify) || (host === "cloudflare" && config?.cloudflare) ? true : false;
  const autoKeys = host === "netlify" ? "NETLIFY_TOKEN" : host === "cloudflare" ? "CLOUDFLARE_API_TOKEN og CLOUDFLARE_ACCOUNT_ID" : "";

  async function publish() {
    setRunning(true);
    setSteps({ project: { status: "running" }, github: { status: "idle" }, vercel: { status: "idle" }, host: { status: "idle" } });
    let githubUrl: string | undefined;
    let liveUrl: string | undefined;
    let ok = false;
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: slug, files, isPrivate, host, env: envFor(loadConnectors(projectId)), projectId, ...(analytics ? { analyticsProject: projectId } : {}) }),
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
          const detail = step === "vercel" && typeof event.state === "string" ? VERCEL_STATES[event.state] ?? event.state : step === "host" && typeof event.detail === "string" ? event.detail : undefined;
          if (step === "github" && status === "done") githubUrl = event.url as string;
          if ((step === "vercel" || step === "host") && status === "done") liveUrl = event.url as string;
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

  const finished = steps.vercel.status === "done" || steps.github.status === "done" || steps.github.status === "error" || steps.vercel.status === "error" || steps.host.status === "done" || steps.host.status === "error";

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
                <p className="mt-1 text-[13px] text-muted">Legger koden på GitHub, og siden live der du velger.</p>
              </div>
              <button type="button" onClick={onClose} disabled={running} className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40" aria-label="Lukk">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {config && !ready && <Setup config={config} needsVercel={host === "vercel"} />}

              <HostingPicker files={files} value={host} onChange={setHost} disabled={running} />

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
                  {host === "vercel" ? (
                    <>
                      Blir <span className="font-mono text-muted">{slug}</span>.vercel.app
                      {last ? " (samme sted som sist, så siden oppdateres)" : ""}
                    </>
                  ) : (
                    <>
                      Repoet blir <span className="font-mono text-muted">{slug}</span> på GitHub. Adressen til siden får du hos {hostInfo.name}.
                    </>
                  )}
                </p>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-muted">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} disabled={running || Boolean(last?.githubUrl)} className="size-4 accent-[var(--accent)]" />
                <Lock className="size-3.5" />
                Privat GitHub-repo{last?.githubUrl ? " (kan ikke endres etter første publisering)" : ""}
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-muted">
                <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} disabled={running} className="mt-0.5 size-4 accent-[var(--accent)]" />
                <span>
                  Tell besøk (uten cookies)
                  <span className="mt-0.5 block text-[12px] text-faint">Siden sender sti, kilde, land og enhet til Pivolar. Ingen IP-adresser lagres, og ingenting sendes hvis nettleseren ber om «Do Not Track». Se tallene under Analyse.</span>
                </span>
              </label>

              {(running || finished) && (
                <div className="space-y-2">
                  <StepRow icon={Rocket} title="Gjør prosjektet klart" state={steps.project} />
                  <StepRow icon={GitBranch} title="GitHub" state={steps.github} />
                  {host === "vercel" && <StepRow icon={Globe} title="Vercel" state={steps.vercel} />}
                  {auto && <StepRow icon={Globe} title={hostInfo.name} state={steps.host} />}
                </div>
              )}

              {host !== "vercel" && host !== "github-pages" && (host === "netlify" || host === "cloudflare") && !auto && (
                <p className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] text-muted">
                  Vil du at Pivolar legger siden ut hos {hostInfo.name} selv? Legg inn <span className="font-mono text-fg">{autoKeys}</span> i miljøvariablene, så bygges siden i en isolert maskin og lastes opp. Uten nøkkelen legges bare koden på GitHub, og du fullfører hos {hostInfo.name}.
                </p>
              )}

              {host !== "vercel" && steps.github.status === "done" && (!auto || steps.host.status === "error" || steps.host.status === "skipped") && (
                <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3.5">
                  <p className="text-[13.5px] font-medium">Neste steg hos {hostInfo.name}</p>
                  <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-muted">
                    {hostInfo.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  {link && (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] transition hover:border-line-strong">
                      {host === "github-pages" ? "Åpne innstillinger for Pages" : `Åpne i ${hostInfo.name}`}
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                  <p className="text-[12px] text-faint">Innstillingene for {hostInfo.name} ligger allerede i repoet.</p>
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
