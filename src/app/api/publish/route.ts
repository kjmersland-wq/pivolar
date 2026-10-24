import { pickEnv } from "@/lib/connectors";
import { PROTECTED_PATHS, type FileMap } from "@/lib/files";
import { readBrand } from "@/lib/publish/brand";
import { publishToGitHub, type PublishFile } from "@/lib/publish/github";
import { renderIcon, renderOgImage } from "@/lib/publish/og";
import { bundleStorageImages } from "@/lib/publish/storage-images";
import { buildDeployableProject, slugify } from "@/lib/publish/project";
import { deployToVercel } from "@/lib/publish/vercel";

export const maxDuration = 300;

/** Which parts of publishing are set up. Only names and yes/no, never the secrets themselves. */
export async function GET() {
  return Response.json({
    github: Boolean(process.env.GITHUB_TOKEN),
    vercel: Boolean(process.env.VERCEL_TOKEN),
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
  /** The Pivolar project id. When set, the site counts page views (without cookies) and reports them to Pivolar. */
  analyticsProject?: string;
  /** Builds the project and reports what it would do, without touching GitHub or Vercel. */
  dryRun?: boolean;
};

type Event =
  | { step: "project"; status: "done"; files: number }
  | { step: "github"; status: "running" | "done" | "error" | "skipped"; url?: string; commitUrl?: string; created?: boolean; message?: string }
  | { step: "vercel"; status: "running" | "done" | "error" | "skipped"; state?: string; url?: string; inspectorUrl?: string; message?: string }
  | { step: "finished"; ok: boolean };

/**
 * Publishes the current project: a Vite project is generated from the files, pushed to GitHub in
 * one commit and deployed to Vercel. Progress is streamed as one JSON object per line.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const files = Object.fromEntries(Object.entries(body.files ?? {}).filter(([path]) => !PROTECTED_PATHS.has(path)));
  const title = (body.name ?? "").trim() || "Pivolar-app";
  const slug = slugify(title);
  const wantGitHub = body.targets?.github !== false;
  const wantVercel = body.targets?.vercel !== false;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: Event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let ok = true;

      try {
        if (Object.keys(files).length === 0) throw new Error("Prosjektet har ingen filer å publisere.");
        // Pictures generated in Pivolar are copied into the project, so the site does not depend on Pivolar's storage.
        const bundled = await bundleStorageImages(files, process.env.NEXT_PUBLIC_SUPABASE_URL);
        const project: Record<string, PublishFile> = { ...buildDeployableProject(bundled.files, title, { icons: true, ...(body.analyticsProject ? { analytics: { origin: new URL(request.url).origin, projectId: body.analyticsProject } } : {}) }), ...bundled.images };
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
                env: pickEnv(body.env),
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
