import type { FileMap } from "../files.ts";
import { moveCheck } from "./check.ts";

/**
 * Prepares an imported project for Cloudflare, with plain rules and no AI: it lists the files to add and
 * the steps that must still be done by hand (anything that needs `npm install` on the owner's machine,
 * because a changed package.json without a matching lock file stops the install at the host). The files go
 * into the project as the owner's own edits, and leave Pivolar as a pull request, never straight onto the branch.
 */

export type Preparation = { ok: true; preset: string; write: Record<string, string>; manual: string[]; next: string[] } | { ok: false; message: string };

const NEXT = [
  "Åpne «Git» her i panelet og send endringene som pull request.",
  "Slå sammen pull requesten på GitHub.",
  "I Cloudflare: Workers & Pages, Create, Import a repository, og velg repoet.",
  "Sett VITE_-variablene og hemmelighetene i Cloudflare før første bygging.",
];

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "app";

export function prepareCloudflare(files: FileMap): Preparation {
  const report = moveCheck(files);
  const preset = report.hosting.preset;
  let pkg: { name?: string; engines?: { node?: string }; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(files["/package.json"] ?? "{}") as typeof pkg;
  } catch {
    return { ok: false, message: "package.json er ikke gyldig JSON." };
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const write: Record<string, string> = {};
  const manual: string[] = [];

  if (/^Vite/.test(preset)) {
    // A single-page app: every address that is not a file opens the front page.
    if (!("/public/_redirects" in files) && !("/_redirects" in files)) write["/public/_redirects"] = "/*  /index.html  200\n";
    if (!("/.nvmrc" in files) && !pkg.engines?.node) write["/.nvmrc"] = "22\n";
    manual.push("Har repoet flere låsefiler (for eksempel bun.lock og package-lock.json), slett dem du ikke bruker direkte på GitHub. Pivolar får ikke med store låsefiler og kan ikke slette dem.");
    return { ok: true, preset, write, manual, next: NEXT };
  }

  if (preset === "TanStack Start") {
    const hasConfig = ["/wrangler.jsonc", "/wrangler.json", "/wrangler.toml"].some((p) => p in files);
    if (!hasConfig) {
      write["/wrangler.jsonc"] = `${JSON.stringify({ name: slug(pkg.name ?? "app"), compatibility_date: "2025-09-02", compatibility_flags: ["nodejs_compat"], main: "@tanstack/react-start/server-entry" }, null, 2)}\n`;
    }
    if (!("/.nvmrc" in files) && !pkg.engines?.node) write["/.nvmrc"] = "22\n";
    const missing = ["@cloudflare/vite-plugin", "wrangler"].filter((name) => !(name in deps));
    if (missing.length > 0) manual.push(`Kjør «npm install -D ${missing.join(" ")}» på din egen maskin og legg package.json og låsefilen inn i samme pull request. Pivolar endrer ikke package.json her, for en låsefil som ikke stemmer stopper installasjonen hos Cloudflare.`);
    const config = files["/vite.config.ts"] ?? files["/vite.config.js"] ?? "";
    if (!/cloudflare\s*\(/.test(config)) manual.push('Ta pluginen inn i vite.config: «import { cloudflare } from "@cloudflare/vite-plugin"» og legg «cloudflare({ viteEnvironment: { name: "ssr" } })» først i plugins. Sjekk mot TanStack Starts veiledning for Cloudflare. Bruker prosjektet en delt Lovable-config, kan den allerede gjøre dette.');
    manual.push("Byggekommando i Cloudflare: npm run build. Deploy-kommando: npx wrangler deploy. Hemmeligheter legges under Variables and Secrets, aldri med VITE_ foran.");
    return { ok: true, preset, write, manual, next: NEXT };
  }

  return { ok: false, message: `${preset === "Ukjent" ? "Fant ikke rammeverket" : `${preset} støttes ikke`}. Forberedelsen gjelder Vite og TanStack Start.` };
}
