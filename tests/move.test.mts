import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moveCheck, reportToText } from "../src/lib/move/check.ts";

const REF = "abcdefghijklmnopqrst";
const files: Record<string, string> = {
  "/package.json": JSON.stringify({ scripts: { build: "vite build" }, dependencies: { react: "18", "@paddle/paddle-js": "1" }, devDependencies: { vite: "5", "lovable-tagger": "1" } }),
  "/index.html": '<script src="https://cdn.gpteng.co/gptengineer.js"></script>',
  "/supabase/config.toml": `project_id = "${REF}"\n[functions.paddle-webhook]\nverify_jwt = false\n`,
  "/supabase/migrations/20250102_b.sql": `create policy "own" on public.orders for select using (auth.uid() = user_id);\ncreate table public.logs (id int);`,
  "/supabase/migrations/20250101_a.sql": `create table public.orders (id uuid primary key);\nalter table public.orders enable row level security;\ncreate table public.notes (id int);\nalter table public.notes enable row level security;\ninsert into storage.buckets (id, name) values ('avatars', 'avatars');\ncreate extension if not exists pg_cron;`,
  "/supabase/functions/paddle-webhook/index.ts": `const k = Deno.env.get("PADDLE_WEBHOOK_SECRET"); const u = Deno.env.get("SUPABASE_URL"); const s = req.headers.get("paddle-signature"); fetch("https://api.paddle.com/x");`,
  "/supabase/functions/chat/index.ts": `const k = Deno.env.get("LOVABLE_API_KEY"); fetch("https://ai.gateway.lovable.dev/v1");`,
  "/src/integrations/supabase/client.ts": `createClient("https://${REF}.supabase.co", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY); supabase.auth.signIn();`,
  "/src/pay.ts": `const p = "pri_01abcdefghijklmnopqrstuvwx"; const t = "live_0123456789abcdef0123456789a";`,
};

const report = moveCheck(files, { omitted: ["/.env"] });
const group = (id: string) => report.groups.find((g) => g.id === id)!;
const item = (g: string, id: string) => group(g).items.find((i) => i.id === id)!;

assert.equal(report.lovable, true);
assert.deepEqual(report.summary, { tables: 3, functions: 2, secrets: 1, webhooks: 1, migrations: 2 });

// Migrations are listed in file-name order, whatever order they were given in
assert.deepEqual(item("database", "db-migrations").values, ["20250101_a.sql", "20250102_b.sql"]);
// A policy in a later migration counts for a table created in an earlier one
assert.match(item("database", "db-tables").values!.join("\n"), /orders[^\n]*1 regler/);
assert.deepEqual(item("database", "db-rls").values, ["logs"], "a table without row level security is flagged");
assert.deepEqual(item("database", "db-policies").values, ["notes"], "security on but no rules is flagged");
assert.deepEqual(item("database", "db-buckets").values, ["avatars"]);
assert.deepEqual(item("database", "db-extensions").values, ["pg_cron"]);
assert.deepEqual(item("database", "db-ref").values, [REF]);

// Functions: the names Supabase supplies are not secrets, Lovable's own AI key is a warning
assert.deepEqual(item("functions", "fn-deploy").values, ["chat", "paddle-webhook"]);
assert.equal(item("functions", "fn-ai-chat").kind, "warn");
assert.ok(item("functions", "fn-jwt-paddle-webhook"));
assert.match(item("secrets", "secrets-create").values!.join("\n"), /^PADDLE_WEBHOOK_SECRET {2}· {2}brukes av paddle-webhook$/);
assert.ok(!JSON.stringify(item("secrets", "secrets-create")).includes("SUPABASE_URL"));
assert.deepEqual(item("secrets", "secrets-env").values, ["/.env"]);

// Payments: public ids are listed, the token is cut so it is never shown whole
assert.deepEqual(item("payments", "pay-paddle-ids").values, ["pri_01abcdefghijklmnopqrstuvwx"]);
assert.ok(item("payments", "pay-paddle-token").values![0]!.endsWith("…") && !JSON.stringify(report).includes("live_0123456789abcdef0123456789a"));
assert.ok(item("payments", "pay-webhooks").values![0]!.includes("Paddle"));

