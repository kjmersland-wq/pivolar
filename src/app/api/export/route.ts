import { PROTECTED_PATHS, type FileMap } from "@/lib/files";
import { buildDeployableProject } from "@/lib/publish/project";
import { buildExport, slug } from "@/lib/zip/export";

const MAX_BYTES = 6_000_000;

type Body = {
  name?: string;
  files?: FileMap;
  /** "source": the files as they are. "vite": a ready Vite project made from a Pivolar app. */
  mode?: "source" | "vite";
  notes?: { skippedBinaries?: string[]; omittedSecrets?: string[] };
  /** Returns the report only, so the dialog can show it before anything is downloaded. */
  dryRun?: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const name = (body.name ?? "").trim().slice(0, 80) || "pivolar-prosjekt";
  const mode = body.mode === "vite" ? "vite" : "source";
  const given = Object.entries(body.files ?? {}).filter(([path, content]) => typeof content === "string" && !PROTECTED_PATHS.has(path));
  if (given.length === 0) return Response.json({ error: "Prosjektet har ingen filer å eksportere." }, { status: 400 });
  if (given.reduce((sum, [, content]) => sum + content.length, 0) > MAX_BYTES) return Response.json({ error: "Prosjektet er for stort til å eksportere her." }, { status: 413 });

  let files: FileMap = Object.fromEntries(given);
  if (mode === "vite") {
    try {
      files = Object.fromEntries(Object.entries(buildDeployableProject(files, name)).map(([path, content]) => [`/${path}`, content]));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Kunne ikke lage Vite-prosjekt." }, { status: 400 });
    }
  }

  const list = (value: string[] | undefined) => (value ?? []).filter((p) => typeof p === "string").slice(0, 500);
  const notes = { skippedBinaries: list(body.notes?.skippedBinaries), omittedSecrets: list(body.notes?.omittedSecrets) };
  const { zip, manifest, report } = buildExport({ name, files, mode, notes });
  if (body.dryRun) return Response.json({ manifest, report });

  return new Response(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug(name)}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
