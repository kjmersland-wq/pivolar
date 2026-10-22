"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { deleteProject, useProjects } from "@/lib/projects";

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

export function ProjectGrid() {
  const projects = useProjects();
  if (projects.length === 0) return null;
  return (
    <section className="mx-auto mt-20 w-full max-w-5xl px-4 pb-24">
      <h2 className="mb-4 text-[13px] font-medium uppercase tracking-wider text-faint">Dine prosjekter</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project, index) => (
          <div key={project.id} className="group card relative overflow-hidden rounded-2xl transition hover:-translate-y-0.5 hover:border-line-strong">
            <Link href={`/p/${project.id}`} className="block">
              <div className={`h-28 bg-gradient-to-br ${TINTS[index % TINTS.length]}`} />
              <div className="p-4">
                <p className="truncate text-[14.5px] font-medium">{project.name}</p>
                <p className="mt-0.5 text-[12.5px] text-faint">{ago(project.updatedAt)}</p>
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
