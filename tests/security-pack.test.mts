import assert from "node:assert/strict";
import { checkPackages, lowestVersion, packageFindings, readDependencies } from "../src/lib/checks/deps.ts";
import { securityFindings } from "../src/lib/checks/security.ts";
import { deepScanRequest, moreSecurityFindings } from "../src/lib/checks/security-more.ts";
import { CONNECTORS } from "../src/lib/connectors/index.ts";
import { buildDeployableProject } from "../src/lib/publish/project.ts";

const ids = (files: Record<string, string>) => moreSecurityFindings(files).map((f) => f.id.split(":")[0]);

// --- keys that would ship to the browser
{
  assert.deepEqual(ids({ "/lib/k.ts": "const k = import.meta.env.VITE_STRIPE_SECRET_KEY;" }), ["public-env"]);
  assert.deepEqual(ids({ "/lib/k.ts": "const k = process.env.NEXT_PUBLIC_SERVICE_ROLE_KEY;" }), ["public-env"]);
  assert.deepEqual(ids({ "/lib/k.ts": "const url = import.meta.env.VITE_SUPABASE_URL;" }), [], "public values are fine");
  assert.deepEqual(ids({ "/api/k.ts": "const k = process.env.STRIPE_SECRET_KEY;" }), [], "a server may read its own secrets");
}

// --- markup
{
  assert.deepEqual(ids({ "/App.tsx": '<a href="https://x.no" target="_blank">x</a>' }), ["blank"]);
  assert.deepEqual(ids({ "/App.tsx": '<a href="https://x.no" target="_blank" rel="noopener noreferrer">x</a>' }), []);
  assert.deepEqual(ids({ "/a.ts": "el.innerHTML = text;" }), ["inner-html"]);
  assert.deepEqual(ids({ "/a.ts": "if (el.innerHTML === text) {}" }), [], "reading is fine");
  assert.deepEqual(ids({ "/App.tsx": '<a href="javascript:alert(1)">x</a>' }), ["js-url"]);
  assert.deepEqual(ids({ "/a.ts": 'window.parent.postMessage(data, "*");' }), ["post-message"]);
  assert.deepEqual(ids({ "/App.tsx": '<img src="http://cdn.example/a.png" alt="" />' }), ["mixed"]);
  assert.deepEqual(ids({ "/App.tsx": '<img src="http://localhost:3000/a.png" alt="" />' }), []);
}

// --- server functions
{
  const base = `export async function POST(request: Request): Promise<Response> {\n`;
  assert.deepEqual(ids({ "/api/a.ts": base + `  const b = await request.json();\n  return new Response(JSON.stringify({ ok: b.x }));\n}\n` }), ["no-validation"]);
  assert.deepEqual(ids({ "/api/a.ts": base + `  const b = await request.json();\n  if (typeof b.x !== "string" || b.x.length > 100) return new Response("no", { status: 400 });\n  return new Response("ok");\n}\n` }), []);
  assert.deepEqual(ids({ "/api/a.ts": base + `  return new Response(JSON.stringify({ k: process.env.SECRET }));\n}\n` }), ["env-leak"]);
  assert.ok(ids({ "/api/a.ts": base + "  const b = (await request.json()) as { to: string };\n  if (typeof b.to !== \"string\") return new Response(\"x\");\n  await fetch(`https://${b.to}/hook`);\n  return new Response(\"ok\");\n}\n" }).includes("ssrf"));
  assert.deepEqual(ids({ "/api/a.ts": `const h = { "Access-Control-Allow-Origin": "*" };\n` }), ["cors"]);
  assert.deepEqual(ids({ "/api/a.ts": base + `  try { await work(); } catch (error) { return new Response(JSON.stringify({ error: error.message })); }\n}\n` }), ["error-leak"]);
  // SSRF follows the variables that hold what the caller sent
  const guarded = `  if (typeof b.x !== "string") return new Response("x");\n`;
  assert.ok(ids({ "/api/a.ts": base + `  const { url } = await request.json();\n  if (typeof url !== "string") return new Response("x");\n  await fetch(url);\n  return new Response("ok");\n}\n` }).includes("ssrf"), "destructured");
  assert.ok(ids({ "/api/a.ts": base + `  const b = await request.json();\n${guarded}  await fetch(b.url, { method: "POST" });\n  return new Response("ok");\n}\n` }).includes("ssrf"), "the whole address");
  assert.ok(ids({ "/api/a.ts": base + `  const b = await request.json();\n${guarded}  await fetch("https://" + b.host + "/x");\n  return new Response("ok");\n}\n` }).includes("ssrf"), "the host by concatenation");
  assert.ok(!ids({ "/api/a.ts": base + "  const b = await request.json();\n" + guarded + "  await fetch(`https://api.example.com/users/${b.id}`);\n  return new Response(\"ok\");\n}\n" }).includes("ssrf"), "a value in the path of a fixed host is not SSRF");
  assert.ok(!ids({ "/api/a.ts": base + `  const b = await request.json();\n${guarded}  await fetch("https://api.example.com/x", { body: b.x });\n  return new Response("ok");\n}\n` }).includes("ssrf"), "a fixed address");
  // the same patterns in browser code are not server findings
  assert.deepEqual(ids({ "/lib/a.ts": "const h = { 'Access-Control-Allow-Origin': '*' };" }), []);
}

