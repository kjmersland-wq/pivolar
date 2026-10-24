import { createHash } from "node:crypto";
import { withHostRules, type DistFiles } from "./files.ts";

/**
 * Puts a finished site on Netlify with their file-digest deploy: the site is created (or found by name),
 * Netlify is told the SHA-1 of every file, and only the files it does not already have are uploaded.
 * The token is the owner's own (NETLIFY_TOKEN) and is only ever sent to api.netlify.com.
 */

const API = "https://api.netlify.com/api/v1";

type Fetcher = typeof fetch;
export type NetlifyResult = { siteId: string; deployId: string; url: string; created: boolean };

class NetlifyError extends Error {}

function explain(status: number, body: unknown): string {
  const message = (body as { message?: string; errors?: unknown })?.message ?? "";
  if (status === 401) return "Netlify avviste nøkkelen (NETLIFY_TOKEN). Lag en ny under User settings → Applications → Personal access tokens.";
  if (status === 403) return `Netlify nektet tilgang. ${message}`.trim();
  if (status === 422) return `Netlify avviste forespørselen: ${message || "ugyldige data"}`;
  if (status === 429) return "Netlify sier det er for mange forespørsler akkurat nå. Vent litt og prøv igjen.";
  return `Netlify svarte ${status}${message ? `: ${message}` : ""}.`;
}

async function call<T>(fetcher: Fetcher, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers } });
  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) throw Object.assign(new NetlifyError(explain(response.status, body)), { status: response.status });
  return body as T;
}

type Site = { id: string; name: string; ssl_url?: string; url?: string };

/** The site called `name` on the owner's account, or a new one. A name that is taken by someone else gets a short suffix. */
export async function netlifyEnsureSite(token: string, name: string, fetcher: Fetcher = fetch, suffix: () => string = () => Math.random().toString(36).slice(2, 6)): Promise<{ site: Site; created: boolean }> {
  const found = await call<Site[]>(fetcher, token, `/sites?name=${encodeURIComponent(name)}&filter=all&per_page=100`).catch(() => [] as Site[]);
  const own = Array.isArray(found) ? found.find((s) => s.name === name) : undefined;
  if (own) return { site: own, created: false };
  for (const candidate of [name, `${name}-${suffix()}`, `${name}-${suffix()}`]) {
    try {
      return { site: await call<Site>(fetcher, token, "/sites", { method: "POST", body: JSON.stringify({ name: candidate }) }), created: true };
    } catch (error) {
      // 422 means the name is taken by another account: try the next one. Anything else stops here.
      if ((error as { status?: number }).status !== 422) throw error;
    }
  }
  throw new NetlifyError("Fant ikke et ledig navn hos Netlify. Velg et annet navn på nettstedet.");
}

const sha1 = (content: Buffer) => createHash("sha1").update(content).digest("hex");

/** Uploads the site and waits until Netlify has it live. */
export async function netlifyDeploy(token: string, siteId: string, input: DistFiles, fetcher: Fetcher = fetch, options: { onStatus?: (text: string) => void; pollMs?: number; timeoutMs?: number } = {}): Promise<{ deployId: string; url: string }> {
  const files = withHostRules(input);
  const digests: Record<string, string> = {};
  const byHash = new Map<string, string[]>();
  for (const [path, content] of files) {
    const hash = sha1(content);
    digests[path] = hash;
    byHash.set(hash, [...(byHash.get(hash) ?? []), path]);
  }
  const deploy = await call<{ id: string; required?: string[]; state?: string }>(fetcher, token, `/sites/${siteId}/deploys`, { method: "POST", body: JSON.stringify({ files: digests }) });

  // Only what Netlify does not already have is sent, a few files at a time.
  const needed = [...new Set(deploy.required ?? [])];
  options.onStatus?.(`Laster opp ${needed.length} av ${files.size} filer …`);
  const queue = needed.flatMap((hash) => {
    const paths = byHash.get(hash);
    return paths?.[0] ? [{ hash, path: paths[0] }] : [];
  });
  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const response = await fetcher(`${API}/deploys/${deploy.id}/files${item.path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(files.get(item.path)!),
      });
      if (!response.ok) throw new NetlifyError(explain(response.status, await response.json().catch(() => ({}))));
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  // Netlify makes the deploy live when every file is there. Wait for that.
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  for (;;) {
    const state = await call<{ state?: string; error_message?: string; ssl_url?: string; url?: string }>(fetcher, token, `/deploys/${deploy.id}`);
    if (state.state === "ready") return { deployId: deploy.id, url: state.ssl_url ?? state.url ?? "" };
    if (state.state === "error") throw new NetlifyError(`Netlify kunne ikke legge ut siden${state.error_message ? `: ${state.error_message}` : "."}`);
    if (Date.now() > deadline) throw new NetlifyError("Netlify brukte for lang tid på å legge ut siden. Se Deploys i Netlify for status.");
    options.onStatus?.("Netlify legger ut siden …");
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 2_000));
  }
}

export async function deployToNetlify(token: string, name: string, files: DistFiles, fetcher: Fetcher = fetch, options: { onStatus?: (text: string) => void; pollMs?: number } = {}): Promise<NetlifyResult> {
  const { site, created } = await netlifyEnsureSite(token, name, fetcher);
  const result = await netlifyDeploy(token, site.id, files, fetcher, options);
  return { siteId: site.id, deployId: result.deployId, url: result.url || site.ssl_url || site.url || "", created };
}
