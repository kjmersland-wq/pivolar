import type { Connector } from "./types.ts";

const clean = (value: string | undefined) => (value ?? "").trim();
export const KEEP_LOOK = "Følg designet siden har fra før (farger, skrift, avrunding).";

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

export const READY: Connector[] = [
  {
    id: "paddle",
    name: "Paddle",
    category: "ecommerce",
    kind: "ready",
    summary: "Kjøpsknapp med betalingsvindu. Paddle er selger og tar seg av moms og skatt for deg.",
    docs: "https://developer.paddle.com/paddlejs/overview",
    fields: [
      { key: "token", label: "Klient-token", placeholder: "test_… eller live_…", help: "Paddle → Developer tools → Authentication → Client-side tokens. Er offentlig og trygg å ha på siden.", pattern: /^(test|live)_[A-Za-z0-9]{10,}$/, error: "Klient-tokenet starter med test_ eller live_." },
      { key: "priceId", label: "Pris-ID", placeholder: "pri_…", help: "Paddle → Catalog → Products → prisen du vil selge.", pattern: /^pri_[A-Za-z0-9]{10,}$/, error: "Pris-ID-en starter med pri_." },
      { key: "label", label: "Tekst på knappen", placeholder: "Kjøp nå", optional: true },
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
    category: "ecommerce",
    kind: "ready",
    summary: "Kjøpsknapp som sender kunden til en Stripe-betalingslenke. Ingen server nødvendig.",
    docs: "https://docs.stripe.com/payment-links",
    fields: [
      { key: "link", label: "Betalingslenke", placeholder: "https://buy.stripe.com/…", help: "Stripe → Payment Links → Create. Kopier lenken.", pattern: /^https:\/\/(buy|donate)\.stripe\.com\/[\w-]+/, error: "Betalingslenken starter med https://buy.stripe.com/." },
      { key: "label", label: "Tekst på knappen", placeholder: "Kjøp nå", optional: true },
    ],
    request: (v) =>
      `Legg til en kjøpsknapp ("${clean(v.label) || "Kjøp nå"}") på siden (for eksempel i prisseksjonen, eller lag en om den mangler). Den skal være en vanlig <a href="${clean(v.link)}" target="_blank" rel="noopener noreferrer"> som ser ut som en primærknapp. Ingen skript og ingen nøkler i koden. ${KEEP_LOOK}`,
    after: "Stripe-betalingslenken åpner Stripes egen side. Hvis Stripe har avslått kontoen din, bruk Paddle i stedet.",
  },
  {
    id: "resend",
    name: "Resend (nyhetsbrev)",
    category: "messaging",
    kind: "ready",
    summary: "Påmeldingsskjema som samler e-postadresser i en Resend-liste. Gratis opp til 3000 e-poster i måneden.",
    docs: "https://resend.com/docs/dashboard/audiences/introduction",
    fields: [
      { key: "apiKey", label: "API-nøkkel", placeholder: "re_…", secret: true, env: "RESEND_API_KEY", help: "Resend → API Keys. Gi nøkkelen bare «Sending access». Den lagres bare i denne nettleseren og sendes til siden din ved publisering.", pattern: /^re_[A-Za-z0-9_]{10,}$/, error: "API-nøkkelen starter med re_." },
      { key: "audienceId", label: "Liste-ID (Audience)", placeholder: "xxxxxxxx-xxxx-…", secret: true, env: "RESEND_AUDIENCE_ID", help: "Resend → Audiences → opprett en liste og kopier ID-en.", pattern: /^[0-9a-f-]{20,}$/i, error: "Liste-ID-en er en lang kode med bokstaver, tall og bindestreker." },
    ],
    files: () => ({ "/api/subscribe.ts": SUBSCRIBE_FUNCTION }),
    request: () =>
      `Legg til et påmeldingsskjema til nyhetsbrev på siden (for eksempel over bunnteksten). Skjemaet har ett e-postfelt med label og en knapp, og sender fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, website }) }). Legg til et skjult felt «website» som mennesker aldri ser (visually hidden, tabindex -1, autocomplete off) og send med verdien. Vis tre tilstander: sender, takk-melding ved ok, og feilmeldingen fra svaret ved feil. Funksjonen /api/subscribe finnes allerede, ikke lag den på nytt og ikke legg inn nøkler. I forhåndsvisningen finnes ikke funksjonen: vis da en vennlig feilmelding, den virker først etter publisering. ${KEEP_LOOK}`,
    after: "Påmeldingen virker først etter at siden er publisert. Nøkkelen sendes med ved publisering, så du må publisere på nytt etter at du har lagt den inn.",
  },
];
