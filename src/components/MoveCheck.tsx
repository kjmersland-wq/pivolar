"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Info } from "lucide-react";
import type { FileMap } from "@/lib/files";
import { moveCheck, reportToText } from "@/lib/move/check";
import { prepareCloudflare } from "@/lib/move/prepare";
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
export function MoveCheck({ projectId, files, omitted, onPrepare }: { projectId: string; files: FileMap; omitted: string[]; onPrepare: (changes: Record<string, string>) => void }) {
  const report = useMemo(() => moveCheck(files, { omitted }), [files, omitted]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const prep = useMemo(() => prepareCloudflare(files), [files]);
  const [prepared, setPrepared] = useState<string[] | null>(null);

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

  function prepare() {
    if (!prep.ok) return;
    onPrepare(prep.write);
    setPrepared(Object.keys(prep.write));
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
      <div className="space-y-2 border-b border-line px-5 py-4">
        <p className="text-[13.5px] font-medium">Forbered for Cloudflare</p>
        {!prep.ok ? (
          <p className="text-[12.5px] text-muted">{prep.message}</p>
        ) : (
          <>
            <p className="text-[12.5px] text-muted">
              {Object.keys(prep.write).length > 0 ? `Legger til ${Object.keys(prep.write).join(", ")} i prosjektet.` : "Ingen filer må legges til."} Så sender du endringene til GitHub som pull request, slår dem sammen der, og importerer repoet i Cloudflare.
            </p>
            <button type="button" onClick={prepare} disabled={Object.keys(prep.write).length === 0} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition enabled:hover:border-line-strong disabled:opacity-50">
              Forbered
            </button>
            {prepared !== null && <p className="text-[12.5px] text-emerald-400">Lagt til i prosjektet: {prepared.join(", ")}.</p>}
            <ol className="list-decimal space-y-0.5 pl-5 text-[12.5px] text-muted">
              {prep.next.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {prep.manual.length > 0 && (
              <ul className="space-y-1 text-[12.5px] text-amber-400">
                {prep.manual.map((m) => (
                  <li key={m}>Gjenstår for hånd: {m}</li>
                ))}
              </ul>
            )}
          </>
        )}
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
