import { backendFilesFor } from "../backend/files.ts";
import { parseSchema } from "../backend/schema.ts";
import type { Connector } from "./types.ts";

/** What the public key of a Supabase project says it is, or null when it does not look like a key at all. */
function keyRole(key: string): string | null {
  if (/^sb_publishable_[\w-]{10,}$/.test(key)) return "anon";
  if (/^sb_secret_/.test(key)) return "service_role";
  const parts = key.split(".");
  if (parts.length !== 3 || !/^eyJ[\w-]+$/.test(parts[0]!)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { role?: string };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

const KEEP_LOOK = "Følg designet siden har fra før (farger, skrift, avrunding).";

export const BACKEND: Connector[] = [
  {
    id: "supabase-app",
    name: "Innlogging og database (Supabase)",
    category: "backend",
    kind: "ready",
    summary: "Gir appen konto og innlogging, og tabeller der hver bruker bare ser sine egne rader. Pivolar skriver SQL-en og koden fra en kort beskrivelse av tabellene, uten AI.",
    docs: "https://supabase.com/docs/guides/database/postgres/row-level-security",
    fields: [
      { key: "url", label: "Prosjektets adresse", placeholder: "https://abcdefghij.supabase.co", help: "Supabase → Project Settings → API → Project URL.", pattern: /^https:\/\/[a-z0-9]{10,30}\.supabase\.co\/?$/, error: "Adressen ser ut som https://abcdefghij.supabase.co." },
      {
        key: "anonKey",
        label: "Offentlig nøkkel (anon eller publishable)",
        placeholder: "eyJ… eller sb_publishable_…",
        help: "Supabase → Project Settings → API. Bruk bare den offentlige nøkkelen. Den hemmelige (service_role / secret) skal aldri inn i en side, og avvises her.",
        check: (value) => {
          const role = keyRole(value);
          if (role === "service_role") return "Dette er den hemmelige nøkkelen (service_role). Den kan lese og endre alt, og må aldri ligge i en side. Bruk den offentlige (anon / publishable).";
          return role === "anon" ? null : "Nøkkelen ser ikke riktig ut. Den offentlige nøkkelen starter med eyJ eller sb_publishable_.";
        },
      },
      {
        key: "tables",
        label: "Tabeller",
        multiline: true,
        suggest: { endpoint: "/api/backend/suggest", label: "Foreslå tabeller med AI", placeholder: "Hva skal appen gjøre? For eksempel: en oppgaveliste der hver bruker har sine egne oppgaver" },
        placeholder: "oppgaver: tittel text!, ferdig ja/nei, frist dato\nprodukter [offentlig]: navn text!, pris tall",
        help: "Én tabell per linje: navn, så kolonner med type (tekst, tall, heltall, ja/nei, dato, tidspunkt). ! betyr påkrevd. [offentlig] betyr at alle kan lese, men bare eieren av raden kan endre.",
        check: (value) => {
          const parsed = parseSchema(value);
          if (!parsed.ok) return parsed.errors[0] ?? "Tabellene kunne ikke leses.";
          return parsed.tables.length ? null : "Skriv minst én tabell.";
        },
      },
    ],
    files: (values) => backendFilesFor(values),
    request: (values) => {
      const parsed = parseSchema(values.tables ?? "");
      const tables = parsed.ok ? parsed.tables : [];
      const list = tables.map((t) => `- ${t.name}${t.publicRead ? " (offentlig: kan leses uten innlogging)" : ""}: ${t.columns.map((c) => `${c.name} (${c.type}${c.required ? ", påkrevd" : ""})`).join(", ")}`).join("\n");
      return `Appen får innlogging og database gjennom Supabase. Filene /lib/supabase.ts, /lib/useTable.ts, /lib/db-types.ts, /components/AuthGate.tsx og /supabase/schema.sql finnes allerede: ikke lag dem på nytt, ikke endre dem og ikke skriv inn nøkler. Pakk det som krever innlogging i <AuthGate> (fra ./components/AuthGate), og vis <SignOutButton /> i menyen. Bruk useTable("tabellnavn") for å lese og skrive: den gir rows, loading, error, add(verdier), update(id, verdier), remove(id) og reload(). Rader har id, owner_id og created_at i tillegg til kolonnene. Vis error i grensesnittet, og tomme tilstander og laster-tilstander. Tabeller:\n${list || "(ingen ennå)"}\nBygg skjemaene og listene appen trenger for disse tabellene. Sett ikke owner_id selv, databasen gjør det. ${KEEP_LOOK}`;
    },
    after: "Kjør supabase/schema.sql i Supabase (SQL Editor) før du prøver appen, og slå på e-postinnlogging under Authentication. Legg til adressen til siden din under Authentication → URL Configuration. Endrer du tabellene, lag filene på nytt her og kjør SQL-en igjen.",
  },
];
