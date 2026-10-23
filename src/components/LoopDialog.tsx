"use client";

import { RotateCcw, Send, X } from "lucide-react";

/**
 * Shown when the same preview error has been sent for fixing too many times. A further attempt
 * costs credit and rarely works when two have not, so the owner chooses what happens.
 */
export function LoopDialog({ attempts, error, onTryAnyway, onGoBack, onCancel }: { attempts: number; error: string; onTryAnyway: () => void; onGoBack: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="loop-title">
      <div className="card w-full max-w-md rounded-2xl p-6">
        <h2 id="loop-title" className="text-[17px] font-semibold">
          Samme feil igjen
        </h2>
        <p className="mt-1.5 text-[13.5px] text-muted">
          Pivolar har prøvd å rette denne feilen {attempts} ganger uten at den er borte. Et nytt forsøk koster mer kreditt, og lykkes sjelden når de første ikke gjorde det.
        </p>
        <pre className="mt-4 max-h-28 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-2 p-3 text-[12px] leading-relaxed text-fg/90">{error.slice(0, 500)}</pre>
        <div className="mt-5 grid gap-2">
          <button type="button" onClick={onGoBack} className="bg-brand flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-white transition hover:brightness-110">
            <RotateCcw className="size-4" />
            Gå tilbake til før forsøkene
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onTryAnyway} className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[13.5px] transition hover:border-line-strong">
              <Send className="size-4" />
              Prøv likevel
            </button>
            <button type="button" onClick={onCancel} className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[13.5px] text-muted transition hover:text-fg">
              <X className="size-4" />
              Avbryt
            </button>
          </div>
        </div>
        <p className="mt-4 text-[12.5px] text-muted">Du kan også beskrive for Pivolar hva du tror er feil, så trenger den ikke å gjette.</p>
      </div>
    </div>
  );
}
