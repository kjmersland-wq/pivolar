import type { Classification, DbKind } from "../stack/classify.ts";

/**
 * The files that put a project with a server on a server of its own (Hetzner with Coolify or
 * Dokku, or Render and Railway): a Dockerfile for its language, a compose file with the database it
 * needs, a workflow that tells Coolify to build again, and a guide. They are filled in from fixed
 * templates and from what the stack classification found. No AI is used.
 *
 * The start command is the most likely one for the framework. It is a starting point, and the guide says so.
 */

type Files = Record<string, string>;
export type Target = "hetzner" | "render" | "railway";

const lines = (...parts: (string | false | null | undefined)[]) => parts.filter((p): p is string => typeof p === "string").join("\n") + "\n";

function json(text: string | undefined): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text ?? "") as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Pm = "npm" | "pnpm" | "yarn" | "bun";

function packageManager(files: Files): { pm: Pm; lock: string | null } {
  if ("/bun.lock" in files || "/bun.lockb" in files) return { pm: "bun", lock: "/bun.lock" in files ? "bun.lock" : "bun.lockb" };
  if ("/pnpm-lock.yaml" in files) return { pm: "pnpm", lock: "pnpm-lock.yaml" };
  if ("/yarn.lock" in files) return { pm: "yarn", lock: "yarn.lock" };
  return { pm: "npm", lock: "/package-lock.json" in files ? "package-lock.json" : null };
}

function nodeStart(c: Classification, files: Files): string {
  const pkg = json(files["/package.json"]);
  const scripts = (pkg?.scripts as Record<string, string>) ?? {};
  const deps = { ...((pkg?.dependencies as Record<string, string>) ?? {}), ...((pkg?.devDependencies as Record<string, string>) ?? {}) };
  if (c.framework === "TanStack Start" || c.framework === "Nuxt") return '["node", ".output/server/index.mjs"]';
  if (c.framework === "Astro" && "@astrojs/node" in deps) return '["node", "./dist/server/entry.mjs"]';
  if (c.framework === "SvelteKit" && "@sveltejs/adapter-node" in deps) return '["node", "build"]';
  if (scripts.start) return '["npm", "start"]';
  const main = typeof pkg?.main === "string" ? pkg.main : null;
  return JSON.stringify(["node", main ?? "server.js"]).replace(/","/g, '", "');
}

function nodeDockerfile(c: Classification, files: Files): string {
  const { pm, lock } = packageManager(files);
  const pkg = json(files["/package.json"]);
  const scripts = (pkg?.scripts as Record<string, string>) ?? {};
  const install =
    pm === "pnpm" ? "RUN corepack enable && pnpm install --frozen-lockfile"
    : pm === "yarn" ? "RUN corepack enable && yarn install --frozen-lockfile"
    : pm === "bun" ? "RUN npm install -g bun && bun install --frozen-lockfile"
    : lock ? "RUN npm ci" : "RUN npm install";
  const build = scripts.build ? (pm === "npm" ? "RUN npm run build" : pm === "bun" ? "RUN bun run build" : `RUN ${pm} run build`) : null;
  // These frameworks build for Cloudflare unless told otherwise; a normal server needs the Node target.
  const nitro = c.framework === "TanStack Start" || c.framework === "Nuxt";
  return lines(
    "FROM node:22-slim AS build",
    "WORKDIR /app",
    `COPY package.json ${lock ?? ""}`.trimEnd() + " ./",
    install,
    "COPY . .",
    nitro && "# Bygger for en vanlig Node-server (standard er Cloudflare).",
    nitro && "ENV NITRO_PRESET=node-server",
    build,
    "",
    "FROM node:22-slim",
    "WORKDIR /app",
    "ENV NODE_ENV=production",
    `ENV PORT=${c.port}`,
    "# Hele byggemappen følger med, også pakkene som bare trengs under bygging. Det er enkelt og trygt, men kan gjøres mindre senere.",
    "COPY --from=build /app ./",
    `EXPOSE ${c.port}`,
    `CMD ${nodeStart(c, files)}`,
  );
}

