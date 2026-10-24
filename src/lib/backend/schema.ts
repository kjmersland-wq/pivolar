/**
 * A backend for the app Pivolar builds: tables, sign-in and the rules for who may see what. The owner
 * writes the tables in a few plain lines, and plain code turns them into SQL for Supabase with
 * row-level security on every table, plus the files the app uses. No AI writes any SQL.
 *
 *   oppgaver: tittel text, ferdig ja/nei, frist dato
 *   produkter [offentlig]: navn text!, pris tall
 *
 * Every table gets an owner (the signed-in user), and a user only ever sees their own rows. A table
 * marked [offentlig] can also be read by anyone, but still only be changed by the owner of a row.
 */

export type ColumnType = "text" | "int" | "number" | "bool" | "date" | "datetime";
export type Column = { name: string; type: ColumnType; required: boolean };
export type Table = { name: string; publicRead: boolean; columns: Column[] };
export type Parsed = { ok: true; tables: Table[] } | { ok: false; errors: string[] };

export const SCHEMA_LIMITS = { tables: 10, columns: 20, name: 40 };

const TYPES: Record<string, ColumnType> = {
  text: "text", tekst: "text", string: "text",
  int: "int", heltall: "int", integer: "int",
  number: "number", tall: "number", desimal: "number", numeric: "number",
  bool: "bool", boolean: "bool", "ja/nei": "bool",
  date: "date", dato: "date",
  datetime: "datetime", tidspunkt: "datetime", timestamp: "datetime",
};

/** Words PostgreSQL does not let a table or column be named, and the columns every table has already. */
const RESERVED = new Set([
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "both", "case", "cast", "check", "collate", "column", "constraint", "create", "current_date", "current_time", "current_timestamp", "current_user", "default", "deferrable", "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for", "foreign", "from", "grant", "group", "having", "in", "initially", "intersect", "into", "lateral", "leading", "limit", "localtime", "localtimestamp", "not", "null", "offset", "on", "only", "or", "order", "placing", "primary", "references", "returning", "select", "session_user", "some", "symmetric", "table", "then", "to", "trailing", "true", "union", "unique", "user", "using", "variadic", "when", "where", "window", "with",
  "id", "owner_id", "created_at",
]);

/** A name as it is used in the database: lowercase letters, digits and underscores, starting with a letter. */
export function identifier(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s-]+/g, "_");
}

const VALID = /^[a-z][a-z0-9_]*$/;

function checkName(raw: string, what: string, line: number, errors: string[]): string | null {
  const name = identifier(raw);
  if (!name || !VALID.test(name) || name.length > SCHEMA_LIMITS.name) {
    errors.push(`Linje ${line}: «${raw.trim().slice(0, 30)}» er ikke et gyldig navn på ${what}. Bruk bokstaver, tall og understrek, og start med en bokstav.`);
    return null;
  }
  if (RESERVED.has(name) || name.startsWith("pg_")) {
    errors.push(`Linje ${line}: «${name}» kan ikke brukes som navn på ${what} (det er opptatt i databasen). Velg et annet.`);
    return null;
  }
  return name;
}

/** Reads the lines into tables, or says what is wrong in words the owner can act on. */
export function parseSchema(text: string): Parsed {
  const errors: string[] = [];
  const tables: Table[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) return;
    const n = index + 1;
    const colon = line.indexOf(":");
    if (colon < 1) return void errors.push(`Linje ${n}: skriv «tabell: kolonne type, kolonne type». Du mangler kolonnen med kolon.`);
    const head = line.slice(0, colon);
    const publicRead = /\[\s*offentlig\s*\]\s*$/i.test(head);
    const name = checkName(head.replace(/\[[^\]]*\]\s*$/, ""), "tabellen", n, errors);
    if (!name) return;
    if (tables.some((t) => t.name === name)) return void errors.push(`Linje ${n}: tabellen «${name}» er skrevet to ganger.`);
    const columns: Column[] = [];
    for (const part of line.slice(colon + 1).split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const words = piece.split(/\s+/);
      // A lone name is a text column; a ! after the type (or the lone name) means it must be filled in.
      const alone = words.length === 1;
      const typeWord = (alone ? "text" : words[words.length - 1]!).toLowerCase();
      const required = alone ? piece.endsWith("!") : typeWord.endsWith("!");
      if (alone && required) words[0] = words[0]!.slice(0, -1);
      const type = TYPES[typeWord.replace(/!$/, "")];
      const nameWords = words.length > 1 ? words.slice(0, -1) : words;
      if (words.length > 1 && !type) {
        errors.push(`Linje ${n}: «${words[words.length - 1]}» er ikke en kjent type. Bruk tekst, tall, heltall, ja/nei, dato eller tidspunkt.`);
        continue;
      }
      const column = checkName(nameWords.join(" "), "kolonnen", n, errors);
      if (!column) continue;
      if (columns.some((c) => c.name === column)) {
        errors.push(`Linje ${n}: kolonnen «${column}» er skrevet to ganger.`);
        continue;
      }
      columns.push({ name: column, type: type ?? "text", required });
    }
    if (columns.length === 0) return void errors.push(`Linje ${n}: tabellen «${name}» trenger minst én kolonne.`);
    if (columns.length > SCHEMA_LIMITS.columns) return void errors.push(`Linje ${n}: høyst ${SCHEMA_LIMITS.columns} kolonner per tabell.`);
    tables.push({ name, publicRead, columns });
  });
  if (tables.length > SCHEMA_LIMITS.tables) errors.push(`Høyst ${SCHEMA_LIMITS.tables} tabeller.`);
  return errors.length ? { ok: false, errors } : { ok: true, tables };
}

