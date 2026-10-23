"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Loader2, RefreshCw, Wand2, X } from "lucide-react";
import { compareSpecs, fixMessage, type Comparison } from "@/lib/analyze/compare";
import type { Spec } from "@/lib/analyze/condense";

type Props = {
  open: boolean;
  onClose: () => void;
  reference: { spec: Spec; url: string | undefined } | null;
  /** Measures the preview. Resolves with the same kind of spec the reference was measured into. */
  measure: () => Promise<Spec>;
  /** Sends the correction request to the chat. */
  onFix: (message: string) => void;
  busy: boolean;
};

/** Measures the preview, compares it with the reference site and offers to fix the differences. */
export function CompareDialog({ open, onClose, reference, measure, onFix, busy }: Props) {
  const [state, setState] = useState<{ phase: "idle" | "measuring" | "done" | "error"; comparison?: Comparison; error?: string }>({ phase: "idle" });

  const run = useCallback(async () => {
    if (!reference) return;
    setState({ phase: "measuring" });
    // The preview needs a moment to settle after it was switched to the wide frame or got new files.
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    try {
      const live = await measure();
      setState({ phase: "done", comparison: compareSpecs(reference.spec, live) });
    } catch (error) {
      setState({ phase: "error", error: error instanceof Error ? error.message : "Målingen mislyktes." });
    }
  }, [measure, reference]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the measurement when the dialog opens
    if (open) void run();
    else setState({ phase: "idle" });
  }, [open, run]);

  const comparison = state.comparison;
  const groups = new Map<string, string[]>();
  for (const d of comparison?.deviations ?? []) groups.set(d.section, [...(groups.get(d.section) ?? []), d.text]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="card flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-3xl p-6 text-left" role="dialog" aria-label="Sammenlign med referansen">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold tracking-tight">Sammenlign med referansen</h2>
                <p className="mt-1 truncate text-[13px] text-muted">{reference?.url ?? "Referansesiden"} · målt på 1280 px bredde</p>
              </div>
              <button type="button" onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Lukk">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              {state.phase === "measuring" && (
                <p className="flex items-center gap-2 text-[13.5px] text-muted">
                  <Loader2 className="size-4 animate-spin" /> Måler forhåndsvisningen …
                </p>
              )}
              {state.phase === "error" && (
                <p className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[13px] text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {state.error}
                </p>
              )}
              {comparison && (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Stat label="Sidehøyde" value={`${comparison.docLive} px`} sub={`referansen ${comparison.docRef} px`} bad={Math.abs(comparison.docLive - comparison.docRef) >= 12} />
                    <Stat label="Seksjoner funnet" value={`${comparison.matched}`} sub={comparison.missingSections.length ? `${comparison.missingSections.length} mangler` : "alle"} bad={comparison.missingSections.length > 0} />
                    <Stat label="Avvik" value={`${comparison.deviations.length + comparison.more}`} sub={comparison.deviations.length === 0 ? "ingen over toleransen" : "se listen"} bad={comparison.deviations.length > 0} />
                  </div>
                  {comparison.missingSections.length > 0 && <p className="text-[12.5px] text-amber-400">Mangler: {comparison.missingSections.join("; ")}</p>}
                  {comparison.carousels.length > 0 && <p className="text-[12.5px] text-muted">{comparison.carousels.join("; ")} er en karusell. Bare størrelsen er sammenlignet, innholdet avhenger av aktiv slide.</p>}
                  {comparison.deviations.length === 0 ? (
                    <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[13px] text-emerald-400">
                      <Check className="size-4" /> Ingen avvik over toleransen. Kopien ligger innenfor noen få piksler av referansen.
                    </p>
                  ) : (
                    [...groups.entries()].map(([section, items]) => (
                      <div key={section} className="space-y-1">
                        <p className="text-[12.5px] font-medium">{section}</p>
                        <ul className="space-y-0.5 text-[12.5px] leading-relaxed text-muted">
                          {items.map((item) => (
                            <li key={item} className="flex gap-2">
                              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-faint" />
                              <span className="min-w-0 break-words">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                  {comparison.more > 0 && <p className="text-[12px] text-faint">og {comparison.more} mindre avvik til</p>}
                </>
              )}
            </div>

            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => void run()} disabled={state.phase === "measuring"} className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-[14px] text-muted transition enabled:hover:text-fg disabled:opacity-50">
                <RefreshCw className="size-4" /> Mål på nytt
              </button>
              <button
                type="button"
                disabled={!comparison || comparison.deviations.length === 0 || busy}
                onClick={() => {
                  if (!comparison) return;
                  onFix(fixMessage(comparison, reference?.url));
                  onClose();
                }}
                className="bg-brand flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50"
              >
                <Wand2 className="size-4" /> Be Pivolar rette avvikene
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stat({ label, value, sub, bad }: { label: string; value: string; sub: string; bad: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="text-[11.5px] uppercase tracking-wider text-faint">{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tracking-tight ${bad ? "text-amber-400" : "text-emerald-400"}`}>{value}</p>
      <p className="text-[12px] text-muted">{sub}</p>
    </div>
  );
}
