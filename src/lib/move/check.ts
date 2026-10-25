/**
 * A checklist for moving a project that was built in Lovable (or any Vite + Supabase project) to a setup
 * of the owner's own: their own Supabase project, their own payment keys and a host such as Cloudflare Pages.
 * It only reads the text of the repository, with plain patterns: nothing is run, nothing is fetched, and no
 * secret is ever shown (only the names of the secrets the code reads). Everything it lists is something the
 * owner has to do or check by hand, and each point can be ticked off.
 */

export type FileMap = Record<string, string>;
export type Kind = "todo" | "warn" | "info";
export type GroupId = "database" | "functions" | "secrets" | "payments" | "frontend" | "hosting" | "cleanup";
export type Item = { id: string; kind: Kind; title: string; detail?: string; values?: string[] };
export type Group = { id: GroupId; title: string; items: Item[] };
export type Hosting = { preset: string; build: string; output: string; node: string | null; env: string[]; notes: string[] };
export type MoveReport = {
  lovable: boolean;
  groups: Group[];
  hosting: Hosting;
  summary: { tables: number; functions: number; secrets: number; webhooks: number; migrations: number };
};

/** Read at most this much of one file, so a huge file cannot slow the check down. */
const MAX_CHARS = 300_000;
const text = (files: FileMap, path: string) => (files[path] ?? "").slice(0, MAX_CHARS);

/** Names Supabase gives every edge function by itself. They are not set by hand. */
const PROVIDED = new Set(["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL", "SB_REGION", "SB_EXECUTION_ID", "DENO_DEPLOYMENT_ID", "DENO_REGION"]);

const uniq = <T,>(items: T[]) => [...new Set(items)];
const names = (re: RegExp, source: string, group = 1) => uniq([...source.matchAll(re)].map((m) => m[group]!));

type Table = { name: string; rls: boolean; policies: number };

function sqlOf(files: FileMap): { migrations: string[]; sql: string } {
  const migrations = Object.keys(files)
    .filter((p) => /^\/supabase\/migrations\/[^/]+\.sql$/.test(p))
    .sort();
  return { migrations, sql: migrations.map((p) => text(files, p)).join("\n") };
}

function tablesOf(sql: string): Table[] {
  const out = new Map<string, Table>();
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    const schema = m[1]?.toLowerCase();
    if (schema && schema !== "public") continue;
    const name = m[2]!.toLowerCase();
    if (!out.has(name)) out.set(name, { name, rls: false, policies: 0 });
  }
  for (const table of out.values()) {
    const n = table.name;
    table.rls = new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:public\\.)?"?${n}"?\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql);
    table.policies = [...sql.matchAll(new RegExp(`create\\s+policy\\s+(?:"[^"]*"|\\w+)\\s+on\\s+(?:public\\.)?"?${n}"?\\b`, "gi"))].length;
  }
  return [...out.values()];
}

type Fn = { name: string; secrets: string[]; webhook: "stripe" | "paddle" | "other" | null; verifyJwt: boolean | null; lovableAi: boolean; usesStripe: boolean; usesPaddle: boolean };

