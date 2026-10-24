import type { FileMap } from "../files.ts";

/**
 * Connectors: ready-made links to outside services. Each one says what it needs from the owner
 * (public values and secrets), which files it adds to the project and what the model should build
 * on top of them. Secrets never go into files or prompts: they stay with the owner and are given
 * to the published site as environment variables.
 */

export type Field = {
  key: string;
  label: string;
  placeholder: string;
  /** Secret fields are kept out of files and prompts and sent to the host as environment variables. */
  secret?: boolean;
  /** Environment variable the published site reads the value from. */
  env?: string;
  help?: string;
};

export type Category = "betaling" | "e-post";

export type Connector = {
  id: string;
  name: string;
  category: Category;
  summary: string;
  /** Where the owner gets the values. */
  docs: string;
  fields: Field[];
  /** Files written straight into the project (server functions, for example). */
  files?: (values: Record<string, string>) => FileMap;
  /** What the model builds in the page. Gets only public values. */
  request: (values: Record<string, string>) => string;
  /** Short reminder shown after it has been added. */
  after: string;
};

const clean = (value: string | undefined) => (value ?? "").trim();
const KEEP_LOOK = "Følg designet siden har fra før (farger, skrift, avrunding).";

/** The only environment variables a published site may receive, so nothing else can be sent along. */
export const ENV_NAMES = ["RESEND_API_KEY", "RESEND_AUDIENCE_ID"] as const;

/** Picks the allowed, non-empty environment variables out of whatever the browser sent. */
export function pickEnv(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const name of ENV_NAMES) {
    const value = (input as Record<string, unknown>)[name];
    if (typeof value === "string" && value.trim() && value.length < 500) out[name] = value.trim();
  }
  return out;
}

/** Subscribers are added to a Resend audience. The function lives under /api, which Vercel runs as a server function. */
export const SUBSCRIBE_FUNCTION = `const EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function POST(request: Request): Promise<Response> {
  const key = process.env.RESEND_API_KEY;
  const audience = process.env.RESEND_AUDIENCE_ID;
  if (!key || !audience) return reply(500, { error: "Nyhetsbrevet er ikke satt opp ennå." });

  const body = (await request.json().catch(() => null)) as { email?: unknown; website?: unknown } | null;
  // The hidden "website" field is for bots: people never see it, so they never fill it in.
  if (body?.website) return reply(200, { ok: true });
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 200) return reply(400, { error: "Skriv inn en gyldig e-postadresse." });

  const response = await fetch("https://api.resend.com/audiences/" + audience + "/contacts", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, unsubscribed: false }),
  });
  if (!response.ok) return reply(502, { error: "Kunne ikke melde deg på akkurat nå. Prøv igjen senere." });
  return reply(200, { ok: true });
}
`;

