import assert from "node:assert/strict";
import { parse } from "yaml";
import { HOSTS, hostById } from "../src/lib/hosting/catalog.ts";
import { hostFiles, missingHostFiles } from "../src/lib/hosting/files.ts";
import { adviceFor, estimateCost, formatMoney, rank, TABLE } from "../src/lib/hosting/rules.ts";
import { composeFor, dockerfileFor, serverFiles } from "../src/lib/hosting/server-files.ts";
import { classifyStack } from "../src/lib/stack/classify.ts";
import { analyze } from "../src/lib/zip/analyze.ts";

const pkg = (over: Record<string, unknown>) => JSON.stringify({ name: "x", ...over });
const web = (deps: Record<string, string>, extra: Record<string, unknown> = {}) => ({ "/package.json": pkg({ dependencies: deps, scripts: { build: "build" }, ...extra }) });
const kind = (files: Record<string, string>) => {
  const c = classifyStack(files);
  return `${c.stack}/${c.delivery}`;
};

// --- the three groups
{
  assert.equal(kind({ "/index.html": "<h1>Hei</h1>" }), "static/files");
  assert.equal(kind({ "/README.md": "tekst" }), "static/files");
  assert.equal(kind({}), "static/files");
  assert.equal(kind(web({}, { devDependencies: { vite: "^6" } })), "static/files", "a build without a framework is only files");
  assert.equal(kind(web({ react: "19", "react-dom": "19" }, { devDependencies: { vite: "^6" } })), "frontend/files");
  assert.equal(classifyStack(web({ react: "19" }, { devDependencies: { vite: "^6" } })).framework, "Vite + React");
  // Pivolar's own sites
  assert.equal(kind({ "/App.tsx": "x" }), "frontend/files");
  const withFunctions = classifyStack({ "/App.tsx": "x", "/api/subscribe.ts": "x" });
  assert.equal(withFunctions.functions, true);
  assert.equal(withFunctions.stack, "frontend");
  assert.equal(classifyStack({ "/App.tsx": "x" }).functions, false);
  assert.equal(classifyStack({ "/index.html": "x", "/api/x.js": "x" }).functions, true, "a plain site with /api functions");
  assert.equal(classifyStack({ ...web({ react: "19" }), "/api/x.ts": "x" }).functions, false, "a project with its own package.json brings its own api folder");
}

// --- frameworks: the same framework is files or server depending on how it is set up
{
  assert.equal(kind(web({ next: "16", react: "19" })), "frontend/ssr");
  assert.equal(kind({ ...web({ next: "16", react: "19" }), "/next.config.mjs": 'export default { output: "export" };' }), "frontend/files", "Next.js exported to files");
  assert.equal(kind(web({ astro: "5" })), "frontend/files");
  assert.equal(kind(web({ astro: "5", "@astrojs/node": "9" })), "frontend/ssr");
  assert.equal(kind(web({ nuxt: "4" }, { scripts: { build: "nuxt build" } })), "frontend/ssr");
  assert.equal(kind(web({ nuxt: "4" }, { scripts: { build: "nuxt generate" } })), "frontend/files");
  assert.equal(kind(web({ "@sveltejs/kit": "2" })), "frontend/ssr");
  assert.equal(kind(web({ "@sveltejs/kit": "2", "@sveltejs/adapter-static": "3" })), "frontend/files");
  assert.equal(kind(web({ "@tanstack/react-start": "1", react: "19" })), "frontend/ssr");
  assert.equal(kind(web({ "@remix-run/react": "2", react: "19" })), "frontend/ssr");
  assert.equal(kind(web({ gatsby: "5", react: "19" })), "frontend/files");
}

