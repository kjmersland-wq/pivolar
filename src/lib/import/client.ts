import { importProject } from "@/lib/projects";
import { buildSiteProject, type SiteProject } from "./site-project";
import type { Design } from "./design";
import type { SiteModel } from "./model";

/** Calls to the import route from the browser, and the step that turns a finished import into a project. */

export type Probe = { cms: string; rest: boolean; name: string; description: string; language: string | null; counts: { pages: number | null; posts: number | null; media: number | null }; notes: string[] };
export type Summary = { name: string; pages: number; posts: number; media: number; unknownBlocks: number; plugins: { name: string; pages: number }[]; warnings: string[]; truncated: boolean };
export type Step = { stored: number; failed: number; remaining: number; total: number; status: "fetched" | "images_done" };

async function call<T>(body: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/import/cms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Fikk ikke kontakt med serveren.");
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? (response.status === 429 ? "For mange forespørsler. Vent litt og prøv igjen." : "Importen feilet."));
  return data;
}

export const probeSite = (url: string) => call<{ probe: Probe }>({ action: "probe", url, confirmOwner: true }).then((r) => r.probe);
export const fetchSite = (url: string) => call<{ job: string; summary: Summary }>({ action: "fetch", url, confirmOwner: true });
export const nextImages = (job: string) => call<Step>({ action: "images", job });

/** Asks the AI for a design brief for a finished job. The server checks the limits and saves the brief with the job. */
export async function designSite(job: string): Promise<Design> {
  let response: Response;
  try {
    response = await fetch("/api/import/design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job }) });
  } catch {
    throw new Error("Fikk ikke kontakt med serveren.");
  }
  const data = (await response.json().catch(() => ({}))) as { design?: Design; error?: string };
  if (!response.ok || !data.design) throw new Error(data.error ?? (response.status === 429 ? "For mange forespørsler. Vent litt og prøv igjen." : "Fikk ikke noe forslag."));
  return data.design;
}

/** Reads the finished job and saves it as a project in the browser, with the pictures pointing at storage. */
export async function createProjectFromJob(job: string, url: string): Promise<{ ok: true; id: string; report: SiteProject["report"] } | { ok: false; error: string }> {
  try {
    const loaded = await call<{ model: SiteModel; assets: { file: string; url: string }[] }>({ action: "get", job });
    const urls = new Map(loaded.assets.map((a) => [a.file, a.url]));
    const built = buildSiteProject(loaded.model, (file) => urls.get(file) ?? null);
    const saved = importProject(
      loaded.model.name || "Importert nettsted",
      built.files,
      { source: "cms", fileName: url, at: Date.now(), skippedBinaries: [], omittedSecrets: [], cms: { url, job, pages: built.report.routes, images: built.report.images } },
      "WordPress (importert)",
    );
    return saved.ok ? { ok: true, id: saved.project.id, report: built.report } : { ok: false, error: saved.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Importen feilet." };
  }
}
