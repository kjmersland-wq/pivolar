"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Globe, Loader2, Sparkles, X } from "lucide-react";
import type { Design } from "@/lib/import/design";
import { createProjectFromJob, designSite, fetchSite, nextImages, probeSite, type Probe, type Summary } from "@/lib/import/client";

type Phase = "idle" | "probing" | "probed" | "fetching" | "images" | "ready" | "designing" | "saving";

/** Reads a WordPress site into a project: check the site, fetch the content and pictures, and open it. */
export function ImportCms() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [owner, setOwner] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [error, setError] = useState("");
  const [design, setDesign] = useState<Design | null>(null);
  const job = useRef("");
  const busy = phase === "probing" || phase === "fetching" || phase === "images" || phase === "designing" || phase === "saving";

  function close() {
    if (busy) return;
    setOpen(false);
    setPhase("idle");
    setProbe(null);
    setSummary(null);
    setDesign(null);
    setError("");
  }

  async function check() {
    setError("");
    setPhase("probing");
    try {
      const result = await probeSite(url);
      setProbe(result);
      setPhase("probed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt.");
      setPhase("idle");
    }
  }

  async function run() {
    setError("");
    setPhase("fetching");
    try {
      const fetched = await fetchSite(url);
      job.current = fetched.job;
      setSummary(fetched.summary);
      setPhase("images");
      // The pictures come a few at a time, so no single request has to last long. Stops after a fixed number of rounds as a last resort.
      for (let round = 0; round < 80; round++) {
        const step = await nextImages(fetched.job);
        setProgress({ done: step.total - step.remaining, total: step.total, failed: step.failed });
        if (step.status === "images_done") break;
      }
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt.");
      setPhase(summary ? "ready" : "probed");
    }
  }

  async function suggestDesign() {
    setError("");
    setPhase("designing");
    try {
      setDesign(await designSite(job.current));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt.");
    }
    setPhase("ready");
  }

  async function save() {
    setPhase("saving");
    const saved = await createProjectFromJob(job.current, url);
    if (!saved.ok) {
      setError(saved.error);
      return setPhase("ready");
    }
    router.push(`/p/${saved.id}`);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-xl border border-line bg-surface/60 px-4 py-2.5 text-[13.5px] text-muted backdrop-blur transition hover:border-line-strong hover:text-fg">
        <Globe className="size-4" />
        Importer fra WordPress
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="card max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl p-6 text-left" role="dialog" aria-label="Importer fra WordPress">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-tight">Importer fra WordPress</h2>
                  <p className="mt-1 text-[13px] text-muted">Pivolar leser sidene, innleggene og bildene med vanlig kode, uten AI. Nettstedet ditt endres ikke.</p>
                </div>
                <button type="button" onClick={close} disabled={busy} className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40" aria-label="Lukk">
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-5 space-y-3">
                <input
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setProbe(null);
                    setPhase("idle");
                  }}
                  disabled={busy || phase === "ready"}
                  placeholder="dittnettsted.no"
                  autoFocus
                  aria-label="Adressen til nettstedet"
                  className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] outline-none transition focus:border-line-strong disabled:opacity-60"
                />
                <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-muted">
                  <input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} disabled={busy} className="mt-0.5 size-4 accent-[var(--accent)]" />
                  <span>Dette er mitt eget nettsted, eller jeg har lov til å bruke innholdet.</span>
                </label>

                {probe && phase !== "idle" && (
                  <div className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] text-muted">
                    <p className="text-[13.5px] font-medium text-fg">{probe.name || "Nettstedet"}</p>
                    {probe.rest ? (
                      <p className="mt-1">
                        WordPress. {probe.counts.pages ?? "?"} sider, {probe.counts.posts ?? "?"} innlegg og {probe.counts.media ?? "?"} bilder i mediebiblioteket.
                      </p>
                    ) : (
                      <p className="mt-1">{probe.notes[0] ?? "Innholdet kan ikke leses herfra ennå."}</p>
                    )}
                  </div>
                )}

                {(phase === "fetching" || phase === "images" || phase === "ready" || phase === "designing" || phase === "saving") && (
                  <div className="space-y-2 text-[12.5px] text-muted">
                    <p className="flex items-center gap-2">
                      {phase === "fetching" ? <Loader2 className="size-3.5 animate-spin" /> : <span className="text-emerald-400">✓</span>} Henter sider og innlegg
                    </p>
                    {summary && (
                      <p className="flex items-center gap-2">
                        {phase === "images" ? <Loader2 className="size-3.5 animate-spin" /> : <span className="text-emerald-400">✓</span>} Henter bilder {progress.total > 0 ? `(${progress.done} av ${progress.total}${progress.failed ? `, ${progress.failed} feilet` : ""})` : ""}
                      </p>
                    )}
                  </div>
                )}

                {summary && (phase === "ready" || phase === "designing") && (
                  <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] text-muted">
                    <p>
                      <span className="text-fg">{summary.pages + summary.posts}</span> sider og innlegg, <span className="text-fg">{summary.media}</span> bilder.
                    </p>
                    {summary.plugins.length > 0 && <p>Programtillegg: {summary.plugins.map((p) => p.name).join(", ")}.</p>}
                    {summary.warnings.map((w) => (
                      <p key={w} className="flex gap-2">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                        {w}
                      </p>
                    ))}
                  </div>
                )}

                {(phase === "ready" || phase === "designing") && (
                  <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] text-muted">
                    {design ? (
                      <>
                        <p className="text-fg">Designforslaget er lagret.</p>
                        {design.hero && <p>Forsiden får overskriften «{design.hero.headline}».</p>}
                        <p>
                          Topp: {design.header === "centered" ? "midtstilt" : "enkel"}, bunn: {design.footer === "columns" ? "i kolonner" : "én linje"}, hjørner: {design.radius === "none" ? "skarpe" : design.radius === "round" ? "runde" : "myke"}, luft: {design.density === "airy" ? "romslig" : "vanlig"}.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>Valgfritt: la AI foreslå topp, bunn, hjørner og en overskrift til forsiden. Den leser bare en kort beskrivelse av nettstedet, ikke alle sidene, og endrer ingen tekster.</p>
                        <button type="button" onClick={() => void suggestDesign()} disabled={phase === "designing"} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] text-fg transition hover:border-line-strong disabled:opacity-60">
                          {phase === "designing" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                          Foreslå design med AI
                        </button>
                      </>
                    )}
                  </div>
                )}

                {error && <p className="text-[13px] text-red-400">{error}</p>}

                {phase === "ready" || phase === "designing" || phase === "saving" ? (
                  <button type="button" onClick={() => void save()} disabled={phase === "saving" || phase === "designing"} className="bg-brand flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-60">
                    {phase === "saving" && <Loader2 className="size-4 animate-spin" />}
                    Åpne som prosjekt
                  </button>
                ) : probe?.rest && phase === "probed" ? (
                  <button type="button" onClick={() => void run()} disabled={!owner} className="bg-brand flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50">
                    Hent innholdet
                  </button>
                ) : (
                  <button type="button" onClick={() => void check()} disabled={busy || url.trim().length < 3 || !owner} className="bg-brand flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50">
                    {phase === "probing" && <Loader2 className="size-4 animate-spin" />}
                    {phase === "probing" ? "Sjekker …" : "Sjekk nettstedet"}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