// --- full stack: it must keep running, or it brings its own database
{
  assert.equal(kind(web({ express: "5" })), "fullstack/server");
  assert.equal(kind(web({ react: "19", express: "5" })), "fullstack/server", "a server pulls the whole project into full stack");
  assert.equal(kind(web({ next: "16", react: "19", "@prisma/client": "6" })), "fullstack/server", "Next.js with its own database");
  assert.equal(kind(web({ fastify: "5" })), "fullstack/server");
  assert.equal(kind({ "/package.json": pkg({ scripts: { start: "node server.js" } }) }), "fullstack/server", "a start script that runs node");
  assert.equal(kind({ "/Dockerfile": "FROM node", ...web({ react: "19" }) }), "fullstack/server");
  assert.equal(classifyStack({ "/docker-compose.yml": "services: {}" }).docker, true);
  assert.equal(kind({ "/requirements.txt": "fastapi\nuvicorn" }), "fullstack/server");
  assert.equal(kind({ "/go.mod": "module x" }), "fullstack/server");
  assert.equal(classifyStack({ "/go.mod": "module x" }).runtime, "go");
  assert.equal(classifyStack({ "/Gemfile": "gem 'rails'" }).runtime, "ruby");
  assert.equal(kind({ "/Gemfile": "gem 'jekyll'", "/index.md": "x" }), "static/files", "Jekyll builds files");
  // Hosted databases are not a database of its own
  assert.equal(kind(web({ react: "19", "@supabase/supabase-js": "2" }, { devDependencies: { vite: "^6" } })), "frontend/files");
  // Which database
  assert.equal(classifyStack(web({ pg: "8" })).database, "postgres");
  assert.equal(classifyStack(web({ mysql2: "3" })).database, "mysql");
  assert.equal(classifyStack(web({ mongoose: "8" })).database, "mongo");
  assert.equal(classifyStack(web({ "better-sqlite3": "11" })).database, "sqlite");
  assert.equal(classifyStack({ ...web({ "@prisma/client": "6" }), "/prisma/schema.prisma": 'provider = "mysql"' }).database, "mysql", "the schema says which one an ORM talks to");
  assert.equal(classifyStack(web({ "drizzle-orm": "1" })).database, "postgres", "the most common one when nothing says");
}

// --- other languages and CMS
{
  const fast = classifyStack({ "/requirements.txt": "fastapi\nuvicorn" });
  assert.deepEqual([fast.runtime, fast.framework, fast.port], ["python", "FastAPI", 8000]);
  assert.equal(classifyStack({ "/requirements.txt": "Django==5.0\npsycopg2" }).framework, "Django");
  assert.equal(classifyStack({ "/requirements.txt": "flask" }).framework, "Flask");
  const wp = classifyStack({ "/wp-config.php": "<?php", "/wp-content/themes/x/style.css": "x" });
  assert.deepEqual([wp.stack, wp.runtime, wp.framework, wp.database, wp.port], ["fullstack", "php", "WordPress", "mysql", 80]);
  assert.equal(classifyStack({ "/configuration.php": "<?php", "/administrator/index.php": "x" }).framework, "Joomla");
  assert.equal(classifyStack({ "/sites/default/settings.php": "<?php", "/index.php": "x" }).framework, "Drupal");
  assert.equal(classifyStack({ "/index.php": "<?php" }).framework, "PHP");
}

// --- same input, same answer, and a reason for every answer
{
  const files = web({ express: "5", pg: "8" });
  assert.deepEqual(classifyStack(files), classifyStack(files));
  assert.equal(kind({ "/package.json": "{ not json" }), "static/files", "a broken package.json is ignored, not a crash");
  for (const f of [{ "/index.html": "x" }, files, web({ next: "16" }), { "/App.tsx": "x" }, {}]) assert.ok(classifyStack(f).reasons.length > 0);
  assert.match(classifyStack(files).reasons.join(" "), /express/);
  assert.match(classifyStack(files).reasons.join(" "), /Postgres/);
}

// --- the table: stack and delivery to host
{
  const best = (profile: Parameters<typeof rank>[0]) => rank(profile)[0]!.host.id;
  assert.equal(best({ functions: false, commercial: false, stack: "static", delivery: "files" }), "cloudflare");
  assert.equal(best({ functions: false, commercial: false, stack: "frontend", delivery: "files" }), "cloudflare");
  assert.equal(best({ functions: false, commercial: false, stack: "frontend", delivery: "ssr" }), "vercel");
  assert.equal(best({ functions: false, commercial: false, stack: "fullstack", delivery: "server" }), "hetzner");
  const full = Object.fromEntries(rank({ functions: false, commercial: false, stack: "fullstack", delivery: "server" }).map((a) => [a.host.id, a.fit]));
  assert.deepEqual(full, { hetzner: "best", render: "ok", railway: "ok", vercel: "no", cloudflare: "no", netlify: "no", "github-pages": "no" });
  // Every host has an answer in every row, so a new host cannot be forgotten
  for (const [row, hosts] of Object.entries(TABLE)) if (row !== "static/files" && row !== "frontend/files") for (const h of HOSTS) assert.ok(h.id in hosts, `${row} has an answer for ${h.id}`);
  assert.equal(TABLE["static/files"], TABLE["frontend/files"], "files are files");
  // Overrides come before the table
  assert.equal(adviceFor(hostById("hetzner"), { functions: true, commercial: false, stack: "fullstack", delivery: "server" }).fit, "no", "functions written for Vercel stay on Vercel");
  assert.equal(adviceFor(hostById("vercel"), { functions: true, commercial: false, stack: "frontend", delivery: "files" }).fit, "best");
  assert.equal(adviceFor(hostById("github-pages"), { functions: false, commercial: true, stack: "static", delivery: "files" }).fit, "no");
  assert.equal(adviceFor(hostById("github-pages"), { functions: false, commercial: false, stack: "static", delivery: "files" }).fit, "ok");
  assert.match(adviceFor(hostById("vercel"), { functions: false, commercial: true, stack: "static", delivery: "files" }).why, /Pro/);
  assert.equal(rank({ functions: false, commercial: false }).at(-1)!.fit === "overkill" || rank({ functions: false, commercial: false }).at(-1)!.fit === "no", true, "the worst fit is last");
}