// --- every file a connector writes is clean, and the findings reach the normal security list
{
  for (const c of CONNECTORS) for (const [path, code] of Object.entries(c.files?.({}) ?? {})) assert.deepEqual(moreSecurityFindings({ [path]: code }), [], `${c.id}: ${path}`);
  const merged = securityFindings({ "/lib/k.ts": "const k = import.meta.env.VITE_API_SECRET;" });
  assert.equal(merged[0]!.severity, "high");
  assert.match(merged[0]!.title, /offentlig variabel/);
}

// --- packages: versions
{
  assert.equal(lowestVersion("^18.3.1"), "18.3.1");
  assert.equal(lowestVersion("~1.2.3"), "1.2.3");
  assert.equal(lowestVersion(">=2.0.0 <3"), "2.0.0");
  assert.equal(lowestVersion("1.0.0-beta.2"), "1.0.0-beta.2");
  for (const bad of ["latest", "*", "github:a/b", "file:../x", "workspace:*", "^18"]) assert.equal(lowestVersion(bad), null, bad);
  const { dependencies, skipped } = readDependencies({ "/package.json": JSON.stringify({ dependencies: { react: "^19.0.0", mine: "workspace:*" }, devDependencies: { vite: "~6.3.0" } }) });
  assert.deepEqual(dependencies.map((d) => [d.name, d.version, d.dev]), [["react", "19.0.0", false], ["vite", "6.3.0", true]]);
  assert.equal(skipped, 1);
  assert.deepEqual(readDependencies({ "/package.json": "not json" }), { dependencies: [], skipped: 0 });
}

