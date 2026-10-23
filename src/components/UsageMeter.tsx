"use client";

import Link from "next/link";
import { Gauge } from "lucide-react";
import { money, useUsage } from "@/lib/usage/client";
import { cn } from "@/lib/utils";

/** Small pill in the header: what is left of the budget, coloured by how close it is to zero. */
export function UsageMeter() {
  const { summary, error } = useUsage();
  if (!summary && !error) return null;

  let label = "Forbruk";
  let tone = "border-line bg-surface-2 text-muted hover:text-fg";
  let title = "Se forbruk og budsjett";
  if (error) {
    label = "Forbruk";
    title = error;
  } else if (summary) {
    const { budget, monthUsd } = summary;
    if (budget.level === "none" || budget.remainingUsd === null) {
      label = `${money(monthUsd)} denne mnd`;
      title = "Ingen budsjett satt. Trykk for å sette ett.";
    } else if (budget.level === "over") {
      label = "Tomt budsjett";
      tone = "border-red-500/40 bg-red-500/10 text-red-400";
      title = `Budsjettet er brukt opp (${money(budget.spentUsd)} av ${money(budget.budgetUsd ?? 0)}).`;
    } else {
      label = `${money(budget.remainingUsd)} igjen`;
      title = `${money(budget.spentUsd)} brukt av ${money(budget.budgetUsd ?? 0)}.`;
      if (budget.level === "warn") tone = "border-amber-500/40 bg-amber-500/10 text-amber-400";
    }
  }

  return (
    <Link href="/forbruk" title={title} className={cn("flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[12.5px] transition", tone)}>
      <Gauge className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
