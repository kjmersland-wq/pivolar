import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { autoHosts, deployAuto, isAutoHost, type Opened } from "../src/lib/deploy/auto.ts";
import { buildDist, type BuildSandbox } from "../src/lib/deploy/build.ts";
import { cloudflareDeploy, cloudflareEnsureProject, deployToCloudflare, pagesHash } from "../src/lib/deploy/cloudflare.ts";
import { checkDist, contentTypeOf, DIST_LIMITS, distPath, withHostRules, type DistFiles } from "../src/lib/deploy/files.ts";
import { deployToNetlify, netlifyEnsureSite } from "../src/lib/deploy/netlify.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const site = (extra: Record<string, string> = {}): DistFiles => new Map(Object.entries({ "/index.html": "<h1>Hei</h1>", "/assets/app.js": "console.log(1)", "/om-oss/index.html": "<h1>Om</h1>", ...extra }).map(([k, v]) => [k, Buffer.from(v)]));

// --- paths from the build machine are checked
assert.equal(distPath("dist/index.html"), "/index.html");
assert.equal(distPath("dist/om-oss/index.html"), "/om-oss/index.html");
assert.equal(distPath("assets/a.js"), "/assets/a.js");
for (const bad of ["", "/etc/passwd", "dist/../x", "a/../../b", "a//b", "a\\b", "x\u0000y", "a/./b", "x".repeat(400)]) assert.equal(distPath(bad), null, JSON.stringify(bad));

// --- what every host gets besides the files
{
  const out = withHostRules(site());
  assert.equal(out.get("/_redirects")?.toString(), "/*  /index.html  200\n");
  assert.match(out.get("/_headers")!.toString(), /X-Content-Type-Options: nosniff/);
  const own = withHostRules(site({ "/_redirects": "/a /b 301\n" }));
  assert.equal(own.get("/_redirects")!.toString(), "/a /b 301\n", "a file the site already has is never replaced");
  assert.ok(!site().has("/_redirects"), "the input is not changed");
  assert.equal(contentTypeOf("/a.webp"), "image/webp");
  assert.equal(contentTypeOf("/a.unknown"), "application/octet-stream");
}

// --- a site that is too big or empty is stopped with a reason
assert.throws(() => checkDist(new Map()), /ingen filer/);
assert.throws(() => checkDist(new Map([["/a.js", Buffer.from("x")]])), /ingen index\.html/);
assert.throws(() => checkDist(new Map([["/index.html", Buffer.alloc(DIST_LIMITS.fileBytes + 1)]])), /er over 25 MB/);
assert.throws(() => checkDist(new Map([["/index.html", Buffer.from("x")], ...Array.from({ length: DIST_LIMITS.files + 1 }, (_, i) => [`/f${i}.txt`, Buffer.from("x")] as const)])), /grensen er/);
assert.doesNotThrow(() => checkDist(site()));

