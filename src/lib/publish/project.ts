import { trackingSnippet } from "../analytics/snippet.ts";
import type { HostId } from "../hosting/catalog.ts";
import { hostFiles } from "../hosting/files.ts";
import { PROTECTED_PATHS, SANDBOX_DEPENDENCIES, type FileMap } from "../files.ts";
import { metaTags, readBrand, type Brand } from "./brand.ts";

/** Lowercase, URL-safe name that works as a GitHub repo name and a Vercel project name. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "atelier-app";
}

const PACKAGE_JSON = (name: string) =>
  JSON.stringify(
    {
      name,
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview", typecheck: "tsc --noEmit", test: "vitest run" },
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        ...SANDBOX_DEPENDENCIES,
      },
      devDependencies: {
        "@tailwindcss/vite": "^4.1.0",
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "@testing-library/react": "^16.1.0",
        "@vitejs/plugin-react": "^4.3.4",
        jsdom: "^25.0.0",
        tailwindcss: "^4.1.0",
        typescript: "^5.6.0",
        vite: "^6.3.0",
        vitest: "^3.0.0",
      },
    },
    null,
    2,
  ) + "\n";

/**
 * Headers every page and function answers with. A Content-Security-Policy is left out on purpose:
 * it has to name every script and frame the site loads (payments, analytics, embeds), so a general one would break them.
 */
export const SECURITY_HEADERS =
  JSON.stringify(
    {
      headers: [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "X-Frame-Options", value: "SAMEORIGIN" },
            { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ],
        },
      ],
    },
    null,
    2,
  ) + "\n";

const VITE_CONFIG = `import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The share image needs an absolute address. Vercel exposes the production domain while building.
function siteUrl() {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "";
  return {
    name: "site-url",
    transformIndexHtml: (html: string) => html.replaceAll("__SITE_URL__", base),
    // Search engines need the absolute address, so robots.txt and the sitemap are written at build time.
    generateBundle(this: { emitFile: (file: { type: "asset"; fileName: string; source: string }) => void }) {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: "User-agent: *\\nAllow: /\\n" + (base ? "\\nSitemap: " + base + "/sitemap.xml\\n" : "") });
      if (base) this.emitFile({ type: "asset", fileName: "sitemap.xml", source: '<?xml version="1.0" encoding="UTF-8"?>\\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\\n  <url><loc>' + base + "/</loc></url>\\n</urlset>\\n" });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrl()],
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"] },
});
`;

const TSCONFIG =
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        isolatedModules: true,
        noEmit: true,
        resolveJsonModule: true,
      },
      include: ["src"],
    },
    null,
    2,
  ) + "\n";

/** Browser features the page may use that jsdom does not have. */
const TEST_SETUP = `class Stub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
Object.assign(globalThis, { IntersectionObserver: Stub, ResizeObserver: Stub });
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
window.scrollTo = () => {};
`;

/** The page must at least draw something without throwing. A broken import or a crash on load fails here, before it goes live. */
const SMOKE_TEST = `import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "./App";

test("the page renders", () => {
  const { container } = render(<App />);
  expect(container.textContent?.trim().length).toBeGreaterThan(0);
});
`;

const CI_WORKFLOW = `name: Kontroll
on:
  push:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm install
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
`;

const manifest = (brand: Brand, title: string, icons: boolean) =>
  JSON.stringify(
    {
      name: brand.name || title,
      short_name: (brand.name || title).slice(0, 12),
      description: brand.description || undefined,
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: brand.primary,
      icons: icons
        ? [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ]
        : [],
    },
    null,
    2,
  ) + "\n";

/** Pages are fetched fresh when online and kept for when the connection drops; other files are served from the cache first. */
const SERVICE_WORKER = `const CACHE = "app-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  const keep = (response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  };
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(keep).catch(() => caches.match(request).then((hit) => hit || caches.match("/"))));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then(keep)));
});
`;

const MAIN_TSX = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Makes the site installable and lets it open without a connection.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
`;

/**
 * Remote @import lines (Google Fonts) must come before every other rule. The preview wants them at
 * the top of styles.css; here Tailwind's own import is added, so they are moved in front of it.
 */
export function buildStyles(css: string): string {
  const remote: string[] = [];
  const rest = css.replace(/^[ \t]*@import\s+url\([^)]*\)[^;\n]*;?[ \t]*$/gm, (line) => {
    const trimmed = line.trim();
    remote.push(trimmed.endsWith(";") ? trimmed : trimmed + ";");
    return "";
  });
  const head = remote.length ? remote.join("\n") + "\n" : "";
  return head + '@import "tailwindcss";\n\n' + rest.trim() + "\n";
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Turns the files Pivolar shows in its preview into a normal Vite + React + Tailwind project that
 * builds on Vercel. Paths move under src/, the sandbox-only files are left out, and Tailwind is
 * installed properly (the preview loads it from a CDN, a real build must not).
 */
export function buildDeployableProject(files: FileMap, title: string, options: { icons?: boolean; analytics?: { origin: string; projectId: string }; host?: HostId } = {}): Record<string, string> {
  const slug = slugify(title);
  const brand = readBrand(files, title);
  const counter = options.analytics ? trackingSnippet(options.analytics.origin, options.analytics.projectId) : "";
  const out: Record<string, string> = {
    ".github/workflows/ci.yml": CI_WORKFLOW,
    "package.json": PACKAGE_JSON(slug),
    "vite.config.ts": VITE_CONFIG,
    "tsconfig.json": TSCONFIG,
    "vercel.json": SECURITY_HEADERS,
    "index.html": `<!doctype html>
<html lang="nb">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(brand.name || title)}</title>
    ${metaTags(brand, title)}
    <link rel="manifest" href="/manifest.webmanifest" />${counter ? `\n    ${counter}` : ""}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    ".gitignore": "node_modules\ndist\n.env\n.env.*\n.vercel\n",
    "README.md": `# ${title}\n\nBygget med Pivolar.\n\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n`,
    "src/main.tsx": MAIN_TSX,
    "src/vite-env.d.ts": '/// <reference types="vite/client" />\n',
    "src/test-setup.ts": TEST_SETUP,
    "src/App.test.tsx": SMOKE_TEST,
    "public/manifest.webmanifest": manifest(brand, title, options.icons === true),
    "public/sw.js": SERVICE_WORKER,
  };

  for (const [path, code] of Object.entries(files)) {
    if (PROTECTED_PATHS.has(path)) continue;
    const relative = path.replace(/^\/+/, "");
    if (relative === "styles.css") continue;
    // Files under /public are served as they are (favicon, logo) and files under /api run as server functions on Vercel; everything else is source code.
    out[relative.startsWith("public/") || relative.startsWith("api/") ? relative : `src/${relative}`] = code;
  }
  out["src/styles.css"] = buildStyles(files["/styles.css"] ?? "");
  // Settings for the chosen host sit next to the site, and never replace a file the site already has.
  for (const [path, content] of Object.entries(hostFiles(options.host ?? "vercel", slug))) if (!(path in out)) out[path] = content;

  if (!out["src/App.tsx"]) throw new Error("Prosjektet mangler /App.tsx.");
  return out;
}