function pythonDockerfile(c: Classification, files: Files): string {
  const text = `${files["/requirements.txt"] ?? ""}\n${files["/pyproject.toml"] ?? ""}`.toLowerCase();
  const settings = /DJANGO_SETTINGS_MODULE['"],\s*['"]([\w.]+)\.settings/.exec(files["/manage.py"] ?? "")?.[1];
  const start =
    c.framework === "FastAPI" ? 'CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]'
    : c.framework === "Django" && settings ? `CMD ["sh", "-c", "gunicorn ${settings}.wsgi --bind 0.0.0.0:\${PORT:-8000}"]`
    : c.framework === "Flask" ? 'CMD ["sh", "-c", "gunicorn app:app --bind 0.0.0.0:${PORT:-8000}"]'
    : 'CMD ["python", "main.py"]';
  const server = c.framework === "Flask" && !text.includes("gunicorn") ? 'RUN pip install --no-cache-dir gunicorn' : c.framework === "Django" && !text.includes("gunicorn") ? "RUN pip install --no-cache-dir gunicorn" : c.framework === "FastAPI" && !text.includes("uvicorn") ? 'RUN pip install --no-cache-dir "uvicorn[standard]"' : null;
  const install = "/requirements.txt" in files ? "COPY requirements.txt ./\nRUN pip install --no-cache-dir -r requirements.txt" : "/pyproject.toml" in files ? "COPY pyproject.toml ./\nRUN pip install --no-cache-dir ." : null;
  return lines("FROM python:3.12-slim", "WORKDIR /app", "ENV PYTHONUNBUFFERED=1", install, server, "COPY . .", `ENV PORT=${c.port}`, `EXPOSE ${c.port}`, "# Startkommandoen er gjettet ut fra rammeverket. Sjekk at den peker på riktig fil.", start);
}

function phpDockerfile(): string {
  return lines(
    "FROM php:8.3-apache",
    "RUN docker-php-ext-install mysqli pdo pdo_mysql && a2enmod rewrite",
    "COPY . /var/www/html/",
    "RUN chown -R www-data:www-data /var/www/html",
    "EXPOSE 80",
  );
}

export function dockerfileFor(c: Classification, files: Files): string | null {
  if (c.runtime === "node") return nodeDockerfile(c, files);
  if (c.runtime === "python") return pythonDockerfile(c, files);
  if (c.runtime === "php") return phpDockerfile();
  return null;
}

const DB: Record<DbKind, { image: string; env: string[]; url: string; volume: string; label: string }> = {
  postgres: { image: "postgres:16-alpine", env: ["POSTGRES_PASSWORD: ${DB_PASSWORD:?Sett DB_PASSWORD i .env}", "POSTGRES_DB: app"], url: "postgres://postgres:${DB_PASSWORD}@db:5432/app", volume: "/var/lib/postgresql/data", label: "Postgres" },
  mysql: { image: "mariadb:11", env: ["MARIADB_ROOT_PASSWORD: ${DB_PASSWORD:?Sett DB_PASSWORD i .env}", "MARIADB_DATABASE: app"], url: "mysql://root:${DB_PASSWORD}@db:3306/app", volume: "/var/lib/mysql", label: "MariaDB (MySQL-kompatibel)" },
  mongo: { image: "mongo:7", env: [], url: "mongodb://db:27017/app", volume: "/data/db", label: "MongoDB" },
  sqlite: { image: "", env: [], url: "file:/data/app.db", volume: "/data", label: "SQLite-fil" },
};

export function composeFor(c: Classification): string {
  const db = c.database ? DB[c.database] : null;
  const body = [
    "services:",
    "  app:",
    "    build: .",
    "    restart: unless-stopped",
    "    env_file:",
    "      - path: .env",
    "        required: false",
    `    ports:`,
    `      - "\${PORT:-${c.port}}:${c.port}"`,
    db && c.database !== "sqlite" && "    depends_on:",
    db && c.database !== "sqlite" && "      - db",
    db && "    environment:",
    db && `      DATABASE_URL: ${db.url}`,
    db && c.database === "sqlite" && "    volumes:",
    db && c.database === "sqlite" && "      - data:/data",
  ];
  if (db && c.database !== "sqlite") {
    body.push("", "  db:", `    image: ${db.image}`, "    restart: unless-stopped");
    if (db.env.length > 0) body.push("    environment:", ...db.env.map((e) => `      ${e}`));
    body.push("    volumes:", `      - data:${db.volume}`);
  }
  if (db) body.push("", "volumes:", "  data:");
  return lines(...body);
}

const DOCKERIGNORE = lines(".git", "node_modules", ".env", ".env.*", "!.env.example", "*.log", ".next", "dist", ".output", ".DS_Store", "__pycache__", ".venv");

function coolifyWorkflow(): string {
  return lines(
    "# Ber Coolify bygge og rulle ut på nytt hver gang main endres.",
    "# Legg inn tre hemmeligheter i repoet (Settings → Secrets and variables → Actions):",
    "#   COOLIFY_URL   adressen til Coolify, for eksempel https://coolify.dittdomene.no",
    "#   COOLIFY_TOKEN et API-token fra Coolify (Keys & Tokens → API tokens)",
    "#   COOLIFY_UUID  prosjektets UUID (står i adressen til ressursen i Coolify)",
    "# Bruker du Coolifys egen GitHub-app med automatisk utrulling, trenger du ikke denne filen.",
    "# Sjekk at adressen under stemmer med Coolifys dokumentasjon for din versjon (API → Deploy).",
    "name: Rull ut til Coolify",
    "",
    "on:",
    "  push:",
    "    branches: [main]",
    "  workflow_dispatch:",
    "",
    "jobs:",
    "  deploy:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Be Coolify bygge på nytt",
    "        env:",
    "          COOLIFY_URL: ${{ secrets.COOLIFY_URL }}",
    "          COOLIFY_TOKEN: ${{ secrets.COOLIFY_TOKEN }}",
    "          COOLIFY_UUID: ${{ secrets.COOLIFY_UUID }}",
    "        run: |",
    '          curl --fail --silent --show-error --request GET "$COOLIFY_URL/api/v1/deploy?uuid=$COOLIFY_UUID&force=false" --header "Authorization: Bearer $COOLIFY_TOKEN"',
  );
}

function renderYaml(name: string): string {
  return lines("services:", "  - type: web", `    name: ${name}`, "    runtime: docker", "    dockerfilePath: ./Dockerfile", "    plan: starter");
}

function guide(target: Target, c: Classification, hasDockerfile: boolean): string {
  const db = c.database ? DB[c.database].label : null;
  const head = [
    "# Legge prosjektet på en server",
    "",
    `Pivolar har lest prosjektet og kommet til: **${c.framework ?? c.runtime}**, ${c.stack === "fullstack" ? "krever en server som går hele tiden" : "rendres på serveren"}${db ? `, med database (${db})` : ""}.`,
    hasDockerfile ? "" : "Det finnes ingen ferdig mal for dette språket, så det er ingen Dockerfile her. Coolify kan bygge mange prosjekter selv (Nixpacks), så du kan prøve uten.",
    "",
  ];
  const hetzner = [
    "## 1. Server hos Hetzner",
    "Lag en Cloud-server med Ubuntu (de minste koster rundt 6 EUR i måneden med IPv4, uten mva.) og åpne portene 22, 80 og 443.",
    "",
    "## 2. Coolify (anbefalt)",
    "Coolify er en gratis, selvdrevet tjeneste som bygger og kjører prosjektet ditt. Installer den på serveren (se coolify.io/docs for gjeldende kommando), og følg dette:",
    "1. Nytt prosjekt → Ny ressurs → velg GitHub-repoet (privat repo: bruk GitHub-appen eller en deploy key).",
    `2. Byggemetode: **${hasDockerfile ? "Dockerfile" : "Nixpacks"}**${c.database ? " (eller Docker Compose, så følger databasen med fra `docker-compose.yml`)" : ""}.`,
    "3. Legg inn miljøvariablene prosjektet trenger under Environment.",
    "4. Legg inn domenet ditt. Coolify ordner https selv.",
    "5. Trykk Deploy. For automatisk utrulling ved hver endring, bruk Coolifys egen GitHub-app, eller workflowen `.github/workflows/deploy-coolify.yml`.",
    "",
    "## Alternativ: Dokku",
    "Dokku er enklere og mer håndholdt. På serveren: `dokku apps:create min-app`, `dokku domains:add min-app ditt-domene.no`. På maskinen din: `git remote add dokku dokku@SERVER:min-app && git push dokku main`. https: `dokku letsencrypt:enable min-app` (krever pluginen).",
    "",
    "## Uten Coolify eller Dokku",
    "På serveren med Docker: `git clone <repoet> && cd <mappen> && docker compose up -d --build`.",
  ];
  const managed = [
    `## ${target === "render" ? "Render" : "Railway"}`,
    target === "render"
      ? "Åpne render.com/deploy med repoet ditt. Render leser `render.yaml` og bruker Dockerfilen. Legg inn miljøvariabler under Environment."
      : "Åpne railway.com/new, velg «Deploy from GitHub repo», og velg repoet. Railway bruker Dockerfilen. Legg inn miljøvariabler under Variables og lag et domene under Settings → Networking.",
    c.database ? "Databasen legger du til som en egen tjeneste hos leverandøren, og setter `DATABASE_URL` til adressen den gir." : "",
  ];
  const tail = [
    "",
    "## Husk",
    "- Startkommandoen i Dockerfilen er gjettet ut fra rammeverket. Sjekk at den peker på riktig fil.",
    c.database ? "- Databasen i `docker-compose.yml` ligger på samme server. Ta daglig sikkerhetskopi av volumet, eller bruk en administrert database." : "",
    "- Hold serveren oppdatert (`apt update && apt upgrade`) og ta sikkerhetskopier.",
  ];
  return lines(...head, ...(target === "hetzner" ? hetzner : managed), ...tail);
}

/**
 * The files for a project with a server, for the chosen host. Files for languages without a
 * template are left out, and the guide says so.
 */
export function serverFiles(target: Target, name: string, files: Files, c: Classification): Files {
  const dockerfile = dockerfileFor(c, files);
  const out: Files = {};
  if (dockerfile) {
    out["Dockerfile"] = dockerfile;
    out[".dockerignore"] = DOCKERIGNORE;
  }
  if (target === "hetzner") {
    if (dockerfile) out["docker-compose.yml"] = composeFor(c);
    out[".github/workflows/deploy-coolify.yml"] = coolifyWorkflow();
  }
  if (target === "render" && dockerfile) out["render.yaml"] = renderYaml(name);
  out["HOSTING.md"] = guide(target, c, Boolean(dockerfile));
  return out;
}
