"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Info } from "lucide-react";
import type { FileMap } from "@/lib/files";
import { moveCheck, reportToText } from "@/lib/move/check";
import { cn } from "@/lib/utils";

const key = (projectId: string) => `pivolar:move:${projectId}`;

function load(projectId: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(projectId)) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  } catch {
    return [];
  }
}

/**
 * The checklist for moving an imported project (typically from Lovable) to the owner's own Supabase,
 * payment keys and a host such as Cloudflare Pages. Everything is read from the files; the ticks are kept
 * in this browser only, per project.
 */
export function MoveCheck({ projectId, files, omitted }: { projectId: string; files: FileMap; omitted: string[] }) {
  const report = useMemo(() => moveCheck(files, { omitted }), [files, omitted]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the ticks live in the browser, read once per project
    setDone(new Set(load(projectId)));
  }, [projectId]);

  function toggle(id: string) {
    const next = new Set(done);
    if (!next.delete(id)) next.add(id);
    setDone(next);
    try {
      localStorage.setItem(key(projectId), JSON.stringify([...next]));
    } catch {
      /* the ticks are a convenience; without storage they just are not kept */
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportToText(report, done));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the browser may refuse; nothing else to do */
    }
  }

  const todo = report.groups.flatMap((g) => g.items).filter((i) => i.kind !== "info");
  const finished = todo.filter((i) => done.has(i.id)).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">
            {finished} av {todo.length} punkter krysset av
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {report.summary.tables} tabeller · {report.summary.functions} funksjoner · {report.summary.secrets} hemmeligheter · {report.summary.webhooks} webhooks
          </p>
        </div>
        <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition hover:border-line-strong">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Kopiert" : "Kopier som tekst"}
        </button>
      </div>
      {report.groups.map((group) => (
        <div key={group.id} className="border-b border-line px-5 py-4 last:border-b-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{group.title}</p>
          <ul className="mt-2 space-y-3">
            {group.items.map((item) => (
              <li key={item.id} className="flex gap-3">
                {item.kind === "info" ? (
                  <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                ) : (
                  <input type="checkbox" checked={done.has(item.id)} onChange={() => toggle(item.id)} aria-label={item.title} className="mt-1 size-4 shrink-0 accent-[var(--accent,currentColor)]" />
                )}
                <div className="min-w-0">
                  <p className={cn("text-[13.5px]", done.has(item.id) && "text-muted line-through")}>
                    {item.kind === "warn" && <AlertTriangle className="mr-1 inline size-3.5 text-amber-400" aria-label="Obs" />}
                    {item.title}
                  </p>
                  {item.detail && <p className="mt-0.5 text-[12.5px] text-muted">{item.detail}</p>}
                  {item.values && item.values.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {item.values.slice(0, 40).map((v) => (
                        <li key={v} className="break-all font-mono text-[12px] text-muted">
                          {v}
                        </li>
                      ))}
                      {item.values.length > 40 && <li className="text-[12px] text-muted">… og {item.values.length - 40} til</li>}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
