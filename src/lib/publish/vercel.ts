import type { PublishFile } from "@/lib/publish/github";

const API = "https://api.vercel.com";

type Options = {
  token: string;
  /** Team that owns the project. Omit for a personal account. */
  teamId?: string | undefined;
  /** Project name. The same name updates the same project, a new name creates one. */
  name: string;
  files: Record<string, PublishFile>;
  /** Environment variables the deployed site's server functions read (API keys from connectors). */
  env?: Record<string, string> | undefined;
  onStatus?: (state: string) => void;
};

export type VercelResult = { url: string; deploymentUrl: string; inspectorUrl: string | undefined; readyState: string };

class VercelError extends Error {}

const query = (teamId?: string) => (teamId ? `?teamId=${encodeURIComponent(teamId)}` : "");

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

function explain(status: number, data: unknown): string {
  const error = (data as { error?: { message?: string; code?: string } })?.error;
  const message = error?.message ?? "";
  if (status === 401 || status === 403) {
    return `Vercel avviste nøkkelen (VERCEL_TOKEN) eller teamet (VERCEL_TEAM_ID). ${message}`.trim();
  }
  if (status === 402) return "Vercel krever betaling eller en høyere plan for dette. " + message;
  if (status === 429) return "For mange forespørsler til Vercel. Prøv igjen om litt.";
  return `Vercel svarte ${status}. ${message}`.trim();
}

/**
 * Uploads the project files straight to Vercel (no Git integration needed) as a production
 * deployment and waits until it is live or has failed.
 */
export async function deployToVercel({ token, teamId, name, files, env, onStatus }: Options): Promise<VercelResult> {
  const created = await call<{
    id?: string;
    url?: string;
    inspectorUrl?: string;
    readyState?: string;
    alias?: string[];
  }>(token, `/v13/deployments${query(teamId)}${teamId ? "&" : "?"}skipAutoDetectionConfirmation=1`, {
    method: "POST",
    body: JSON.stringify({
      name,
      target: "production",
      files: Object.entries(files).map(([file, content]) => ({
        file,
        data: typeof content === "string" ? Buffer.from(content, "utf8").toString("base64") : content.base64,
        encoding: "base64",
      })),
      projectSettings: { framework: "vite" },
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    }),
  });
  if (created.status !== 200 || !created.data.id) throw new VercelError(explain(created.status, created.data));

  const id = created.data.id;
  let state = created.data.readyState ?? "QUEUED";
  let deploymentUrl = created.data.url ?? "";
  let inspectorUrl = created.data.inspectorUrl;
  let aliases = created.data.alias ?? [];
  onStatus?.(state);

  // Builds usually take 20-60 seconds. Give up after about four minutes.
  for (let attempt = 0; attempt < 80 && state !== "READY" && state !== "ERROR" && state !== "CANCELED"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const poll = await call<{ readyState?: string; url?: string; inspectorUrl?: string; alias?: string[] }>(
      token,
      `/v13/deployments/${id}${query(teamId)}`,
    );
    if (poll.status !== 200) throw new VercelError(explain(poll.status, poll.data));
    if (poll.data.readyState && poll.data.readyState !== state) {
      state = poll.data.readyState;
      onStatus?.(state);
    }
    deploymentUrl = poll.data.url ?? deploymentUrl;
    inspectorUrl = poll.data.inspectorUrl ?? inspectorUrl;
    aliases = poll.data.alias ?? aliases;
  }

  if (state === "ERROR" || state === "CANCELED") {
    throw new VercelError(`Byggingen på Vercel feilet. Se loggen: ${inspectorUrl ?? "vercel.com"}`);
  }
  if (state !== "READY") throw new VercelError("Byggingen på Vercel tok for lang tid. Sjekk status på vercel.com.");

  const url = aliases.find((alias) => alias.endsWith(".vercel.app") && !alias.includes("-git-")) ?? deploymentUrl;
  return { url: url.startsWith("http") ? url : `https://${url}`, deploymentUrl: `https://${deploymentUrl}`, inspectorUrl, readyState: state };
}
