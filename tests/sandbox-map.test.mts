import assert from "node:assert/strict";
import { TEMPLATE } from "../src/lib/files.ts";
import { cleanCss, isMappable, mapForSandbox, rewriteAlias, rewriteEnv, tailwindConfig, themeVariables } from "../src/lib/sandbox-map.ts";

// --- alias imports become relative
assert.equal(rewriteAlias('import { Button } from "@/components/ui/button";', "/pages/Index.tsx"), 'import { Button } from "../components/ui/button";');
assert.equal(rewriteAlias('import App from "@/App";', "/main.tsx"), 'import App from "./App";');
assert.equal(rewriteAlias("import x from '@/lib/utils'", "/components/ui/card.tsx"), "import x from '../../lib/utils'");
assert.equal(rewriteAlias('const P = lazy(() => import("@/pages/Home"));', "/App.tsx"), 'const P = lazy(() => import("./pages/Home"));');
assert.equal(rewriteAlias('import "@/index.css";', "/App.tsx"), 'import "./index.css";');
assert.equal(rewriteAlias('import x from "@radix-ui/react-slot"', "/a.tsx"), 'import x from "@radix-ui/react-slot"', "scoped packages are not aliases");
assert.equal(rewriteAlias('import x from "react"', "/a.tsx"), 'import x from "react"');

// --- env
assert.match(rewriteEnv("const u = import.meta.env.VITE_SUPABASE_URL;"), /\(\{ MODE: "development".*\}\)\.VITE_SUPABASE_URL/);
assert.equal(rewriteEnv("no env here"), "no env here");

// --- css
{
  const css = `@tailwind base;\n@tailwind components;\n@import "tailwindcss";\n@layer base {\n  * {\n    @apply border-border;\n  }\n  body {\n    @apply bg-background text-foreground;\n  }\n  h1 { @apply text-4xl font-bold; }\n}\n.x { color: red; }`;
  const out = cleanCss(css);
  assert.ok(!/@tailwind|@apply|tailwindcss/.test(out));
  assert.match(out, /border-color: hsl\(var\(--border\)\)/);
  assert.match(out, /background-color: hsl\(var\(--background\)\); color: hsl\(var\(--foreground\)\)/);
  assert.match(out, /\.x \{ color: red; \}/);
}

// --- theme from css variables
{
  const css = `:root {\n --background: 0 0% 100%;\n --foreground: 222.2 84% 4.9%;\n --primary: 222.2 47.4% 11.2%;\n --primary-foreground: 210 40% 98%;\n --border: 214.3 31.8% 91.4%;\n --radius: 0.5rem;\n --font-sans: Inter;\n --hero: #fff;\n}`;
  assert.deepEqual(themeVariables(css), ["background", "foreground", "primary", "primary-foreground", "border"], "only HSL triples, not hex or fonts");
  const script = tailwindConfig(css);
  const config = JSON.parse(script.split("window.tailwind.config = ")[1]!.replace(/;\s*$/, ""));
  assert.deepEqual(config.theme.extend.colors.primary, { DEFAULT: "hsl(var(--primary) / <alpha-value>)", foreground: "hsl(var(--primary-foreground) / <alpha-value>)" });
  assert.equal(config.theme.extend.colors.border, "hsl(var(--border) / <alpha-value>)");
  assert.equal(config.theme.extend.colors.background, "hsl(var(--background) / <alpha-value>)");
  assert.equal(config.darkMode, "class");
  assert.ok(config.theme.extend.borderRadius.lg);
  assert.ok(!("hero" in config.theme.extend.colors));
}

