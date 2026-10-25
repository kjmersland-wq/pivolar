import { buildDist, type BuildOptions, type BuildSandbox, type ProjectFile } from "./build.ts";
import { checkDist, type DistFiles } from "./files.ts";
import { cloudflareDeploy, cloudflareEnsureProject } from "./cloudflare.ts";
import { netlifyDeploy, netlifyEnsureSite } from "./netlify.ts";

/**
 * The automatic roll-out to Netlify or Cloudflare Pages, start to end: make sure the site exists (so its
 * address is known), build the project in an isolated machine, and upload the finished files. Progress
 * is reported as short sentences. The owner's token never goes into the machine that builds.
 */

export type AutoHost = "netlify" | "cloudflare";
export type Opened = { sandbox: BuildSandbox; stop(): Promise<void> };

/** Which hosts can be rolled out from here, from the keys that are set. Only names, never values. */
export function autoHosts(env: Record<string, string | undefined> = process.env): Record<AutoHost, boolean> {
  return { netlify: Boolean(env.NETLIFY_TOKEN?.trim()), cloudflare: Boolean(env.CLOUDFLARE_API_TOKEN?.trim() && env.CLOUDFLARE_ACCOUNT_ID?.trim()) };
}

export const isAutoHost = (host: string): host is AutoHost => host === "netlify" || host === "cloudflare";

export type AutoOptions = {
  host: AutoHost;
  name: string;
  project: Record<string, ProjectFile>;
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  open: () => Promise<Opened>;
  onStatus?: (text: string) => void;
  /** Extra build settings, for imported projects. */
  build?: Pick<BuildOptions, "env" | "outDir" | "remove" | "legacyPeerDeps">;
};

export async function deployAuto(options: AutoOptions): Promise<{ url: string; created: boolean }> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const status = options.onStatus ?? (() => {});
  const names = { netlify: "Netlify", cloudflare: "Cloudflare" } as const;
  const where = names[options.host];

  // The site first, so the address it will have is known when the site is built (canonical addresses and sitemap).
  status(`Gjør klart hos ${where} …`);
  let siteUrl = "";
  let ensured: { created: boolean };
  let upload: (files: DistFiles) => Promise<string>;
  if (options.host === "netlify") {
    const token = env.NETLIFY_TOKEN?.trim();
    if (!token) throw new Error("NETLIFY_TOKEN mangler i miljøvariablene.");
    const { site, created } = await netlifyEnsureSite(token, options.name, fetcher);
    siteUrl = site.ssl_url ?? site.url ?? "";
    ensured = { created };
    upload = async (files) => (await netlifyDeploy(token, site.id, files, fetcher, { onStatus: status })).url || siteUrl;
  } else {
    const token = env.CLOUDFLARE_API_TOKEN?.trim();
    const account = env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN og CLOUDFLARE_ACCOUNT_ID må være satt i miljøvariablene.");
    const { project, created } = await cloudflareEnsureProject(token, account, options.name, fetcher);
    siteUrl = `https://${project.subdomain ?? `${project.name}.pages.dev`}`;
    ensured = { created };
    upload = async (files) => {
      await cloudflareDeploy(token, account, project.name, files, fetcher, { onStatus: status });
      return siteUrl;
    };
  }

  status("Bygger siden i en isolert maskin …");
  const machine = await options.open();
  let files: DistFiles;
  try {
    files = await buildDist(machine.sandbox, options.project, { ...options.build, siteUrl, onStep: (step) => status(step === "install" ? "Installerer pakker …" : step === "build" ? "Bygger siden …" : step === "read" ? "Henter de ferdige filene …" : "Sender filene til byggemaskinen …") });
  } finally {
    await machine.stop().catch(() => {});
  }
  checkDist(files);
  const url = await upload(files);
  return { url, created: ensured.created };
}
