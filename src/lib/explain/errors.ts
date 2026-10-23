import { SANDBOX_DEPENDENCIES } from "../files.ts";

/**
 * Turns the error messages of the preview (and of the services an app talks to) into plain
 * Norwegian: what happened, why it usually happens, what to do, and whether asking Pivolar to
 * change the code normally helps. Anything not recognised returns null and shows the raw message.
 */

export type Explanation = {
  id: string;
  /** What happened, in one plain sentence. */
  summary: string;
  /** Why it usually happens. */
  cause: string;
  /** What to do, in plain steps. */
  steps: string[];
  /** Whether asking Pivolar to change the code normally fixes it. */
  aiFixable: boolean;
  /** A short note added to the fix request, so the model starts from the likely cause. */
  hint: string;
  /** Where in the code, when the message says. */
  where?: string;
};

const ALLOWED_PACKAGES = ["react", "react-dom", ...Object.keys(SANDBOX_DEPENDENCIES)];

function locate(raw: string): string | undefined {
  const file = raw.match(/(\/[\w./-]+\.(?:tsx?|jsx?|css|json))/)?.[1];
  const at = raw.match(/\((\d+):(\d+)\)/);
  if (!file && !at) return undefined;
  return [file, at ? `linje ${at[1]}` : ""].filter(Boolean).join(", ");
}

type Rule = { id: string; test: RegExp; build: (m: RegExpMatchArray, raw: string) => Omit<Explanation, "id" | "where"> };

