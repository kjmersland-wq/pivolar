import { limit } from "@/lib/quota/server";
import { pickEnv } from "@/lib/connectors";
import { isHostId, type HostId } from "@/lib/hosting/catalog";
import { isUuid } from "@/lib/oauth/core";
import { googleEnvFor } from "@/lib/oauth/server";
import { createClient } from "@/lib/supabase/server";
import { PROTECTED_PATHS, type FileMap } from "@/lib/files";
import { readBrand } from "@/lib/publish/brand";
import { publishToGitHub, type PublishFile } from "@/lib/publish/github";
import { renderIcon, renderOgImage } from "@/lib/publish/og";
import { bundleStorageImages } from "@/lib/publish/storage-images";
import { buildDeployableProject, slugify } from "@/lib/publish/project";
import { deployToVercel } from "@/lib/publish/vercel";
import { autoHosts, deployAuto, isAutoHost, type Opened } from "@/lib/deploy/auto";
import type { BuildSandbox } from "@/lib/deploy/build";
import { buildEnvFrom, isImportedProject, planImported } from "@/lib/deploy/imported";
import { isPublicRepo } from "@/lib/github/repo";

export const maxDuration = 300;

/** Which parts of publishing are set up. Only names and yes/no, never the secrets themselves. */
export async function GET() {
  return Response.json({
    github: Boolean(process.env.GITHUB_TOKEN),
    vercel: Boolean(process.env.VERCEL_TOKEN),
    // Which hosts Pivolar can roll out to by itself. Only yes or no.
    ...autoHosts(),
  });
}

type Body = {
  /** Project title; becomes the repository and Vercel project name. */
  name?: string;
  files?: FileMap;
  isPrivate?: boolean;
  targets?: { github?: boolean; vercel?: boolean };
  /** Connector keys for the site's server functions. Only the names in ENV_NAMES are used; they go to Vercel, never to GitHub. */
  env?: Record<string, string>;
  /** Where the site goes (see HOSTS). Vercel when left out. */
  host?: string;
  /** Netlify and Cloudflare are rolled out from here when their keys are set. False keeps only the code on GitHub. */
  autoDeploy?: boolean;
  /** For an imported project: the repository it came from, which the build machine clones. */
  github?: { owner?: string; repo?: string; sha?: string };
  /** For an imported project: public build variables (VITE_…) given by the owner. */
  buildEnv?: Record<string, string>;
  /** The Pivolar project id, used to look up the Google sign-ins of the project. */
  projectId?: string;
  /** The Pivolar project id. When set, the site counts page views (without cookies) and reports them to Pivolar. */
  analyticsProject?: string;
  /** Builds the project and reports what it would do, without touching GitHub or Vercel. */
  dryRun?: boolean;
};

type Event =
  | { step: "project"; status: "done"; files: number }
  | { step: "github"; status: "running" | "done" | "error" | "skipped"; url?: string; commitUrl?: string; created?: boolean; message?: string }
  | { step: "vercel"; status: "running" | "done" | "error" | "skipped"; state?: string; url?: string; inspectorUrl?: string; message?: string }
  | { step: "host"; status: "running" | "done" | "error" | "skipped"; detail?: string; url?: string; message?: string; created?: boolean }
  | { step: "finished"; ok: boolean };

/**
 * Publishes the current project: a Vite project is generated from the files, pushed to GitHub in
 * one commit and deployed to Vercel. Progress is streamed as one JSON object per line.
 */