function functionsOf(files: FileMap): Fn[] {
  const config = text(files, "/supabase/config.toml");
  const dirs = uniq(Object.keys(files).flatMap((p) => /^\/supabase\/functions\/([^/_][^/]*)\//.exec(p)?.[1] ?? [])).sort();
  return dirs.map((name) => {
    const code = Object.entries(files)
      .filter(([p]) => p.startsWith(`/supabase/functions/${name}/`) && /\.(ts|js|mjs)$/.test(p))
      .map(([, c]) => c.slice(0, MAX_CHARS))
      .join("\n");
    const secrets = names(/Deno\.env\.get\(\s*["'`]([A-Z0-9_]+)["'`]\s*\)/g, code).filter((n) => !PROVIDED.has(n));
    const usesStripe = /(?:from\s+["'](?:https:\/\/esm\.sh\/stripe|npm:stripe|stripe)|new\s+Stripe\()/i.test(code);
    const usesPaddle = /paddle/i.test(code) && /(paddle-signature|Paddle-Signature|api\.paddle\.com|sandbox-api\.paddle\.com|@paddle\/)/i.test(code);
    const stripeHook = /constructEvent(?:Async)?\(|stripe-signature/i.test(code);
    const paddleHook = /paddle-signature|webhooks\.unmarshal/i.test(code);
    const otherHook = /webhook/i.test(name) || /svix-signature|x-hub-signature|x-signature/i.test(code);
    const verify = new RegExp(`\\[functions\\.${name.replace(/[-.]/g, "\\$&")}\\][^\\[]*?verify_jwt\\s*=\\s*(true|false)`, "i").exec(config)?.[1];
    return {
      name,
      secrets,
      webhook: stripeHook ? "stripe" : paddleHook ? "paddle" : otherHook ? "other" : null,
      verifyJwt: verify === undefined ? null : verify === "true",
      lovableAi: /LOVABLE_API_KEY|ai\.gateway\.lovable\.dev/.test(code),
      usesStripe,
      usesPaddle,
    };
  });
}

const SOURCE = /\.(tsx?|jsx?|mjs|vue|svelte|astro|html)$/;
const sources = (files: FileMap) => Object.entries(files).filter(([p]) => SOURCE.test(p) && !p.startsWith("/supabase/functions/") && !p.startsWith("/node_modules/"));

const mask = (value: string) => (value.length > 14 ? `${value.slice(0, 10)}…` : value);

function hostingOf(files: FileMap, envNames: string[]): Hosting {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string>; engines?: { node?: string } } = {};
  try {
    pkg = JSON.parse(text(files, "/package.json") || "{}") as typeof pkg;
  } catch {
    pkg = {};
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (n: string) => n in deps;
  const notes: string[] = [];
  const node = (text(files, "/.nvmrc").trim().replace(/^v/, "") || pkg.engines?.node || "").slice(0, 40) || null;
  let preset = "Ukjent";
  let output = "dist";
  if (has("next")) {
    preset = "Next.js";
    output = "out";
    notes.push("Next.js lages som rene filer bare med `output: \"export\"` i next.config. Bruker prosjektet serverfunksjoner eller server-rendering, passer det ikke på Cloudflare Pages uten en egen tilpasning.");
  } else if (has("react-scripts")) {
    preset = "Create React App";
    output = "build";
  } else if (has("astro")) preset = "Astro";
  else if (has("vite")) preset = has("react") ? "Vite + React" : "Vite";
  else if (has("@sveltejs/kit")) {
    preset = "SvelteKit";
    notes.push("SvelteKit trenger adapteret for Cloudflare for å kjøre på Pages.");
  } else notes.push("Fant ikke rammeverket. Sjekk byggekommandoen og mappen selv.");
  const build = pkg.scripts?.build ? "npm run build" : "npm run build (mangler i package.json: legg til et build-skript)";
  if (preset.startsWith("Vite") || preset === "Create React App") notes.push("Alle adresser som ikke er filer må åpne forsiden (SPA). Pivolar legger inn `_redirects` med `/*  /index.html  200` når siden rulles ut fra Pivolar. Setter du opp Cloudflare selv, legg filen i `public/`.");
  notes.push("`VITE_`-variabler bakes inn når siden bygges. Sett dem i Cloudflare Pages (Settings, Variables) før bygging, og bygg på nytt når de endres.");
  return { preset, build, output, node, env: envNames, notes };
}

/** Where a secret with a well-known name comes from, so the owner knows which dashboard to open. */
function secretSource(name: string): string | null {
  if (/PADDLE.*API_KEY/.test(name)) return "Paddle: Developer tools, Authentication, ny API-nøkkel (live og sandbox er hver sin)";
  if (/WEBHOOK_SECRET|SIGNING_SECRET/.test(name)) return /STRIPE/.test(name) ? "Stripe: Webhooks, signeringshemmeligheten til det nye endepunktet" : "Betalingstjenesten: Notifications/Webhooks, hemmeligheten til den nye webhooken (live og sandbox er hver sin)";
  if (/STRIPE.*(SECRET|API)_KEY|STRIPE_KEY/.test(name)) return "Stripe: Developers, API keys";
  if (/OPENAI/.test(name)) return "OpenAI: API keys";
  if (/ANTHROPIC/.test(name)) return "Anthropic: Console, API keys";
  if (/RESEND/.test(name)) return "Resend: API Keys";
  if (/(HASH|CRON|JWT|SESSION|COOKIE).*SECRET|SECRET.*SALT/.test(name)) return "Lager du selv: en tilfeldig, lang tekst (for eksempel `openssl rand -hex 32`). Verdien trenger ikke være lik den gamle";
  return null;
}

const OLD_REF = /https:\/\/([a-z0-9]{20})\.supabase\.co/g;

export function moveCheck(files: FileMap, options: { omitted?: string[] } = {}): MoveReport {
  const { migrations, sql } = sqlOf(files);
  const tables = tablesOf(sql);
  const fns = functionsOf(files);
  const pkgText = text(files, "/package.json");
  const lovable = /lovable-tagger|lovable\.dev|gptengineer/i.test(pkgText + text(files, "/index.html") + text(files, "/README.md") + text(files, "/vite.config.ts")) || Object.keys(files).some((p) => p.startsWith("/.lovable/"));
  const groups: Group[] = [];
  const add = (id: GroupId, title: string, items: Item[]) => items.length > 0 && groups.push({ id, title, items });

  // --- the database
  const db: Item[] = [];
  const configRef = /project_id\s*=\s*"([a-z0-9]+)"/.exec(text(files, "/supabase/config.toml"))?.[1];
  if (migrations.length > 0 || tables.length > 0) {
    db.push({ id: "db-project", kind: "todo", title: "Lag et eget Supabase-prosjekt for denne appen", detail: "Ikke bruk det samme som Pivolar selv. Hent Project URL og den offentlige nøkkelen (anon eller publishable) under Project Settings, API." });
    db.push({ id: "db-migrations", kind: "todo", title: `Kjør ${migrations.length} migrasjon${migrations.length === 1 ? "" : "er"} i SQL Editor, i denne rekkefølgen`, detail: "Filnavnene begynner med tidspunktet, så alfabetisk rekkefølge er riktig.", values: migrations.map((p) => p.split("/").pop()!) });
  }
  if (tables.length > 0) db.push({ id: "db-tables", kind: "info", title: `${tables.length} tabeller lages av migrasjonene`, values: tables.map((t) => `${t.name}${t.rls ? "" : "  (uten radnivå-sikkerhet)"}${t.policies ? `  · ${t.policies} regler` : ""}`) });
  const open = tables.filter((t) => !t.rls);
  if (open.length > 0) db.push({ id: "db-rls", kind: "warn", title: `${open.length} tabeller mangler radnivå-sikkerhet`, detail: "Uten den kan alle med den offentlige nøkkelen lese og endre radene. Slå den på, og lag regler, før appen brukes av andre.", values: open.map((t) => t.name) });
  const withoutPolicy = tables.filter((t) => t.rls && t.policies === 0);
  if (withoutPolicy.length > 0) db.push({ id: "db-policies", kind: "warn", title: `${withoutPolicy.length} tabeller har sikkerhet på, men ingen regler`, detail: "Da kan ingen bruker lese eller skrive. Det er trygt, men appen virker ikke før reglene er lagt til.", values: withoutPolicy.map((t) => t.name) });
  const buckets = names(/storage\.buckets[\s\S]{0,300}?values\s*\(\s*'([^']+)'/gi, sql);
  if (buckets.length > 0) db.push({ id: "db-buckets", kind: "info", title: "Filbøtter lages av migrasjonene", detail: "Filene som ligger i bøttene hos Lovable følger ikke med. Last dem opp på nytt, eller eksporter dem.", values: buckets });
  if (/auth\.users/i.test(sql) && /create\s+trigger/i.test(sql)) db.push({ id: "db-auth-trigger", kind: "info", title: "En trigger på innloggingstabellen (for eksempel som lager en profil for hver ny bruker) lages av migrasjonene", detail: "Sjekk at den ble opprettet: ny bruker skal få en profil." });
  if (/create\s+extension|cron\.schedule/i.test(sql)) db.push({ id: "db-extensions", kind: "info", title: "Migrasjonene slår på utvidelser eller planlagte jobber", detail: "Noen utvidelser (som pg_cron) må slås på under Database, Extensions i Supabase først.", values: names(/create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-z_0-9-]+)"?/gi, sql) });
  db.push({ id: "db-data", kind: "info", title: "Brukere og data følger ikke med av seg selv", detail: "Har du ingen ekte kunder, kan du starte på nytt. Ellers: bruk eksporten Lovable beskriver for Cloud-prosjekter (bekreft hos Lovable hva den tar med, spesielt innlogginger) eller eksporter fra Supabase." });
  if (configRef) db.push({ id: "db-ref", kind: "info", title: "Det gamle Supabase-prosjektet står i supabase/config.toml", values: [configRef] });
  if (migrations.length > 0 || tables.length > 0 || configRef) add("database", "Database", db);

  // --- functions
  const fn: Item[] = [];
  if (fns.length > 0) {
    fn.push({ id: "fn-deploy", kind: "todo", title: `Rull ut ${fns.length} funksjon${fns.length === 1 ? "" : "er"} til det nye prosjektet`, detail: "Med Supabase CLI: `supabase login`, `supabase link --project-ref <ny referanse>` og `supabase functions deploy`. Eller lim hver inn under Edge Functions i dashbordet.", values: fns.map((f) => f.name) });
    for (const f of fns.filter((x) => x.verifyJwt === false)) fn.push({ id: `fn-jwt-${f.name}`, kind: "info", title: `${f.name} er åpen uten innlogging (verify_jwt = false)`, detail: "Det er vanlig for webhooks, som kalles av Paddle eller Stripe. Funksjonen må da selv sjekke signaturen." });
    for (const f of fns.filter((x) => x.lovableAi)) fn.push({ id: `fn-ai-${f.name}`, kind: "warn", title: `${f.name} bruker Lovables egen AI-tilgang (LOVABLE_API_KEY)`, detail: "Den virker bare i Lovable. Bytt til din egen nøkkel (for eksempel Anthropic eller OpenAI) i funksjonen, og legg den inn som hemmelighet." });
  }
  add("functions", "Funksjoner (Supabase Edge Functions)", fn);

  // --- the secrets the functions read
  const secretNames = uniq(fns.flatMap((f) => f.secrets)).filter((n) => n !== "LOVABLE_API_KEY");
  const secrets: Item[] = [];
  if (secretNames.length > 0) {
    secrets.push({ id: "secrets-create", kind: "todo", title: `Lag ${secretNames.length} hemmeligheter under Edge Functions, Secrets i det nye prosjektet`, detail: "Verdiene kan ikke leses ut av Lovable. Lag nye nøkler hos hver tjeneste, og lim dem inn bare i Supabase, aldri i chatten eller i koden.", values: secretNames.map((n) => `${n}  ·  brukes av ${fns.filter((f) => f.secrets.includes(n)).map((f) => f.name).join(", ")}`) });
    const where = secretNames.flatMap((n) => {
      const how = secretSource(n);
      return how ? [`${n}  ·  ${how}`] : [];
    });
    if (where.length > 0) secrets.push({ id: "secrets-where", kind: "info", title: "Slik får du hver hemmelighet", values: where });
  }
  if (options.omitted?.length) secrets.push({ id: "secrets-env", kind: "info", title: "Filen .env ble ikke tatt med ved importen (den kan inneholde hemmeligheter)", detail: "Lovable legger vanligvis VITE_SUPABASE_URL og den offentlige nøkkelen der. Skriv dem på nytt for det nye prosjektet.", values: options.omitted });
  add("secrets", "Hemmeligheter", secrets);

  // --- payments
  const pay: Item[] = [];
  const deps = pkgText;
  const usesPaddle = fns.some((f) => f.usesPaddle) || /@paddle\//.test(deps);
  const usesStripe = fns.some((f) => f.usesStripe) || /@stripe\/|"stripe"/.test(deps);
  const all = [...sources(files).map(([, c]) => c.slice(0, MAX_CHARS)), ...Object.entries(files).filter(([p]) => p.startsWith("/supabase/")).map(([, c]) => c.slice(0, MAX_CHARS))].join("\n");
  const paddlePrices = names(/\b(pri_[a-z0-9]{26})\b/g, all);
  const paddleProducts = names(/\b(pro_[a-z0-9]{26})\b/g, all);
  const stripePrices = names(/\b(price_[A-Za-z0-9]{10,})\b/g, all);
  const paddleToken = names(/\b((?:live|test)_[a-f0-9]{27})\b/g, all).map(mask);
  const stripePk = names(/\b(pk_(?:live|test)_[A-Za-z0-9]{10,})\b/g, all).map(mask);
  if (usesPaddle) {
    pay.push({ id: "pay-paddle-key", kind: "todo", title: "Paddle: lag en ny API-nøkkel og en ny webhook", detail: "Developer tools, Authentication for nøkkelen, og Notifications for webhooken. Webhooken skal peke på den nye funksjonsadressen, og den gamle mot Lovable slås av når du bytter." });
    if (paddlePrices.length + paddleProducts.length > 0) pay.push({ id: "pay-paddle-ids", kind: "info", title: "Paddle-priser og produkter koden bruker", detail: "De ligger i Paddle-kontoen din, og følger med. Sjekk at de finnes i riktig modus (test eller live).", values: [...paddlePrices, ...paddleProducts] });
    if (paddleToken.length > 0) pay.push({ id: "pay-paddle-token", kind: "info", title: "Paddles nøkkel for nettleseren (client-side token) står i koden", detail: "Den er laget for å ligge i nettleseren, men sjekk at den hører til riktig modus.", values: paddleToken });
  }
  if (usesStripe) {
    pay.push({ id: "pay-stripe-key", kind: "todo", title: "Stripe: lag en ny begrenset nøkkel og et nytt webhook-endepunkt", detail: "Developers, API keys og Webhooks. Endepunktet skal peke på den nye funksjonen, og får en ny signeringshemmelighet." });
    if (stripePrices.length > 0) pay.push({ id: "pay-stripe-ids", kind: "info", title: "Stripe-priser koden bruker", detail: "De ligger i Stripe-kontoen din og følger med.", values: stripePrices });
    if (stripePk.length > 0) pay.push({ id: "pay-stripe-pk", kind: "info", title: "Stripes offentlige nøkkel står i koden", values: stripePk });
  }
  const hooks = fns.filter((f) => f.webhook);
  if (hooks.length > 0) pay.push({ id: "pay-webhooks", kind: "todo", title: "Pek webhookene på de nye adressene", detail: "Adressen blir https://<ny referanse>.supabase.co/functions/v1/<navn>.", values: hooks.map((f) => `${f.name}  (${f.webhook === "stripe" ? "Stripe" : f.webhook === "paddle" ? "Paddle" : "webhook"})`) });
  if (usesPaddle || usesStripe) pay.push({ id: "pay-test", kind: "todo", title: "Prøv en testbetaling før du går live", detail: "Bruk testmodus hos Paddle eller Stripe, og sjekk at abonnementet vises i den nye databasen." });
  add("payments", "Betaling", pay);

  // --- the front end
  const front: Item[] = [];
  const viteVars = uniq(sources(files).flatMap(([, c]) => names(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g, c.slice(0, MAX_CHARS)))).sort();
  if (viteVars.length > 0) front.push({ id: "fe-env", kind: "todo", title: `Sett ${viteVars.length} VITE_-variabler for det nye oppsettet`, detail: "De bakes inn når siden bygges, så de må settes hos verten før bygging.", values: viteVars });
  const refs = new Map<string, string[]>();
  for (const [path, content] of Object.entries(files)) {
    if (!/\.(ts|tsx|js|jsx|mjs|html|toml|json)$/.test(path)) continue;
    for (const m of content.slice(0, MAX_CHARS).matchAll(OLD_REF)) refs.set(m[1]!, uniq([...(refs.get(m[1]!) ?? []), path]));
  }
  if (refs.size > 0) front.push({ id: "fe-ref", kind: "todo", title: "Den gamle Supabase-adressen står rett i koden", detail: "Lovable skriver gjerne adressen og den offentlige nøkkelen inn i src/integrations/supabase/client.ts. Bytt dem mot det nye prosjektets, eller flytt dem til VITE_-variabler.", values: [...refs.entries()].map(([ref, paths]) => `${ref}.supabase.co  ·  ${paths.slice(0, 4).join(", ")}${paths.length > 4 ? " …" : ""}`) });
  if (/supabase\.auth\./.test(all)) front.push({ id: "fe-auth", kind: "todo", title: "Sett adressene til siden under Authentication, URL Configuration", detail: "Site URL og Redirect URLs må være adressen til den nye siden, ellers feiler innlogging og e-postlenker." });
  add("frontend", "Appen (nettleserdelen)", front);

  // --- what is Lovable's own
  const clean: Item[] = [];
  if (/lovable-tagger/.test(pkgText)) clean.push({ id: "cl-tagger", kind: "info", title: "lovable-tagger kan fjernes", detail: "Pakken og linjen i vite.config.ts er bare til Lovables editor, og gjør ingenting på en vanlig side.", values: ["lovable-tagger"] });
  if (/gptengineer\.js|lovable\.dev\/(?:s|projects)/.test(text(files, "/index.html"))) clean.push({ id: "cl-script", kind: "info", title: "Lovable-skriptet i index.html kan fjernes", detail: "Det gjør at siden kan redigeres i Lovable, og laster noe fra deres server." });
  if (Object.keys(files).some((p) => p.startsWith("/.lovable/"))) clean.push({ id: "cl-folder", kind: "info", title: "Mappen .lovable kan fjernes" });
  if (/lovable\.app|lovable\.dev/i.test(all)) clean.push({ id: "cl-urls", kind: "warn", title: "Koden nevner lovable.app eller lovable.dev", detail: "Sjekk at ingen adresser, bilder eller metadata (delingsbilde, canonical) fortsatt peker dit." });
  add("cleanup", "Lovable-rester", clean);

  const hosting = hostingOf(files, viteVars);
  const host: Item[] = [
    { id: "host-project", kind: "todo", title: "Rull ut til Cloudflare Pages", detail: "Fra Pivolar: Publiser, velg Cloudflare (krever CLOUDFLARE_API_TOKEN og CLOUDFLARE_ACCOUNT_ID). Eller koble repoet i Cloudflare under Workers & Pages, Create, Pages, Connect to Git." },
    { id: "host-settings", kind: "info", title: `Innstillinger: ${hosting.preset}`, values: [`Byggekommando: ${hosting.build}`, `Utdatamappe: ${hosting.output}`, ...(hosting.node ? [`Node: ${hosting.node}`] : [])] },
    ...hosting.notes.map((n, i): Item => ({ id: `host-note-${i}`, kind: n.startsWith("Next.js") || n.startsWith("SvelteKit") || n.startsWith("Fant ikke") ? "warn" : "info", title: n })),
    { id: "host-domain", kind: "todo", title: "Koble domenet", detail: "Mer, Domene i Pivolar, eller under Custom domains i Cloudflare Pages." },
  ];
  groups.push({ id: "hosting", title: "Cloudflare Pages", items: host });

  return { lovable, groups, hosting, summary: { tables: tables.length, functions: fns.length, secrets: secretNames.length, webhooks: hooks.length, migrations: migrations.length } };
}

/** The checklist as plain text, to copy into notes or a ticket. `done` lists the ids already ticked. */
export function reportToText(report: MoveReport, done: ReadonlySet<string> = new Set()): string {
  const lines = [`Flyttesjekk${report.lovable ? " (Lovable-prosjekt)" : ""}`, ""];
  for (const group of report.groups) {
    lines.push(group.title);
    for (const item of group.items) {
      const mark = item.kind === "info" ? "-" : done.has(item.id) ? "[x]" : "[ ]";
      lines.push(`${mark} ${item.kind === "warn" ? "OBS: " : ""}${item.title}`);
      if (item.detail) lines.push(`    ${item.detail}`);
      for (const v of item.values ?? []) lines.push(`    · ${v}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
