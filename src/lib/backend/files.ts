import type { FileMap } from "../files.ts";
import { parseSchema, schemaSql, typesFile, type Table } from "./schema.ts";

/**
 * The files that give an app sign-in and a database through Supabase: the client, a hook for reading
 * and writing a table, a sign-in gate, the row types and the SQL. All of it is fixed code. The only
 * values written into it are the project's address and its public key, which are made to be public.
 */

const PLACEHOLDER_URL = "https://DITT-PROSJEKT.supabase.co";
const PLACEHOLDER_KEY = "DIN-OFFENTLIGE-NOKKEL";

const client = (url: string, key: string) => `import { createClient } from "@supabase/supabase-js";

// Adressen og den offentlige nøkkelen er laget for å ligge i nettleseren. Hva en bruker får se
// og endre bestemmes av reglene i supabase/schema.sql, ikke av nøkkelen.
export const supabase = createClient(${JSON.stringify(url)}, ${JSON.stringify(key)});
`;

const USE_TABLE = `import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { TableName, Tables } from "./db-types";

/** Forklarer en feil fra databasen med ord brukeren kan gjøre noe med. */
function friendly(message: string): string {
  if (/does not exist|schema cache|could not find the table/i.test(message)) return "Tabellen finnes ikke ennå. Kjør supabase/schema.sql i Supabase (SQL Editor).";
  if (/row-level security|permission denied|jwt/i.test(message)) return "Ingen tilgang. Logg inn og prøv igjen.";
  return message;
}

/** Leser og skriver en tabell. En bruker ser og endrer bare sine egne rader (reglene ligger i databasen). */
export function useTable<N extends TableName>(name: N) {
  type Row = Tables[N]["row"];
  type Values = Tables[N]["insert"];
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const { data, error: failure } = await supabase.from(name).select("*").order("created_at", { ascending: false });
    setError(failure ? friendly(failure.message) : "");
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, [name]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(action: PromiseLike<{ error: { message: string } | null }>): Promise<boolean> {
    const { error: failure } = await action;
    if (failure) {
      setError(friendly(failure.message));
      return false;
    }
    await reload();
    return true;
  }

  return {
    rows,
    loading,
    error,
    reload,
    add: (values: Values) => run(supabase.from(name).insert(values)),
    update: (id: string, values: Partial<Values>) => run(supabase.from(name).update(values as Record<string, unknown>).eq("id", id)),
    remove: (id: string) => run(supabase.from(name).delete().eq("id", id)),
  };
}
`;

const AUTH_GATE = `import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

/** Den innloggede brukeren, eller null. undefined mens det sjekkes. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

export function SignOutButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className ?? "text-sm underline"} onClick={() => void supabase.auth.signOut()}>
      Logg ut
    </button>
  );
}

function message(text: string): string {
  if (/invalid login credentials/i.test(text)) return "Feil e-post eller passord.";
  if (/already registered|already been registered/i.test(text)) return "Det finnes allerede en konto med denne e-posten. Logg inn i stedet.";
  if (/password should be at least|weak/i.test(text)) return "Passordet er for svakt. Bruk minst 8 tegn.";
  if (/email not confirmed/i.test(text)) return "Bekreft e-posten din først. Sjekk innboksen.";
  if (/rate limit|too many/i.test(text)) return "For mange forsøk. Vent litt og prøv igjen.";
  return "Noe gikk galt. Prøv igjen.";
}

function SignIn() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (mode === "up" && password.length < 8) return setError("Passordet må ha minst 8 tegn.");
    setBusy(true);
    const result = mode === "in" ? await supabase.auth.signInWithPassword({ email: email.trim(), password }) : await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (result.error) return setError(message(result.error.message));
    if (mode === "up" && !result.data.session) setNotice("Sjekk e-posten din og bekreft kontoen. Logg deretter inn.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-5">
      <h1 className="text-2xl font-semibold">{mode === "in" ? "Logg inn" : "Lag konto"}</h1>
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <label className="block text-sm">
          E-post
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <label className="block text-sm">
          Passord
          <input type="password" required minLength={mode === "up" ? 8 : undefined} autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-emerald-700">{notice}</p> : null}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-60">
          {busy ? "Venter …" : mode === "in" ? "Logg inn" : "Lag konto"}
        </button>
      </form>
      <button type="button" className="text-sm underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
        {mode === "in" ? "Ny her? Lag konto" : "Har du konto? Logg inn"}
      </button>
    </main>
  );
}

/** Viser innloggingen til brukeren er inne, og deretter appen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session === undefined) return <p className="p-6 text-sm text-slate-500">Laster …</p>;
  if (!session) return <SignIn />;
  return <>{children}</>;
}
`;

/** Every file the backend adds. The same paths whatever the values, so the project can tell that it is connected. */
export function backendFiles(options: { url?: string; key?: string; tables?: Table[] } = {}): FileMap {
  const tables = options.tables ?? [];
  return {
    "/lib/supabase.ts": client(options.url ?? PLACEHOLDER_URL, options.key ?? PLACEHOLDER_KEY),
    "/lib/useTable.ts": USE_TABLE,
    "/lib/db-types.ts": typesFile(tables),
    "/components/AuthGate.tsx": AUTH_GATE,
    "/supabase/schema.sql": schemaSql(tables),
  };
}

/** The files from what the owner typed. Tables that cannot be read give no tables, and the check says why. */
export function backendFilesFor(values: Record<string, string>): FileMap {
  const parsed = parseSchema(values.tables ?? "");
  return backendFiles({ ...(values.url ? { url: values.url.replace(/\/+$/, "") } : {}), ...(values.anonKey ? { key: values.anonKey } : {}), tables: parsed.ok ? parsed.tables : [] });
}
