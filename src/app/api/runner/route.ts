import { Sandbox } from "@vercel/sandbox";
import { limit } from "@/lib/quota/server";
import { z } from "zod";
import { diffImport } from "@/lib/github/changes";
import { downloadBranch, GitHubImportError } from "@/lib/github/repo";
import { archiveFiles } from "@/lib/runner/archive";
import { parseEnv, PORT, projectFiles, startProject, syncProject, type RunEvent } from "@/lib/runner/run";

export const maxDuration = 300;

const Id = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const Files = z.record(z.string().max(300), z.string().max(1_000_000)).refine((files) => Object.keys(files).length <= 2000, "For mange filer.");

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    id: Id,
    files: Files,
    env: z.string().max(20_000).optional(),
    /** Where the project was imported from, so images and data files that are not in Pivolar can be included. */
    github: z.object({ owner: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), repo: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), sha: z.string().length(40) }).optional(),
  }),
  z.object({ action: z.literal("sync"), id: Id, files: Files, previous: Files }),
  z.object({ action: z.literal("stop"), id: Id }),
]);

const nameFor = (id: string) => `pivolar-${id}`;
/** Long enough to work in; extended every time files are sent. */
const TIMEOUT = 30 * 60_000;

/** Whether running projects is possible here: Vercel Sandbox needs a Vercel login or token. */
export async function GET() {
  return Response.json({ available: Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL || process.env.VERCEL_TOKEN) });
}

/**
 * Runs an imported project in a Vercel Sandbox and streams progress as it installs and starts.
 * The project runs in its own throwaway VM, never in Pivolar's server.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ugyldig forespørsel." }, { status: 400 });
  const body = parsed.data;

  try {
    if (body.action === "stop") {
      const sandbox = await Sandbox.get({ name: nameFor(body.id), resume: false }).catch(() => null);
      await sandbox?.stop().catch(() => {});
      return Response.json({ ok: true });
    }

    if (body.action === "sync") {
      const sandbox = await Sandbox.get({ name: nameFor(body.id), resume: false }).catch(() => null);
      if (!sandbox) return Response.json({ running: false });
      const { write, remove } = diffImport(projectFiles(body.previous), projectFiles(body.files));
      await syncProject(sandbox, write, remove);
      await sandbox.extendTimeout(10 * 60_000).catch(() => {});
      return Response.json({ running: true, written: Object.keys(write).length, removed: remove.length });
    }

    // Starting a run is what costs money (a throwaway VM). Stopping and syncing are not counted.
    const stopped = await limit("runner");
    if (stopped) return stopped;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: RunEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          // A named sandbox that is still running is reused, so reopening the preview does not start over.
          const sandbox = await Sandbox.getOrCreate({
            name: nameFor(body.id),
            ports: [PORT],
            timeout: TIMEOUT,
            persistent: false,
            resources: { vcpus: 2 },
          });
          // The repository itself is fetched here and copied in, so no GitHub credential ever enters the sandbox.
          let base: Record<string, Buffer> = {};
          if (body.github) {
            const { zip } = await downloadBranch({ owner: body.github.owner, repo: body.github.repo, branch: body.github.sha }, process.env.GITHUB_TOKEN || undefined);
            base = archiveFiles(zip);
          }
          for await (const event of startProject(sandbox, body.files, parseEnv(body.env ?? ""), undefined, base)) send(event);
        } catch (error) {
          send({ step: "error", message: error instanceof GitHubImportError || error instanceof Error ? error.message : "Kunne ikke starte forhåndsvisningen." });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Noe gikk galt." }, { status: 500 });
  }
}
