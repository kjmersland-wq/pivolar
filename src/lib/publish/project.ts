import { PROTECTED_PATHS, SANDBOX_DEPENDENCIES, type FileMap } from "../files.ts";
import { metaTags, readBrand } from "./brand.ts";

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
      scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        ...SANDBOX_DEPENDENCIES,
      },
      devDependencies: {
        "@tailwindcss/vite": "^4.1.0",
        "@types/react": "^19.0.0",
        "@types/react-dom": "^19.0.0",
        "@vitejs/plugin-react": "^4.3.4",
        tailwindcss: "^4.1.0",
        typescript: "^5.6.0",
        vite: "^6.3.0",
      },
    },
    null,
    2,
  ) + "\n";

const VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The share image needs an absolute address. Vercel exposes the production domain while building.
function siteUrl() {
  return {
    name: "site-url",
    transformIndexHtml: (html: string) =>
      html.replaceAll("__SITE_URL__", process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : ""),
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrl()],
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

const MAIN_TSX = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
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
export function buildDeployableProject(files: FileMap, title: string): Record<string, string> {
  const slug = slugify(title);
  const brand = readBrand(files, title);
  const out: Record<string, string> = {
    "package.json": PACKAGE_JSON(slug),
    "vite.config.ts": VITE_CONFIG,
    "tsconfig.json": TSCONFIG,
    "index.html": `<!doctype html>
<html lang="nb">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(brand.name || title)}</title>
    ${metaTags(brand, title)}
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
  };

  for (const [path, code] of Object.entries(files)) {
    if (PROTECTED_PATHS.has(path)) continue;
    const relative = path.replace(/^\/+/, "");
    if (relative === "styles.css") continue;
    // Files under /public are served as they are (favicon, logo); everything else is source code.
    out[relative.startsWith("public/") ? relative : `src/${relative}`] = code;
  }
  out["src/styles.css"] = buildStyles(files["/styles.css"] ?? "");

  if (!out["src/App.tsx"]) throw new Error("Prosjektet mangler /App.tsx.");
  return out;
}