// --- the build machine
type Call = { cmd: string; args?: string[]; cwd?: string; env?: Record<string, string> };
function machine(options: { fail?: string; listing?: string; missing?: string } = {}) {
  const calls: Call[] = [];
  const written: { path: string; size: number }[] = [];
  const dist = new Map([["dist/index.html", "<h1>Hei</h1>"], ["dist/assets/app.js", "x"], ["dist/om-oss/index.html", "<h1>Om</h1>"]]);
  const sandbox: BuildSandbox = {
    async writeFiles(files) {
      for (const f of files) written.push({ path: f.path, size: f.content.byteLength });
    },
    async runCommand(params) {
      calls.push(params);
      const key = `${params.cmd} ${(params.args ?? []).join(" ")}`;
      const failing = options.fail && key.includes(options.fail);
      return { exitCode: failing ? 1 : 0, stdout: async () => (params.cmd === "find" ? options.listing ?? [...dist.keys()].join("\n") + "\n" : ""), stderr: async () => (failing ? "npm ERR! boom\n".repeat(80) : "") };
    },
    async readFileToBuffer({ path }) {
      const name = path.replace("/vercel/sandbox/", "");
      if (options.missing && name.includes(options.missing)) return null;
      const content = dist.get(name);
      return content === undefined ? null : Buffer.from(content);
    },
  };
  return { sandbox, calls, written };
}
{
  const m = machine();
  const steps: string[] = [];
  const dist = await buildDist(m.sandbox, { "package.json": "{}", "src/main.tsx": "x", "public/img.png": { base64: Buffer.from("png").toString("base64") } }, { siteUrl: "https://kaffe.example", onStep: (s) => steps.push(s) });
  assert.deepEqual([...dist.keys()].sort(), ["/assets/app.js", "/index.html", "/om-oss/index.html"]);
  assert.deepEqual(steps, ["write", "install", "build", "read"]);
  assert.deepEqual(m.written.map((w) => w.path), ["/vercel/sandbox/package.json", "/vercel/sandbox/src/main.tsx", "/vercel/sandbox/public/img.png"]);
  assert.equal(m.written[2]!.size, 3, "a picture is written as its bytes");
  assert.deepEqual(m.calls.map((c) => `${c.cmd} ${(c.args ?? []).join(" ")}`), ["npm install --no-audit --no-fund --loglevel=error", "npm run build", "find dist -type f"]);
  assert.deepEqual(m.calls[1]!.env, { SITE_URL: "https://kaffe.example", CI: "1" }, "the build knows the address; nothing else of the owner's is passed");
  assert.ok(m.calls.every((c) => !c.env || Object.keys(c.env).every((k) => ["SITE_URL", "CI"].includes(k))), "no tokens go into the machine");

  await assert.rejects(buildDist(machine({ fail: "run build" }).sandbox, { "package.json": "{}" }), (e: Error) => /^Byggingen feilet:\n/.test(e.message) && e.message.length < 800);
  await assert.rejects(buildDist(machine({ fail: "install" }).sandbox, { "package.json": "{}" }), /Installasjonen av pakker feilet/);
  await assert.rejects(buildDist(machine({ listing: "dist/index.html\ndist/../../etc/passwd\n" }).sandbox, {}), /ugyldig navn/);
  await assert.rejects(buildDist(machine({ missing: "app.js" }).sandbox, {}), /Fant ikke \/assets\/app\.js/);
  await assert.rejects(buildDist(machine({ listing: "dist/a.js\n" }).sandbox, {}), /ingen index\.html|Fant ikke/);
}

// --- a fake of each host's API, to follow what is sent
type Seen = { method: string; url: string; auth: string | null; body?: string };
function netlifyApi(options: { taken?: boolean; deployState?: string[]; unauthorized?: boolean; existing?: boolean } = {}) {
  const seen: Seen[] = [];
  const stored = new Set<string>();
  let polls = 0;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ method: init.method ?? "GET", url, auth: new Headers(init.headers).get("authorization"), ...(typeof init.body === "string" ? { body: init.body } : {}) });
    if (options.unauthorized) return reply({ message: "Access Denied" }, 401);
    const path = url.replace("https://api.netlify.com/api/v1", "");
    if (path.startsWith("/sites?")) return reply(options.existing ? [{ id: "site-1", name: "kaffe", ssl_url: "https://kaffe.netlify.app" }] : []);
    if (path === "/sites" && init.method === "POST") {
      const name = JSON.parse(init.body as string).name as string;
      return options.taken && name === "kaffe" ? reply({ message: "Subdomain must be unique" }, 422) : reply({ id: "site-1", name, ssl_url: `https://${name}.netlify.app` }, 201);
    }
    if (path === "/sites/site-1/deploys" && init.method === "POST") {
      const files = JSON.parse(init.body as string).files as Record<string, string>;
      const hashes = [...new Set(Object.values(files))];
      return reply({ id: "dep-1", required: hashes.filter((h) => !stored.has(h)).slice(0, 100) });
    }
    if (path.startsWith("/deploys/dep-1/files/") && init.method === "PUT") return reply({});
    if (path === "/deploys/dep-1") {
      const state = (options.deployState ?? ["uploading", "ready"])[Math.min(polls++, (options.deployState ?? ["uploading", "ready"]).length - 1)];
      return reply({ state, ssl_url: "https://kaffe.netlify.app", error_message: state === "error" ? "build failed" : undefined });
    }
    return reply({ message: `unexpected ${url}` }, 500);
  }) as typeof fetch;
  return { fetcher, seen, stored };
}
const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");