const SQL_TYPES: Record<ColumnType, string> = { text: "text", int: "integer", number: "numeric", bool: "boolean", date: "date", datetime: "timestamptz" };

/** The SQL to run once in Supabase's SQL Editor. Safe to run again: tables and rules are replaced, data is kept. */
export function schemaSql(tables: Table[]): string {
  const out = [
    "-- Laget av Pivolar. Kjør dette i Supabase → SQL Editor.",
    "-- Hver tabell har radnivå-sikkerhet: en bruker ser og endrer bare sine egne rader.",
    "-- Tabeller merket offentlig kan i tillegg leses av alle. Ingen kan endre andres rader.",
    "-- Kjører du det på nytt, beholdes dataene. Nye kolonner legger du til med alter table.",
    "",
  ];
  if (tables.length === 0) out.push("-- Ingen tabeller er lagt til ennå.");
  for (const t of tables) {
    const cols = t.columns.map((c) => `  ${c.name} ${SQL_TYPES[c.type]}${c.type === "bool" ? " not null default false" : c.required ? " not null" : ""}`);
    out.push(
      `create table if not exists public.${t.name} (`,
      "  id uuid primary key default gen_random_uuid(),",
      "  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,",
      "  created_at timestamptz not null default now(),",
      `${cols.join(",\n")}`,
      ");",
      `create index if not exists ${t.name}_owner_idx on public.${t.name} (owner_id);`,
      `alter table public.${t.name} enable row level security;`,
      `revoke all on public.${t.name} from anon, authenticated;`,
      `grant select, insert, update, delete on public.${t.name} to authenticated;`,
    );
    if (t.publicRead) out.push(`grant select on public.${t.name} to anon;`);
    const policy = (suffix: string, action: string, roles: string, clause: string) => [`drop policy if exists ${t.name}_${suffix} on public.${t.name};`, `create policy ${t.name}_${suffix} on public.${t.name} for ${action} to ${roles}`, `  ${clause};`];
    out.push(
      ...policy("select_own", "select", "authenticated", "using ((select auth.uid()) = owner_id)"),
      ...(t.publicRead ? policy("select_public", "select", "anon, authenticated", "using (true)") : [`drop policy if exists ${t.name}_select_public on public.${t.name};`]),
      ...policy("insert_own", "insert", "authenticated", "with check ((select auth.uid()) = owner_id)"),
      ...policy("update_own", "update", "authenticated", "using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)"),
      ...policy("delete_own", "delete", "authenticated", "using ((select auth.uid()) = owner_id)"),
      "",
    );
  }
  return out.join("\n") + "\n";
}

const TS_TYPES: Record<ColumnType, string> = { text: "string", int: "number", number: "number", bool: "boolean", date: "string", datetime: "string" };

const pascal = (name: string) => name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");

/** TypeScript types for the rows, so the app and the model use the same column names. */
export function typesFile(tables: Table[]): string {
  const rows = tables.map((t) => {
    const fields = t.columns.map((c) => `  ${c.name}: ${TS_TYPES[c.type]}${c.required || c.type === "bool" ? "" : " | null"};`);
    return `export type ${pascal(t.name)}Row = {\n  id: string;\n  owner_id: string;\n  created_at: string;\n${fields.join("\n")}\n};`;
  });
  const map = tables.map((t) => `  ${t.name}: { row: ${pascal(t.name)}Row; insert: Partial<Omit<${pascal(t.name)}Row, "id" | "owner_id" | "created_at">> };`);
  return `// Raddata fra supabase/schema.sql. Endrer du tabellene, lag filen på nytt i koblingen.\n${rows.join("\n\n")}${rows.length ? "\n\n" : ""}export type Tables = {\n${map.join("\n")}\n};\n\nexport type TableName = keyof Tables;\n`;
}
