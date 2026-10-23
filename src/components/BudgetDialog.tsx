"use client";

import Link from "next/link";
import { Archive, Trash2 } from "lucide-react";
import { money } from "@/lib/usage/client";
import type { Budget } from "@/lib/usage/summary";

/**
 * Shown when a message is sent with the budget used up. It does not block work for good: the
 * message is either kept for later or thrown away, and the owner decides which.
 */
export function BudgetDialog({ text, hadAttachments, budget, onSave, onDiscard }: { text: string; hadAttachments: boolean; budget: Budget; onSave: () => void; onDiscard: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="budget-title">
      <div className="card w-full max-w-md rounded-2xl p-6">
        <h2 id="budget-title" className="text-[17px] font-semibold">
          Budsjettet er brukt opp
        </h2>
        <p className="mt-1.5 text-[13.5px] text-muted">
          Du har brukt {money(budget.spentUsd)} av {money(budget.budgetUsd ?? 0)}. Hva skal skje med meldingen din?
        </p>
        <blockquote className="mt-4 max-h-32 overflow-auto rounded-xl border border-line bg-surface-2 p-3 text-[13px] leading-relaxed text-fg/90">{text}</blockquote>
        {hadAttachments && <p className="mt-2 text-[12px] text-faint">Bilder du la ved blir ikke lagret, bare teksten.</p>}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onSave}
            className="bg-brand flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-white transition hover:brightness-110"
          >
            <Archive className="size-4" />
            Lagre til senere
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-[13.5px] transition hover:border-line-strong hover:text-red-400"
          >
            <Trash2 className="size-4" />
            Slett
          </button>
        </div>
        <p className="mt-4 text-[12.5px] text-muted">
          Fyll på hos leverandøren og øk budsjettet under{" "}
          <Link href="/forbruk" target="_blank" className="text-fg underline underline-offset-2">
            Forbruk
          </Link>
          . En lagret melding kan sendes senere fra prosjektet.
        </p>
      </div>
    </div>
  );
}