// --- mapping a project
const pkg = JSON.stringify({ dependencies: { react: "^18.3.1", "react-dom": "^18.3.1", "react-router-dom": "^6.30.1", "@supabase/supabase-js": "^2.50.0", "lovable-tagger": "^1.0.0", "@tanstack/react-query": "^5.0.0" } });
const project = {
  ...TEMPLATE,
  "/package.json": pkg,
  "/index.html": "<html></html>",
  "/vite.config.ts": "x",
  "/tailwind.config.ts": "x",
  "/README.md": "# hi",
  "/.env": "SECRET=1",
  "/bun.lockb": "binary",
  "/src/main.tsx": 'import App from "./App";',
  "/src/vite-env.d.ts": "/// <reference types=\"vite/client\" />",
  "/src/App.tsx": 'import Index from "@/pages/Index";\nexport default function App() { return <Index />; }',
  "/src/pages/Index.tsx": 'import { Button } from "@/components/ui/button";\nconst url = import.meta.env.VITE_URL;\nexport default function Index() { return <Button>{String(url)}</Button>; }',
  "/src/components/ui/button.tsx": 'import { cn } from "@/lib/utils";\nexport const Button = (p: any) => <button className={cn("bg-primary", p.className)} {...p} />;',
  "/src/lib/utils.ts": "export const cn = (...c: string[]) => c.filter(Boolean).join(' ');",
  "/src/index.css": "@tailwind base;\n:root { --primary: 222 47% 11%; --primary-foreground: 210 40% 98%; }\nbody { @apply bg-background; }",
  "/public/favicon.svg": "<svg/>",
  "/supabase/migrations/1.sql": "create table x();",
};
assert.ok(isMappable(project));
assert.ok(!isMappable(TEMPLATE));
{
  const m = mapForSandbox(project)!;
  assert.ok(m, "a Vite + React project is mapped");
  const paths = Object.keys(m.files).sort();
  assert.deepEqual(paths, ["/App.tsx", "/atelier-inspector.js", "/components/ui/button.tsx", "/index.tsx", "/lib/utils.ts", "/pages/Index.tsx", "/public/favicon.svg", "/styles.css"]);
  assert.equal(m.files["/index.tsx"], TEMPLATE["/index.tsx"], "the sandbox entry is the starter's");
  assert.match(m.files["/App.tsx"]!, /from "\.\/pages\/Index"/);
  assert.match(m.files["/pages/Index.tsx"]!, /from "\.\.\/components\/ui\/button"/);
  assert.ok(!m.files["/pages/Index.tsx"]!.includes("import.meta"));
  assert.match(m.files["/components/ui/button.tsx"]!, /from "\.\.\/\.\.\/lib\/utils"/);
  assert.ok(!m.files["/styles.css"]!.includes("@tailwind") && !m.files["/styles.css"]!.includes("@apply"));
  assert.match(m.files["/atelier-inspector.js"]!, /^window\.tailwind = /, "the theme is set before the inspector runs");
  assert.match(m.files["/atelier-inspector.js"]!, /hsl\(var\(--primary\)/);
  for (const secret of ["/.env", "/package.json", "/index.html", "/README.md", "/supabase/migrations/1.sql", "/bun.lockb"]) assert.ok(!(secret in m.files), secret);
  // dependencies: the project's own, minus what the sandbox supplies or cannot use
  assert.equal(m.dependencies["react-router-dom"], "^6.30.1");
  assert.equal(m.dependencies["@supabase/supabase-js"], "^2.50.0");
  assert.equal(m.dependencies["@tanstack/react-query"], "^5.0.0");
  assert.ok(!("react" in m.dependencies) && !("react-dom" in m.dependencies) && !("lovable-tagger" in m.dependencies));
  assert.ok("lucide-react" in m.dependencies, "the sandbox's own packages stay");
}

// --- not mappable
assert.equal(mapForSandbox(TEMPLATE), null, "a normal Pivolar project is not mapped");
assert.equal(mapForSandbox({ ...TEMPLATE, "/package.json": JSON.stringify({ dependencies: { vue: "3" } }), "/src/main.ts": "x" }), null);
assert.equal(mapForSandbox({ ...TEMPLATE, "/package.json": "{ broken" , "/src/App.tsx": "x" }), null);
assert.equal(mapForSandbox({ ...TEMPLATE, "/package.json": pkg }), null, "no /src/App.tsx");

// --- user changes to the real files show up in the preview
{
  const edited = mapForSandbox({ ...project, "/src/pages/Index.tsx": 'export default function Index() { return <h1>Ny</h1>; }' })!;
  assert.match(edited.files["/pages/Index.tsx"]!, /Ny/);
}

console.log("sandbox-map: all ok");
