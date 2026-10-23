"use client";

import { useEffect, useState } from "react";
import { ExternalLink, GitPullRequest, Loader2, X } from "lucide-react";
import type { ImportInfo } from "@/lib/projects";
import type { FileMap } from "@/lib/files";

type Summary = { write: string[]; remove: string[] };
type Sent = { url: string; branch: string; number: number };

async function call<T>(body: object): Promise<T & { error?: string }> {
  const response = await fetch("/api/github/pull-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && !data.error) data.error = "Noe gikk galt.";
  return data;
}

/** Sends the changes made in Pivolar back to the imported repository as a pull request. The imported branch is not touched. */
export function PullRequestDialog({ open, github, files, onClose }: { open: boolean; github: NonNullable<ImportInfo["github"]>; files: FileMap; onClose: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [title, setTitle] = useState("Endringer fra Pivolar");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);

  const base = { owner: github.owner, repo: github.repo, baseBranch: github.branch, baseSha: github.sha, files };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the dialog opens
    setSummary(null);
    setError("");
    setSent(null);
    setBusy(true);
    call<Summary>({ owner: github.owner, repo: github.repo, baseBranch: github.branch, baseSha: github.sha, files, dryRun: true })
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setSummary(data);
      })
      .catch(() => !cancelled && setError("Fikk ikke kontakt med serveren."))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // The comparison is made once per opening; the files do not change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function send() {
    setBusy(true);
    setError("");
    try {
      const data = await call<Sent>({ ...base, title: title.trim() || "Endringer fra Pivolar", body: "Laget i Pivolar. Se gjennom endringene før du slår dem sammen." });
      if (data.error) setError(data.error);
      else setSent(data);
    } catch {
      setError("Fikk ikke kontakt med serveren.");
    } finally {
      setBusy(false);
    }
  }

  const count = summary ? summary.write.length + summary.remove.length : 0;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="pr-title">
      <div className="card flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="pr-title" className="text-[17px] font-semibold">
              Send til GitHub
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              Endringene legges i en ny gren i {github.owner}/{github.repo} og åpnes som en pull request. Grenen «{github.branch}» røres ikke.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Lukk" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
            <X className="size-4" />
          </button>
        </div>

        {sent ? (
          <div className="mt-5 space-y-3">
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[13.5px]">Pull request #{sent.number} er opprettet på grenen {sent.branch}.</p>
            <a href={sent.url} target="_blank" rel="noreferrer" className="bg-brand flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-white transition hover:brightness-110">
              <ExternalLink className="size-4" />
              Åpne på GitHub
            </a>
          </div>
        ) : (
          <>
            <div className="mt-4 min-h-0 flex-1 overflow-auto">
              {busy && !summary && !error && (
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <Loader2 className="size-4 animate-spin" />
                  Sammenligner med GitHub …
                </p>
              )}
              {summary && (
                <div className="space-y-2 text-[12.5px]">
                  <p className="text-muted">{count} {count === 1 ? "fil" : "filer"} endres:</p>
                  <ul className="space-y-0.5 font-mono text-[12px]">
                    {summary.write.slice(0, 30).map((path) => (
                      <li key={path}>+ {path}</li>
                    ))}
                    {summary.remove.slice(0, 30).map((path) => (
                      <li key={path} className="text-red-400">
                        − {path}
                      </li>
                    ))}
                  </ul>
                  {count > 60 && <p className="text-faint">og flere …</p>}
                </div>
              )}
              {error && <p className="text-[13px] text-red-400">{error}</p>}
            </div>
            {summary && (
              <>
                <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Tittel på pull request" className="mt-4 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] outline-none transition focus:border-line-strong" />
                <button type="button" onClick={send} disabled={busy} className="bg-brand mt-3 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-60">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <GitPullRequest className="size-4" />}
                  {busy ? "Sender …" : "Opprett pull request"}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
