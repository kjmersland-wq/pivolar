import type { Classification } from "../stack/classify.ts";
import type { HostId } from "./catalog.ts";
import { serverFiles, type Target } from "./server-files.ts";

/**
 * The files a host needs next to the site, written into the published repository. Every host gets
 * the same build (npm run build, output in dist); only the settings that tell it so differ.
 */

const NETLIFY = `[build]
  command = "npm run build"
  publish = "dist"

# The site is one page that changes itself, so every address opens index.html.
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`;

const wrangler = (name: string) =>
  JSON.stringify({ name, compatibility_date: "2026-10-01", build: { command: "npm install && npm run build" }, assets: { directory: "./dist", not_found_handling: "single-page-application" } }, null, 2) + "\n";

const render = (name: string) => `services:
  - type: web
    name: ${name}
    runtime: static
    buildCommand: npm install && npm run build
    staticPublishPath: dist
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
`;

const PAGES_WORKFLOW = `name: Publiser til GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm install
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
`;

const DOCKERFILE = `FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
`;

const CADDYFILE = `# Sett DOMAIN til domenet ditt (for eksempel minside.no) så ordner Caddy https selv.
# Uten DOMAIN svarer serveren på port 80 uten https, for testing.
{$DOMAIN::80} {
	root * /srv
	encode zstd gzip
	try_files {path} /index.html
	file_server
}
`;

const COMPOSE = `services:
  web:
    build: .
    restart: unless-stopped
    environment:
      DOMAIN: \${DOMAIN:-:80}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - caddy_data:/data

volumes:
  caddy_data:
`;

const HOSTING_MD = `# Legge siden på din egen server (Hetzner eller lignende)

1. Lag en server med Ubuntu, og installer Docker (https://docs.docker.com/engine/install/ubuntu/).
2. Hent koden: \`git clone <adressen til repoet ditt> && cd <mappen>\`
3. Start: \`DOMAIN=ditt-domene.no docker compose up -d --build\` (uten DOMAIN kjører den på port 80 uten https).
4. Pek domenet (A-oppføring) mot serverens IP-adresse.
5. Oppdatere senere: \`git pull && docker compose up -d --build\`.

Serveren har ingen database og ingen serverfunksjoner. Den serverer bare filene i dist. Husk sikkerhetskopier og at serveren må oppdateres jevnlig (\`apt update && apt upgrade\`).
`;

/** What the settings files are made from: the project's files and what the stack classification found. Without it a site of only files is assumed. */
export type ProjectInfo = { files: Record<string, string>; classification: Classification };

const SERVER_HOSTS = new Set<HostId>(["hetzner", "render", "railway"]);

export function hostFiles(host: HostId, name: string, project?: ProjectInfo): Record<string, string> {
  // A project with a server of its own gets a Dockerfile for its language instead of the files-only setup.
  if (project && SERVER_HOSTS.has(host) && project.classification.delivery !== "files") return serverFiles(host as Target, name, project.files, project.classification);
  switch (host) {
    case "netlify":
      return { "netlify.toml": NETLIFY };
    case "cloudflare":
      return { "wrangler.jsonc": wrangler(name) };
    case "render":
      return { "render.yaml": render(name) };
    case "github-pages":
      return { ".github/workflows/pages.yml": PAGES_WORKFLOW };
    case "hetzner":
      return { Dockerfile: DOCKERFILE, Caddyfile: CADDYFILE, "docker-compose.yml": COMPOSE, "HOSTING.md": HOSTING_MD };
    default:
      return {};
  }
}

/** The host's own page for deploying a repository. Only for hosts that have one; the others are steps to follow. */
export function deployLink(host: HostId, repoUrl: string): string | null {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repoUrl)) return null;
  const encoded = encodeURIComponent(repoUrl);
  switch (host) {
    case "netlify":
      return `https://app.netlify.com/start/deploy?repository=${encoded}`;
    case "cloudflare":
      return `https://deploy.workers.cloudflare.com/?url=${encoded}`;
    case "render":
      return `https://render.com/deploy?repo=${encoded}`;
    case "github-pages":
      return `${repoUrl}/settings/pages`;
    default:
      return null;
  }
}

/** The settings files for a host that the project does not already have, so nothing the owner wrote is replaced. */
export function missingHostFiles(host: HostId, name: string, project: ProjectInfo): Record<string, string> {
  const wanted = hostFiles(host, name, project);
  return Object.fromEntries(Object.entries(wanted).filter(([path]) => !(`/${path}` in project.files)));
}
