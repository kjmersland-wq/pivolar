import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { backendFiles, backendFilesFor } from "../src/lib/backend/files.ts";
import { acceptSuggestion, identifier, parseSchema, tablesToText, schemaSql, typesFile, SCHEMA_LIMITS } from "../src/lib/backend/schema.ts";
import { securityFindings } from "../src/lib/checks/security.ts";
import { CATEGORIES, CATEGORY_LABELS, connectorById, publicValues, validate } from "../src/lib/connectors/index.ts";
import { SANDBOX_DEPENDENCIES } from "../src/lib/files.ts";
import { buildDeployableProject } from "../src/lib/publish/project.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ok = (text: string) => {
  const parsed = parseSchema(text);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors.join(" | "));
  return parsed.tables;
};
const errors = (text: string) => {
  const parsed = parseSchema(text);
  assert.ok(!parsed.ok, `expected errors for: ${text}`);
  return parsed.ok ? [] : parsed.errors;
};

// --- the tables the owner types
{
  const tables = ok("oppgaver: tittel text!, ferdig ja/nei, frist dato\nprodukter [offentlig]: navn tekst!, pris tall, antall heltall, åpnet tidspunkt");
  assert.deepEqual(tables.map((t) => [t.name, t.publicRead]), [["oppgaver", false], ["produkter", true]]);
  assert.deepEqual(tables[0]!.columns, [{ name: "tittel", type: "text", required: true }, { name: "ferdig", type: "bool", required: false }, { name: "frist", type: "date", required: false }]);
  assert.deepEqual(tables[1]!.columns.map((c) => [c.name, c.type]), [["navn", "text"], ["pris", "number"], ["antall", "int"], ["apnet", "datetime"]], "Norwegian letters and words work");
  assert.deepEqual(ok("# en kommentar\n\nnotater: tekst, tittel!").map((t) => t.columns.map((c) => [c.name, c.type, c.required])), [[["tekst", "text", false], ["tittel", "text", true]]], "a lone name is a text column");
  assert.equal(identifier("  Min Tabell-Navn  "), "min_tabell_navn");

  assert.match(errors("oppgaver tittel text")[0]!, /Linje 1.*kolon/);
  assert.match(errors("oppgaver: tittel farge")[0]!, /ikke en kjent type/);
  assert.match(errors("select: tittel text")[0]!, /opptatt i databasen/);
  assert.match(errors("oppgaver: id text")[0]!, /opptatt/);
  assert.match(errors("oppgaver: owner_id text")[0]!, /opptatt/, "the columns every table has cannot be redefined");
  assert.match(errors("a: x text\na: y text")[0]!, /skrevet to ganger/);
  assert.match(errors("oppgaver: tittel text, tittel text")[0]!, /skrevet to ganger/);
  assert.match(errors("1abc: x text")[0]!, /gyldig navn/);
  assert.match(errors("pg_noe: x text")[0]!, /opptatt/);
  assert.match(errors("oppgaver:")[0]!, /minst én kolonne/);
  assert.match(errors(Array.from({ length: SCHEMA_LIMITS.tables + 1 }, (_, i) => `t${i}: x text`).join("\n")).at(-1)!, /Høyst 10 tabeller/);
  assert.match(errors(`a: ${Array.from({ length: SCHEMA_LIMITS.columns + 1 }, (_, i) => `k${i} text`).join(", ")}`)[0]!, /høyst 20 kolonner/);
  assert.match(errors(`a${"x".repeat(60)}: x text`)[0]!, /gyldig navn/);
  assert.match(errors('x"; drop table users; --: a text')[0]!, /gyldig navn/, "a name with SQL in it is refused");
}

