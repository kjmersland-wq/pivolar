/**
 * Stack classification: reads the files of a project and puts it in one of three groups, with
 * the reasons in plain words. It is plain if/else on file names and dependencies, with no AI, so
 * the same project always gets the same answer and it costs nothing to run.
 *
 *   static     only files: simple company sites, plain HTML, builds that need no framework
 *   frontend   a front-end app: React, Vue, Next.js and the like, with or without server rendering
 *   fullstack  something that must keep running on a server, or talks to its own database
 */

export type Stack = "static" | "frontend" | "fullstack";
/** files: only files after the build. ssr: the framework's own server renders pages. server: a long-running process of its own. */
export type Delivery = "files" | "ssr" | "server";
export type Runtime = "none" | "node" | "python" | "php" | "ruby" | "go" | "java" | "dotnet";
export type DbKind = "postgres" | "mysql" | "mongo" | "sqlite";

export type Classification = {
  stack: Stack;
  delivery: Delivery;
  runtime: Runtime;
  /** Framework, in words, when one is recognised. */
  framework: string | null;
  /** Server functions under /api (a Pivolar site with a contact form, newsletter or Google). Written for Vercel. */
  functions: boolean;
  docker: boolean;
  /** A database the project runs itself. A hosted service such as Supabase does not count. */
  database: DbKind | null;
  /** The port the app listens on, for the generated Docker files. */
  port: number;
  /** Why, as short phrases. */
  reasons: string[];
};

export const STACK_LABELS: Record<Stack, string> = { static: "Statisk", frontend: "Avansert frontend", fullstack: "Fullstack (krever server)" };

type Files = Record<string, string>;

