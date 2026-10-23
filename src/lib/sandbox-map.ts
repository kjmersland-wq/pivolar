import { PROTECTED_PATHS, SANDBOX_DEPENDENCIES, TEMPLATE, type FileMap } from "./files.ts";

/**
 * Shows an imported Vite + React project in the preview. The preview sandbox expects the starter
 * layout (/App.tsx, /styles.css), so the project's files are laid out that way for the preview
 * only: /src/x becomes /x, `@/` imports become relative ones, `import.meta.env` gets an empty
 * object and the Tailwind theme is rebuilt from the CSS variables the project defines. The
 * project's real files are never changed by this.
 */

export type SandboxProject = {
  /** Files for the preview sandbox, keyed by sandbox path. */
  files: FileMap;
  /** Packages from the project's package.json that the preview can fetch. */
  dependencies: Record<string, string>;
};

/** Left out of the preview: build setup, lockfiles, secrets and things that only matter on a server. */
const SKIP = [
  /^\/package(-lock)?\.json$/,
  /^\/(bun\.lockb?|yarn\.lock|pnpm-lock\.yaml)$/,
  /^\/index\.html$/,
  /^\/(vite|vitest|tailwind|postcss|eslint|next|astro)\.config\.[cm]?[jt]s$/,
  /^\/postcss\.config\.[cm]?js$/,
  /^\/tsconfig(\.\w+)?\.json$/,
  /^\/components\.json$/,
  /^\/(\.git|\.github|node_modules|supabase|dist|\.vscode)\//,
  /^\/\.env/,
  /^\/src\/(main\.[jt]sx?|vite-env\.d\.ts)$/,
  /\.(md|txt|lock)$/i,
];

/** Never fetched into the preview: React comes from the sandbox itself, and these only run on a server or in a build. */
const NOT_IN_PREVIEW = new Set(["react", "react-dom", "vite", "typescript", "tailwindcss", "postcss", "autoprefixer", "eslint", "tailwindcss-animate", "@vitejs/plugin-react-swc", "@vitejs/plugin-react", "lovable-tagger"]);

const CODE = /\.(tsx?|jsx?)$/;

const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

