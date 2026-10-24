import { extname } from "node:path";
import { blake3 } from "@noble/hashes/blake3.js";
import { contentTypeOf, type DistFiles } from "./files.ts";

/**
 * Puts a finished site on Cloudflare Pages with their direct-upload API, the same one Wrangler uses:
 * a project is created (or found by name), every file is named by a hash of its content, only the
 * files Cloudflare does not have are uploaded, and a deployment is made from the list of files.
 * The token is the owner's own (CLOUDFLARE_API_TOKEN) and is only ever sent to api.cloudflare.com.
 */

const API = "https://api.cloudflare.com/client/v4";
type Fetcher = typeof fetch;
export type CloudflareResult = { project: string; url: string; deploymentUrl: string; created: boolean };

class CloudflareError extends Error {}

type Envelope<T> = { success?: boolean; errors?: { code?: number; message?: string }[]; result?: T };

function explain(status: number, body: Envelope<unknown>): string {
  const first = body.errors?.[0];
  const detail = first?.message ? ` ${first.message}` : "";
  if (status === 401 || status === 403 || first?.code === 10000) return `Cloudflare avviste nøkkelen (CLOUDFLARE_API_TOKEN). Den trenger tillatelsen «Cloudflare Pages: Edit» for kontoen.${detail}`;
  if (status === 429) return "Cloudflare sier det er for mange forespørsler akkurat nå. Vent litt og prøv igjen.";
  return `Cloudflare svarte ${status}.${detail}`;
}

async function call<T>(fetcher: Fetcher, token: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(url.startsWith("http") ? url : `${API}${url}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  const body = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || body.success === false) throw Object.assign(new CloudflareError(explain(response.status, body)), { status: response.status });
  return body.result as T;
}

const json = { "Content-Type": "application/json" };

/** The name Cloudflare gives a file: the first 32 characters of the BLAKE3 hash of its base64 text followed by its extension. */
export function pagesHash(content: Buffer, path: string): string {
  const extension = extname(path.split("/").pop() ?? "").slice(1);
  return Buffer.from(blake3(new TextEncoder().encode(content.toString("base64") + extension))).toString("hex").slice(0, 32);
}

type Project = { name: string; subdomain?: string };

export async function cloudflareEnsureProject(token: string, accountId: string, name: string, fetcher: Fetcher = fetch): Promise<{ project: Project; created: boolean }> {
  const base = `/accounts/${encodeURIComponent(accountId)}/pages/projects`;
  try {
    return { project: await call<Project>(fetcher, token, `${base}/${encodeURIComponent(name)}`), created: false };
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
  }
  const project = await call<Project>(fetcher, token, base, { method: "POST", headers: json, body: JSON.stringify({ name, production_branch: "main" }) });
  return { project, created: true };
}

/** Meta files Cloudflare reads from the site's root. They are sent as their own parts, not as files of the site. */
const META = new Set(["/_headers", "/_redirects", "/_routes.json"]);

export async function cloudflareDeploy(token: string, accountId: string, project: string, input: DistFiles, fetcher: Fetcher = fetch, options: { onStatus?: (text: string) => void } = {}): Promise<{ url: string }> {
  const files = new Map(input);
  if (!files.has("/_redirects")) files.set("/_redirects", Buffer.from("/*  /index.html  200\n"));
  if (!files.has("/_headers")) files.set("/_headers", Buffer.from("/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n"));

  const { jwt } = await call<{ jwt: string }>(fetcher, token, `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project)}/upload-token`);

  const site = [...files].filter(([path]) => !META.has(path));
  const manifest: Record<string, string> = {};
  const byHash = new Map<string, { path: string; content: Buffer }>();
  for (const [path, content] of site) {
    const hash = pagesHash(content, path);
    manifest[path] = hash;
    byHash.set(hash, { path, content });
  }

  const missing = await call<string[]>(fetcher, jwt, "/pages/assets/check-missing", { method: "POST", headers: json, body: JSON.stringify({ hashes: [...byHash.keys()] }) });
  const need = [...new Set(missing)].flatMap((hash) => (byHash.has(hash) ? [byHash.get(hash)!] : []).map((file) => ({ hash, ...file })));
  options.onStatus?.(`Laster opp ${need.length} av ${site.length} filer …`);

  // Uploaded in batches, so one request never gets huge.
  const batches: (typeof need)[] = [];
  let current: typeof need = [];
  let bytes = 0;
  for (const file of need) {
    if (current.length && (current.length >= 50 || bytes + file.content.byteLength > 12 * 1024 * 1024)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.content.byteLength;
  }
  if (current.length) batches.push(current);
  for (const batch of batches) {
    await call(fetcher, jwt, "/pages/assets/upload", {
      method: "POST",
      headers: json,
      body: JSON.stringify(batch.map((file) => ({ key: file.hash, value: file.content.toString("base64"), metadata: { contentType: contentTypeOf(file.path) }, base64: true }))),
    });
  }
  await call(fetcher, jwt, "/pages/assets/upsert-hashes", { method: "POST", headers: json, body: JSON.stringify({ hashes: [...byHash.keys()] }) });

  options.onStatus?.("Cloudflare legger ut siden …");
  const form = new FormData();
  form.append("manifest", JSON.stringify(manifest));
  form.append("branch", "main");
  form.append("commit_message", "Publisert fra Pivolar");
  for (const path of META) {
    const content = files.get(path);
    if (content) form.append(path.slice(1), new File([new Uint8Array(content)], path.slice(1)));
  }
  const deployment = await call<{ url?: string }>(fetcher, token, `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(project)}/deployments`, { method: "POST", body: form });
  return { url: deployment.url ?? "" };
}

export async function deployToCloudflare(token: string, accountId: string, name: string, files: DistFiles, fetcher: Fetcher = fetch, options: { onStatus?: (text: string) => void } = {}): Promise<CloudflareResult> {
  const { project, created } = await cloudflareEnsureProject(token, accountId, name, fetcher);
  const deployed = await cloudflareDeploy(token, accountId, project.name, files, fetcher, options);
  return { project: project.name, url: `https://${project.subdomain ?? `${project.name}.pages.dev`}`, deploymentUrl: deployed.url, created };
}
