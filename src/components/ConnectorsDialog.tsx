"use client";

import { useState } from "react";
import { ArrowLeft, CreditCard, ExternalLink, Mail, Plug, X } from "lucide-react";
import { CONNECTORS, missingFields, publicValues, validate, type Category, type Connector } from "@/lib/connectors";
import { loadConnectors, saveConnector } from "@/lib/connectors/store";
import type { FileMap } from "@/lib/files";
import { cn } from "@/lib/utils";

const GROUPS: { category: Category; label: string; Icon: typeof CreditCard }[] = [
  { category: "betaling", label: "Betaling", Icon: CreditCard },
  { category: "e-post", label: "E-post og nyhetsbrev", Icon: Mail },
];

/** Adds an outside service to the project: asks for what it needs, writes any server files and has the model build the page part. */
export function ConnectorsDialog({
  open,
  projectId,
  files,
  busy,
  onClose,
  onFix,
  onAddFiles,
}: {
  open: boolean;
  projectId: string;
  files: FileMap;
  busy: boolean;
  onClose: () => void;
  onFix: (text: string) => void;
  onAddFiles: (files: FileMap) => void;
}) {
  const [chosen, setChosen] = useState<Connector | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  if (!open) return null;

  function pick(connector: Connector | null) {
    setChosen(connector);
    setError("");
    setValues(connector ? (loadConnectors(projectId)[connector.id] ?? {}) : {});
  }

  function add() {
    if (!chosen) return;
    const missing = missingFields(chosen, values);
    if (missing.length > 0) return setError(`Fyll inn: ${missing.join(", ")}.`);
    const problem = validate(chosen, values);
    if (problem) return setError(problem);
    saveConnector(projectId, chosen.id, values);
    const extra = chosen.files?.(values);
    if (extra) onAddFiles(extra);
    onFix(chosen.request(publicValues(chosen, values)));
    onClose();
  }

  const installed = (connector: Connector) => Object.keys(loadConnectors(projectId)[connector.id] ?? {}).length > 0 || (connector.files ? Object.keys(connector.files({})).every((p) => p in files) : false);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="connectors-title">
      <div className="card flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {chosen && (
              <button type="button" onClick={() => pick(null)} aria-label="Tilbake" className="mt-0.5 grid size-7 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
                <ArrowLeft className="size-4" />
              </button>
            )}
            <div>
              <h2 id="connectors-title" className="text-[17px] font-semibold">
                {chosen ? chosen.name : "Koblinger"}
              </h2>
              <p className="mt-1 text-[13px] text-muted">{chosen ? chosen.summary : "Legg til betaling og e-post på siden din uten å skrive koden selv."}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Lukk" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-auto">
          {chosen ? (
            <>
              {chosen.fields.map((field) => (
                <label key={field.key} className="block text-[12.5px] text-muted">
                  {field.label}
                  <input
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    placeholder={field.placeholder}
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    spellCheck={false}
                    className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] text-fg outline-none transition focus:border-line-strong"
                  />
                  {field.help && <span className="mt-1 block text-faint">{field.help}</span>}
                </label>
              ))}
              <a href={chosen.docs} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted transition hover:text-fg">
                Hvor finner jeg dette? <ExternalLink className="size-3" />
              </a>
              <p className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] text-muted">{chosen.after}</p>
              {error && <p className="text-[13px] text-red-400">{error}</p>}
            </>
          ) : (
            GROUPS.map(({ category, label, Icon }) => (
              <div key={category}>
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.12em] text-faint">
                  <Icon className="size-3.5" />
                  {label}
                </p>
                <div className="space-y-2">
                  {CONNECTORS.filter((c) => c.category === category).map((connector) => (
                    <button key={connector.id} type="button" onClick={() => pick(connector)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3 text-left transition hover:border-line-strong">
                      <span className="min-w-0">
                        <span className="block text-[13.5px] font-medium">{connector.name}</span>
                        <span className="mt-0.5 block text-[12.5px] text-muted">{connector.summary}</span>
                      </span>
                      <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px]", installed(connector) ? "bg-emerald-500/15 text-emerald-400" : "bg-surface text-muted")}>{installed(connector) ? "Lagt til" : "Legg til"}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {chosen ? (
          <button type="button" disabled={busy} onClick={add} className="bg-brand mt-4 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50">
            <Plug className="size-4" />
            Legg til i prosjektet
          </button>
        ) : (
          <p className="mt-4 text-[12px] text-muted">Hemmelige nøkler (som Resend) blir ikke skrevet inn i koden. De lagres bare i denne nettleseren og sendes til siden din når du publiserer.</p>
        )}
      </div>
    </div>
  );
}