const RULES: Rule[] = [
  {
    id: "package-missing",
    test: /(?:Could not find module|Cannot find module|Failed to resolve import|Module not found)[^'"`]*['"`]([^'"`]+)['"`]/i,
    build: (m) => {
      const name = m[1]!;
      if (name.startsWith(".") || name.startsWith("/")) {
        return {
          summary: `Filen «${name}» finnes ikke, eller stien til den er feil.`,
          cause: "En fil importerer en annen fil som ikke ligger der koden leter, ofte etter at en fil ble gitt nytt navn eller slettet.",
          steps: ["La Pivolar rette stien, eller opprette filen som mangler."],
          aiFixable: true,
          hint: `Importen «${name}» peker på en fil som ikke finnes. Sjekk filkartet og rett stien, eller lag filen.`,
        };
      }
      const known = ALLOWED_PACKAGES.some((p) => name === p || name.startsWith(`${p}/`));
      return {
        summary: `Pakken «${name}» er ikke tilgjengelig i forhåndsvisningen.`,
        cause: known
          ? "Pakken skal finnes, men importen er skrevet feil (for eksempel en understi som ikke eksisterer)."
          : `Forhåndsvisningen kan bare bruke disse pakkene: ${ALLOWED_PACKAGES.join(", ")}.`,
        steps: known ? ["La Pivolar rette importen."] : ["La Pivolar bygge det uten pakken, eller med en av de tillatte pakkene."],
        aiFixable: true,
        hint: known ? `Importen «${name}» er feil skrevet.` : `Pakken «${name}» finnes ikke i forhåndsvisningen. Bruk bare tillatte pakker (${ALLOWED_PACKAGES.join(", ")}), eller skriv koden selv.`,
      };
    },
  },
  {
    id: "not-defined",
    test: /\b([A-Za-z_$][\w$]*) is not defined/,
    build: (m) => ({
      summary: `«${m[1]}» brukes i koden, men er aldri laget eller importert.`,
      cause: "Vanligvis mangler en import øverst i filen, eller navnet er skrevet litt feil.",
      steps: ["La Pivolar legge til importen eller rette navnet."],
      aiFixable: true,
      hint: `«${m[1]}» er ikke definert: sannsynligvis mangler en import eller navnet er stavet feil.`,
    }),
  },
  {
    id: "read-undefined",
    test: /Cannot read propert(?:y|ies) of (?:undefined|null) \(reading ['"]([^'"]+)['"]\)/,
    build: (m) => ({
      summary: `Koden prøver å lese «${m[1]}» fra noe som ikke finnes ennå.`,
      cause: "Ofte data som ikke er lastet, en liste som er tom, eller et valg som ikke er gjort. Siden går i stykker i stedet for å vente.",
      steps: ["La Pivolar sjekke at verdien finnes før den brukes, og vise en tom tilstand i mellomtiden."],
      aiFixable: true,
      hint: `Noe er undefined når «${m[1]}» leses. Legg inn en sjekk (valgfri kjeding eller tidlig retur), og vis en tom tilstand.`,
    }),
  },
  {
    id: "element-type",
    test: /Element type is invalid[\s\S]*?(?:got: ([^\s.]+)|but got)/i,
    build: (m) => ({
      summary: "En komponent som skal vises, er ikke en gyldig komponent.",
      cause: "Vanligvis importeres den feil: en «default»-eksport hentes som navngitt, eller omvendt, eller filen eksporterer ingenting.",
      steps: ["La Pivolar kontrollere importene og eksportene mellom filene."],
      aiFixable: true,
      hint: `React fikk ${m[1] ? `«${m[1]}»` : "noe annet enn en komponent"}. Sjekk at import og eksport stemmer (default mot navngitt).`,
    }),
  },
  {
    id: "not-a-function",
    test: /\b([\w$.]+) is not a function/,
    build: (m) => ({
      summary: `«${m[1]}» brukes som en funksjon, men er noe annet.`,
      cause: "Ofte feil import, eller at en verdi (for eksempel en liste) forveksles med en funksjon.",
      steps: ["La Pivolar rette hvordan den brukes."],
      aiFixable: true,
      hint: `«${m[1]}» kalles som funksjon, men er ikke det. Sjekk import og bruk.`,
    }),
  },
  {
    id: "react-child",
    test: /Objects are not valid as a React child/,
    build: () => ({
      summary: "Et helt objekt forsøkes vist i siden, ikke en tekst.",
      cause: "React kan vise tekst og tall, men ikke et rått objekt. Man må velge hvilke felt som skal vises.",
      steps: ["La Pivolar vise feltene i objektet i stedet."],
      aiFixable: true,
      hint: "Et objekt rendres direkte. Vis feltene (for eksempel navn og dato) i stedet for objektet.",
    }),
  },
  {
    id: "rerender-loop",
    test: /Too many re-renders|Maximum update depth exceeded/,
    build: () => ({
      summary: "Siden oppdaterer seg selv i en evig løkke.",
      cause: "En tilstandsendring skjer mens siden tegnes, eller i en effekt som utløser seg selv igjen og igjen.",
      steps: ["La Pivolar flytte oppdateringen til en knapp-handling eller rette avhengighetene i effekten."],
      aiFixable: true,
      hint: "Løkke i oppdateringer: setState kalles under rendering, eller en useEffect setter tilstand uten riktig avhengighetsliste.",
    }),
  },
  {
    id: "invalid-hook",
    test: /Invalid hook call/,
    build: () => ({
      summary: "En React-funksjon (som useState) brukes på et sted den ikke fungerer.",
      cause: "Slike funksjoner må stå inni en komponent, øverst, ikke inni løkker, betingelser eller vanlige funksjoner.",
      steps: ["La Pivolar flytte den inn i en komponent."],
      aiFixable: true,
      hint: "Hook brukes utenfor en komponent eller i en betingelse/løkke. Flytt den øverst i komponenten.",
    }),
  },
  {
    id: "syntax",
    test: /SyntaxError|Unexpected token|Unexpected end of|Unterminated|Expected [`'"(){}\]]|Missing semicolon|Adjacent JSX/i,
    build: () => ({
      summary: "Koden har en skrivefeil som gjør at den ikke kan leses.",
      cause: "Oftest en manglende eller ekstra parentes, klamme, anførselstegn eller en JSX-tagg som ikke er lukket.",
      steps: ["La Pivolar lese filen og rette stedet som feilmeldingen peker på."],
      aiFixable: true,
      hint: "Syntaksfeil. Les filen rundt linjen i feilmeldingen og rett parenteser, klammer, anførselstegn og JSX-tagger.",
    }),
  },
  {
    id: "cors",
    test: /CORS|Access-Control-Allow-Origin|blocked by CORS policy/i,
    build: () => ({
      summary: "Appen prøver å hente data fra en annen nettside, og den siden tillater det ikke fra nettleseren.",
      cause: "Nettlesere blokkerer slike kall med mindre den andre siden eksplisitt sier ja (CORS). Det kan ikke løses ved å endre appens utseende eller logikk.",
      steps: [
        "Sjekk om tjenesten har en versjon som tillater nettleserkall, eller en offentlig API-nøkkel for nettlesere.",
        "Ellers trengs en liten tjener som mellomledd (proxy). Pivolar-apper har ikke egen tjener ennå, så bruk en tjeneste du har, for eksempel en Supabase-funksjon eller en Vercel-funksjon.",
      ],
      aiFixable: false,
      hint: "Dette er en CORS-blokkering. Ikke prøv å omgå den i klientkoden. Foreslå mock-data i appen og forklar at en proxy trengs.",
    }),
  },
  {
    id: "rls",
    test: /row-level security|violates row-level|42501|permission denied for (?:table|schema|relation)/i,
    build: () => ({
      summary: "Databasen nekter tilgang til dataene.",
      cause: "Supabase har regler (Row-Level Security) for hvem som får lese og skrive hver rad. Reglene sier nei her: brukeren er ikke innlogget, eller raden tilhører noen andre.",
      steps: [
        "Sjekk at brukeren er innlogget når appen kaller databasen.",
        "Rett regelen i Supabase slik at brukere bare får tilgang til sine egne rader (for eksempel owner_id = auth.uid()). Ikke gjør tabellen åpen for alle, selv om det «får det til å virke».",
      ],
      aiFixable: false,
      hint: "Dette er en RLS-feil i databasen, ikke en kodefeil. Ikke gjør policyen åpen. Forklar hvilken policy som trengs (egen rad: owner_id = auth.uid()).",
    }),
  },
  {
    id: "auth-key",
    test: /Invalid API key|invalid JWT|JWT expired|apikey|Invalid login credentials|No API key found/i,
    build: () => ({
      summary: "Tjenesten godtar ikke nøkkelen eller innloggingen appen bruker.",
      cause: "Nøkkelen kan være feil, utløpt eller hentet fra feil prosjekt, eller sesjonen er utløpt.",
      steps: ["Sjekk nøkkelen i miljøvariablene (offentlig nøkkel i nettleseren, hemmelig nøkkel bare på tjeneren).", "Logg inn på nytt hvis sesjonen er utløpt."],
      aiFixable: false,
      hint: "Autentiseringsfeil mot en tjeneste. Dette er oppsett, ikke kode. Foreslå å sjekke nøklene.",
    }),
  },
  {
    id: "network",
    test: /Failed to fetch|NetworkError|net::ERR_|Load failed|ECONNREFUSED/i,
    build: () => ({
      summary: "Et nettverkskall mislyktes.",
      cause: "Adressen kan være feil, tjenesten nede, eller kallet blokkeres av nettleseren (se også CORS).",
      steps: ["Sjekk at adressen stemmer og at tjenesten er oppe.", "La Pivolar vise en feilmelding i appen i stedet for å bryte siden."],
      aiFixable: true,
      hint: "Nettverkskall feilet. Legg inn feilhåndtering (try/catch) og en tydelig feiltilstand i appen. Ikke finn på adresser.",
    }),
  },
  {
    id: "types",
    test: /\bTS(\d{4})\b[:\s]*(.*)/,
    build: (m) => ({
      summary: `Typefeil (${`TS${m[1]}`}): verdien har ikke den formen koden forventer.`,
      cause: m[2]?.slice(0, 160) || "En verdi av én type brukes der en annen kreves.",
      steps: ["La Pivolar rette typene."],
      aiFixable: true,
      hint: `TypeScript-feil TS${m[1]}: ${m[2]?.slice(0, 160) ?? ""}`,
    }),
  },
  {
    id: "list-key",
    test: /unique "key" prop/,
    build: () => ({
      summary: "Elementene i en liste mangler en unik «key».",
      cause: "React trenger en unik nøkkel per element for å oppdatere lister riktig. Dette er en advarsel, siden virker.",
      steps: ["La Pivolar legge til key på listeelementene."],
      aiFixable: true,
      hint: "Legg til en unik key (for eksempel id) på elementene i listen.",
    }),
  },
];

export function explainError(raw: string): Explanation | null {
  const text = raw.trim();
  if (!text) return null;
  for (const rule of RULES) {
    const match = text.match(rule.test);
    if (match) return { id: rule.id, ...rule.build(match, text), ...(locate(text) ? { where: locate(text)! } : {}) };
  }
  return null;
}