// --- Netlify
{
  const api = netlifyApi();
  const result = await deployToNetlify("tok", "kaffe", site(), api.fetcher, { pollMs: 1 });
  assert.deepEqual(result, { siteId: "site-1", deployId: "dep-1", url: "https://kaffe.netlify.app", created: true });
  const deployCall = api.seen.find((s) => s.url.endsWith("/sites/site-1/deploys") && s.method === "POST")!;
  const digests = JSON.parse(deployCall.body!).files as Record<string, string>;
  assert.equal(digests["/index.html"], sha1("<h1>Hei</h1>"), "files are named by their SHA-1");
  assert.ok(digests["/_redirects"] && digests["/_headers"], "the fallback and the headers go along");
  const puts = api.seen.filter((s) => s.method === "PUT").map((s) => s.url.replace("https://api.netlify.com/api/v1/deploys/dep-1/files", ""));
  assert.deepEqual(puts.sort(), ["/_headers", "/_redirects", "/assets/app.js", "/index.html", "/om-oss/index.html"].sort(), "what Netlify asks for is uploaded");
  assert.ok(api.seen.every((s) => s.url.startsWith("https://api.netlify.com/") && s.auth === "Bearer tok"), "the key goes only to Netlify");

  // Files Netlify already has are not sent again
  const again = netlifyApi();
  again.stored.add(sha1("<h1>Hei</h1>"));
  await deployToNetlify("tok", "kaffe", site(), again.fetcher, { pollMs: 1 });
  assert.ok(!again.seen.some((s) => s.method === "PUT" && s.url.endsWith("/files/index.html")), "a file it already has is skipped");

  // The site of the same name is reused; a taken name gets a suffix
  const reused = netlifyApi({ existing: true });
  assert.deepEqual((await deployToNetlify("tok", "kaffe", site(), reused.fetcher, { pollMs: 1 })).created, false);
  assert.ok(!reused.seen.some((s) => s.url.endsWith("/sites") && s.method === "POST"), "no second site is made");
  const taken = netlifyApi({ taken: true });
  const ensured = await netlifyEnsureSite("tok", "kaffe", taken.fetcher, () => "ab12");
  assert.equal(ensured.site.name, "kaffe-ab12");

  // Errors say what to do
  await assert.rejects(deployToNetlify("bad", "kaffe", site(), netlifyApi({ unauthorized: true }).fetcher), /NETLIFY_TOKEN/);
  await assert.rejects(deployToNetlify("tok", "kaffe", site(), netlifyApi({ deployState: ["error"] }).fetcher, { pollMs: 1 }), /kunne ikke legge ut siden: build failed/);
}