function json(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const SERVER_DEPS = ["express", "fastify", "hono", "koa", "@nestjs/core", "@hapi/hapi", "restify", "socket.io", "@trpc/server", "apollo-server", "@apollo/server", "graphql-yoga"];
const UI_DEPS = ["react", "vue", "svelte", "solid-js", "preact", "@angular/core", "lit", "alpinejs"];
const BUILD_DEPS = ["vite", "parcel", "webpack", "esbuild", "rollup", "@11ty/eleventy"];

const DB_DEPS: [RegExp, DbKind][] = [
  [/^(pg|postgres|pg-promise|@neondatabase\/serverless|psycopg2?|psycopg)$/, "postgres"],
  [/^(mysql2?|mariadb|mysqlclient|pymysql)$/, "mysql"],
  [/^(mongoose|mongodb|pymongo|motor)$/, "mongo"],
  [/^(better-sqlite3|sqlite3|sqlite)$/, "sqlite"],
];

/** The words of a Python requirements file or pyproject, lowercased, so a package can be looked up by name. */
function pythonDeps(files: Files): Set<string> {
  const text = `${files["/requirements.txt"] ?? ""}\n${files["/pyproject.toml"] ?? ""}\n${files["/Pipfile"] ?? ""}`.toLowerCase();
  return new Set(text.split(/[^a-z0-9_.-]+/).filter(Boolean));
}

export function classifyStack(files: Files): Classification {
  const paths = Object.keys(files);
  const has = (p: RegExp) => paths.some((f) => p.test(f));
  const pkg = json(files["/package.json"]);
  const deps: Record<string, string> = { ...((pkg?.dependencies as Record<string, string>) ?? {}), ...((pkg?.devDependencies as Record<string, string>) ?? {}) };
  const dep = (name: string) => name in deps;
  const scripts = (pkg?.scripts as Record<string, string>) ?? {};
  const py = pythonDeps(files);
  const reasons: string[] = [];

  const docker = has(/^\/(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/);
  const functions = paths.some((p) => p.startsWith("/api/")) && !pkg;

  // --- which language does it run in?
  let runtime: Runtime = pkg ? "node" : "none";
  if (has(/^\/(requirements\.txt|pyproject\.toml|Pipfile|manage\.py)$/)) runtime = "python";
  else if (has(/^\/(composer\.json|wp-config(-sample)?\.php|configuration\.php|artisan)$/) || has(/^\/wp-content\//) || has(/^\/index\.php$/)) runtime = "php";
  else if (has(/^\/Gemfile$/) && !/jekyll/i.test(files["/Gemfile"] ?? "")) runtime = "ruby";
  else if (has(/^\/go\.mod$/)) runtime = "go";
  else if (has(/^\/(pom\.xml|build\.gradle(\.kts)?)$/)) runtime = "java";
  else if (has(/\.csproj$/)) runtime = "dotnet";

  // --- a database the project runs itself
  let database: DbKind | null = null;
  for (const name of [...Object.keys(deps), ...py]) {
    const hit = DB_DEPS.find(([re]) => re.test(name));
    if (hit) {
      database = hit[1];
      break;
    }
  }
  if (!database && (dep("prisma") || dep("@prisma/client") || dep("drizzle-orm") || dep("typeorm") || dep("sequelize") || dep("knex"))) {
    // An ORM says there is a database but not which; the schema or the connection address usually does.
    const hint = `${files["/prisma/schema.prisma"] ?? ""}${files["/drizzle.config.ts"] ?? ""}`.toLowerCase();
    database = /mysql/.test(hint) ? "mysql" : /mongo/.test(hint) ? "mongo" : /sqlite/.test(hint) ? "sqlite" : "postgres";
  }
  if (!database && (py.has("django") || py.has("sqlalchemy"))) database = "postgres";
  if (!database && runtime === "php" && has(/^\/wp-/)) database = "mysql";

  const port = runtime === "python" ? 8000 : runtime === "php" ? 80 : 3000;
  const framework = frameworkOf(files, deps, py, runtime);
  const make = (stack: Stack, delivery: Delivery, why: string[]): Classification => ({ stack, delivery, runtime, framework, functions, docker, database, port, reasons: why });

  // 1. Fullstack: it has to keep running on a server, or it brings its own database
  if (docker) reasons.push("har et Docker-oppsett");
  if (runtime !== "none" && runtime !== "node") reasons.push(`kjører på ${{ python: "Python", php: "PHP", ruby: "Ruby", go: "Go", java: "Java", dotnet: ".NET" }[runtime]}`);
  const serverDep = SERVER_DEPS.find(dep);
  if (serverDep) reasons.push(`bruker serverpakken ${serverDep}`);
  if (database) reasons.push(`har sin egen database (${{ postgres: "Postgres", mysql: "MySQL", mongo: "MongoDB", sqlite: "SQLite" }[database]})`);
  if (pkg && !serverDep && !framework && !UI_DEPS.some(dep) && !BUILD_DEPS.some(dep) && scripts.start && /\bnode\b|ts-node|tsx|nodemon/.test(scripts.start)) reasons.push("har et start-skript som kjører en server");
  if (reasons.length > 0) return make("fullstack", "server", reasons);

  // 2. Front-end app: built into files, or rendered by the framework's own server
  if (pkg) {
    const ssr = ssrFramework(files, deps, scripts);
    if (ssr) return make("frontend", ssr.delivery, [ssr.why]);
    if (UI_DEPS.some(dep)) return make("frontend", "files", [`en ${UI_DEPS.find(dep)}-app som bygges til ferdige filer`]);
    if (BUILD_DEPS.some(dep) || scripts.build) return make("static", "files", ["bygges til ferdige filer uten rammeverk"]);
  }

  // 3. Pivolar's own sites: a React app that is built when it is published
  if (!pkg && paths.includes("/App.tsx")) return make("frontend", "files", [functions ? "en React-side med serverfunksjoner under /api" : "en React-side som bygges til ferdige filer"]);

  // 4. Only files
  if (has(/(^|\/)index\.html$/) || has(/\.html$/)) return make("static", "files", ["ren HTML, ingen bygging eller server"]);
  return make("static", "files", ["bare filer, ingen server eller bygging funnet"]);
}

/** A framework by name, when the files say which one it is. */
function frameworkOf(files: Files, deps: Record<string, string>, py: Set<string>, runtime: Runtime): string | null {
  const d = (n: string) => n in deps;
  if (runtime === "php") {
    const paths = Object.keys(files);
    if (paths.some((p) => /^\/(wp-config(-sample)?\.php|wp-content\/)/.test(p))) return "WordPress";
    if (paths.some((p) => p === "/configuration.php" || p.startsWith("/administrator/"))) return "Joomla";
    if (paths.some((p) => p === "/sites/default/settings.php" || p.startsWith("/core/modules/"))) return "Drupal";
    return "PHP";
  }
  if (runtime === "python") return py.has("django") ? "Django" : py.has("fastapi") ? "FastAPI" : py.has("flask") ? "Flask" : "Python";
  if (d("next")) return "Next.js";
  if (d("@tanstack/react-start")) return "TanStack Start";
  if (d("astro")) return "Astro";
  if (Object.keys(deps).some((n) => n.startsWith("@remix-run/"))) return "Remix";
  if (d("nuxt")) return "Nuxt";
  if (d("@sveltejs/kit")) return "SvelteKit";
  if (d("gatsby")) return "Gatsby";
  if (d("@nestjs/core")) return "NestJS";
  if (d("express")) return "Express";
  if (d("vite") && d("react")) return "Vite + React";
  if (d("vite") && d("vue")) return "Vite + Vue";
  return null;
}

/** Frameworks that can render pages on a server. Says whether this project does, or only builds files. */
function ssrFramework(files: Files, deps: Record<string, string>, scripts: Record<string, string>): { delivery: Delivery; why: string } | null {
  const d = (n: string) => n in deps;
  const config = (names: string[]) => names.map((n) => files[`/${n}`]).find((c) => c !== undefined) ?? "";
  if (d("next")) {
    const exported = /output\s*:\s*["']export["']/.test(config(["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"])) || /next export/.test(scripts.build ?? "");
    return exported ? { delivery: "files", why: "Next.js eksportert til ferdige filer" } : { delivery: "ssr", why: "Next.js med serverrendering" };
  }
  if (d("astro")) return d("@astrojs/node") || d("@astrojs/vercel") || d("@astrojs/cloudflare") || d("@astrojs/netlify") ? { delivery: "ssr", why: "Astro med serverrendering" } : { delivery: "files", why: "Astro bygget til statiske filer" };
  if (d("nuxt")) return /nuxt generate|nuxi generate/.test(`${scripts.build ?? ""} ${scripts.generate ?? ""}`) && !/nuxt build/.test(scripts.build ?? "") ? { delivery: "files", why: "Nuxt generert til statiske filer" } : { delivery: "ssr", why: "Nuxt med serverrendering" };
  if (d("@sveltejs/kit")) return d("@sveltejs/adapter-static") ? { delivery: "files", why: "SvelteKit bygget til statiske filer" } : { delivery: "ssr", why: "SvelteKit med serverrendering" };
  if (d("@tanstack/react-start")) return { delivery: "ssr", why: "TanStack Start med serverrendering" };
  if (Object.keys(deps).some((n) => n.startsWith("@remix-run/"))) return { delivery: "ssr", why: "Remix med serverrendering" };
  if (d("gatsby")) return { delivery: "files", why: "Gatsby bygget til statiske filer" };
  return null;
}
