import { PROTECTED_PATHS, type FileMap } from "../files.ts";
import type { Finding } from "./quality.ts";

/**
 * More security checks, for the parts the first check does not cover: server functions under /api
 * (added by connectors), keys that would ship to the browser because of how they are named, and
 * markup that opens the page to attacks. Like the first check it only reads the code.
 */

const line = (text: string, index: number) => text.slice(0, index).split("\n").length;
const CODE = /\.(tsx?|jsx?|mts|mjs)$/;

/** Public variable prefixes: whatever carries one is written into the page every visitor downloads. */
const PUBLIC_ENV = /\b(?:import\.meta\.env\.VITE_|process\.env\.(?:NEXT_PUBLIC_|VITE_))[A-Z0-9_]*(?:SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|TOKEN|API_KEY|APIKEY)[A-Z0-9_]*/g;

/** Names that hold what the caller sent: `const b = await request.json()`, `const { to } = await request.json()`, `new URL(request.url)`. */
function requestVariables(content: string): string[] {
  const names = new Set<string>();
  for (const m of content.matchAll(/(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:\(\s*)?(?:await\s+)?(?:\(\s*)?(?:request\.(?:json|formData|text)\s*\(|new\s+URL\s*\(\s*request\.url)/g)) names.add(m[1]!);
  for (const m of content.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*(?::[^=]+)?=\s*(?:\(\s*)?await\s+request\.(?:json|formData)\s*\(/g)) {
    for (const part of m[1]!.split(",")) {
      const name = part.split(":").pop()?.split("=")[0]?.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

/** Whether the first argument of fetch is built from the request: the host itself, or the whole address. Values in a fixed address are fine. */
function addressFromRequest(argument: string, names: string[]): boolean {
  const text = argument.trim();
  if (names.length === 0) return false;
  const name = `(?:${names.map((n) => n.replace(/[$]/g, "\\$&")).join("|")})`;
  if (new RegExp(`^${name}\\b`).test(text)) return true;
  if (new RegExp(`^\`(?:https?:\\/\\/)?\\$\\{\\s*${name}\\b`).test(text)) return true;
  if (new RegExp(`^["'\`]https?:\\/\\/["'\`]\\s*\\+\\s*${name}\\b`).test(text)) return true;
  return false;
}

export function moreSecurityFindings(files: FileMap): Finding[] {
  const out: Finding[] = [];

  for (const [path, content] of Object.entries(files)) {
    if (PROTECTED_PATHS.has(path) || !CODE.test(path)) continue;
    const server = path.startsWith("/api/");

    // --- keys that ship to the browser
    if (!server) {
      for (const m of content.matchAll(PUBLIC_ENV)) {
        out.push({
          id: `public-env:${path}:${m.index}`,
          severity: "high",
          title: `${path} leser en hemmelighet fra en offentlig variabel`,
          detail: `${m[0]} er skrevet inn i siden hver besøkende laster ned. Variabler som starter med VITE_ eller NEXT_PUBLIC_ er aldri hemmelige.`,
          path,
          line: line(content, m.index ?? 0),
          fix: `Flytt det som bruker ${m[0]} i ${path} til en serverfunksjon under /api, og les nøkkelen der med process.env uten VITE_/NEXT_PUBLIC_ foran. Si fra at nøkkelen må byttes hos tjenesten, siden den kan ha vært eksponert.`,
        });
      }
    }

    // --- markup that opens the page to attacks
    if (!server) {
      for (const m of content.matchAll(/<a\b[^>]*\btarget\s*=\s*["']_blank["'][^>]*>/g)) {
        if (/\brel\s*=\s*["'][^"']*noopener/.test(m[0])) continue;
        out.push({
          id: `blank:${path}:${m.index}`,
          severity: "low",
          title: `Lenke som åpner ny fane uten rel="noopener" i ${path.split("/").pop()}`,
          detail: "Siden som åpnes kan styre fanen den kom fra. Moderne nettlesere demper det, men rel er billig sikring.",
          path,
          line: line(content, m.index ?? 0),
          fix: `Legg rel="noopener noreferrer" på lenken i ${path} linje ${line(content, m.index ?? 0)}.`,
        });
      }
      for (const m of content.matchAll(/\.(?:innerHTML|outerHTML)\s*=(?!=)|document\.write\s*\(|insertAdjacentHTML\s*\(/g)) {
        out.push({
          id: `inner-html:${path}:${m.index}`,
          severity: "medium",
          title: `${path} skriver HTML direkte inn i siden`,
          detail: "Hvis teksten kan komme fra brukere eller et API, kan den kjøre skadelig kode hos andre besøkende.",
          path,
          line: line(content, m.index ?? 0),
          fix: `Bytt ut direkte HTML-skriving i ${path} linje ${line(content, m.index ?? 0)} med JSX eller textContent.`,
        });
      }
      for (const m of content.matchAll(/(?:href|src)\s*=\s*\{?\s*["'`]\s*javascript:/gi)) {
        out.push({
          id: `js-url:${path}:${m.index}`,
          severity: "medium",
          title: `${path} har en javascript:-adresse`,
          detail: "Slike adresser kjører kode når noen trykker, og er blokkert av de fleste sikkerhetsregler.",
          path,
          line: line(content, m.index ?? 0),
          fix: `Bytt javascript:-adressen i ${path} med en vanlig onClick.`,
        });
      }
      for (const m of content.matchAll(/\bpostMessage\s*\([^)]*,\s*["']\*["']\s*\)/g)) {
        out.push({
          id: `post-message:${path}:${m.index}`,
          severity: "low",
          title: `${path} sender meldinger til alle vinduer`,
          detail: "Med «*» som mottaker kan hvilken som helst side som har åpnet denne lese meldingen.",
          path,
          line: line(content, m.index ?? 0),
          fix: `Bytt «*» i postMessage i ${path} med den faktiske adressen til mottakeren.`,
        });
      }
      for (const m of content.matchAll(/(?:src|href)\s*=\s*["']http:\/\/(?!localhost|127\.0\.0\.1)[^"']+["']/g)) {
        out.push({
          id: `mixed:${path}:${m.index}`,
          severity: "low",
          title: `${path} laster noe over ukryptert http`,
          detail: "En https-side som laster http-innhold blir blokkert eller advarsel i nettleseren.",
          path,
          line: line(content, m.index ?? 0),
          fix: `Bytt http:// med https:// i ${path} linje ${line(content, m.index ?? 0)}.`,
        });
      }
    }

    // --- server functions
    if (server) {
      for (const m of content.matchAll(/(?:Response(?:\.json)?\s*\(|JSON\.stringify\s*\()[^;]*process\.env\b/g)) {
        out.push({
          id: `env-leak:${path}:${m.index}`,
          severity: "high",
          title: `${path} sender miljøvariabler i svaret`,
          detail: "Alt i svaret kan leses av den som kaller funksjonen, også nøkler.",
          path,
          line: line(content, m.index ?? 0),
          fix: `Fjern process.env fra svaret i ${path}. Svar bare med det den som kaller trenger.`,
        });
      }
      const reads = /\brequest\.(?:json|formData|text)\s*\(/.test(content);
      const checks = /\btypeof\b|\.length\b|\.test\s*\(|\.safeParse\s*\(|\.parse\s*\(/.test(content);
      if (reads && !checks) {
        out.push({
          id: `no-validation:${path}`,
          severity: "medium",
          title: `${path} bruker innkommende data uten kontroll`,
          detail: "Funksjonen er åpen for hvem som helst. Uten kontroll av type og lengde kan den misbrukes eller krasje.",
          path,
          fix: `Valider innkommende data i ${path}: sjekk type og maks lengde på hvert felt, og svar 400 med en kort feilmelding ved ugyldig data.`,
        });
      }
      const inputs = requestVariables(content);
      for (const m of content.matchAll(/\bfetch\(\s*([^,)]{0,160})/g)) {
        if (!addressFromRequest(m[1] ?? "", inputs)) continue;
        out.push({
          id: `ssrf:${path}:${m.index}`,
          severity: "medium",
          title: `${path} henter en adresse som kommer fra den som kaller`,
          detail: "Da kan funksjonen brukes til å nå interne tjenester eller andres systemer (SSRF).",
          path,
          line: line(content, m.index ?? 0),
          fix: `I ${path} må funksjonen bare hente fra en fast, kjent adresse. Bruk innkommende data bare som verdier, ikke som hele eller deler av adressen, eller slå opp mot en liste over tillatte verter.`,
        });
      }
      for (const m of content.matchAll(/Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']/gi)) {
        out.push({
          id: `cors:${path}:${m.index}`,
          severity: "low",
          title: `${path} tillater kall fra alle nettsteder`,
          detail: "Greit for helt åpne data, men ikke for funksjoner som sender e-post, melder på eller skriver til en tjeneste.",
          path,
          line: line(content, m.index ?? 0),
          fix: `Begrens Access-Control-Allow-Origin i ${path} til adressen til siden din, eller fjern headeren hvis funksjonen bare brukes fra samme side.`,
        });
      }
      for (const m of content.matchAll(/(?:Response(?:\.json)?\s*\(|JSON\.stringify\s*\()[^;]*(?:\b(?:err|error|e)\.(?:message|stack)|String\(\s*(?:err|error|e)\s*\))/g)) {
        out.push({
          id: `error-leak:${path}:${m.index}`,
          severity: "low",
          title: `${path} sender interne feilmeldinger til den som kaller`,
          detail: "Feilmeldinger kan avsløre oppbygging, filstier og noen ganger nøkler.",
          path,
          line: line(content, m.index ?? 0),
          fix: `Svar med en kort, generell feilmelding i ${path}, og logg detaljene med console.error i stedet.`,
        });
      }
      if (!/\bRateLimit|rate[-_ ]?limit|\bhoneypot\b|website\b|turnstile|recaptcha|hcaptcha/i.test(content) && /\bfetch\(\s*["'`]https?:/.test(content)) {
        out.push({
          id: `no-abuse-guard:${path}`,
          severity: "low",
          title: `${path} har ingen beskyttelse mot misbruk`,
          detail: "En åpen funksjon som sender e-post, SMS eller melder på kan bli brukt av roboter og gi deg regningen.",
          path,
          fix: `Legg til et skjult honeypot-felt i skjemaet som bruker ${path}, avvis forespørsler der det er fylt ut, og begrens størrelsen på det som sendes.`,
        });
      }
    }
  }

  return out;
}

/** The checklist an AI review works through. It is sent in chat mode, so it reports and does not change files. */
export function deepScanRequest(files: FileMap): string {
  const paths = Object.keys(files).filter((p) => !PROTECTED_PATHS.has(p));
  const api = paths.filter((p) => p.startsWith("/api/"));
  const sql = paths.filter((p) => p.endsWith(".sql"));
  return `Gjør en grundig sikkerhetsgjennomgang av dette prosjektet. Les filene før du svarer, og ikke endre noe nå: bare rapporter.

Gå gjennom, i denne rekkefølgen, og svar med konkrete funn (fil og linje, hva som kan skje, hvordan det rettes):
1. Innlogging og tilgang: kan noen se eller endre andres data? Er sider eller handlinger som krever innlogging faktisk beskyttet på serveren, ikke bare skjult i skjermbildet?
2. Datatilgang: ${sql.length > 0 ? `les ${sql.join(", ")} og sjekk radnivå-sikkerhet og policyer.` : "finnes det en database? Hvis ja, hvilke regler styrer hvem som kan lese og skrive?"}
3. Input og injeksjon: skjemaer og alt som skrives ut på siden (XSS, usikre adresser, rå HTML).
4. Hemmeligheter: nøkler i koden, i variabler med VITE_/NEXT_PUBLIC_ foran, eller i svar fra serverfunksjoner.
5. Serverfunksjoner${api.length > 0 ? ` (${api.join(", ")})` : ""}: validering, misbruk (roboter, regningen), henting av adresser fra innkommende data (SSRF), feilmeldinger som lekker detaljer.
6. Tredjepartsskript og innebygd innhold: hva lastes fra andre steder, og hva skjer hvis det byttes ut?
7. Personvern: hva samles inn, og er samtykke og sletting dekket?

Avslutt med en prioritert liste (alvorlig, bør rettes, liten) og spør om jeg vil at du retter de alvorlige først. Ikke svekk noe for å få det til å virke.`;
}
