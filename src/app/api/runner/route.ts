import { Sandbox } from "@vercel/sandbox";
import { quotaConfig } from "@/lib/quota/config";
import { DENIALS } from "@/lib/quota/decide";
import { limit, signedInUserId } from "@/lib/quota/server";
import { atConcurrentLimit, extensionFor, isPastLimit, ownerPrefix, sandboxName } from "@/lib/runner/limits";
import { z } from "zod";
import { diffImport } from "@/lib/github/changes";
import { downloadBranch, GitHubImportError, isPublicRepo } from "@/lib/github/repo";
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

/** Long enough to work in; extended when files are sent, but never past the longest a run may live. */
const TIMEOUT = 30 * 60_000;
/** How long a run is kept alive from the last time files were sent to it. */
const KEEP_ALIVE = 10 * 60_000;

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

  // A run belongs to the signed-in user: the name carries the user, so another user cannot reach it, even with the project id.
  const userId = await signedInUserId();
  if (!userId) return Response.json({ error: "Du må logge inn." }, { status: 401 });
  const nameFor = (id: string) => sandboxName(userId, id);
  const maxMs = quotaConfig().sandboxMaxMs;

  try {
    if (body.action === "stop") {
      const sandbox = await Sandbox.get({ name: nameFor(body.id), resume: false }).catch(() => null);
      await sandbox?.stop().catch(() => {});
      return Response.json({ ok: true });
    }

    if (body.action === "sync") {
      const sandbox = await Sandbox.get({ name: nameFor(body.id), resume: false }).catch(() => null);
      if (!sandbox) return Response.json({ running: false });
      // A run that has lived as long as it may is stopped, however often files are sent to it.
      const now = Date.now();
      const next = extensionFor({ now, createdAt: sandbox.createdAt.getTime(), expiresAt: sandbox.expiresAt ? sandbox.expiresAt.getTime() : null, maxMs, wantMs: KEEP_ALIVE });
      if (next.action === "stop") {
        await sandbox.stop().catch(() => {});
        return Response.json({ running: false, reason: "max-lifetime" });
      }
      const { write, remove } = diffImport(projectFiles(body.previous), projectFiles(body.files));
      await syncProject(sandbox, write, remove);
      if (next.action === "extend") await sandbox.extendTimeout(next.ms).catch(() => {});
      return Response.json({ running: true, written: Object.keys(write).length, removed: remove.length });
    }

    // Starting a run is what costs money (a throwaway VM). Stopping and syncing are not counted.
    const stopped = await limit("runner");
    if (stopped) return stopped;

    // Only a few runs at a time per user, however slowly they are started. If the list cannot be read, nothing is started.
    try {
      const listed = await (await Sandbox.list({ namePrefix: ownerPrefix(userId) })).toArray();
      if (atConcurrentLimit(listed, nameFor(body.id), quotaConfig().sandboxMaxConcurrent)) return Response.json({ error: DENIALS.concurrent.message }, { status: DENIALS.concurrent.status });
    } catch {
      return Response.json({ error: "Kunne ikke sjekke kjøringene dine akkurat nå. Prøv igjen om litt." }, { status: 503 });
    }

    // An old run that is still alive is not reused: it is stopped, and the new one gets a full lifetime of its own.
    const old = await Sandbox.get({ name: nameFor(body.id), resume: false }).catch(() => null);
    if (old && isPastLimit(old.createdAt.getTime(), Date.now(), maxMs)) await old.stop().catch(() => {});

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: RunEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        try {
          // A named sandbox that is still running is reused, so reopening the preview does not start over.
          // A public repository is cloned inside the machine, so its size does not matter here and no credential is needed.
          // A private one is fetched here and copied in, so no GitHub credential ever enters the sandbox.
          const publicRepo = body.github ? await isPublicRepo({ owner: body.github.owner, repo: body.github.repo }) : false;
          const sandbox = await Sandbox.getOrCreate({
            name: nameFor(body.id),
            ports: [PORT],
            timeout: TIMEOUT,
            persistent: false,
            resources: { vcpus: 2 },
            ...(publicRepo && body.github ? { source: { type: "git" as const, url: `https://github.com/${body.github.owner}/${body.github.repo}.git`, revision: body.github.sha } } : {}),
          });
          let base: Record<string, Buffer> = {};
          if (body.github && !publicRepo) {
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
