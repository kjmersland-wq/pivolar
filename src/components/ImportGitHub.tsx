"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GitBranch, Loader2, X } from "lucide-react";
import { ImportReport, type Imported } from "@/components/ImportReport";
import type { RepoSource } from "@/lib/github/repo";

type Branches = { defaultBranch: string; branches: string[]; private: boolean; repo: string };
type Loaded = Imported & { source: RepoSource };

async function post<T>(body: object): Promise<T & { error?: string }> {
  const response = await fetch("/api/github/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok && !data.error) data.error = "Importen feilet.";
  return data;
}

/** Reads a repository from GitHub (Lovable projects live there) and shows what was found before saving. */
export function ImportGitHub() {
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<Branches | null>(null);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Loaded | null>(null);

  function close() {
    setOpen(false);
    setBranches(null);
    setBranch("");
    setError("");
  }

  async function findBranches() {
    setBusy(true);
    setError("");
    try {
      const data = await post<Branches>({ repo, branchesOnly: true });
      if (data.error) return setError(data.error);
      setBranches(data);
      setBranch(data.defaultBranch);
    } catch {
      setError("Fikk ikke kontakt med serveren.");
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    setBusy(true);
    setError("");
    try {
      const data = await post<Loaded>({ repo, branch });
      if (data.error) return setError(data.error);
      setResult(data);
      setOpen(false);
    } catch {
      setError("Fikk ikke kontakt med serveren.");
    } finally {
      setBusy(false);
    }
  }

  const source = result?.source;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl border border-line bg-surface/60 px-4 py-2.5 text-[13.5px] text-muted backdrop-blur transition hover:border-line-strong hover:text-fg"
      >
        <GitBranch className="size-4" />
        Importer fra GitHub
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="card w-full max-w-md rounded-3xl p-6 text-left" role="dialog" aria-label="Importer fra GitHub">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-tight">Importer fra GitHub</h2>
                  <p className="mt-1 text-[13px] text-muted">Pivolar leser en kopi. Repoet på GitHub endres ikke.</p>
                </div>
                <button type="button" onClick={close} className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Lukk">
                  <X className="size-4" />
                </button>
              </div>

              <form
                className="mt-5 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void (branches ? load() : findBranches());
                }}
              >
                <input
                  value={repo}
                  onChange={(e) => {
                    setRepo(e.target.value);
                    setBranches(null);
                  }}
                  placeholder="github.com/navn/repo"
                  autoFocus
                  className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] outline-none transition focus:border-line-strong"
                  aria-label="GitHub-adresse"
                />
                {branches && (
                  <label className="block text-[12.5px] text-muted">
                    Gren
                    <select value={branch} onChange={(e) => setBranch(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[14px] text-fg outline-none">
                      {branches.branches.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1 block text-faint">{branches.private ? "Privat repo" : "Offentlig repo"}</span>
                  </label>
                )}
                {error && <p className="text-[13px] text-red-400">{error}</p>}
                <button type="submit" disabled={busy || repo.trim().length < 3} className="bg-brand flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-60">
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {branches ? (busy ? "Leser repoet …" : "Les inn repoet") : busy ? "Sjekker …" : "Finn grener"}
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ImportReport
        result={result}
        label={source ? `${source.owner}/${source.repo} (${source.branch})` : ""}
        defaultName={source?.repo ?? ""}
        info={
          source
            ? {
                source: "github",
                fileName: `${source.owner}/${source.repo}@${source.branch}`,
                github: { owner: source.owner, repo: source.repo, branch: source.branch, sha: source.sha, private: source.private, url: source.url },
              }
            : null
        }
        note="Repoet på GitHub er ikke endret. Store datafiler blir liggende i repoet. Pivolar kan lese og endre filene med AI."
        onClose={() => setResult(null)}
      />
    </>
  );
}
