import { checkDist, DIST_LIMITS, distPath, type DistFiles } from "./files.ts";

/**
 * Builds the published project in an isolated, throwaway machine (Vercel Sandbox), and returns the
 * finished site. Nothing about the owner reaches the machine: no tokens and no environment, only the
 * project's own files and the address the site will get. The machine is always stopped afterwards.
 */

const DIR = "/vercel/sandbox";

/** The few parts of a Sandbox the build uses, so it can be tested without one. */
export type BuildSandbox = {
  writeFiles(files: { path: string; content: Buffer }[]): Promise<void>;
  runCommand(params: { cmd: string; args?: string[]; cwd?: string; env?: Record<string, string> }): Promise<{ exitCode?: number | null; stdout(): Promise<string>; stderr(): Promise<string> }>;
  readFileToBuffer(file: { path: string; cwd?: string }): Promise<Buffer | null>;
};

export type ProjectFile = string | { base64: string };

const toBuffer = (file: ProjectFile) => (typeof file === "string" ? Buffer.from(file, "utf8") : Buffer.from(file.base64, "base64"));

/** The end of what a failed command printed, without a flood and without control characters. */
const tail = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(-700);

async function run(sandbox: BuildSandbox, cmd: string, args: string[], what: string, env?: Record<string, string>) {
  const result = await sandbox.runCommand({ cmd, args, cwd: DIR, ...(env ? { env } : {}) });
  if (result.exitCode !== 0) {
    const out = tail((await result.stderr()) || (await result.stdout()));
    throw new Error(`${what} feilet${out ? `:\n${out}` : "."}`);
  }
  return result;
}

export type BuildOptions = {
  siteUrl?: string;
  onStep?: (step: "write" | "install" | "build" | "read") => void;
  /** Public build variables (VITE_…) the owner gave. Never a token. */
  env?: Record<string, string>;
  /** The folder the build writes to. */
  outDir?: string;
  /** Files to delete after the project is written (foreign lock files in a cloned repository). */
  remove?: string[];
  /** Install with the old peer-dependency rules, which imported projects often need. */
  legacyPeerDeps?: boolean;
};

export async function buildDist(sandbox: BuildSandbox, project: Record<string, ProjectFile>, options: BuildOptions = {}): Promise<DistFiles> {
  const onStep = options.onStep ?? (() => {});
  const writes = Object.entries(project).flatMap(([path, file]) => {
    const clean = distPath(path.replace(/^\/+/, ""));
    return clean ? [{ path: `${DIR}${clean}`, content: toBuffer(file) }] : [];
  });
  onStep("write");
  for (let i = 0; i < writes.length; i += 200) await sandbox.writeFiles(writes.slice(i, i + 200));
  const outDir = options.outDir ?? "dist";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(outDir)) throw new Error("Utdatamappen har et ugyldig navn.");
  const remove = (options.remove ?? []).filter((name) => /^[A-Za-z0-9._-]{1,60}$/.test(name));
  if (remove.length > 0) await run(sandbox, "rm", ["-f", ...remove], "Opprydding av låsefiler");
  onStep("install");
  await run(sandbox, "npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...(options.legacyPeerDeps ? ["--legacy-peer-deps"] : [])], "Installasjonen av pakker");
  onStep("build");
  await run(sandbox, "npm", ["run", "build"], "Byggingen", { ...(options.env ?? {}), ...(options.siteUrl ? { SITE_URL: options.siteUrl } : {}), CI: "1" });
  onStep("read");
  const listing = await run(sandbox, "find", [outDir, "-type", "f"], `Oppslaget i ${outDir}`);
  const paths = (await listing.stdout())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ line, path: distPath(outDir === "dist" ? line : line.replace(new RegExp(`^${outDir}/`), "dist/")) }));
  if (paths.some((p) => !p.path)) throw new Error("Byggingen ga en fil med et ugyldig navn, så ingenting er lagt ut.");
  if (paths.length > DIST_LIMITS.files) throw new Error(`Siden har ${paths.length} filer, og grensen er ${DIST_LIMITS.files}.`);

  const files: DistFiles = new Map();
  let total = 0;
  const queue = [...paths];
  async function worker() {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const content = await sandbox.readFileToBuffer({ path: `${DIR}/${item.line}` });
      if (!content) throw new Error(`Fant ikke ${item.path} etter byggingen.`);
      total += content.byteLength;
      if (total > DIST_LIMITS.totalBytes) throw new Error(`Siden er over ${DIST_LIMITS.totalBytes / 1024 / 1024} MB, og er for stor for en vanlig publisering.`);
      files.set(item.path!, content);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  checkDist(files);
  return files;
}