// --- price estimates, from numbers and without AI
{
  const files = { functions: false, commercial: false, stack: "static", delivery: "files" } as const;
  assert.equal(estimateCost(hostById("cloudflare"), files).label, "gratis");
  assert.equal(estimateCost(hostById("vercel"), files).label, "gratis");
  assert.equal(estimateCost(hostById("vercel"), { ...files, commercial: true }).label, "20 USD i måneden", "a shop needs Pro");
  assert.equal(estimateCost(hostById("cloudflare"), { ...files, delivery: "ssr" }).label, "5 USD i måneden", "server code is on the paid plan");
  assert.equal(estimateCost(hostById("cloudflare"), { ...files, functions: true }).label, "5 USD i måneden");
  assert.equal(estimateCost(hostById("hetzner"), { ...files, stack: "fullstack", delivery: "server" }).label, "ca. 6 EUR i måneden");
  assert.equal(estimateCost(hostById("render"), { ...files, stack: "fullstack", delivery: "server" }).label, "7 USD i måneden");
  assert.equal(estimateCost(hostById("render"), files).label, "sjekk hos leverandøren", "unknown stays unknown");
  assert.equal(estimateCost(hostById("github-pages"), { ...files, delivery: "server" }).money, null);
  assert.equal(formatMoney({ amount: 0, currency: "EUR" }), "gratis");
  for (const h of HOSTS) assert.ok(h.cost.files === null || h.cost.files.amount >= 0);
}

// --- the files for a server
{
  const next = { ...web({ next: "16", react: "19" }, { scripts: { build: "next build", start: "next start" } }), "/package-lock.json": "{}" };
  const nc = classifyStack(next);
  const docker = dockerfileFor(nc, next)!;
  assert.match(docker, /^FROM node:22-slim AS build/);
  assert.match(docker, /COPY package\.json package-lock\.json \.\/\nRUN npm ci/);
  assert.match(docker, /RUN npm run build/);
  assert.match(docker, /EXPOSE 3000\nCMD \["npm", "start"\]/);
  const noLock: Record<string, string> = { ...next };
  delete noLock["/package-lock.json"];
  assert.match(dockerfileFor(classifyStack(noLock), noLock) ?? "", /COPY package\.json \.\/\nRUN npm install/, "without a lockfile, npm install");
  const pnpm = { ...web({ express: "5" }, { scripts: { build: "tsc", start: "node dist/index.js" } }), "/pnpm-lock.yaml": "x" };
  assert.match(dockerfileFor(classifyStack(pnpm), pnpm)!, /COPY package\.json pnpm-lock\.yaml \.\/\nRUN corepack enable && pnpm install --frozen-lockfile[\s\S]*RUN pnpm run build/);
  const bun = { ...web({ express: "5" }), "/bun.lock": "x" };
  assert.match(dockerfileFor(classifyStack(bun), bun)!, /npm install -g bun && bun install --frozen-lockfile/);
  const tanstack = web({ "@tanstack/react-start": "1", react: "19" });
  const td = dockerfileFor(classifyStack(tanstack), tanstack)!;
  assert.match(td, /ENV NITRO_PRESET=node-server/, "built for a Node server, not for Cloudflare");
  assert.match(td, /CMD \["node", "\.output\/server\/index\.mjs"\]/);
  const noBuild = { "/package.json": pkg({ dependencies: { express: "5" }, scripts: { start: "node a.js" } }) };
  assert.doesNotMatch(dockerfileFor(classifyStack(noBuild), noBuild)!, /RUN npm run build/, "no build script, no build step");

  const py = { "/requirements.txt": "fastapi\nuvicorn\n" };
  const pd = dockerfileFor(classifyStack(py), py)!;
  assert.match(pd, /FROM python:3\.12-slim/);
  assert.match(pd, /pip install --no-cache-dir -r requirements\.txt/);
  assert.match(pd, /uvicorn main:app --host 0\.0\.0\.0 --port \$\{PORT:-8000\}/);
  assert.match(pd, /EXPOSE 8000/);
  const dj = { "/requirements.txt": "django\n", "/manage.py": "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mysite.settings')" };
  assert.match(dockerfileFor(classifyStack(dj), dj)!, /gunicorn mysite\.wsgi/);
  assert.match(dockerfileFor(classifyStack({ "/wp-config.php": "<?php" }), { "/wp-config.php": "<?php" })!, /FROM php:8\.3-apache/);
  assert.equal(dockerfileFor(classifyStack({ "/go.mod": "module x" }), { "/go.mod": "module x" }), null, "no template, and it says so");
}

