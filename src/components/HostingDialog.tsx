"use client";

import { useEffect, useMemo, useState } from "react";
import { FilePlus2, X } from "lucide-react";
import { HostingPicker } from "@/components/HostingPicker";
import type { FileMap } from "@/lib/files";
import { hostById, type HostId } from "@/lib/hosting/catalog";
import { missingHostFiles } from "@/lib/hosting/files";
import { profileOf, recommended } from "@/lib/hosting/recommend";
import { slugify } from "@/lib/publish/project";

/**
 * Where a project is cheapest to run, from fixed rules, and the settings files that go with it.
 * For an imported project the files can be added to the project, so they go out with the next
 * pull request. A project made in Pivolar gets its files when it is published.
 */
export function HostingDialog({ open, files, projectName, onClose, onAddFiles }: { open: boolean; files: FileMap; projectName: string; onClose: () => void; onAddFiles: (files: FileMap) => void }) {
  const profile = useMemo(() => (open ? profileOf(files) : null), [open, files]);
  const [host, setHost] = useState<HostId>("vercel");
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!open || !profile) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the choice starts at the recommendation each time the window opens
    setHost(recommended(profile));
    setAdded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !profile) return null;
  // A project made in Pivolar is built and given its settings files when it is published.
  const native = !("/package.json" in files) && "/App.tsx" in files;
  const generated = native ? {} : missingHostFiles(host, slugify(projectName), { files, classification: profile.classification });
  const paths = Object.keys(generated);
  const info = hostById(host);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="hosting-title">
      <div className="card flex max-h-[88vh] w-full max-w-xl flex-col rounded-2xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="hosting-title" className="text-[17px] font-semibold">
              Hosting
            </h2>
            <p className="mt-1 text-[13px] text-muted">Pivolar leser prosjektet og finner den billigste verten som passer, med faste regler.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Lukk" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-auto">
          <HostingPicker files={files} value={host} onChange={(next) => { setHost(next); setAdded(false); }} disabled={false} />

          {native ? (
            <p className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] text-muted">Dette er et prosjekt laget i Pivolar. Innstillingsfilene for {info.name} legges til av seg selv når du trykker Publiser.</p>
          ) : paths.length > 0 ? (
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-[13px] font-medium">Filer for {info.name}</p>
              <ul className="mt-1.5 space-y-0.5 font-mono text-[12px] text-muted">
                {paths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-faint">Filer prosjektet allerede har, blir ikke overskrevet. Les HOSTING.md for stegene etterpå (der den er med).</p>
              <button
                type="button"
                disabled={added}
                onClick={() => {
                  onAddFiles(Object.fromEntries(paths.map((path) => [`/${path}`, generated[path]!])));
                  setAdded(true);
                }}
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] transition enabled:hover:border-line-strong disabled:opacity-60"
              >
                <FilePlus2 className="size-3.5" />
                {added ? "Lagt til i prosjektet" : "Legg filene til i prosjektet"}
              </button>
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] text-muted">Prosjektet har allerede alle filene {info.name} trenger, eller trenger ingen.</p>
          )}
        </div>
      </div>
    </div>
  );
}
