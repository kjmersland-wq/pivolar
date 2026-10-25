import type { FileMap } from "../files.ts";
import type { Finding } from "./quality.ts";
import { moreSecurityFindings } from "./security-more.ts";
import { edgeSecurityFindings } from "./security-edge.ts";

/**
 * Security check: reads the project the way a reviewer would before it goes live. It looks for
 * database rules that let everyone in, secrets in code that ships to the browser, and risky
 * patterns. It cannot see the live database, so it says what it checked.
 */

const line = (text: string, index: number) => text.slice(0, index).split("\n").length;

function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(payload)) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

const SECRETS: { id: string; re: RegExp; what: string }[] = [
  { id: "anthropic", re: /sk-ant-[A-Za-z0-9_-]{20,}/g, what: "en Anthropic-nøkkel" },
  { id: "openai", re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/g, what: "en OpenAI-lignende nøkkel" },
  { id: "stripe", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g, what: "en hemmelig Stripe-nøkkel" },
  { id: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g, what: "en AWS-nøkkel" },
  { id: "github", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, what: "et GitHub-token" },
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, what: "en privat nøkkel" },
];

export function securityFindings(files: FileMap): Finding[] {
  const out: Finding[] = [];
  const add = (f: Omit<Finding, "id"> & { id: string }) => out.push(f);
  let usesDatabase = false;
  let usesAuth = false;

  for (const [path, content] of Object.entries(files)) {
    const isSql = path.endsWith(".sql");
    const isCode = /\.(tsx?|jsx?)$/.test(path);
    if (!isSql && !isCode && !path.endsWith(".json") && !path.endsWith(".html")) continue;

    // --- secrets that would ship to every visitor
    for (const s of SECRETS) {
      for (const m of content.matchAll(s.re)) {
        add({
          id: `secret:${s.id}:${path}:${m.index}`,
          severity: "high",
          title: `${path} inneholder ${s.what}`,
          detail: "Alt i koden kan leses av hvem som helst som åpner siden. Nøkkelen må byttes ut hos tjenesten, og må ikke ligge i koden.",
          path,
          line: line(content, m.index!),
          fix: `Fjern ${s.what} fra ${path} (linje ${line(content, m.index!)}). Hemmelige nøkler skal aldri ligge i nettleserkode. Bruk en miljøvariabel hvis det trengs, og si fra at nøkkelen må byttes hos tjenesten siden den har vært eksponert.`,
        });
      }
    }
    for (const m of content.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
      if (jwtRole(m[0]) === "service_role") {
        add({
          id: `secret:service-role:${path}:${m.index}`,
          severity: "high",
          title: `${path} inneholder en Supabase service_role-nøkkel`,
          detail: "Den omgår alle databaseregler. Hvem som helst kan lese og slette alt. Bytt nøkkelen i Supabase med en gang.",
          path,
          line: line(content, m.index!),
          fix: `Fjern service_role-nøkkelen fra ${path}. Bruk bare den offentlige anon-nøkkelen i nettleseren, og si fra at service_role må byttes i Supabase.`,
        });
      }
    }
    if (isCode && /service_role/i.test(content) && !out.some((f) => f.path === path && f.id.startsWith("secret:service-role"))) {
      add({
        id: `service-role-ref:${path}`,
        severity: "medium",
        title: `${path} nevner service_role`,
        detail: "Nøkkelen med full tilgang skal bare brukes på en tjener, aldri i kode som kjører i nettleseren.",
        path,
        fix: `Sjekk ${path}: service_role skal ikke brukes i nettleserkode. Bruk anon-nøkkelen og la databasereglene styre tilgangen.`,
      });
    }

    // --- database rules
    if (isSql) {
      const tables = [...content.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)].map((m) => m[1]!);
      for (const table of tables) {
        const secured = new RegExp(`alter\\s+table\\s+(?:public\\.)?"?${table}"?\\s+enable\\s+row\\s+level\\s+security`, "i").test(content);
        if (!secured) {
          add({
            id: `no-rls:${path}:${table}`,
            severity: "high",
            title: `Tabellen «${table}» har ikke radnivå-sikkerhet`,
            detail: "Uten Row-Level Security kan hvem som helst med den offentlige nøkkelen lese og endre alle rader.",
            path,
            fix: `Slå på radnivå-sikkerhet for tabellen ${table} i ${path} (alter table ${table} enable row level security), og lag policyer så brukere bare ser og endrer sine egne rader (for eksempel user_id = auth.uid()).`,
          });
        }
      }
      for (const m of content.matchAll(/create\s+policy[\s\S]*?;/gi)) {
        const policy = m[0];
        const open = /(?:using|with\s+check)\s*\(\s*true\s*\)/i.test(policy);
        if (open) {
          const name = policy.match(/create\s+policy\s+"?([^"\s]+)"?/i)?.[1] ?? "policy";
          const forAnon = /to\s+(?:anon|public)\b/i.test(policy) || !/\bto\s+/i.test(policy);
          const write = /for\s+(?:insert|update|delete|all)\b/i.test(policy) || !/for\s+select/i.test(policy);
          add({
            id: `open-policy:${path}:${m.index}`,
            severity: write ? "high" : "medium",
            title: `Åpen policy «${name}»`,
            detail: write
              ? "Policyen slipper alle inn, også for å skrive og slette. Det fjerner hele beskyttelsen."
              : forAnon
                ? "Alle kan lese hele tabellen. Det er greit for offentlig innhold, men ikke for personlige data."
                : "Alle innloggede kan lese hele tabellen.",
            path,
            line: line(content, m.index!),
            fix: `Stram inn policyen «${name}» i ${path}: bytt ut true med en betingelse som knytter raden til brukeren (for eksempel user_id = auth.uid()). Hvis innholdet skal være offentlig, begrens policyen til select.`,
          });
        }
      }
    }

    // --- code patterns
    if (isCode) {
      if (/\.from\(\s*['"`]/.test(content)) usesDatabase = true;
      if (/\bauth\.(?:getUser|getSession|signIn|signUp|onAuthStateChange)|useAuth\b|supabase\.auth/.test(content)) usesAuth = true;
      for (const m of content.matchAll(/dangerouslySetInnerHTML/g)) {
        add({
          id: `html:${path}:${m.index}`,
          severity: "medium",
          title: `${path} setter inn rå HTML`,
          detail: "Hvis innholdet kommer fra brukere eller et API, kan det kjøre skadelig kode hos andre besøkende.",
          path,
          line: line(content, m.index!),
          fix: `Bytt ut dangerouslySetInnerHTML i ${path} med vanlig JSX. Hvis rå HTML er nødvendig, rens den først.`,
        });
      }
      for (const m of content.matchAll(/\beval\s*\(|new\s+Function\s*\(/g)) {
        add({
          id: `eval:${path}:${m.index}`,
          severity: "medium",
          title: `${path} kjører tekst som kode`,
          detail: "eval og new Function lar tekst bli til kode, som er en vanlig inngang for angrep.",
          path,
          line: line(content, m.index!),
          fix: `Fjern eval/new Function i ${path} og skriv logikken direkte.`,
        });
      }
      for (const m of content.matchAll(/localStorage\.setItem\(\s*['"`][^'"`]*(?:token|password|passord|secret)[^'"`]*['"`]/gi)) {
        add({
          id: `storage:${path}:${m.index}`,
          severity: "low",
          title: `${path} lagrer en hemmelighet i nettleseren`,
          detail: "Alt i localStorage kan leses av enhver kode på siden. Passord og tokens bør ikke ligge der.",
          path,
          line: line(content, m.index!),
          fix: `Ikke lagre passord eller tokens i localStorage i ${path}. La Supabase håndtere sesjonen.`,
        });
      }
      for (const m of content.matchAll(/\bfetch\(\s*['"`]http:\/\/(?!localhost|127\.0\.0\.1)/g)) {
        add({
          id: `http:${path}:${m.index}`,
          severity: "low",
          title: `${path} henter data over ukryptert http`,
          detail: "Data kan leses og endres underveis. Bruk https.",
          path,
          line: line(content, m.index!),
          fix: `Bytt http:// med https:// i kallet i ${path}, hvis tjenesten støtter det.`,
        });
      }
    }
  }

  if (usesDatabase && !usesAuth) {
    out.push({
      id: "no-auth",
      severity: "medium",
      title: "Appen bruker databasen, men har ingen innlogging",
      detail: "Uten innlogging kan databasereglene bare skille på «alle» eller «ingen», så hvem som helst kan se eller endre dataene hvis reglene er åpne.",
      fix: "Legg til innlogging med Supabase Auth (e-post og passord), og vis bare brukerens egne data. Behold dagens utseende.",
    });
  }

  out.push(...moreSecurityFindings(files));
  out.push(...edgeSecurityFindings(files));

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function securityRequest(findings: Finding[]): string {
  const list = findings.slice(0, 6).map((f, i) => `${i + 1}. ${f.fix}`).join("\n");
  return `Rett disse sikkerhetsproblemene, ett om gangen, og les hver fil før du endrer den:\n${list}\n\nIkke svekk beskyttelsen for å få noe til å virke.`;
}