// --- compose: the database the project needs, and valid YAML
{
  const compose = (files: Record<string, string>) => composeFor(classifyStack(files));
  const pg = compose(web({ express: "5", pg: "8" }));
  const parsed = parse(pg) as { services: Record<string, { image?: string; environment?: Record<string, string>; depends_on?: string[]; ports?: string[] }>; volumes: Record<string, unknown> };
  assert.deepEqual(Object.keys(parsed.services), ["app", "db"]);
  assert.equal(parsed.services.db!.image, "postgres:16-alpine");
  assert.match(parsed.services.app!.environment!.DATABASE_URL!, /^postgres:\/\/postgres:\$\{DB_PASSWORD\}@db:5432\/app$/);
  assert.deepEqual(parsed.services.app!.depends_on, ["db"]);
  assert.match(parsed.services.db!.environment!.POSTGRES_PASSWORD!, /DB_PASSWORD:\?/, "the password must be set, it is never made up");
  assert.deepEqual(Object.keys(parsed.volumes), ["data"]);
  assert.equal(parsed.services.app!.ports![0], "${PORT:-3000}:3000");

  const my = parse(compose(web({ mysql2: "3", express: "5" }))) as { services: { db: { image: string } } };
  assert.equal(my.services.db.image, "mariadb:11");
  const mongo = parse(compose(web({ mongoose: "8" }))) as { services: { db: { image: string }; app: { environment: { DATABASE_URL: string } } } };
  assert.equal(mongo.services.db.image, "mongo:7");
  assert.equal(mongo.services.app.environment.DATABASE_URL, "mongodb://db:27017/app");
  const sqlite = parse(compose(web({ "better-sqlite3": "11", express: "5" }))) as { services: Record<string, { volumes?: string[] }>; volumes: Record<string, unknown> };
  assert.deepEqual(Object.keys(sqlite.services), ["app"], "a file database needs no database server");
  assert.deepEqual(sqlite.services.app!.volumes, ["data:/data"], "but it must survive a restart");
  const plain = parse(compose(web({ express: "5" }))) as { services: Record<string, unknown>; volumes?: unknown };
  assert.deepEqual(Object.keys(plain.services), ["app"]);
  assert.equal(plain.volumes, undefined);
  const py = parse(composeFor(classifyStack({ "/requirements.txt": "fastapi\n" }))) as { services: { app: { ports: string[] } } };
  assert.equal(py.services.app.ports[0], "${PORT:-8000}:8000");
}