// --- packages: lookup and findings (OSV answered by a stand-in)
{
  const calls: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.endsWith("/querybatch")) {
      const queries = JSON.parse(String(init?.body)).queries as { package: { name: string } }[];
      const results = queries.map((q) => (q.package.name === "lodash" ? { vulns: [{ id: "GHSA-1" }, { id: "GHSA-2" }] } : q.package.name === "vite" ? { vulns: [{ id: "GHSA-3" }] } : {}));
      return new Response(JSON.stringify({ results }));
    }
    if (url.endsWith("GHSA-1")) return new Response(JSON.stringify({ id: "GHSA-1", summary: "Prototype pollution", database_specific: { severity: "HIGH" }, affected: [{ package: { name: "lodash" }, ranges: [{ events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }] }));
    if (url.endsWith("GHSA-2")) return new Response(JSON.stringify({ id: "GHSA-2", summary: "ReDoS", database_specific: { severity: "MODERATE" }, affected: [{ package: { name: "lodash" }, ranges: [{ events: [{ fixed: "4.17.11" }] }] }] }));
    if (url.endsWith("GHSA-3")) return new Response(JSON.stringify({ id: "GHSA-3", summary: "Dev server file read", database_specific: { severity: "HIGH" } }));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const deps = [
    { name: "react", version: "19.0.0", range: "^19.0.0", dev: false },
    { name: "lodash", version: "4.17.0", range: "^4.17.0", dev: false },
    { name: "vite", version: "6.3.0", range: "~6.3.0", dev: true },
  ];
  const reports = await checkPackages(deps, fake);
  assert.deepEqual(reports.map((r) => r.name), ["lodash", "vite"], "only packages with problems");
  assert.equal(calls.filter((c) => c.endsWith("/querybatch")).length, 1, "one batch for all packages");
  const findings = packageFindings(reports);
  assert.equal(findings[0]!.id, "pkg:lodash");
  assert.equal(findings[0]!.severity, "high");
  assert.match(findings[0]!.title, /lodash 4\.17\.0 har 2 kjente feil/);
  assert.match(findings[0]!.fix, /til 4\.17\.21/, "the highest fixed version is the target");
  assert.equal(findings[1]!.severity, "medium", "a high problem in a dev tool is only medium");
  assert.match(findings[1]!.detail, /bare under utvikling/);
  assert.match(findings[1]!.fix, /ingen rettet versjon/);
  assert.deepEqual(await checkPackages([], fake), []);
  await assert.rejects(checkPackages(deps, (async () => new Response("", { status: 500 })) as typeof fetch), /500/);
}

// --- deep scan prompt names what exists in the project, and asks for a report only
{
  const text = deepScanRequest({ "/App.tsx": "x", "/api/subscribe.ts": "x", "/db/schema.sql": "x", "/atelier-inspector.js": "x" });
  assert.match(text, /ikke endre noe nå/);
  assert.match(text, /\/api\/subscribe\.ts/);
  assert.match(text, /\/db\/schema\.sql/);
  assert.doesNotMatch(text, /atelier-inspector/);
  assert.match(deepScanRequest({ "/App.tsx": "x" }), /finnes det en database/);
}

// --- published sites answer with security headers
{
  const project = buildDeployableProject({ "/App.tsx": "export default function App() { return <h1>x</h1>; }\n" }, "Test");
  const config = JSON.parse(project["vercel.json"]!) as { headers: { headers: { key: string; value: string }[] }[] };
  const keys = config.headers[0]!.headers.map((h) => h.key);
  assert.deepEqual(keys, ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy"]);
  assert.ok(!keys.includes("Content-Security-Policy"), "a general policy would break payments and analytics");
}

// --- Supabase edge functions in imported projects
{
  const edge = (files: Record<string, string>) => securityFindings(files).filter((f) => f.id.startsWith("edge-")).map((f) => f.id);
  const cfg = (name: string, v: string) => ({ "/supabase/config.toml": `[functions.${name}]
verify_jwt = ${v}
` });
  const hook = 'const sig = req.headers.get("paddle-signature"); const k = Deno.env.get("PAYMENTS_WEBHOOK_SECRET"); const body = await req.text();';
  assert.deepEqual(edge({ ...cfg("paddle-webhook", "false"), "/supabase/functions/paddle-webhook/index.ts": hook }), ["edge-unsigned:paddle-webhook"], "a webhook that reads the signature but never verifies it");
  assert.deepEqual(edge({ ...cfg("paddle-webhook", "false"), "/supabase/functions/paddle-webhook/index.ts": hook + " const e = await paddle.webhooks.unmarshal(body, k, sig);" }), [], "a verified webhook is fine");
  assert.deepEqual(edge({ ...cfg("stripe-webhook", "false"), "/supabase/functions/stripe-webhook/index.ts": "const e = await stripe.webhooks.constructEventAsync(body, sig, secret);" }), []);
  assert.deepEqual(edge({ ...cfg("send", "false"), "/supabase/functions/send/index.ts": "Deno.serve(async () => new Response('ok'));" }), ["edge-open:send"], "open and nobody checked");
  assert.deepEqual(edge({ ...cfg("send", "false"), "/supabase/functions/send/index.ts": 'const u = await supabase.auth.getUser(req.headers.get("Authorization"));' }), [], "an open function that checks the caller");
  assert.deepEqual(edge({ ...cfg("job", "false"), "/supabase/functions/job/index.ts": 'if (req.headers.get("x-cron") !== Deno.env.get("LOVABLE_CRON_SECRET")) return new Response("no", { status: 401 });' }), [], "a shared secret counts");
  assert.deepEqual(edge({ "/supabase/functions/send/index.ts": "Deno.serve(async () => new Response('ok'));" }), [], "without verify_jwt = false the platform checks the login");
  assert.deepEqual(edge({ ...cfg("admin", "true"), "/supabase/functions/admin/index.ts": 'const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));' }), ["edge-service-role:admin"]);
  assert.deepEqual(edge({ "/supabase/functions/_shared/x.ts": "x" }), [], "shared folders are not functions");
}

console.log("security-pack: all ok");
