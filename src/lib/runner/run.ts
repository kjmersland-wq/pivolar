import { PROTECTED_PATHS, TEMPLATE, type FileMap } from "../files.ts";

/**
 * Runs an imported project for real in an isolated Vercel Sandbox (a throwaway Linux VM), so
 * frameworks the in-browser preview cannot run (TanStack Start, Next.js, anything that needs a
 * server) still show up. The project's own dev server runs there and the preview is its address.
 */

export const PORT = 3000;
export const DIR = "/vercel/sandbox";

/** The few parts of a Sandbox the runner uses, so it can be tested without one. */
export type SandboxLike = {
  domain(port: number): string;
  writeFiles(files: { path: string; content: Buffer }[]): Promise<void>;
  runCommand(params: { cmd: string; args?: string[]; cwd?: string; env?: Record<string, string>; detached?: boolean }): Promise<{ exitCode?: number | null; stdout(): Promise<string>; stderr(): Promise<string> }>;
};

export type RunEvent =
  | { step: "files"; count: number }
  | { step: "install"; status: "running" | "done" }
  | { step: "start" }
  | { step: "ready"; url: string }
  | { step: "error"; message: string };

/** Files that belong to the project: not the starter template that is always present, and not Pivolar's own entry files. */
export function projectFiles(files: FileMap): FileMap {
  const out: FileMap = {};
  for (const [path, content] of Object.entries(files)) {
    if (PROTECTED_PATHS.has(path)) continue;
    if (TEMPLATE[path] === content) continue;
    out[path] = content;
  }
  return out;
}

/** Files are sent in batches, so a repository with thousands of files does not become one huge request. */
async function writeAll(sandbox: SandboxLike, list: { path: string; content: Buffer }[]) {
  for (let i = 0; i < list.length; i += 200) await sandbox.writeFiles(list.slice(i, i + 200));
}

const toWrites = (files: FileMap) => Object.entries(files).map(([path, content]) => ({ path: `${DIR}/${path.replace(/^\/+/, "")}`, content: Buffer.from(content, "utf8") }));

/** How to start the project's dev server on a port that can be reached from outside. */
export function devCommand(files: FileMap): { cmd: string; args: string[]; env: Record<string, string> } | null {
  let dev = "";
  try {
    dev = (JSON.parse(files["/package.json"] ?? "{}") as { scripts?: Record<string, string> }).scripts?.dev ?? "";
  } catch {
    return null;
  }
  if (!dev) return null;
  const env = { HOST: "0.0.0.0", PORT: String(PORT) };
  if (/\bnext\b/.test(dev)) return { cmd: "npm", args: ["run", "dev", "--", "-H", "0.0.0.0", "-p", String(PORT)], env };
  if (/\bvite\b|\bastro\b|\bnuxt\b|\bremix\b/.test(dev)) return { cmd: "npm", args: ["run", "dev", "--", "--host", "0.0.0.0", "--port", String(PORT)], env };
  return { cmd: "npm", args: ["run", "dev"], env };
}

/** Variables the project's dev server needs, from lines like `VITE_URL=https://…`. Only plain KEY=value lines are accepted. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2]!;
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[m[1]!] = value;
  }
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function listening(sandbox: SandboxLike): Promise<boolean> {
  const r = await sandbox.runCommand({ cmd: "bash", args: ["-c", `curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT}/ || true`] });
  const code = Number((await r.stdout()).trim());
  return code > 0 && code < 600;
}

const tail = (text: string) => text.trim().split("\n").slice(-12).join("\n");

/**
 * Puts the project in the sandbox, installs it and starts its dev server. Reports progress as it
 * goes. Calling it again for a sandbox that is already serving only updates the files.
 *
 * `base` is the repository as it is on GitHub, binaries included. The project's text files (with
 * the changes made in Pivolar) are written on top of it.
 */
export async function* startProject(sandbox: SandboxLike, files: FileMap, env: Record<string, string> = {}, wait: { tries: number; delay: number } = { tries: 120, delay: 1000 }, base: Record<string, Buffer> = {}): AsyncGenerator<RunEvent> {
  const project = projectFiles(files);
  const command = devCommand(project);
  if (!command) {
    yield { step: "error", message: "Prosjektet har ikke noe «dev»-skript i package.json, så Pivolar vet ikke hvordan det skal startes." };
    return;
  }
  yield { step: "files", count: Math.max(Object.keys(project).length, Object.keys(base).length) };
  // The repository goes in first, but only where Pivolar does not have a (possibly edited) text version of the file.
  await writeAll(sandbox, Object.entries(base).filter(([path]) => !(path in project)).map(([path, content]) => ({ path: `${DIR}/${path.replace(/^\/+/, "")}`, content })));
  await writeAll(sandbox, toWrites(project));

  if (await listening(sandbox)) {
    yield { step: "ready", url: sandbox.domain(PORT) };
    return;
  }

  yield { step: "install", status: "running" };
  const install = await sandbox.runCommand({ cmd: "npm", args: ["install", "--no-audit", "--no-fund", "--loglevel=error"], cwd: DIR });
  if (install.exitCode !== 0) {
    yield { step: "error", message: `Installasjonen feilet:\n${tail((await install.stderr()) || (await install.stdout()))}` };
    return;
  }
  yield { step: "install", status: "done" };

  yield { step: "start" };
  // Vite refuses requests for hosts it does not know. The sandbox's own address is allowed explicitly.
  const host = new URL(sandbox.domain(PORT)).hostname;
  await sandbox.runCommand({
    cmd: command.cmd,
    args: command.args,
    cwd: DIR,
    detached: true,
    env: { ...command.env, ...env, __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: host, BROWSER: "none" },
  });
  for (let i = 0; i < wait.tries; i++) {
    if (await listening(sandbox)) {
      yield { step: "ready", url: sandbox.domain(PORT) };
      return;
    }
    await sleep(wait.delay);
  }
  yield { step: "error", message: "Utviklingstjeneren startet ikke innen to minutter." };
}

/** Sends changed files to a running sandbox; the dev server's hot reload does the rest. */
export async function syncProject(sandbox: SandboxLike, write: FileMap, remove: string[]): Promise<void> {
  if (Object.keys(write).length > 0) await sandbox.writeFiles(toWrites(write));
  if (remove.length > 0) {
    await sandbox.runCommand({ cmd: "rm", args: ["-f", ...remove.map((path) => `${DIR}/${path.replace(/^\/+/, "")}`)] });
  }
}