// --- Cloudflare
function cloudflareApi(options: { projectExists?: boolean; have?: Set<string>; unauthorized?: boolean } = {}) {
  const seen: (Seen & { form?: FormData })[] = [];
  const uploaded: string[] = [];
  const envelope = (result: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, errors: status < 400 ? [] : [{ code: status === 404 ? 8000007 : 10000, message: status === 404 ? "Project not found" : "Authentication error" }], result }), { status });
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ method: init.method ?? "GET", url, auth: new Headers(init.headers).get("authorization"), ...(typeof init.body === "string" ? { body: init.body } : {}), ...(init.body instanceof FormData ? { form: init.body } : {}) });
    if (options.unauthorized) return envelope(null, 401);
    const path = url.replace("https://api.cloudflare.com/client/v4", "");
    if (path === "/accounts/acc/pages/projects/kaffe" && (!init.method || init.method === "GET")) return options.projectExists ? envelope({ name: "kaffe", subdomain: "kaffe.pages.dev" }) : envelope(null, 404);
    if (path === "/accounts/acc/pages/projects" && init.method === "POST") return envelope({ name: "kaffe", subdomain: "kaffe.pages.dev" });
    if (path.endsWith("/upload-token")) return envelope({ jwt: "jwt-token" });
    if (path === "/pages/assets/check-missing") return envelope((JSON.parse(init.body as string).hashes as string[]).filter((h) => !options.have?.has(h)));
    if (path === "/pages/assets/upload") {
      for (const item of JSON.parse(init.body as string) as { key: string }[]) uploaded.push(item.key);
      return envelope(null);
    }
    if (path === "/pages/assets/upsert-hashes") return envelope(null);
    if (path.endsWith("/deployments") && init.method === "POST") return envelope({ url: "https://abc123.kaffe.pages.dev" });
    return envelope({ message: `unexpected ${url}` }, 500);
  }) as typeof fetch;
  return { fetcher, seen, uploaded };
}
{
  // The name of a file is the first 32 characters of the BLAKE3 hash of its base64 text and its extension
  const a = pagesHash(Buffer.from("hei"), "/om/index.html");
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, pagesHash(Buffer.from("hei"), "/annet/side.html"), "the same content and extension give the same name");
  assert.notEqual(a, pagesHash(Buffer.from("hei"), "/a.css"), "the extension is part of it");
  assert.notEqual(a, pagesHash(Buffer.from("hei!"), "/a.html"));

  const api = cloudflareApi();
  const result = await deployToCloudflare("tok", "acc", "kaffe", site(), api.fetcher);
  assert.deepEqual(result, { project: "kaffe", url: "https://kaffe.pages.dev", deploymentUrl: "https://abc123.kaffe.pages.dev", created: true });
  const order = api.seen.map((s) => `${s.method} ${s.url.replace("https://api.cloudflare.com/client/v4", "")}`);
  assert.deepEqual(order.map((o) => o.replace(/^GET /, "")), ["/accounts/acc/pages/projects/kaffe", "POST /accounts/acc/pages/projects", "/accounts/acc/pages/projects/kaffe/upload-token", "POST /pages/assets/check-missing", "POST /pages/assets/upload", "POST /pages/assets/upsert-hashes", "POST /accounts/acc/pages/projects/kaffe/deployments"]);
  assert.ok(api.seen.every((s) => s.url.startsWith("https://api.cloudflare.com/")));
  for (const s of api.seen) assert.equal(s.auth, s.url.includes("/pages/assets/") ? "Bearer jwt-token" : "Bearer tok", "the account key for the account, the upload key for the files");
  assert.equal(api.uploaded.length, 3, "the three site files are uploaded, and not the two meta files");
  const form = api.seen.at(-1)!.form!;
  const manifest = JSON.parse(String(form.get("manifest"))) as Record<string, string>;
  assert.deepEqual(Object.keys(manifest).sort(), ["/assets/app.js", "/index.html", "/om-oss/index.html"]);
  assert.equal(manifest["/index.html"], pagesHash(Buffer.from("<h1>Hei</h1>"), "/index.html"));
  assert.equal(form.get("branch"), "main");
  assert.ok(form.get("_redirects") instanceof File && form.get("_headers") instanceof File, "fallback and headers are their own parts");

  // Only what Cloudflare lacks is uploaded
  const have = new Set([pagesHash(Buffer.from("<h1>Hei</h1>"), "/index.html")]);
  const partial = cloudflareApi({ projectExists: true, have });
  await deployToCloudflare("tok", "acc", "kaffe", site(), partial.fetcher);
  assert.equal(partial.uploaded.length, 2);
  assert.ok(!partial.seen.some((s) => s.method === "POST" && s.url.endsWith("/pages/projects")), "an existing project is reused");
  assert.equal((await cloudflareEnsureProject("tok", "acc", "kaffe", cloudflareApi({ projectExists: true }).fetcher)).created, false);

  await assert.rejects(deployToCloudflare("bad", "acc", "kaffe", site(), cloudflareApi({ unauthorized: true }).fetcher), /CLOUDFLARE_API_TOKEN.*Cloudflare Pages: Edit/);
  await assert.rejects(cloudflareDeploy("tok", "acc", "kaffe", site(), (async () => new Response("{}", { status: 500 })) as typeof fetch), /Cloudflare svarte 500/);
}

