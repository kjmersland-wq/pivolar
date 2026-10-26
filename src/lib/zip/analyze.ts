// Looks at a set of project files and reports what kind of project it is and what it needs. It only
// reads text; nothing is installed or run.

export type FileMap = Record<string, string>;

import { estimateCost, rank } from "../hosting/rules.ts";
import { classifyStack, STACK_LABELS, type Delivery, type Stack } from "../stack/classify.ts";

export type Report = {
  /** The three groups (static, front-end, full stack) and the cheapest host that fits, from fixed rules. */
  stack: { category: Stack; delivery: Delivery; label: string; reasons: string[]; host: { id: string; name: string; cost: string; why: string } };
  framework: { id: string; label: string };
  packageManager: string | null;
  scripts: Record<string, string>;
  services: string[];
  envVars: string[];
  risks: string[];
  previewable: boolean;
  previewNote: string;
};

const SERVICES: [RegExp, string][] = [
  [/^@supabase\//, "Supabase (database og innlogging)"],
  [/^@neondatabase\//, "Neon (Postgres)"],
  [/^(prisma|@prisma\/client)$/, "Prisma (database)"],
  [/^drizzle-orm$/, "Drizzle (database)"],
  [/^(mongoose|mongodb)$/, "MongoDB"],
  [/^(pg|postgres|mysql2?|better-sqlite3|@libsql\/client)$/, "Databasedriver"],
  [/^firebase(-admin)?$/, "Firebase"],
  [/^(next-auth|@auth\/core|better-auth|lucia)$/, "Innlogging (Auth.js m.fl.)"],
  [/^@clerk\//, "Clerk (innlogging)"],
  [/^stripe$|^@stripe\//, "Stripe (betaling)"],
  [/^@paddle\//, "Paddle (betaling)"],
  [/^(resend|nodemailer|@sendgrid\/mail)$/, "E-post"],
  [/^(openai|@anthropic-ai\/sdk|ai|@ai-sdk\/.*)$/, "AI-leverandør"],
];

const IGNORED_ENV = new Set(["NODE_ENV", "MODE", "DEV", "PROD", "SSR", "BASE_URL", "PORT", "CI", "VERCEL", "VERCEL_ENV", "VERCEL_URL"]);
const SOURCE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro)$/;

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `left` is what the reader did not keep (path and reason). A large lock file is left out, but it still exists in the repository. */
export function analyze(files: FileMap, left: { path: string }[] = []): Report {
  const paths = Object.keys(files);
  const has = (path: string) => path in files;
  const lockFiles = ["/pnpm-lock.yaml", "/yarn.lock", "/bun.lock", "/bun.lockb", "/package-lock.json"].filter((name) => has(name) || left.some((l) => l.path === name.slice(1) || l.path === name));
  const pkg = parseJson(files["/package.json"]);
  const deps: Record<string, string> = { ...((pkg?.dependencies as Record<string, string>) ?? {}), ...((pkg?.devDependencies as Record<string, string>) ?? {}) };
  const dep = (name: string) => name in deps;
  const scriptsRaw = (pkg?.scripts as Record<string, string>) ?? {};
  const scripts = Object.fromEntries(Object.entries(scriptsRaw).filter(([k]) => ["dev", "build", "start", "test", "lint", "typecheck"].includes(k)));

  let framework = { id: "unknown", label: "Ukjent prosjekttype" };
  if (has("/wp-config.php") || has("/wp-config-sample.php") || paths.some((p) => p.startsWith("/wp-content/"))) framework = { id: "wordpress", label: "WordPress" };
  else if (has("/configuration.php") || (has("/administrator/index.php") && has("/libraries/src/Version.php"))) framework = { id: "joomla", label: "Joomla" };
  else if (dep("next")) framework = { id: "nextjs", label: "Next.js" };
  else if (dep("@tanstack/react-start")) framework = { id: "tanstack-start", label: "TanStack Start" };
  else if (dep("astro")) framework = { id: "astro", label: "Astro" };
  else if (Object.keys(deps).some((d) => d.startsWith("@remix-run/")) || dep("react-router")) framework = { id: "remix", label: "Remix / React Router" };
  else if (dep("nuxt")) framework = { id: "nuxt", label: "Nuxt" };
  else if (dep("@sveltejs/kit")) framework = { id: "sveltekit", label: "SvelteKit" };
  else if (dep("vite") && dep("react")) framework = { id: "vite-react", label: "Vite + React" };
  else if (dep("vite") && dep("vue")) framework = { id: "vite-vue", label: "Vite + Vue" };
  else if (dep("vite")) framework = { id: "vite", label: "Vite" };
  else if (dep("express") || dep("fastify") || dep("hono")) framework = { id: "node-server", label: "Node-server" };
  else if (pkg) framework = { id: "node", label: "Node-prosjekt" };
  else if (paths.some((p) => /(^|\/)index\.html$/.test(p))) framework = { id: "static", label: "Statisk HTML" };
  else if (has("/App.tsx")) framework = { id: "pivolar", label: "Pivolar (React + Tailwind)" };

  const lock = (name: string) => lockFiles.includes(name);
  const packageManager = lock("/pnpm-lock.yaml") ? "pnpm" : lock("/yarn.lock") ? "yarn" : lock("/bun.lock") || lock("/bun.lockb") ? "bun" : lock("/package-lock.json") ? "npm" : pkg ? "ukjent (ingen låsefil)" : null;

  const services = [...new Set(Object.keys(deps).flatMap((d) => SERVICES.filter(([re]) => re.test(d)).map(([, label]) => label)))];

  const env = new Set<string>();
  for (const path of paths) {
    const base = path.split("/").pop()!;
    if (/^\.env\.(example|sample|template|dist)$/.test(base)) {
      for (const m of files[path]!.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm)) env.add(m[1]!);
    }
    if (SOURCE.test(path)) {
      for (const m of files[path]!.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g)) env.add(m[1]!);
    }
  }
  const envVars = [...env].filter((name) => !IGNORED_ENV.has(name)).sort();

  const risks: string[] = [];
  for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
    if (scriptsRaw[hook]) risks.push(`package.json kjører «${hook}» ved installasjon. Installer aldri dette prosjektet utenfor et isolert miljø før du har lest skriptet.`);
  }
  if (pkg && !packageManager?.match(/^(npm|pnpm|yarn|bun)$/)) risks.push("Ingen låsefil: avhengighetene kan få nye versjoner ved neste installasjon.");
  if (lockFiles.length > 1) risks.push(`Flere låsefiler (${lockFiles.map((n) => n.slice(1)).join(", ")}): behold én. En som ikke stemmer med package.json kan stoppe installasjonen hos en vert.`);
  if (["wordpress", "joomla"].includes(framework.id)) risks.push("CMS-prosjekt: databasen ligger utenfor filene. Pivolar kan foreløpig bare lese og eksportere filene, ikke kjøre eller konvertere dem.");
  if (services.some((s) => /database|Postgres|MongoDB|Supabase|Firebase/i.test(s))) risks.push("Prosjektet bruker en database. Pivolar rører ikke eksisterende data, og tilkoblingsnøkler må settes som miljøvariabler.");

  const pivolarNative = has("/App.tsx") && !pkg;
  const runnable = Boolean(pkg && scriptsRaw.dev && ["nextjs", "tanstack-start", "astro", "remix", "nuxt", "sveltekit", "vite-vue", "vite", "node-server", "node"].includes(framework.id));
  const viteReact = framework.id === "vite-react" && (has("/src/App.tsx") || has("/src/App.jsx"));

  // What kind of project it is and where it is cheapest to run: fixed rules, no AI.
  const classification = classifyStack(files);
  const profile = { functions: classification.functions, commercial: false, stack: classification.stack, delivery: classification.delivery };
  const best = rank(profile)[0]!;
  return {
    stack: {
      category: classification.stack,
      delivery: classification.delivery,
      label: STACK_LABELS[classification.stack],
      reasons: classification.reasons,
      host: { id: best.host.id, name: best.host.name, cost: estimateCost(best.host, profile).label, why: best.why },
    },
    framework,
    packageManager,
    scripts,
    services,
    envVars,
    risks,
    previewable: pivolarNative,
    previewNote: pivolarNative
      ? "Kan vises i forhåndsvisningen."
      : runnable
        ? "Kan vises ved å kjøre prosjektet i et isolert, midlertidig miljø på Vercel (første oppstart tar ett til to minutter). Endringer med AI virker på filene, og kan sendes til GitHub som en pull request."
        : framework.id === "static"
        ? "Vises som en statisk side. Filer som ikke importeres (bilder, store datafiler) hentes direkte fra GitHub. Endringer med AI virker på filene, og kan sendes til GitHub som en pull request."
        : viteReact
        ? "Vises i en forenklet forhåndsvisning: uten backend og miljøvariabler, og med temaet gjenskapt fra CSS-variablene. Endringer med AI virker på filene, og kan sendes til GitHub som en pull request."
        : "Kan leses, redigeres for hånd og eksporteres, men ikke vises i forhåndsvisningen ennå. Det krever kjøring av prosjektet i et isolert miljø (kommer i fase 4).",
  };
}