function relative(from: string, to: string): string {
  const a = dirOf(from).split("/").filter(Boolean);
  const b = to.split("/").filter(Boolean);
  while (a.length && b.length && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  const up = a.map(() => "..");
  const out = [...(up.length ? up : ["."]), ...b].join("/");
  return out;
}

/** `@/components/x` becomes `../components/x` (or `./components/x`) for the file that imports it. */
export function rewriteAlias(code: string, sandboxPath: string): string {
  return code.replace(/(from\s*|import\s*\(\s*|import\s+|require\(\s*)(['"])@\/([^'"]+)\2/g, (_, lead: string, quote: string, target: string) => `${lead}${quote}${relative(sandboxPath, `/${target}`)}${quote}`);
}

const ENV = '({ MODE: "development", DEV: true, PROD: false, SSR: false, BASE_URL: "/" })';
export const rewriteEnv = (code: string) => code.replace(/import\.meta\.env\b/g, ENV);

/** Tailwind directives and @apply only work in a build; the preview loads Tailwind from a CDN. */
export function cleanCss(css: string): string {
  return css
    .replace(/^\s*@tailwind\s+[^;]+;\s*$/gm, "")
    .replace(/^\s*@import\s+["']tailwindcss[^;]*;\s*$/gm, "")
    .replace(/^\s*@(plugin|config|source|custom-variant|theme)\b[^;{]*;\s*$/gm, "")
    .replace(/^(\s*)@apply\s+border-border\s*;/gm, "$1border-color: hsl(var(--border));")
    .replace(/^(\s*)@apply\s+bg-background\s+text-foreground\s*;/gm, "$1background-color: hsl(var(--background)); color: hsl(var(--foreground));")
    .replace(/@apply\s+[^;}]+;?/g, "");
}

/** Colour variables written as bare HSL triples ("222 47% 11%"), the way shadcn/ui and Lovable define them. */
export function themeVariables(css: string): string[] {
  const names = new Set<string>();
  for (const m of css.matchAll(/--([a-z][\w-]*)\s*:\s*(-?\d+(?:\.\d+)?(?:deg)?)\s+(\d+(?:\.\d+)?%)\s+(\d+(?:\.\d+)?%)\s*;/gi)) names.add(m[1]!);
  return [...names];
}

/** A Tailwind config for the CDN, built from the colour variables: `bg-primary`, `text-muted-foreground`, `border-border`, and `bg-primary/50`. */
export function tailwindConfig(css: string): string {
  const colors: Record<string, string | Record<string, string>> = {};
  const ref = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;
  const names = themeVariables(css);
  // `primary` with a `primary-foreground` becomes one colour with a foreground shade; the rest are plain colours.
  const baseOf = (name: string) => (name.endsWith("-foreground") && names.includes(name.slice(0, -"-foreground".length)) ? name.slice(0, -"-foreground".length) : null);
  for (const name of names) {
    const base = baseOf(name);
    if (!base) colors[name] = names.some((other) => baseOf(other) === name) ? { DEFAULT: ref(name) } : ref(name);
  }
  for (const name of names) {
    const base = baseOf(name);
    if (base) (colors[base] as Record<string, string>).foreground = ref(name);
  }
  const radius = /--radius\s*:\s*([^;]+);/.exec(css)?.[1]?.trim();
  const config = {
    darkMode: "class",
    theme: {
      extend: {
        colors,
        ...(radius ? { borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" } } : {}),
      },
    },
  };
  return `window.tailwind = window.tailwind || {};\nwindow.tailwind.config = ${JSON.stringify(config)};\n`;
}

/** Maps `/src/pages/Index.tsx` to `/pages/Index.tsx`, and the main stylesheet to `/styles.css`. */
function sandboxPath(path: string): string | null {
  if (path === "/src/index.css") return "/styles.css";
  if (path.startsWith("/src/")) return path.slice(4);
  if (path.startsWith("/public/")) return path;
  return null;
}

export function isMappable(files: FileMap): boolean {
  if (!("/package.json" in files)) return false;
  if (!("/src/App.tsx" in files || "/src/App.jsx" in files)) return false;
  try {
    const pkg = JSON.parse(files["/package.json"]!) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return "react" in { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return false;
  }
}

export function mapForSandbox(files: FileMap): SandboxProject | null {
  if (!isMappable(files)) return null;
  const out: FileMap = {};
  for (const path of PROTECTED_PATHS) if (files[path]) out[path] = files[path]!;
  out["/styles.css"] = TEMPLATE["/styles.css"]!;

  let theme = "";
  for (const [path, content] of Object.entries(files)) {
    if (PROTECTED_PATHS.has(path) || SKIP.some((re) => re.test(path))) continue;
    // The starter template's own files are not part of the project.
    if (TEMPLATE[path] === content && !path.startsWith("/src/")) continue;
    const target = sandboxPath(path);
    if (!target) continue;
    if (CODE.test(target)) out[target] = rewriteEnv(rewriteAlias(content, target));
    else if (target.endsWith(".css")) {
      if (target === "/styles.css") theme = content;
      out[target] = cleanCss(content);
    } else out[target] = content;
  }
  if (out["/App.jsx"] && !out["/App.tsx"]) out["/App.tsx"] = 'export { default } from "./App.jsx";\n';

  // The inspector is loaded after the Tailwind CDN, so the theme is set there.
  const inspector = out["/atelier-inspector.js"];
  if (inspector && theme) out["/atelier-inspector.js"] = `${tailwindConfig(theme)}${inspector}`;

  const pkg = JSON.parse(files["/package.json"]!) as { dependencies?: Record<string, string> };
  const dependencies: Record<string, string> = { ...SANDBOX_DEPENDENCIES };
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (!NOT_IN_PREVIEW.has(name)) dependencies[name] = version;
  }
  return { files: out, dependencies };
}