// --- the whole run, for both hosts
{
  const opened = (m: ReturnType<typeof machine>, state: { stopped: number }): (() => Promise<Opened>) => async () => ({ sandbox: m.sandbox, stop: async () => void state.stopped++ });
  const statuses: string[] = [];

  const net = netlifyApi();
  const m1 = machine();
  const s1 = { stopped: 0 };
  const done = await deployAuto({ host: "netlify", name: "kaffe", project: { "package.json": "{}" }, env: { NETLIFY_TOKEN: "tok" }, fetcher: net.fetcher, open: opened(m1, s1), onStatus: (t) => statuses.push(t) });
  assert.deepEqual(done, { url: "https://kaffe.netlify.app", created: true });
  assert.equal(s1.stopped, 1, "the machine is stopped");
  assert.deepEqual(m1.calls[1]!.env, { SITE_URL: "https://kaffe.netlify.app", CI: "1" }, "the site was made first, so the build knows its address");
  assert.ok(statuses[0]!.startsWith("Gjør klart hos Netlify") && statuses.some((s) => s.startsWith("Bygger siden")) && statuses.some((s) => s.startsWith("Laster opp")));

  const cf = cloudflareApi();
  const m2 = machine();
  const s2 = { stopped: 0 };
  const cfDone = await deployAuto({ host: "cloudflare", name: "kaffe", project: { "package.json": "{}" }, env: { CLOUDFLARE_API_TOKEN: "tok", CLOUDFLARE_ACCOUNT_ID: "acc" }, fetcher: cf.fetcher, open: opened(m2, s2) });
  assert.deepEqual(cfDone, { url: "https://kaffe.pages.dev", created: true });
  assert.equal(m2.calls[1]!.env?.SITE_URL, "https://kaffe.pages.dev");

  // A failed build stops the machine and uploads nothing
  const failing = netlifyApi();
  const s3 = { stopped: 0 };
  await assert.rejects(deployAuto({ host: "netlify", name: "kaffe", project: { "package.json": "{}" }, env: { NETLIFY_TOKEN: "tok" }, fetcher: failing.fetcher, open: opened(machine({ fail: "run build" }), s3) }), /Byggingen feilet/);
  assert.equal(s3.stopped, 1);
  assert.ok(!failing.seen.some((s) => s.method === "PUT" || s.url.endsWith("/deploys")), "nothing is uploaded after a failed build");

  // Keys that are missing
  await assert.rejects(deployAuto({ host: "netlify", name: "k", project: {}, env: {}, open: opened(machine(), { stopped: 0 }) }), /NETLIFY_TOKEN mangler/);
  await assert.rejects(deployAuto({ host: "cloudflare", name: "k", project: {}, env: { CLOUDFLARE_API_TOKEN: "x" }, open: opened(machine(), { stopped: 0 }) }), /CLOUDFLARE_ACCOUNT_ID/);

  assert.deepEqual(autoHosts({ NETLIFY_TOKEN: "x", CLOUDFLARE_API_TOKEN: "y" }), { netlify: true, cloudflare: false });
  assert.deepEqual(autoHosts({}), { netlify: false, cloudflare: false });
  assert.ok(isAutoHost("netlify") && isAutoHost("cloudflare") && !isAutoHost("vercel") && !isAutoHost("render"));
}

// --- the route and the dialog
{
  const route = read("src/app/api/publish/route.ts");
  assert.match(route, /\.\.\.autoHosts\(\)/, "the status answer carries only yes or no");
  assert.ok(route.indexOf("deployToVercel(") < route.indexOf("deployAuto("), "after the code is on GitHub");
  assert.match(route, /if \(!wantGitHub \|\| !ok\)[\s\S]*Hoppet over fordi GitHub feilet/, "nothing is rolled out when the code did not get to GitHub");
  assert.match(route, /body\.autoDeploy !== false && autoHosts\(\)\[host\]/, "only when the keys are set, and it can be turned off");
  assert.match(route, /limit\("publish"\)/);
  const dialog = read("src/components/PublishDialog.tsx");
  assert.match(dialog, /NETLIFY_TOKEN/);
  assert.match(dialog, /CLOUDFLARE_API_TOKEN og CLOUDFLARE_ACCOUNT_ID/);
  assert.match(dialog, /steps\.host/);
}

console.log("deploy: all ok");
