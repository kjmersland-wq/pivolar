import { extname } from "node:path";

/**
 * What the automatic roll-out to Netlify and Cloudflare Pages works on: the finished site, as a list of
 * files with the address each is served on. The site is built once, in an isolated machine, and the
 * same files go to either host.
 */

export type DistFiles = Map<string, Buffer>;

export const DIST_LIMITS = {
  files: 2_000,
  /** Both hosts accept far more; this keeps one publish from filling a machine and a request. */
  totalBytes: 80 * 1024 * 1024,
  /** Cloudflare Pages allows 25 MiB per file. */
  fileBytes: 25 * 1024 * 1024,
};

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json", webmanifest: "application/manifest+json",
  xml: "application/xml", txt: "text/plain; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", map: "application/json", pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg",
};

export const contentTypeOf = (path: string) => TYPES[extname(path).slice(1).toLowerCase()] ?? "application/octet-stream";

/**
 * A path in the finished site, with a leading slash, or null when it is not a plain file path. The
 * names come out of the build machine, so they are checked like anything from outside.
 */
export function distPath(raw: string): string | null {
  const path = raw.trim().replace(/^\.\//, "").replace(/^dist\//, "");
  if (!path || path.length > 300 || path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return null;
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  return `/${path}`;
}

/** Fallback to the front page for every address that is not a file, and the same safety headers as the other hosts. Never replaces a file the site already has. */
export function withHostRules(files: DistFiles): DistFiles {
  const out = new Map(files);
  if (!out.has("/_redirects")) out.set("/_redirects", Buffer.from("/*  /index.html  200\n"));
  if (!out.has("/_headers")) {
    out.set(
      "/_headers",
      Buffer.from(["/*", "  X-Content-Type-Options: nosniff", "  Referrer-Policy: strict-origin-when-cross-origin", "  X-Frame-Options: SAMEORIGIN", "  Permissions-Policy: camera=(), microphone=(), geolocation=()", ""].join("\n")),
    );
  }
  return out;
}

/** Throws a message for the owner when the site is too big for one publish. */
export function checkDist(files: DistFiles): void {
  if (files.size === 0) throw new Error("Byggingen ga ingen filer. Sjekk at prosjektet bygger (npm run build) og legger resultatet i dist.");
  if (!files.has("/index.html")) throw new Error("Byggingen ga ingen index.html, så det er ingen forside å legge ut.");
  if (files.size > DIST_LIMITS.files) throw new Error(`Siden har ${files.size} filer, og grensen er ${DIST_LIMITS.files}.`);
  let total = 0;
  for (const [path, content] of files) {
    if (content.byteLength > DIST_LIMITS.fileBytes) throw new Error(`Filen ${path} er over ${DIST_LIMITS.fileBytes / 1024 / 1024} MB.`);
    total += content.byteLength;
  }
  if (total > DIST_LIMITS.totalBytes) throw new Error(`Siden er ${(total / 1024 / 1024).toFixed(0)} MB, og grensen er ${DIST_LIMITS.totalBytes / 1024 / 1024} MB.`);
}
