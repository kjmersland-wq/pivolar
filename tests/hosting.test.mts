import assert from "node:assert/strict";
import { HOSTS, HOST_IDS, hostById, isHostId } from "../src/lib/hosting/catalog.ts";
import { deployLink, hostFiles } from "../src/lib/hosting/files.ts";
import { advise, profileOf, recommended } from "../src/lib/hosting/recommend.ts";
import { buildDeployableProject } from "../src/lib/publish/project.ts";

const app = (extra: Record<string, string> = {}) => ({ "/App.tsx": "export default function App() { return <h1>Hei</h1>; }\n", ...extra });

// --- the catalog
{
  assert.deepEqual(HOST_IDS, ["vercel", "cloudflare", "netlify", "github-pages", "render", "hetzner"]);
  assert.equal(new Set(HOST_IDS).size, HOSTS.length);
  for (const h of HOSTS) {
    assert.match(h.source, /^https:\/\//, `${h.id} has a source`);
    assert.match(h.checked, /^\d{4}-\d{2}-\d{2}$/, `${h.id} says when the price was checked`);
    assert.ok(h.price.length > 20 && h.summary.length > 20 && h.steps.length > 0, `${h.id} is described`);
  }
  assert.deepEqual(HOSTS.filter((h) => h.functions).map((h) => h.id), ["vercel"], "server functions are written for Vercel only");
  assert.equal(hostById("github-pages").noCommerce, true);
  assert.equal(isHostId("netlify"), true);
  assert.equal(isHostId("evil"), false);
  assert.equal(isHostId(undefined), false);
}

// --- what a site needs
{
  assert.deepEqual(profileOf(app()), { functions: false, commercial: false });
  assert.equal(profileOf(app({ "/api/subscribe.ts": "x" })).functions, true);
  assert.equal(profileOf(app({ "/components/Buy.tsx": 'const url = "https://buy.stripe.com/abc";' })).commercial, true);
  assert.equal(profileOf(app({ "/components/Pricing.tsx": "Priser fra 99 kr. Meld deg på nyhetsbrevet." })).commercial, false, "a price list is not a shop");
  assert.equal(profileOf(app({ "/components/Buy.tsx": "Paddle.Checkout.open({})" })).commercial, true);
}

// --- the advice
{
  const fits = (profile: Parameters<typeof advise>[0]) => Object.fromEntries(advise(profile).map((a) => [a.host.id, a.fit]));
  const staticSite = fits({ functions: false, commercial: false });
  assert.deepEqual(staticSite, { vercel: "ok", cloudflare: "best", netlify: "ok", "github-pages": "ok", render: "overkill", hetzner: "overkill" });
  assert.equal(advise({ functions: false, commercial: false })[0]!.host.id, "cloudflare");
  const withFunctions = fits({ functions: true, commercial: false });
  assert.equal(withFunctions.vercel, "best");
  for (const id of ["cloudflare", "netlify", "github-pages", "render", "hetzner"]) assert.equal(withFunctions[id], "no", `${id} cannot run the functions`);
  const shop = fits({ functions: false, commercial: true });
  assert.equal(shop["github-pages"], "no", "free GitHub hosting forbids shops");
  assert.equal(shop.cloudflare, "best");
  assert.match(advise({ functions: false, commercial: true }).find((a) => a.host.id === "vercel")!.why, /Pro/);
  assert.equal(advise({ functions: true, commercial: true }).at(-1)!.fit, "no", "what does not fit comes last");
  assert.equal(recommended({ functions: true, commercial: false }), "vercel");
  assert.equal(recommended({ functions: false, commercial: false }), "cloudflare");
  for (const a of advise({ functions: true, commercial: false })) assert.ok(a.why.length > 10);
}

// --- settings files per host
{
  assert.deepEqual(hostFiles("vercel", "min-side"), {});
  assert.match(hostFiles("netlify", "min-side")["netlify.toml"]!, /command = "npm run build"[\s\S]*publish = "dist"[\s\S]*from = "\/\*"[\s\S]*status = 200/);
  const wrangler = JSON.parse(hostFiles("cloudflare", "min-side")["wrangler.jsonc"]!) as { name: string; assets: { directory: string; not_found_handling: string }; build: { command: string } };
  assert.equal(wrangler.name, "min-side");
  assert.equal(wrangler.assets.directory, "./dist");
  assert.equal(wrangler.assets.not_found_handling, "single-page-application");
  assert.match(wrangler.build.command, /npm run build/);
  const render = hostFiles("render", "min-side")["render.yaml"]!;
  assert.match(render, /runtime: static/);
  assert.match(render, /staticPublishPath: dist/);
  assert.match(render, /name: min-side/);
  const pages = hostFiles("github-pages", "min-side")[".github/workflows/pages.yml"]!;
  assert.match(pages, /\$\{\{ steps\.deployment\.outputs\.page_url \}\}/, "the workflow expression is written as GitHub expects it");
  assert.doesNotMatch(pages, /\\\$/, "no stray backslash");
  assert.match(pages, /path: dist/);
  const own = hostFiles("hetzner", "min-side");
  assert.deepEqual(Object.keys(own), ["Dockerfile", "Caddyfile", "docker-compose.yml", "HOSTING.md"]);
  assert.match(own.Dockerfile!, /npm run build[\s\S]*COPY --from=build \/app\/dist \/srv/);
  assert.match(own.Caddyfile!, /try_files \{path\} \/index\.html/);
  assert.match(own["docker-compose.yml"]!, /DOMAIN: \$\{DOMAIN:-:80\}/);
  assert.match(own["HOSTING.md"]!, /docker compose up -d --build/);
}

// --- the buttons that open the host's own deploy page
{
  const repo = "https://github.com/kari/min-side";
  assert.equal(deployLink("netlify", repo), `https://app.netlify.com/start/deploy?repository=${encodeURIComponent(repo)}`);
  assert.equal(deployLink("cloudflare", repo), `https://deploy.workers.cloudflare.com/?url=${encodeURIComponent(repo)}`);
  assert.equal(deployLink("render", repo), `https://render.com/deploy?repo=${encodeURIComponent(repo)}`);
  assert.equal(deployLink("github-pages", repo), `${repo}/settings/pages`);
  assert.equal(deployLink("vercel", repo), null);
  assert.equal(deployLink("hetzner", repo), null);
  assert.equal(deployLink("netlify", "https://evil.example/kari/min-side"), null, "only GitHub repositories");
  assert.equal(deployLink("netlify", "https://github.com/kari/min-side/../../x"), null);
}

// --- the published project carries the host's settings, and never overwrites a file the site has
{
  const base = buildDeployableProject(app(), "Min side");
  assert.ok(!("netlify.toml" in base) && !("wrangler.jsonc" in base), "nothing extra by default");
  const netlify = buildDeployableProject(app(), "Min side", { host: "netlify" });
  assert.ok("netlify.toml" in netlify);
  assert.ok("vercel.json" in netlify, "the security headers file is harmless elsewhere");
  assert.equal(JSON.parse(buildDeployableProject(app(), "Min side", { host: "cloudflare" })["wrangler.jsonc"]!).name, "min-side");
  assert.ok(".github/workflows/pages.yml" in buildDeployableProject(app(), "Min side", { host: "github-pages" }));
  assert.ok(".github/workflows/ci.yml" in buildDeployableProject(app(), "Min side", { host: "github-pages" }), "the test workflow stays");
  assert.ok("Dockerfile" in buildDeployableProject(app(), "Min side", { host: "hetzner" }));
  const taken = buildDeployableProject({ ...app(), "/netlify.toml": "x" }, "Min side", { host: "netlify" });
  assert.equal(taken["src/netlify.toml"], "x", "the site's own file stays where it was put");
}

console.log("hosting: all ok");