export async function POST(request: Request) {
  const stopped = await limit("publish");
  if (stopped) return stopped;
  const body = (await request.json().catch(() => ({}))) as Body;
  const files = Object.fromEntries(Object.entries(body.files ?? {}).filter(([path]) => !PROTECTED_PATHS.has(path)));
  const title = (body.name ?? "").trim() || "Pivolar-app";
  const slug = slugify(title);
  // The chosen host decides where the site goes: Vercel is deployed from here, the others get the code on GitHub plus their own settings file.
  const host: HostId = isHostId(body.host) ? body.host : "vercel";
  const wantGitHub = host !== "vercel" || body.targets?.github !== false;
  const wantVercel = host === "vercel" && body.targets?.vercel !== false;
  // Google tokens are read here, with the owner's session, and go to Vercel only when the project has a function that uses them.
  const usesGoogle = Object.keys(files).some((path) => path === "/api/contact.ts" || path === "/api/sheet.ts");
  const google = usesGoogle && isUuid(body.projectId) ? await googleEnvFor(await createClient(), body.projectId) : {};

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: Event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let ok = true;

      /** An imported project: cloned from its public repository in the build machine, with Pivolar's text files written over it. */
      async function publishImported() {
        const fail = (message: string) => {
          ok = false;
          send({ step: "host", status: "error", message });
        };
        send({ step: "github", status: "skipped", message: "Koden ligger allerede på GitHub." });
        send({ step: "vercel", status: "skipped" });
        if (host !== "cloudflare") return fail("Importerte prosjekter rulles bare ut til Cloudflare Pages.");
        if (!autoHosts()[host]) return fail("CLOUDFLARE_API_TOKEN og CLOUDFLARE_ACCOUNT_ID må være satt i miljøvariablene.");
        const plan = planImported(files);
        if (!plan.ok) return fail(plan.message);
        const repo = body.github;
        if (!repo?.owner || !repo.repo || !/^[A-Za-z0-9-]{1,39}$/.test(repo.owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo.repo) || (repo.sha && !/^[0-9a-f]{7,40}$/.test(repo.sha))) {
          return fail("Bare prosjekter importert fra GitHub kan rulles ut slik, for byggemaskinen henter repoet derfra.");
        }
        if (!(await isPublicRepo({ owner: repo.owner, repo: repo.repo }))) return fail("Repoet er privat. Byggemaskinen kan bare hente offentlige repoer. Gjør det offentlig mens du ruller ut, eller bruk Cloudflares egen kobling til GitHub.");
        const { env, rejected } = buildEnvFrom(body.buildEnv);
        if (rejected.length > 0) return fail(`Variablene ${rejected.join(", ")} ble ikke brukt. Bare VITE_-variabler uten hemmeligheter kan gis til byggingen, for de blir synlige for alle som besøker siden.`);
        send({ step: "project", status: "done", files: Object.keys(plan.project).length });
        if (body.dryRun) return send({ step: "host", status: "skipped", message: "Prøvekjøring" });
        send({ step: "host", status: "running", detail: "Gjør klart …" });
        try {
          const opened = async (): Promise<Opened> => {
            const { Sandbox } = await import("@vercel/sandbox");
            const sandbox = await Sandbox.create({
              timeout: 8 * 60_000,
              resources: { vcpus: 4 },
              source: { type: "git", url: `https://github.com/${repo.owner}/${repo.repo}.git`, ...(repo.sha ? { revision: repo.sha } : {}) },
            });
            return { sandbox: sandbox as unknown as BuildSandbox, stop: async () => void (await sandbox.stop()) };
          };
          const result = await deployAuto({
            host,
            name: slug,
            project: plan.project,
            open: opened,
            build: { env, outDir: plan.outDir, remove: plan.remove, legacyPeerDeps: true },
            onStatus: (detail) => send({ step: "host", status: "running", detail }),
          });
          send({ step: "host", status: "done", url: result.url, created: result.created });
        } catch (error) {
          fail(error instanceof Error ? error.message : "Utrullingen feilet.");
        }
      }

      try {
        if (Object.keys(files).length === 0) throw new Error("Prosjektet har ingen filer å publisere.");
        if (isImportedProject(files)) {
          await publishImported();
          return;
        }
        if (host !== "vercel" && Object.keys(files).some((path) => path.startsWith("/api/"))) {
          throw new Error("Serverfunksjonene under /api virker bare på Vercel. Velg Vercel, eller fjern koblingene som bruker dem.");
        }
        // Pictures generated in Pivolar are copied into the project, so the site does not depend on Pivolar's storage.
        const bundled = await bundleStorageImages(files, process.env.NEXT_PUBLIC_SUPABASE_URL);
        const project: Record<string, PublishFile> = { ...buildDeployableProject(bundled.files, title, { icons: true, host, ...(body.analyticsProject ? { analytics: { origin: new URL(request.url).origin, projectId: body.analyticsProject } } : {}) }), ...bundled.images };
        // The share image is drawn from /brand.json and the logo. Without them it uses the title and default colours.
        const og = await renderOgImage(readBrand(files, title));
        project["public/og.png"] = { base64: Buffer.from(og).toString("base64") };
        // Home-screen icons for the installable app (the manifest points at these).
        const brand = readBrand(files, title);
        for (const [name, size, maskable] of [["icon-192", 192, false], ["icon-512", 512, false], ["icon-maskable-512", 512, true]] as const) {
          project[`public/${name}.png`] = { base64: Buffer.from(await renderIcon(brand, size, maskable)).toString("base64") };
        }
        send({ step: "project", status: "done", files: Object.keys(project).length });

        if (body.dryRun) {
          send({ step: "github", status: "skipped", message: "Prøvekjøring" });
          send({ step: "vercel", status: "skipped", message: "Prøvekjøring" });
          return;
        }

        if (wantGitHub) {
          const token = process.env.GITHUB_TOKEN;
          if (!token) {
            ok = false;
            send({ step: "github", status: "error", message: "GITHUB_TOKEN mangler i miljøvariablene." });
          } else {
            send({ step: "github", status: "running" });
            try {
              const result = await publishToGitHub({
                token,
                owner: process.env.GITHUB_OWNER || undefined,
                repo: slug,
                files: project,
                message: "Publisert fra Pivolar",
                isPrivate: body.isPrivate !== false,
              });
              send({
                step: "github",
                status: "done",
                url: result.url,
                commitUrl: result.commitUrl,
                created: result.created,
                ...(result.workflowSkipped ? { message: "Kontroll-arbeidsflyten (CI) ble ikke lagt til: GITHUB_TOKEN trenger tillatelsen «Workflow» for det." } : {}),
              });
            } catch (error) {
              ok = false;
              send({ step: "github", status: "error", message: error instanceof Error ? error.message : "GitHub feilet." });
            }
          }
        } else {
          send({ step: "github", status: "skipped" });
        }

        if (wantVercel) {
          const token = process.env.VERCEL_TOKEN;
          if (!token) {
            ok = false;
            send({ step: "vercel", status: "error", message: "VERCEL_TOKEN mangler i miljøvariablene." });
          } else {
            send({ step: "vercel", status: "running", state: "QUEUED" });
            try {
              const result = await deployToVercel({
                token,
                teamId: process.env.VERCEL_TEAM_ID || undefined,
                name: slug,
                files: project,
                env: { ...pickEnv(body.env), ...google },
                onStatus: (state) => send({ step: "vercel", status: "running", state }),
              });
              send({ step: "vercel", status: "done", url: result.url, ...(result.inspectorUrl ? { inspectorUrl: result.inspectorUrl } : {}) });
            } catch (error) {
              ok = false;
              send({ step: "vercel", status: "error", message: error instanceof Error ? error.message : "Vercel feilet." });
            }
          }
        } else {
          send({ step: "vercel", status: "skipped" });
        }

        // Netlify and Cloudflare Pages: built in an isolated machine and uploaded with the owner's own key.
        if (isAutoHost(host) && body.autoDeploy !== false && autoHosts()[host]) {
          if (!wantGitHub || !ok) {
            // The code is on GitHub first. If that failed, nothing more is done, and the answer says so.
            send({ step: "host", status: "skipped", message: "Hoppet over fordi GitHub feilet." });
          } else {
            send({ step: "host", status: "running", detail: "Gjør klart …" });
            try {
              const opened = async (): Promise<Opened> => {
                const { Sandbox } = await import("@vercel/sandbox");
                const sandbox = await Sandbox.create({ timeout: 6 * 60_000, resources: { vcpus: 4 } });
                return { sandbox: sandbox as unknown as BuildSandbox, stop: async () => void (await sandbox.stop()) };
              };
              const result = await deployAuto({ host, name: slug, project, open: opened, onStatus: (detail) => send({ step: "host", status: "running", detail }) });
              send({ step: "host", status: "done", url: result.url, created: result.created });
            } catch (error) {
              ok = false;
              send({ step: "host", status: "error", message: error instanceof Error ? error.message : "Utrullingen feilet." });
            }
          }
        } else if (isAutoHost(host)) {
          send({ step: "host", status: "skipped" });
        }
      } catch (error) {
        ok = false;
        send({ step: "github", status: "error", message: error instanceof Error ? error.message : "Publisering feilet." });
      } finally {
        send({ step: "finished", ok });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
