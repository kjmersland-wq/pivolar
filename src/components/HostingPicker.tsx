"use client";

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import type { FileMap } from "@/lib/files";
import type { HostId } from "@/lib/hosting/catalog";
import { advise, profileOf, type Fit } from "@/lib/hosting/recommend";
import { cn } from "@/lib/utils";

const FIT: Record<Fit, { label: string; tone: string }> = {
  best: { label: "Anbefalt", tone: "bg-emerald-500/15 text-emerald-400" },
  ok: { label: "Passer", tone: "bg-sky-500/15 text-sky-400" },
  overkill: { label: "Mer enn nødvendig", tone: "bg-surface text-muted" },
  no: { label: "Passer ikke", tone: "bg-red-500/15 text-red-400" },
};

/** Where the site can go, ranked for what it contains, with what it costs and why. */
export function HostingPicker({ files, value, onChange, disabled }: { files: FileMap; value: HostId; onChange: (host: HostId) => void; disabled: boolean }) {
  const advice = useMemo(() => advise(profileOf(files)), [files]);
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-[12.5px] font-medium text-muted">Hvor skal siden ligge?</legend>
      {advice.map(({ host, fit, why }) => {
        const selected = value === host.id;
        return (
          <label key={host.id} className={cn("block cursor-pointer rounded-xl border p-3 transition", selected ? "border-line-strong bg-surface-2" : "border-line hover:border-line-strong", fit === "no" && "opacity-60")}>
            <div className="flex items-start gap-2.5">
              <input type="radio" name="host" value={host.id} checked={selected} onChange={() => onChange(host.id)} disabled={fit === "no"} className="mt-1 size-4 accent-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-medium">{host.name}</span>
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[11px]", FIT[fit].tone)}>{FIT[fit].label}</span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-muted">{why}</p>
                {selected && (
                  <div className="mt-2 space-y-1.5 text-[12px] text-muted">
                    <p>{host.summary}</p>
                    <p>
                      <span className="text-fg">Pris:</span> {host.price}{" "}
                      <a href={host.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                        kilde <ExternalLink className="size-3" />
                      </a>
                      <span className="text-faint"> · sjekket {host.checked}. Prisene endres ofte: sjekk hos leverandøren.</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </label>
        );
      })}
    </fieldset>
  );
}