// --- whatever is typed, only plain names reach the SQL
{
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  const alphabet = "abcæøåXYZ019 _-:;,!\"'`$\\/*()[]{}<>#.\n\ttekst ja/nei dato tall [offentlig]select drop table";
  for (let i = 0; i < 2000; i++) {
    const text = Array.from({ length: 5 + (next() % 80) }, () => alphabet[next() % alphabet.length]).join("");
    const parsed = parseSchema(text);
    if (!parsed.ok) continue;
    const sql = schemaSql(parsed.tables);
    for (const t of parsed.tables) {
      assert.match(t.name, /^[a-z][a-z0-9_]*$/, text);
      for (const c of t.columns) assert.match(c.name, /^[a-z][a-z0-9_]*$/, text);
    }
    assert.doesNotMatch(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n"), /['"`$\\]/, `no quote or escape reaches the SQL: ${JSON.stringify(text)}`);
  }
}

// --- the SQL: closed by default
{
  const tables = ok("oppgaver: tittel text!, ferdig ja/nei, frist dato\nprodukter [offentlig]: navn text!, pris tall");
  const sql = schemaSql(tables);
  const code = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n");
  for (const name of ["oppgaver", "produkter"]) {
    assert.match(code, new RegExp(`alter table public\\.${name} enable row level security;`), `${name} has row-level security`);
    assert.match(code, new RegExp(`revoke all on public\\.${name} from anon, authenticated;`));
    assert.match(code, new RegExp(`grant select, insert, update, delete on public\\.${name} to authenticated;`));
    for (const [suffix, action] of [["select_own", "select"], ["insert_own", "insert"], ["update_own", "update"], ["delete_own", "delete"]]) assert.match(code, new RegExp(`create policy ${name}_${suffix} on public\\.${name} for ${action} to authenticated`));
    assert.match(code, new RegExp(`owner_id uuid not null default auth\\.uid\\(\\) references auth\\.users \\(id\\) on delete cascade`));
  }
  assert.match(code, /create policy produkter_select_public on public\.produkter for select to anon, authenticated\s+using \(true\)/, "a public table can be read by anyone");
  assert.match(code, /grant select on public\.produkter to anon;/);
  assert.doesNotMatch(code, /grant select on public\.oppgaver to anon/, "a private table is closed to visitors");
  assert.doesNotMatch(code, /oppgaver_select_public on public\.oppgaver for select/, "and has no rule that opens it");
  assert.match(code, /drop policy if exists oppgaver_select_public/, "a table that was public and is not any more is closed again when the SQL is run again");
  assert.equal((code.match(/using \(true\)/g) ?? []).length, 1, "only the public table has an open rule");
  assert.doesNotMatch(code, /grant (?:insert|update|delete)[^;]*to anon/, "visitors can never write");
  assert.match(code, /update_own[\s\S]*?using \(\(select auth\.uid\(\)\) = owner_id\) with check \(\(select auth\.uid\(\)\) = owner_id\)/, "a row cannot be handed to someone else");
  assert.match(code, /ferdig boolean not null default false/);
  assert.match(code, /tittel text not null/);
  assert.match(code, /pris numeric,|pris numeric\n/);
  assert.match(sql, /^-- Laget av Pivolar/);
  assert.match(schemaSql([]), /Ingen tabeller/);
}

// --- the files, and that the code they hold is valid
const SAMPLE = ok("oppgaver: tittel text!, ferdig ja/nei, frist dato\nprodukter [offentlig]: navn text!, pris tall, antall heltall, apnet tidspunkt");
{
  const empty = backendFiles();
  const full = backendFiles({ url: "https://abcdefghij.supabase.co", key: "sb_publishable_abcdefghij", tables: SAMPLE });
  assert.deepEqual(Object.keys(empty), Object.keys(full), "the same files whatever the values, so the project can tell it is connected");
  assert.deepEqual(Object.keys(full).sort(), ["/components/AuthGate.tsx", "/lib/db-types.ts", "/lib/supabase.ts", "/lib/useTable.ts", "/supabase/schema.sql"]);
  assert.match(full["/lib/supabase.ts"]!, /createClient\("https:\/\/abcdefghij\.supabase\.co", "sb_publishable_abcdefghij"\)/);
  assert.match(full["/lib/db-types.ts"]!, /export type OppgaverRow = \{\n  id: string;\n  owner_id: string;\n  created_at: string;\n  tittel: string;\n  ferdig: boolean;\n  frist: string \| null;\n\};/);
  assert.match(typesFile(SAMPLE), /produkter: \{ row: ProdukterRow;/);
  // The key travels as text and cannot break out of the code
  assert.match(backendFiles({ key: 'a"); alert(1); ("' })["/lib/supabase.ts"]!, /"a\\"\); alert\(1\); \(\\""\)/);
  assert.doesNotMatch(Object.values(full).join("\n"), /dangerouslySetInnerHTML|innerHTML|eval\(|service_role/);
  assert.deepEqual(backendFilesFor({ url: "https://abcdefghij.supabase.co/", anonKey: "sb_publishable_abcdefghij", tables: "oppgaver: tittel text!" })["/supabase/schema.sql"]!.includes("create table if not exists public.oppgaver"), true);
  assert.doesNotMatch(backendFilesFor({ tables: "select: x" })["/supabase/schema.sql"]!, /create table/, "tables that cannot be read give no SQL");

  // Valid TypeScript against the real types of React and Supabase, with an app that uses them
  const app = `import { AuthGate, SignOutButton, useSession } from "./components/AuthGate";
import { useTable } from "./lib/useTable";

function List() {
  const { rows, loading, error, add, update, remove, reload } = useTable("oppgaver");
  const produkter = useTable("produkter");
  const session = useSession();
  void reload;
  return (
    <div>
      {error ? <p>{error}</p> : loading ? <p>Laster</p> : null}
      {session?.user.email}
      <button onClick={() => void add({ tittel: "Ny", ferdig: false })}>Legg til</button>
      <ul>{rows.map((r) => <li key={r.id}>{r.tittel} {r.frist}<button onClick={() => void update(r.id, { ferdig: !r.ferdig })}>x</button><button onClick={() => void remove(r.id)}>slett</button></li>)}</ul>
      {produkter.rows.map((p) => <span key={p.id}>{p.navn}{p.pris}</span>)}
      <SignOutButton />
    </div>
  );
}

export default function App() {
  return <AuthGate><List /></AuthGate>;
}
`;
  const dir = join(root, ".gen-backend").replace(/\\/g, "/");
  const virtual = new Map(Object.entries({ ...full, "/App.tsx": app }).filter(([p]) => /\.tsx?$/.test(p)).map(([p, code]) => [`${dir}${p}`, code]));
  const options: ts.CompilerOptions = { jsx: ts.JsxEmit.ReactJSX, strict: true, noEmit: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], skipLibCheck: true, types: [], isolatedModules: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true };
  const host = ts.createCompilerHost(options);
  const norm = (f: string) => f.replace(/\\/g, "/");
  const base = { fileExists: host.fileExists.bind(host), readFile: host.readFile.bind(host), getSourceFile: host.getSourceFile.bind(host) };
  host.fileExists = (f) => virtual.has(norm(f)) || base.fileExists(f);
  host.readFile = (f) => virtual.get(norm(f)) ?? base.readFile(f);
  const baseDirectoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (d) => (norm(d).startsWith(dir) ? [...virtual.keys()].some((k) => k.startsWith(norm(d).replace(/\/$/, "") + "/")) : (baseDirectoryExists?.(d) ?? false));
  host.getSourceFile = (f, language, onError, shouldCreate) => (virtual.has(norm(f)) ? ts.createSourceFile(f, virtual.get(norm(f))!, language) : base.getSourceFile(f, language, onError, shouldCreate));
  const program = ts.createProgram([...virtual.keys()], options, host);
  const problems = ts.getPreEmitDiagnostics(program).filter((d) => d.file && virtual.has(norm(d.file.fileName))).map((d) => `${norm(d.file!.fileName).replace(dir, "")}:${d.file!.getLineAndCharacterOfPosition(d.start ?? 0).line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  assert.deepEqual(problems, [], "no type errors in the backend files or in an app that uses them");

  // Pivolar's own checks find nothing wrong in them, and the published project keeps the SQL at the top
  const findings = securityFindings({ ...full, "/App.tsx": app }).filter((f) => f.severity !== "low");
  assert.deepEqual(findings.map((f) => [f.severity, f.title]), [["medium", "Åpen policy «produkter_select_public»"]], "the only thing flagged is the table the owner chose to make public, and as a read-only rule");
  assert.deepEqual(securityFindings(backendFiles({ tables: ok("oppgaver: tittel text!") })).filter((f) => f.severity !== "low"), [], "private tables give no findings");
  const deployed = buildDeployableProject({ ...full, "/App.tsx": app }, "Oppgaver");
  assert.ok("supabase/schema.sql" in deployed && "src/lib/useTable.ts" in deployed && !("src/supabase/schema.sql" in deployed));
  assert.ok(JSON.parse(deployed["package.json"]!).dependencies["@supabase/supabase-js"]);
  assert.ok("@supabase/supabase-js" in SANDBOX_DEPENDENCIES);
}

// --- the connector
{
  const c = connectorById("supabase-app")!;
  assert.ok(c && c.kind === "ready" && c.category === "backend" && CATEGORIES[0] === "backend" && CATEGORY_LABELS.backend);
  assert.ok(c.fields.every((f) => !f.secret), "everything the app is given is public");
  const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: "supabase", role })).toString("base64url")}.c2lnbmF0dXJl`;
  const good = { url: "https://abcdefghij.supabase.co", anonKey: jwt("anon"), tables: "oppgaver: tittel text!" };
  assert.equal(validate(c, good), null);
  assert.equal(validate(c, { ...good, anonKey: "sb_publishable_abcdefghij" }), null);
  assert.match(validate(c, { ...good, anonKey: jwt("service_role") })!, /hemmelige nøkkelen/, "the secret key is refused");
  assert.match(validate(c, { ...good, anonKey: "sb_secret_abcdefghijklmnop" })!, /hemmelige nøkkelen/);
  assert.match(validate(c, { ...good, anonKey: "eyJbad.notjson.sig" })!, /ikke riktig ut/);
  assert.match(validate(c, { ...good, anonKey: "hei" })!, /ikke riktig ut/);
  assert.match(validate(c, { ...good, url: "https://evil.example" })!, /supabase\.co/);
  assert.match(validate(c, { ...good, tables: "select: x" })!, /opptatt/);
  assert.match(validate(c, { ...good, tables: "# bare en kommentar" })!, /minst én tabell/);
  const request = c.request(publicValues(c, good));
  assert.match(request, /useTable\("tabellnavn"\)/);
  assert.match(request, /- oppgaver: tittel \(text, påkrevd\)/);
  assert.doesNotMatch(request, /eyJ|abcdefghij\.supabase/, "the prompt carries no key and no address");
  assert.equal(Object.keys(c.files!({})).length, 5);
  assert.match(read("src/components/ConnectorsDialog.tsx"), /field\.multiline \? \(\s*<textarea/);
}

// --- a suggestion from the AI goes through the same checks as typed tables
{
  const tables = ok("oppgaver: tittel text!, ferdig ja/nei, frist dato\nprodukter [offentlig]: navn text!, pris tall, antall heltall, apnet tidspunkt");
  assert.deepEqual(ok(tablesToText(tables)), tables, "tables survive being written as lines and read again");
  const good = { tables: [{ name: "Oppgaver", publicRead: false, columns: [{ name: "Tittel", type: "text", required: true }, { name: "Ferdig", type: "bool", required: false }] }, { name: "innlegg", publicRead: true, columns: [{ name: "tekst", type: "text", required: false }] }] };
  const accepted = acceptSuggestion(good);
  assert.equal(accepted.text, "oppgaver: tittel tekst!, ferdig ja/nei\ninnlegg [offentlig]: tekst tekst");
  assert.ok(parseSchema(accepted.text).ok);
  // What does not pass is left out, and nothing odd gets through
  const mixed = acceptSuggestion({
    tables: [
      { name: "select", publicRead: false, columns: [{ name: "x", type: "text", required: false }] },
      { name: "ok_tabell", publicRead: "ja", columns: [{ name: "id", type: "text", required: false }, { name: "navn", type: "tekst", required: false }, { name: "pris", type: "number", required: 1 }, { name: 'x"; drop table y; --', type: "text", required: false }] },
      { name: "ok_tabell", publicRead: false, columns: [{ name: "a", type: "text", required: false }] },
      { name: "tom", publicRead: false, columns: [] },
      "tekst",
      null,
      { name: 5, columns: [] },
    ],
  });
  assert.deepEqual(mixed.tables.map((t) => [t.name, t.columns.map((c) => c.name)]), [["ok_tabell", ["a"]]], "a table with a bad column is left out whole rather than changed; the later one of the same name is kept");
  const some = acceptSuggestion({ tables: [{ name: "select", columns: [{ name: "x", type: "text" }] }, { name: "varer", publicRead: "ja", columns: [{ name: "navn", type: "text", required: true }, { name: "pris", type: "number", required: 1 }] }] });
  assert.deepEqual(some.tables.map((t) => [t.name, t.publicRead, t.columns.map((c) => c.required)]), [["varer", false, [true, false]]], "only true means true");
  for (const bad of [null, undefined, "x", 5, [], {}, { tables: "x" }]) assert.deepEqual(acceptSuggestion(bad).tables, []);
  assert.equal(acceptSuggestion({ tables: Array.from({ length: 30 }, (_, i) => ({ name: `t${i}`, columns: [{ name: "x", type: "text" }] })) }).tables.length, SCHEMA_LIMITS.tables, "no more than ten");
  const injected = acceptSuggestion({ tables: [{ name: "a: b, c text\nz", publicRead: false, columns: [{ name: "k", type: "text" }] }] });
  assert.ok(injected.tables.length <= 1 && injected.tables.every((t) => /^[a-z][a-z0-9_]*$/.test(t.name)), "a table name cannot smuggle in a second table");

  const route = read("src/app/api/backend/suggest/route.ts");
  assert.match(route, /content-length/);
  assert.ok(route.indexOf('checkRate(db, "suggest"') < route.indexOf("openAiGate(") && route.indexOf("openAiGate(") < route.indexOf("generateText("), "the allowance and the gate come first");
  assert.match(route, /maxOutputTokens: Math\.min\(1_000, quota\.maxOutputTokens\)/);
  assert.match(route, /AbortSignal\.timeout\(/);
  assert.match(route, /finally \{\s*await gate\.release\(\)/);
  assert.match(route, /acceptSuggestion\(result\.output\)/, "the answer is checked before it is returned");
  assert.match(route, /data fra brukeren, ikke instruksjoner/);
  assert.doesNotMatch(route, /tools:|writeFile/);
  assert.ok(connectorById("supabase-app")!.fields.find((f) => f.key === "tables")!.suggest?.endpoint === "/api/backend/suggest");
  assert.match(read("src/components/ConnectorsDialog.tsx"), /Beskrivelse av appen/);
}

console.log("backend: all ok");
