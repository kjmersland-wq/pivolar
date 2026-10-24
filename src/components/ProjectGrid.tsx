"use client";

import { useState } from "react";
import Link from "next/link";
import { CloudUpload, Loader2, Trash2 } from "lucide-react";
import { deleteProject, isAccountId, useProjects } from "@/lib/projects";
import { migrateLegacy, type MigrateResult } from "@/lib/sync";
import { useThumb } from "@/lib/thumbs";

/** Older projects only exist in this browser. Moving them to the account is always the user's own step. */
function MoveToAccount({ count }: { count: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MigrateResult | null>(null);
  async function run() {
    setBusy(true);
    setResult(await migrateLegacy());
    setBusy(false);
  }
  return (
    <div className="card mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
      <div className="min-w-0 text-[13.5px]">
        <p className="font-medium">
          {count === 1 ? "1 prosjekt ligger bare i denne nettleseren" : `${count} prosjekter ligger bare i denne nettleseren`}
        </p>
        <p className="mt-0.5 text-muted">Flytt dem til kontoen din, så er de trygge og kan åpnes fra alle enheter.</p>
        {result?.failed.map((f) => (
          <p key={f.name} className="mt-1 text-red-400">
            «{f.name}»: {f.reason}
          </p>
        ))}
      </div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="bg-brand flex items-center gap-2 rounded-xl px-4 py-2 text-[13.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
        Flytt til konto
      </button>
    </div>
  );
}

function ago(time: number) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "akkurat nå";
  if (minutes < 60) return `${minutes} min siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} t siden`;
  return `${Math.round(hours / 24)} d siden`;
}

const TINTS = [
  "from-amber-500/25 to-rose-500/25",
  "from-rose-500/25 to-violet-500/25",
  "from-violet-500/25 to-sky-500/25",
  "from-emerald-500/25 to-sky-500/25",
];

/** The top of the project's opening screen, or a colour until the preview has drawn one. */
function Thumb({ id, tint }: { id: string; tint: string }) {
  const url = useThumb(id);
  // eslint-disable-next-line @next/next/no-img-element -- a small local picture as a data address, not something to optimise
  return url ? <img src={url} alt="" className="aspect-[16/10] w-full object-cover object-top" /> : <div className={`aspect-[16/10] w-full bg-gradient-to-br ${tint}`} />;
}

export function ProjectGrid() {
  const projects = useProjects();
  if (projects.length === 0) return null;
  const legacy = projects.filter((p) => !isAccountId(p.id)).length;
  return (
    <section className="mx-auto mt-20 w-full max-w-5xl px-4 pb-24">
      {legacy > 0 && <MoveToAccount count={legacy} />}
      <h2 className="mb-4 text-[13px] font-medium uppercase tracking-wider text-faint">Dine prosjekter</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project, index) => (
          <div key={project.id} className="group card relative overflow-hidden rounded-2xl transition hover:-translate-y-0.5 hover:border-line-strong">
            <Link href={`/p/${project.id}`} className="block">
              <Thumb id={project.id} tint={TINTS[index % TINTS.length]!} />
              <div className="p-4">
                <p className="truncate text-[14.5px] font-medium">{project.name}</p>
                <p className="mt-0.5 flex items-center gap-2 text-[12.5px] text-faint">
                  {ago(project.updatedAt)}
                  {project.framework && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{project.framework}</span>}
                </p>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Slette «${project.name}»?`)) deleteProject(project.id);
              }}
              className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-lg bg-bg/70 text-muted opacity-0 backdrop-blur transition hover:text-red-400 group-hover:opacity-100"
              aria-label="Slett prosjekt"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
