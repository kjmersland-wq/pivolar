import assert from "node:assert/strict";
import { cleanupRequest, countComponents, findDuplicates, qualityFindings } from "../src/lib/checks/quality.ts";
import { securityFindings } from "../src/lib/checks/security.ts";

let seed = 0;
// Every call gives different text, so two generated files never count as copies of each other.
const lines = (n: number) => {
  seed++;
  return Array.from({ length: n }, (_, i) => `  const value${seed}x${i} = compute(${i * seed}, "item-${seed}-${i}");`).join("\n");
};

// --- quality: file size
{
  assert.deepEqual(qualityFindings({ "/App.tsx": lines(100) }), []);
  const f = qualityFindings({ "/components/Big.tsx": lines(350), "/components/Huge.tsx": lines(620) });
  assert.equal(f.length, 2);
  assert.equal(f[0]!.severity, "high", "worst first");
  assert.match(f[0]!.title, /Huge\.tsx er stor \(620 linjer\)/);
  assert.equal(f[1]!.severity, "medium");
  assert.match(f[1]!.fix, /Siden skal se helt lik ut/);
  assert.deepEqual(qualityFindings({ "/styles.css": lines(900), "/brand.json": lines(900) }), [], "only code files count");
}

// --- quality: components per file
{
  const src = ["A", "B", "C", "D", "E"].map((n) => `export function ${n}() {\n  return <div>${n}</div>;\n}`).join("\n\n");
  assert.deepEqual(countComponents(src), ["A", "B", "C", "D", "E"]);
  assert.deepEqual(countComponents("const Card = ({ x }: { x: number }) => <p>{x}</p>;\nconst helper = () => 1;\nfunction lower() {}"), ["Card"]);
  const f = qualityFindings({ "/components/All.tsx": src });
  assert.equal(f[0]!.id, "many-components:/components/All.tsx");
  assert.equal(qualityFindings({ "/components/Few.tsx": src.split("\n\n").slice(0, 3).join("\n\n") }).length, 0);
}

// --- quality: duplicates
{
  const block = `  const items = data.filter((entry) => entry.visible);\n  const sorted = items.sort((a, b) => a.order - b.order);\n  const labels = sorted.map((entry) => entry.label.trim());\n  const joined = labels.join(", ");\n  const upper = joined.toUpperCase();\n  return upper.slice(0, 80);`;
  const files = { "/a.tsx": `function A() {\n${block}\n}`, "/b.tsx": `function B() {\n  // other\n${block}\n}` };
  const groups = findDuplicates(files);
  assert.equal(groups.length, 1, "overlapping windows are one group");
  assert.equal(groups[0]!.places.length, 2);
  assert.equal(qualityFindings(files).filter((x) => x.id.startsWith("duplicate")).length, 1);
  assert.deepEqual(findDuplicates({ "/a.tsx": "}\n}\n}\n}\n}\n}\n}\n}", "/b.tsx": "}\n}\n}\n}\n}\n}\n}\n}" }), [], "braces are not duplicates");
  assert.deepEqual(findDuplicates({ "/index.tsx": block + "\n" + block }), [], "protected files are skipped");
}
{
  const out = cleanupRequest(qualityFindings({ "/components/Huge.tsx": lines(620) }));
  assert.match(out, /^Rydd opp i koden/);
  assert.match(out, /1\. Del opp \/components\/Huge\.tsx/);
}

// --- security: secrets
{
  const f = securityFindings({ "/lib/api.ts": `const key = "sk-ant-api03-abcdefghijklmnopqrstuvwx";\nconst s = "sk_live_abcdefghijklmnopqrstu";` });
  assert.equal(f.length, 2);
  assert.ok(f.every((x) => x.severity === "high" && x.path === "/lib/api.ts"));
  assert.equal(f.find((x) => x.title.includes("Stripe"))!.line, 2);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${b64({ role, iss: "supabase" })}.abcdefghijklmnopqrstuv`;
  const svc = securityFindings({ "/lib/db.ts": `createClient(url, "${jwt("service_role")}")` });
  assert.ok(svc.some((x) => x.title.includes("service_role-nøkkel") && x.severity === "high"));
  assert.deepEqual(securityFindings({ "/lib/db.ts": `createClient(url, "${jwt("anon")}")` }), [], "anon keys are meant to be public");
  assert.equal(securityFindings({ "/lib/db.ts": `// uses service_role later` })[0]!.severity, "medium");
}

// --- security: database rules
{
  const sql = `create table notes (id uuid primary key, user_id uuid, body text);\ncreate policy "all" on notes for all using (true) with check (true);`;
  const f = securityFindings({ "/db/schema.sql": sql });
  assert.ok(f.some((x) => x.id.startsWith("no-rls") && x.title.includes("«notes»")));
  const open = f.find((x) => x.id.startsWith("open-policy"))!;
  assert.equal(open.severity, "high");
  assert.match(open.detail, /skrive og slette/);
  const safe = `create table notes (id uuid primary key, user_id uuid);\nalter table notes enable row level security;\ncreate policy "own" on notes for all using (user_id = auth.uid()) with check (user_id = auth.uid());`;
  assert.deepEqual(securityFindings({ "/db/schema.sql": safe }), []);
  const publicRead = `create table posts (id int);\nalter table public.posts enable row level security;\ncreate policy "read" on posts for select using (true);`;
  const r = securityFindings({ "/db/s.sql": publicRead });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.severity, "medium", "open read is a lesser problem");
}

// --- security: code patterns and missing login
{
  const f = securityFindings({
    "/App.tsx": `import { supabase } from "./lib/db";\nexport default function App() {\n  supabase.from("notes").select();\n  return <div dangerouslySetInnerHTML={{ __html: x }} />;\n}`,
    "/lib/x.ts": `eval("1+1"); localStorage.setItem("auth_token", t); fetch("http://api.example.com/x"); fetch("http://localhost:3000/x");`,
  });
  const ids = f.map((x) => x.id.split(":")[0]);
  for (const want of ["html", "eval", "storage", "http", "no-auth"]) assert.ok(ids.includes(want), want);
  assert.equal(f.filter((x) => x.id.startsWith("http")).length, 1, "localhost is fine");
  const withAuth = securityFindings({ "/App.tsx": `supabase.from("n").select(); supabase.auth.getUser();` });
  assert.ok(!withAuth.some((x) => x.id === "no-auth"));
  assert.deepEqual(securityFindings({ "/App.tsx": "export default function App() { return <div>Hei</div>; }" }), []);
}

console.log("checks: all ok");