export const CONNECTORS: Connector[] = [
  {
    id: "paddle",
    name: "Paddle",
    category: "betaling",
    summary: "Kjøpsknapp med betalingsvindu. Paddle er selger og tar seg av moms og skatt for deg.",
    docs: "https://developer.paddle.com/paddlejs/overview",
    fields: [
      { key: "token", label: "Klient-token", placeholder: "test_… eller live_…", help: "Paddle → Developer tools → Authentication → Client-side tokens. Er offentlig og trygg å ha på siden." },
      { key: "priceId", label: "Pris-ID", placeholder: "pri_…", help: "Paddle → Catalog → Products → prisen du vil selge." },
      { key: "label", label: "Tekst på knappen", placeholder: "Kjøp nå" },
    ],
    request: (v) => {
      const token = clean(v.token);
      const environment = token.startsWith("test_")
        ? 'kall først Paddle.Environment.set("sandbox") (tokenet er et testtoken)'
        : "ikke kall Paddle.Environment.set (tokenet er et live-token)";
      return `Legg til en kjøpsknapp med Paddle Checkout på siden (for eksempel i prisseksjonen, eller lag en om den mangler). Last Paddle.js fra https://cdn.paddle.com/paddle/v2/paddle.js med et <script>-element fra en useEffect (bare én gang), ${environment}, og deretter Paddle.Initialize({ token: "${token}" }). Knappen ("${clean(v.label) || "Kjøp nå"}") åpner betalingsvinduet med Paddle.Checkout.open({ items: [{ priceId: "${clean(v.priceId)}", quantity: 1 }] }). Hvis Paddle ikke er lastet ennå, skal knappen være deaktivert. Ikke legg inn andre nøkler. ${KEEP_LOOK}`;
    },
    after: "Knappen virker i forhåndsvisningen. Bruk test_-token først; bytt til live_ når kontoen din er godkjent hos Paddle.",
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "betaling",
    summary: "Kjøpsknapp som sender kunden til en Stripe-betalingslenke. Ingen server nødvendig.",
    docs: "https://docs.stripe.com/payment-links",
    fields: [
      { key: "link", label: "Betalingslenke", placeholder: "https://buy.stripe.com/…", help: "Stripe → Payment Links → Create. Kopier lenken." },
      { key: "label", label: "Tekst på knappen", placeholder: "Kjøp nå" },
    ],
    request: (v) =>
      `Legg til en kjøpsknapp ("${clean(v.label) || "Kjøp nå"}") på siden (for eksempel i prisseksjonen, eller lag en om den mangler). Den skal være en vanlig <a href="${clean(v.link)}" target="_blank" rel="noopener noreferrer"> som ser ut som en primærknapp. Ingen skript og ingen nøkler i koden. ${KEEP_LOOK}`,
    after: "Stripe-betalingslenken åpner Stripes egen side. Hvis Stripe har avslått kontoen din, bruk Paddle i stedet.",
  },
  {
    id: "resend",
    name: "Nyhetsbrev (Resend)",
    category: "e-post",
    summary: "Påmeldingsskjema som samler e-postadresser i en Resend-liste. Gratis opp til 3000 e-poster i måneden.",
    docs: "https://resend.com/docs/dashboard/audiences/introduction",
    fields: [
      { key: "apiKey", label: "API-nøkkel", placeholder: "re_…", secret: true, env: "RESEND_API_KEY", help: "Resend → API Keys. Gi nøkkelen bare «Sending access». Den lagres bare i denne nettleseren og sendes til siden din ved publisering." },
      { key: "audienceId", label: "Liste-ID (Audience)", placeholder: "xxxxxxxx-xxxx-…", secret: true, env: "RESEND_AUDIENCE_ID", help: "Resend → Audiences → opprett en liste og kopier ID-en." },
    ],
    files: () => ({ "/api/subscribe.ts": SUBSCRIBE_FUNCTION }),
    request: () =>
      `Legg til et påmeldingsskjema til nyhetsbrev på siden (for eksempel over bunnteksten). Skjemaet har ett e-postfelt med label og en knapp, og sender fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, website }) }). Legg til et skjult felt «website» som mennesker aldri ser (visually hidden, tabindex -1, autocomplete off) og send med verdien. Vis tre tilstander: sender, takk-melding ved ok, og feilmeldingen fra svaret ved feil. Funksjonen /api/subscribe finnes allerede, ikke lag den på nytt og ikke legg inn nøkler. I forhåndsvisningen finnes ikke funksjonen: vis da en vennlig feilmelding, den virker først etter publisering. ${KEEP_LOOK}`,
    after: "Påmeldingen virker først etter at siden er publisert. Nøkkelen sendes med ved publisering, så du må publisere på nytt etter at du har lagt den inn.",
  },
];

export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id);

/** What is missing before the connector can be added. */
export function missingFields(connector: Connector, values: Record<string, string>): string[] {
  const optional = new Set(["label"]);
  return connector.fields.filter((f) => !optional.has(f.key) && !clean(values[f.key])).map((f) => f.label);
}

/** Values the page may know about: everything except the secrets. */
export function publicValues(connector: Connector, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(connector.fields.filter((f) => !f.secret).map((f) => [f.key, clean(values[f.key])]));
}

/** Environment variables the published site needs, read from what the owner entered. */
export function envFor(values: Record<string, Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const connector of CONNECTORS) {
    for (const field of connector.fields) {
      const value = clean(values[connector.id]?.[field.key]);
      if (field.env && value) env[field.env] = value;
    }
  }
  return pickEnv(env);
}

/** Basic checks on what the owner typed, so a typo is caught before it lands in the code. */
export function validate(connector: Connector, values: Record<string, string>): string | null {
  const v = (key: string) => clean(values[key]);
  if (connector.id === "paddle") {
    if (!/^(test|live)_[A-Za-z0-9]{10,}$/.test(v("token"))) return "Klient-tokenet starter med test_ eller live_.";
    if (!/^pri_[A-Za-z0-9]{10,}$/.test(v("priceId"))) return "Pris-ID-en starter med pri_.";
  }
  if (connector.id === "stripe" && !/^https:\/\/(buy|donate)\.stripe\.com\/[\w-]+/.test(v("link"))) return "Betalingslenken starter med https://buy.stripe.com/.";
  if (connector.id === "resend") {
    if (!/^re_[A-Za-z0-9_]{10,}$/.test(v("apiKey"))) return "API-nøkkelen starter med re_.";
    if (!/^[0-9a-f-]{20,}$/i.test(v("audienceId"))) return "Liste-ID-en er en lang kode med bokstaver, tall og bindestreker.";
  }
  return null;
}