// The front end
assert.deepEqual(item("frontend", "fe-env").values, ["VITE_SUPABASE_PUBLISHABLE_KEY"]);
assert.match(item("frontend", "fe-ref").values![0]!, new RegExp(`^${REF}\\.supabase\\.co {2}· {2}/src/integrations/supabase/client\\.ts$`));
assert.ok(item("frontend", "fe-auth"));

// Lovable leftovers
assert.deepEqual(group("cleanup").items.map((i) => i.id), ["cl-tagger", "cl-script", "cl-urls"]);
assert.match(item("secrets", "secrets-where").values![0]!, /^PADDLE_WEBHOOK_SECRET {2}· {2}Betalingstjenesten/);
const lovableSecrets = moveCheck({ "/supabase/functions/x/index.ts": `Deno.env.get("PADDLE_LIVE_API_KEY"); Deno.env.get("GUEST_HASH_SECRET"); Deno.env.get("LOVABLE_CRON_SECRET"); Deno.env.get("OPENAI_API_KEY"); Deno.env.get("LOVABLE_API_KEY")` });
assert.deepEqual(lovableSecrets.groups.find((g) => g.id === "secrets")!.items.find((i) => i.id === "secrets-where")!.values!.map((v) => v.split(" ")[0]), ["GUEST_HASH_SECRET", "LOVABLE_CRON_SECRET", "OPENAI_API_KEY", "PADDLE_LIVE_API_KEY"].sort((a, b) => ["PADDLE_LIVE_API_KEY", "GUEST_HASH_SECRET", "LOVABLE_CRON_SECRET", "OPENAI_API_KEY"].indexOf(a) - ["PADDLE_LIVE_API_KEY", "GUEST_HASH_SECRET", "LOVABLE_CRON_SECRET", "OPENAI_API_KEY"].indexOf(b)));

// Cloudflare Pages
assert.equal(report.hosting.preset, "Vite + React");
assert.equal(report.hosting.build, "npm run build");
assert.equal(report.hosting.output, "dist");
assert.ok(report.hosting.notes.some((n) => n.includes("_redirects")));

// Plain text: ticked items are marked, info points never have a box
const text = reportToText(report, new Set(["db-project"]));
assert.match(text, /\[x\] Lag et eget Supabase-prosjekt/);
assert.match(text, /\[ \] Kjør 2 migrasjoner/);
assert.match(text, /- 3 tabeller lages/);
assert.match(text, /\[ \] OBS: 2 tabeller mangler|\[ \] OBS: 1 tabeller mangler/);

// A plain project says only what it must
const bare = moveCheck({ "/package.json": JSON.stringify({ scripts: {}, dependencies: { next: "16" } }) });
assert.equal(bare.lovable, false);
assert.deepEqual(bare.groups.map((g) => g.id), ["hosting"]);
assert.equal(bare.hosting.preset, "Next.js");
assert.equal(bare.hosting.output, "out");
assert.ok(bare.groups[0]!.items.some((i) => i.kind === "warn" && i.title.startsWith("Next.js")));
assert.equal(moveCheck({ "/package.json": "ikke json" }).hosting.preset, "Ukjent");

// A huge file does not slow the check down: only the start is read
const big = moveCheck({ "/package.json": "{}", "/src/a.ts": "x".repeat(2_000_000) + "import.meta.env.VITE_LATE" });
assert.ok(!big.groups.some((g) => g.id === "frontend"));

// The panel shows the checklist only for projects with their own package.json
const panel = readFileSync(new URL("../src/components/ProjectPanel.tsx", import.meta.url), "utf8");
assert.match(panel, /"\/package\.json" in own/);
assert.match(panel, /<MoveCheck[^>]*omitted=\{info\?\.omittedSecrets/);

console.log("move: all ok");