// --- Hetzner with Coolify, Render and Railway
{
  const files = { ...web({ express: "5", pg: "8" }, { scripts: { build: "tsc", start: "node dist/index.js" } }), "/package-lock.json": "{}" };
  const c = classifyStack(files);
  const h = serverFiles("hetzner", "min-app", files, c);
  assert.deepEqual(Object.keys(h).sort(), [".dockerignore", ".github/workflows/deploy-coolify.yml", "Dockerfile", "HOSTING.md", "docker-compose.yml"]);
  const wf = parse(h[".github/workflows/deploy-coolify.yml"]!) as { name: string; on: { push: { branches: string[] }; workflow_dispatch: unknown }; jobs: { deploy: { steps: { env: Record<string, string>; run: string }[] } } };
  assert.deepEqual(wf.on.push.branches, ["main"]);
  const step = wf.jobs.deploy.steps[0]!;
  assert.deepEqual(Object.keys(step.env), ["COOLIFY_URL", "COOLIFY_TOKEN", "COOLIFY_UUID"]);
  assert.doesNotMatch(step.run, /\$\{\{/, "secrets reach the command as variables, never pasted into it");
  assert.match(step.run, /--fail/);
  assert.match(h[".github/workflows/deploy-coolify.yml"]!, /Sjekk at adressen/, "it says what to double-check");
  assert.match(h[".dockerignore"]!, /\.env\n/, "secrets never go into the image");
  const guide = h["HOSTING.md"]!;
  assert.match(guide, /Postgres/);
  assert.match(guide, /Coolify/);
  assert.match(guide, /git push dokku main/);
  assert.match(guide, /Dockerfile/);
  assert.match(guide, /gjettet/);

  const r = serverFiles("render", "min-app", files, c);
  assert.deepEqual(Object.keys(r).sort(), [".dockerignore", "Dockerfile", "HOSTING.md", "render.yaml"]);
  const ry = parse(r["render.yaml"]!) as { services: { type: string; name: string; runtime: string }[] };
  assert.deepEqual([ry.services[0]!.type, ry.services[0]!.name, ry.services[0]!.runtime], ["web", "min-app", "docker"]);
  assert.match(r["HOSTING.md"]!, /render\.yaml/);
  const rw = serverFiles("railway", "min-app", files, c);
  assert.deepEqual(Object.keys(rw).sort(), [".dockerignore", "Dockerfile", "HOSTING.md"]);
  assert.match(rw["HOSTING.md"]!, /railway\.com\/new/);

  const go = serverFiles("hetzner", "min-app", { "/go.mod": "module x" }, classifyStack({ "/go.mod": "module x" }));
  assert.ok(!("Dockerfile" in go) && !("docker-compose.yml" in go));
  assert.match(go["HOSTING.md"]!, /ingen ferdig mal/);
  assert.ok(".github/workflows/deploy-coolify.yml" in go, "Coolify can build many things by itself");
}

// --- hostFiles picks the server files only when the project needs a server
{
  const files = web({ express: "5" });
  const server = { files, classification: classifyStack(files) };
  assert.ok("Dockerfile" in hostFiles("hetzner", "x", server));
  assert.ok(".github/workflows/deploy-coolify.yml" in hostFiles("hetzner", "x", server));
  const site = { files: { "/index.html": "x" }, classification: classifyStack({ "/index.html": "x" }) };
  assert.ok("Caddyfile" in hostFiles("hetzner", "x", site), "a site of only files still gets the file server");
  assert.ok(!(".github/workflows/deploy-coolify.yml" in hostFiles("hetzner", "x", site)));
  assert.ok("Caddyfile" in hostFiles("hetzner", "x"), "without project info nothing changes");
  assert.deepEqual(hostFiles("vercel", "x", server), {}, "Vercel needs no file");
  // Files the project already has are never replaced
  const mine = { ...files, "/Dockerfile": "FROM mine" };
  const missing = missingHostFiles("hetzner", "x", { files: mine, classification: classifyStack(mine) });
  assert.ok(!("Dockerfile" in missing), "the owner's Dockerfile stays");
  assert.ok("docker-compose.yml" in missing);
}

// --- the import report gets the answer too
{
  const next = analyze(web({ next: "16", react: "19" }));
  assert.deepEqual([next.stack.category, next.stack.delivery, next.stack.host.id], ["frontend", "ssr", "vercel"]);
  assert.equal(next.stack.host.cost, "gratis");
  assert.match(next.stack.reasons.join(" "), /Next\.js/);
  const wp = analyze({ "/wp-config.php": "<?php", "/wp-content/x.php": "x" });
  assert.deepEqual([wp.stack.category, wp.stack.host.id], ["fullstack", "hetzner"]);
  assert.equal(wp.stack.host.cost, "ca. 6 EUR i måneden");
  const html = analyze({ "/index.html": "<h1>x</h1>" });
  assert.deepEqual([html.stack.category, html.stack.host.id, html.stack.host.cost], ["static", "cloudflare", "gratis"]);
}

console.log("stack: all ok");
