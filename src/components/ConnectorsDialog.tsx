"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Plug, Search, Sparkles, X } from "lucide-react";
import { CATEGORIES, CATEGORY_LABELS, CONNECTORS, KIND_LABELS, missingFields, publicValues, searchConnectors, validate, type Category, type Connector } from "@/lib/connectors";
import { loadConnectors, removeConnector, saveConnector, type Saved } from "@/lib/connectors/store";
import type { FileMap } from "@/lib/files";
import { cn } from "@/lib/utils";

type Filter = "connected" | "all" | Category;

const KIND_TONE = { ready: "bg-emerald-500/15 text-emerald-400", client: "bg-sky-500/15 text-sky-400", assisted: "bg-amber-500/15 text-amber-400", soon: "bg-surface text-faint" } as const;

/** Browse outside services by category, connect one to the project and see what is connected. */
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
  const [saved, setSaved] = useState<Saved | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Connector | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [idea, setIdea] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [google, setGoogle] = useState<{ configured: boolean; connected: { service: string; email: string | null }[]; error?: string } | null>(null);

  // Which Google services are signed in for this project; looked up when a connector that needs one is opened.
  useEffect(() => {
    if (!open || !chosen?.oauth) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the status is loaded when the connector is opened
    setGoogle(null);
    fetch(`/api/oauth/status?project=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => !cancelled && setGoogle(data))
      .catch(() => !cancelled && setGoogle({ configured: false, connected: [], error: "Fikk ikke kontakt med serveren." }));
    return () => {
      cancelled = true;
    };
  }, [open, chosen, projectId]);
  const signedIn = chosen?.oauth ? google?.connected.find((c) => c.service === chosen.oauth!.service) : undefined;

  const current = useMemo(() => saved ?? (open ? loadConnectors(projectId) : {}), [saved, open, projectId]);
  const isConnected = (connector: Connector) => Object.values(current[connector.id] ?? {}).some(Boolean) || (connector.files ? Object.keys(connector.files({})).every((path) => path in files) : false);
  const connectedCount = CONNECTORS.filter(isConnected).length;

  const list = useMemo(() => {
    const byFilter = CONNECTORS.filter((c) => (filter === "all" ? true : filter === "connected" ? isConnected(c) : c.category === filter));
    // Connectors that can be added come before those that are only listed.
    return searchConnectors(query, byFilter).sort((a, b) => Number(a.kind === "soon") - Number(b.kind === "soon"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isConnected reads current and files
  }, [filter, query, current, files]);

  if (!open) return null;

  function pick(connector: Connector | null) {
    setChosen(connector);
    setError("");
    setValues(connector ? (current[connector.id] ?? {}) : {});
  }

  /** Asks the AI to fill in a field from a sentence about the app. The owner reads and can change the result before anything is made. */
  async function suggest(field: { key: string; suggest?: { endpoint: string } }) {
    if (!field.suggest) return;
    setError("");
    setSuggesting(true);
    try {
      const response = await fetch(field.suggest.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: idea }) });
      const data = (await response.json().catch(() => ({}))) as { tables?: string; error?: string };
      if (!response.ok || !data.tables) setError(data.error ?? "Fikk ikke noe forslag.");
      else setValues((current) => ({ ...current, [field.key]: data.tables! }));
    } catch {
      setError("Fikk ikke kontakt med serveren.");
    }
    setSuggesting(false);
  }

  function add() {
    if (!chosen) return;
    if (chosen.oauth && !signedIn) return setError("Koble til Google-kontoen først.");
    const missing = missingFields(chosen, values);
    if (missing.length > 0) return setError(`Fyll inn: ${missing.join(", ")}.`);
    const problem = validate(chosen, values);
    if (problem) return setError(problem);
    saveConnector(projectId, chosen.id, values);
    setSaved(loadConnectors(projectId));
    const extra = chosen.files?.(values);
    if (extra) onAddFiles(extra);
    onFix(chosen.request(publicValues(chosen, values)));
    onClose();
  }

  function remove() {
    if (!chosen) return;
    removeConnector(projectId, chosen.id);
    setSaved(loadConnectors(projectId));
    pick(null);
  }

  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "connected", label: "Tilkoblet", count: connectedCount },
    { id: "all", label: "Alle", count: CONNECTORS.length },
    ...CATEGORIES.map((category) => ({ id: category as Filter, label: CATEGORY_LABELS[category], count: CONNECTORS.filter((c) => c.category === category).length })).filter((chip) => chip.count > 0),
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="connectors-title">
      <div className="card flex h-[85vh] w-full max-w-2xl flex-col rounded-2xl p-6">
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
              <p className="mt-1 text-[13px] text-muted">{chosen ? chosen.summary : "Koble siden til betaling, e-post, meldinger og statistikk."}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Lukk" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
            <X className="size-4" />
          </button>
        </div>

        {chosen ? (
          <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-auto">
            <span className={cn("inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium", KIND_TONE[chosen.kind])}>{KIND_LABELS[chosen.kind]}</span>
            {chosen.kind === "soon" ? (
              <p className="rounded-xl border border-line bg-surface-2 p-3 text-[13px] text-muted">{chosen.after}</p>
            ) : (
              <>
                {chosen.oauth && (
                  <div className="rounded-xl border border-line bg-surface-2 p-3">
                    <p className="text-[13px] font-medium">Google-konto</p>
                    {!google ? (
                      <p className="mt-1 text-[12.5px] text-muted">Sjekker …</p>
                    ) : !google.configured ? (
                      <p className="mt-1 text-[12.5px] text-muted">Google-innlogging er ikke satt opp i Pivolar ennå. Se «Koble til Google» i README (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET og OAUTH_ENCRYPTION_KEY).</p>
                    ) : google.error ? (
                      <p className="mt-1 text-[12.5px] text-red-400">{google.error}</p>
                    ) : signedIn ? (
                      <div className="mt-1 flex items-center justify-between gap-3 text-[12.5px]">
                        <span className="text-emerald-400">Koblet til {signedIn.email ?? "kontoen din"}</span>
                        <button
                          type="button"
                          onClick={() => {
                            void fetch(`/api/oauth/status?project=${encodeURIComponent(projectId)}&service=${chosen.oauth!.service}`, { method: "DELETE" }).then(() => setGoogle({ ...google, connected: google.connected.filter((c) => c.service !== chosen.oauth!.service) }));
                          }}
                          className="text-muted transition hover:text-fg"
                        >
                          Koble fra
                        </button>
                      </div>
                    ) : (
                      <a href={`/api/oauth/google/start?project=${encodeURIComponent(projectId)}&service=${chosen.oauth.service}`} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] transition hover:border-line-strong">
                        Koble til Google
                      </a>
                    )}
                  </div>
                )}
                {chosen.fields.map((field) => (
                  <label key={field.key} className="block text-[12.5px] text-muted">
                    {field.label}
                    {field.optional ? " (valgfritt)" : ""}
                    {field.multiline ? (
                      <textarea
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                        placeholder={field.placeholder}
                        rows={5}
                        spellCheck={false}
                        className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 font-mono text-[13px] text-fg outline-none transition focus:border-line-strong"
                      />
                    ) : (
                      <input
                        value={values[field.key] ?? ""}
                        onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                        placeholder={field.placeholder}
                        type={field.secret ? "password" : "text"}
                        autoComplete="off"
                        spellCheck={false}
                        className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] text-fg outline-none transition focus:border-line-strong"
                      />
                    )}
                    {field.help && <span className="mt-1 block text-faint">{field.help}</span>}
                    {field.suggest && (
                      <span className="mt-2 flex gap-2">
                        <input value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={600} placeholder={field.suggest.placeholder} aria-label="Beskrivelse av appen" className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-fg outline-none focus:border-line-strong" />
                        <button type="button" onClick={() => void suggest(field)} disabled={suggesting || idea.trim().length < 5} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] text-fg transition hover:border-line-strong disabled:opacity-50">
                          {suggesting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                          {field.suggest.label}
                        </button>
                      </span>
                    )}
                  </label>
                ))}
                <a href={chosen.docs} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted transition hover:text-fg">
                  Dokumentasjon <ExternalLink className="size-3" />
                </a>
                {chosen.after && <p className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] text-muted">{chosen.after}</p>}
                {error && <p className="text-[13px] text-red-400">{error}</p>}
              </>
            )}
          </div>
        ) : (
          <>
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Søk i koblinger" aria-label="Søk i koblinger" className="w-full rounded-xl border border-line bg-surface-2 py-2.5 pl-9 pr-3 text-[14px] outline-none transition focus:border-line-strong" />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <button key={chip.id} type="button" onClick={() => setFilter(chip.id)} className={cn("rounded-full border px-2.5 py-1 text-[12px] transition", filter === chip.id ? "border-line-strong bg-bg-soft font-medium" : "border-line text-muted hover:text-fg")}>
                  {chip.label} <span className="text-faint">{chip.count}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-auto">
              {list.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface-2 p-4 text-[13.5px] text-muted">{filter === "connected" && !query ? "Ingenting er koblet til ennå. Velg en tjeneste under «Alle»." : "Ingen koblinger passer."}</p>
              ) : (
                list.map((connector) => (
                  <button key={connector.id} type="button" onClick={() => pick(connector)} className={cn("flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-3 text-left transition hover:border-line-strong", connector.kind === "soon" && "opacity-60")}>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium">{connector.name}</span>
                      <span className="mt-0.5 block text-[12.5px] text-muted">{connector.summary}</span>
                      <span className="mt-1 block text-[11.5px] text-faint">{CATEGORY_LABELS[connector.category]}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[11px]", KIND_TONE[connector.kind])}>{connector.kind === "soon" ? "Kommer" : KIND_LABELS[connector.kind].split(" (")[0]}</span>
                      {isConnected(connector) && <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-400">Tilkoblet</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
            <p className="mt-3 text-[12px] text-muted">Hemmelige nøkler blir ikke skrevet inn i koden. De lagres bare i denne nettleseren og sendes til siden din når du publiserer.</p>
          </>
        )}

        {chosen && chosen.kind !== "soon" && (
          <div className="mt-4 flex gap-2">
            {Object.values(current[chosen.id] ?? {}).some(Boolean) && (
              <button type="button" onClick={remove} className="rounded-xl border border-line px-4 py-2.5 text-[13.5px] text-muted transition hover:text-fg">
                Fjern nøkler
              </button>
            )}
            <button type="button" disabled={busy} onClick={add} className="bg-brand flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50">
              <Plug className="size-4" />
              Legg til i prosjektet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
