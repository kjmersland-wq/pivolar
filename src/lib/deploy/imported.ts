import { PROTECTED_PATHS, TEMPLATE, type FileMap } from "../files.ts";
import { moveCheck } from "../move/check.ts";

/**
 * Roll-out of an imported project (one that brings its own package.json, typically from Lovable) to
 * Netlify or Cloudflare Pages. The repository is cloned inside the build machine, so pictures and other
 * files Pivolar does not keep come along, and the text files Pivolar holds are written over it so edits
 * made here are included. Only a plain Vite project is built: anything with a server part is refused with
 * a reason, instead of a build that fails halfway.
 */

export const isImportedProject = (files: FileMap) => "/package.json" in files && !("/App.tsx" in files);

/** Lock files of package managers other than npm; a lock file that does not match package.json stops an install. */
const FOREIGN_LOCKS = ["bun.lockb", "bun.lock", "yarn.lock", "pnpm-lock.yaml"];

export type ImportedPlan = { ok: true; project: Record<string, string>; remove: string[]; outDir: string; notes: string[] } | { ok: false; message: string };

export function planImported(files: FileMap): ImportedPlan {
  const hosting = moveCheck(files).hosting;
  if (!/^Vite/.test(hosting.preset)) {
    return {
      ok: false,
      message:
        hosting.preset === "TanStack Start" || hosting.preset === "Next.js" || hosting.preset === "SvelteKit"
          ? `${hosting.preset} har en serverdel og kan ikke bygges til rene filer her. Bare vanlige Vite-prosjekter rulles ut automatisk.`
          : "Fant ikke et Vite-prosjekt. Bare vanlige Vite-prosjekter rulles ut automatisk.",
    };
  }
  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(files["/package.json"] ?? "{}") as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return { ok: false, message: "package.json er ikke gyldig JSON." };
  }
  if (!scripts.build) return { ok: false, message: "package.json har ikke et build-skript." };

  // A different output folder in the Vite config is followed, as long as it is a plain folder name.
  const configured = /outDir\s*:\s*["']([^"']+)["']/.exec(files["/vite.config.ts"] ?? files["/vite.config.js"] ?? "")?.[1];
  const outDir = configured ?? "dist";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(outDir)) return { ok: false, message: `Utdatamappen «${outDir}» i vite.config er ikke en vanlig mappe.` };

  const project: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (PROTECTED_PATHS.has(path) || TEMPLATE[path] === content) continue;
    if (FOREIGN_LOCKS.some((name) => path === `/${name}`)) continue;
    if (/^\/\.env(\.|$)/.test(path) || /\/\.git\//.test(path) || /(^|\/)node_modules\//.test(path)) continue;
    project[path.replace(/^\/+/, "")] = content;
  }
  const notes: string[] = [];
  if (FOREIGN_LOCKS.some((name) => `/${name}` in files)) notes.push("Låsefiler fra andre pakkebehandlere er ikke brukt, så installasjonen går med npm.");
  return { ok: true, project, remove: FOREIGN_LOCKS, outDir, notes };
}

const BLOCKED_NAME = /SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|PASSWD/;
const BLOCKED_VALUE = /^(?:sk|rk)_(?:live|test)_|^sb_secret_|-----BEGIN /;

/**
 * Variables the owner gives the build. Only VITE_ names, because those are written into the page every
 * visitor downloads, so a value that looks like a secret is refused instead of being published.
 */
export function buildEnvFrom(input: unknown): { env: Record<string, string>; rejected: string[] } {
  const env: Record<string, string> = {};
  const rejected: string[] = [];
  if (!input || typeof input !== "object") return { env, rejected };
  for (const [name, value] of Object.entries(input as Record<string, unknown>).slice(0, 60)) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (!/^VITE_[A-Z0-9_]{1,60}$/.test(name) || BLOCKED_NAME.test(name) || BLOCKED_VALUE.test(value) || value.length > 2000 || /[\u0000-\u001f]/.test(value)) rejected.push(name.slice(0, 70));
    else env[name] = value;
  }
  return { env, rejected };
}

/** `VITE_A=1` per line, as typed in the dialog. Comments and blank lines are ignored. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).slice(0, 200)) {
    const m = /^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}
