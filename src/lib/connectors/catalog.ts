import { KEEP_LOOK } from "./ready.ts";
import type { Category, Connector, Field } from "./types.ts";

const clean = (value: string | undefined) => (value ?? "").trim();

/** A service where the model writes the server function from the service's own documentation. Keys stay in environment variables. */
function assisted(spec: { id: string; name: string; category: Category; summary: string; docs: string; fields: Field[]; purpose: string; ui: string }): Connector {
  const env = spec.fields.flatMap((f) => (f.env ? [f.env] : []));
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    kind: "assisted",
    summary: spec.summary,
    docs: spec.docs,
    fields: spec.fields,
    request: () =>
      `Koble siden til ${spec.name}. ${spec.purpose} Lag en serverfunksjon i /api/${spec.id}.ts (Vercel Function, webstandard: export async function POST(request: Request): Promise<Response>) som gjør dette mot ${spec.name}s API (dokumentasjon: ${spec.docs}). Les verdiene fra ${env.join(", ")} via process.env. Skriv dem aldri i koden og aldri i et svar. Valider og begrens input (type og lengde), avvis tomme forespørsler, og svar med kort JSON: ok, eller en ufarlig feilmelding uten interne detaljer. ${spec.ui} Funksjonen finnes ikke i forhåndsvisningen: vis da en vennlig melding om at den virker etter publisering. ${KEEP_LOOK}`,
    after: "AI-en skriver funksjonen ut fra tjenestens dokumentasjon, så den er ikke testet av Pivolar. Prøv den etter publisering, og bruk en nøkkel med så smale rettigheter som mulig. Publiser på nytt etter at nøklene er lagt inn.",
  };
}

const key = (k: string, label: string, env: string, placeholder: string, extra: Partial<Field> = {}): Field => ({ key: k, label, placeholder, secret: true, env, ...extra });
const plain = (k: string, label: string, env: string, placeholder: string, extra: Partial<Field> = {}): Field => ({ key: k, label, placeholder, env, ...extra });

function soon(id: string, name: string, category: Category, summary: string): Connector {
  return { id, name, category, kind: "soon", summary, docs: "", fields: [], request: () => "", after: "Kommer. Trenger innlogging mot tjenesten, som Pivolar ikke har ennå." };
}


export const CLIENT: Connector[] = [
  {
    id: "google-analytics",
    name: "Google Analytics",
    category: "google",
    kind: "client",
    summary: "Besøksstatistikk. Lastes først etter at den besøkende har sagt ja til sporing.",
    docs: "https://support.google.com/analytics/answer/9304153",
    fields: [{ key: "id", label: "Måle-ID", placeholder: "G-XXXXXXXXXX", help: "Analytics → Admin → Data streams → Web → Measurement ID.", pattern: /^G-[A-Z0-9]{6,}$/, error: "Måle-ID-en starter med G-." }],
    request: (v) =>
      `Legg til Google Analytics (GA4) med måle-ID ${clean(v.id)}. Last aldri gtag.js før den besøkende har trykket «Godta» i et lite, pent samtykkebanner nederst på siden (to knapper: Godta og Avslå; valget lagres i localStorage med try/catch). Ved «Godta»: legg til <script async src="https://www.googletagmanager.com/gtag/js?id=${clean(v.id)}"> fra kode, sett window.dataLayer og gtag("config", "${clean(v.id)}"). Ved «Avslå» skal ingenting lastes. ${KEEP_LOOK}`,
    after: "Samtykkebanneret er med fordi norsk og europeisk lov krever samtykke før sporing.",
  },
  {
    id: "google-search-console",
    name: "Google Search Console",
    category: "google",
    kind: "client",
    summary: "Bekrefter at siden er din hos Google, så du ser søk og klikk. Sitemap lages automatisk ved publisering.",
    docs: "https://support.google.com/webmasters/answer/9008080",
    fields: [{ key: "token", label: "Bekreftelseskode", placeholder: "abc123…", help: "Search Console → Add property → URL prefix → HTML tag. Kopier bare verdien i content=\"…\".", pattern: /^[\w-]{20,120}$/, error: "Koden er bare bokstaver, tall, - og _ (uten anførselstegn)." }],
    request: (v) => `Sett "verification": { "google": "${clean(v.token)}" } i /brand.json (behold alle andre felt som de er). Ikke endre noe annet. Publiseringen legger koden inn som meta-tagg.`,
    after: "Publiser på nytt, og trykk Verify i Search Console. Send inn adressen /sitemap.xml der etterpå.",
  },
  {
    id: "bing-webmaster",
    name: "Bing Webmaster Tools",
    category: "marketing",
    kind: "client",
    summary: "Bekrefter siden hos Bing (og DuckDuckGo, Ecosia). Gir søkeord, indeksering og URL-innsending.",
    docs: "https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b",
    fields: [{ key: "token", label: "Bekreftelseskode", placeholder: "ABCDEF0123456789…", help: "Bing Webmaster → Add site → HTML Meta Tag. Kopier verdien i content=\"…\".", pattern: /^[\w-]{20,120}$/, error: "Koden er bare bokstaver, tall, - og _ (uten anførselstegn)." }],
    request: (v) => `Sett "verification": { "bing": "${clean(v.token)}" } i /brand.json (behold alle andre felt som de er). Ikke endre noe annet. Publiseringen legger koden inn som meta-tagg.`,
    after: "Publiser på nytt, og trykk Verify i Bing Webmaster Tools.",
  },
  {
    id: "google-maps",
    name: "Google Maps",
    category: "google",
    kind: "client",
    summary: "Et innebygd kart med adressen din.",
    docs: "https://developers.google.com/maps/documentation/embed/get-started",
    fields: [
      { key: "key", label: "API-nøkkel (Maps Embed)", placeholder: "AIza…", help: "Google Cloud → APIs → Maps Embed API. Begrens nøkkelen til nettadressen din (HTTP referrers) og bare Maps Embed API.", pattern: /^AIza[\w-]{30,}$/, error: "API-nøkkelen starter med AIza." },
      { key: "address", label: "Adresse eller sted", placeholder: "Karl Johans gate 1, Oslo" },
    ],
    request: (v) =>
      `Legg til et kart på siden (for eksempel i en kontaktseksjon) med <iframe src="https://www.google.com/maps/embed/v1/place?key=${clean(v.key)}&q=${encodeURIComponent(clean(v.address))}" title="Kart: ${clean(v.address)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen>, avrundet, med fast høyde og full bredde. ${KEEP_LOOK}`,
    after: "Nøkkelen synes i sidens kode. Det er slik Maps Embed fungerer, så begrens den til din adresse hos Google.",
  },
  {
    id: "tally",
    name: "Tally",
    category: "marketing",
    kind: "client",
    summary: "Legg et skjema fra Tally inn på siden.",
    docs: "https://tally.so/help/embed-form",
    fields: [{ key: "url", label: "Skjema-lenke", placeholder: "https://tally.so/r/abc123", pattern: /^https:\/\/tally\.so\/(r|embed)\/[\w-]+/, error: "Lenken starter med https://tally.so/r/." }],
    request: (v) =>
      `Legg til Tally-skjemaet på siden (for eksempel i en kontaktseksjon) som <iframe src="${clean(v.url).replace("/r/", "/embed/")}?hideTitle=1&transparentBackground=1" title="Skjema" loading="lazy" width="100%" height="520" style={{ border: 0 }}>. ${KEEP_LOOK}`,
    after: "Skjemaet og svarene hører til Tally-kontoen din.",
  },
  {
    id: "logo-dev",
    name: "Logo.dev",
    category: "marketing",
    kind: "client",
    summary: "Firmalogoer fra domenenavn, for eksempel i kunde- eller partnerlister.",
    docs: "https://www.logo.dev/docs/introduction",
    fields: [{ key: "token", label: "Offentlig token", placeholder: "pk_…", help: "Logo.dev → API keys → Publishable key (pk_…). Ikke bruk den hemmelige sk_-nøkkelen.", pattern: /^pk_[\w-]{10,}$/, error: "Tokenet starter med pk_ (den offentlige nøkkelen)." }],
    request: (v) =>
      `Lag en liten Logo-komponent som viser firmalogoen for et domene: <img src={\`https://img.logo.dev/\${domain}?token=${clean(v.token)}&size=80&format=png\`} alt={\`\${name}-logo\`} width={40} height={40} loading="lazy"> med fallback til firmanavnet som tekst når bildet feiler (onError). Bruk den i en rad med partnere eller kunder på siden om det passer. ${KEEP_LOOK}`,
    after: "",
  },
];

const EMAIL_FORM = "Legg til et påmeldings- eller kontaktskjema på siden som sender til funksjonen.";

export const ASSISTED: Connector[] = [
  assisted({ id: "brevo", name: "Brevo", category: "marketing", summary: "Samle e-postadresser i en Brevo-liste og send e-post. Gratis opp til 300 e-poster om dagen.", docs: "https://developers.brevo.com/docs", fields: [key("apiKey", "API-nøkkel", "BREVO_API_KEY", "xkeysib-…", { pattern: /^[\w-]{20,}$/, error: "Skriv inn API-nøkkelen fra Brevo." }), plain("listId", "Liste-ID (tall)", "BREVO_LIST_ID", "3", { pattern: /^\d{1,9}$/, error: "Liste-ID er et tall." })], purpose: "Funksjonen legger en e-postadresse til kontaktlisten (BREVO_LIST_ID) i Brevo.", ui: EMAIL_FORM }),
  assisted({ id: "mailgun", name: "Mailgun", category: "messaging", summary: "Send e-post fra siden, for eksempel fra kontaktskjemaet.", docs: "https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/", fields: [key("apiKey", "API-nøkkel", "MAILGUN_API_KEY", "key-…", { pattern: /^[\w-]{20,}$/, error: "Skriv inn API-nøkkelen fra Mailgun." }), plain("domain", "Sendedomene", "MAILGUN_DOMAIN", "mg.dittdomene.no", { pattern: /^[a-z0-9.-]+\.[a-z]{2,}$/i, error: "Skriv inn domenet, uten https://." }), plain("to", "Send meldinger til", "MAILGUN_TO", "deg@dittdomene.no", { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, error: "Skriv inn en e-postadresse." })], purpose: "Funksjonen tar imot navn, e-post og melding og sender dem som e-post til MAILGUN_TO.", ui: "Legg til et kontaktskjema på siden som sender til funksjonen." }),
  assisted({ id: "klaviyo", name: "Klaviyo", category: "marketing", summary: "Meld besøkende på en Klaviyo-liste for kampanjer og flyter.", docs: "https://developers.klaviyo.com/en/reference/api_overview", fields: [key("apiKey", "Privat API-nøkkel", "KLAVIYO_PRIVATE_KEY", "pk_…", { pattern: /^[\w-]{20,}$/, error: "Skriv inn den private API-nøkkelen." }), plain("listId", "Liste-ID", "KLAVIYO_LIST_ID", "AbC123", { pattern: /^[A-Za-z0-9]{4,}$/, error: "Skriv inn liste-ID-en." })], purpose: "Funksjonen oppretter en profil og abonnerer e-postadressen på listen (KLAVIYO_LIST_ID).", ui: EMAIL_FORM }),
  assisted({ id: "beehiiv", name: "beehiiv", category: "marketing", summary: "Meld besøkende på nyhetsbrevet ditt hos beehiiv.", docs: "https://developers.beehiiv.com/", fields: [key("apiKey", "API-nøkkel", "BEEHIIV_API_KEY", "…", { pattern: /^[\w-]{20,}$/, error: "Skriv inn API-nøkkelen fra beehiiv." }), plain("publicationId", "Publication-ID", "BEEHIIV_PUBLICATION_ID", "pub_…", { pattern: /^pub_[\w-]{10,}$/, error: "Publication-ID starter med pub_." })], purpose: "Funksjonen oppretter en abonnent for e-postadressen i publikasjonen.", ui: EMAIL_FORM }),
  assisted({ id: "hubspot", name: "HubSpot", category: "sales", summary: "Send skjemaer inn som kontakter i HubSpot CRM.", docs: "https://developers.hubspot.com/docs/api/crm/contacts", fields: [key("token", "Private app-token", "HUBSPOT_TOKEN", "pat-…", { pattern: /^pat-[\w-]{20,}$/, error: "Tokenet starter med pat-." })], purpose: "Funksjonen oppretter eller oppdaterer en kontakt i HubSpot med navn og e-post fra skjemaet.", ui: "Legg til et kontaktskjema på siden som sender til funksjonen." }),
  assisted({ id: "slack", name: "Slack", category: "messaging", summary: "Få en melding i Slack når noen fyller ut et skjema eller kjøper.", docs: "https://api.slack.com/messaging/webhooks", fields: [key("url", "Webhook-adresse", "SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/…", { pattern: /^https:\/\/hooks\.slack\.com\/services\/[\w/-]+$/, error: "Adressen starter med https://hooks.slack.com/services/." })], purpose: "Funksjonen sender en kort melding til webhook-adressen når skjemaet sendes inn.", ui: "Legg til et kontaktskjema på siden som sender til funksjonen." }),
  assisted({ id: "discord", name: "Discord", category: "messaging", summary: "Få en melding i en Discord-kanal når noen fyller ut et skjema.", docs: "https://discord.com/developers/docs/resources/webhook", fields: [key("url", "Webhook-adresse", "DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/…", { pattern: /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/, error: "Adressen starter med https://discord.com/api/webhooks/." })], purpose: "Funksjonen sender en kort melding til webhook-adressen (maks 2000 tegn).", ui: "Legg til et kontaktskjema på siden som sender til funksjonen." }),
  assisted({ id: "telegram", name: "Telegram", category: "messaging", summary: "Få en melding i Telegram når noen fyller ut et skjema.", docs: "https://core.telegram.org/bots/api#sendmessage", fields: [key("token", "Bot-token", "TELEGRAM_BOT_TOKEN", "123456:ABC-…", { pattern: /^\d{6,}:[\w-]{30,}$/, error: "Bot-tokenet ser ut som 123456:ABC… (fra @BotFather)." }), plain("chat", "Chat-ID", "TELEGRAM_CHAT_ID", "123456789", { pattern: /^-?\d{4,}$/, error: "Chat-ID er et tall." })], purpose: "Funksjonen sender en kort tekstmelding til chatten (TELEGRAM_CHAT_ID) via sendMessage.", ui: "Legg til et kontaktskjema på siden som sender til funksjonen." }),
  assisted({ id: "twilio", name: "Twilio (SMS)", category: "messaging", summary: "Send SMS fra siden, for eksempel bekreftelser.", docs: "https://www.twilio.com/docs/messaging/api/message-resource", fields: [plain("sid", "Account SID", "TWILIO_ACCOUNT_SID", "AC…", { pattern: /^AC[a-f0-9]{32}$/i, error: "Account SID starter med AC." }), key("token", "Auth token", "TWILIO_AUTH_TOKEN", "…", { pattern: /^[a-f0-9]{32}$/i, error: "Auth token er 32 tegn." }), plain("from", "Avsendernummer", "TWILIO_FROM_NUMBER", "+4712345678", { pattern: /^\+\d{8,15}$/, error: "Nummeret skrives med landskode, for eksempel +47…." })], purpose: "Funksjonen sender en SMS til et telefonnummer (E.164-format) med en kort tekst. Begrens til én SMS per forespørsel og avvis tekst over 300 tegn.", ui: "Legg til et enkelt skjema der den besøkende skriver inn telefonnummer og får en bekreftelse på SMS." }),
  assisted({ id: "gatewayapi", name: "GatewayAPI (SMS)", category: "messaging", summary: "Norsk SMS-tjeneste. Send varsler og bekreftelser.", docs: "https://gatewayapi.com/docs/", fields: [key("token", "API-token", "GATEWAYAPI_TOKEN", "…", { pattern: /^[\w-]{20,}$/, error: "Skriv inn API-tokenet." }), plain("sender", "Avsendernavn", "GATEWAYAPI_SENDER", "MinSide", { pattern: /^[A-Za-z0-9 ]{1,11}$/, error: "Avsendernavn er maks 11 tegn, bare bokstaver og tall." })], purpose: "Funksjonen sender en SMS (landskode og nummer) med en kort tekst. Avvis tekst over 300 tegn.", ui: "Legg til et enkelt skjema der den besøkende skriver inn telefonnummer og får en bekreftelse på SMS." }),
  assisted({ id: "whatsapp", name: "WhatsApp Business", category: "messaging", summary: "Send meldinger via WhatsApp Business Cloud API.", docs: "https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages", fields: [key("token", "Tilgangstoken", "WHATSAPP_TOKEN", "EAA…", { pattern: /^[\w-]{30,}$/, error: "Skriv inn tilgangstokenet fra Meta." }), plain("phone", "Telefonnummer-ID", "WHATSAPP_PHONE_NUMBER_ID", "1234567890", { pattern: /^\d{8,}$/, error: "Telefonnummer-ID er et langt tall." })], purpose: "Funksjonen sender en mal-melding (template) via WhatsApp Cloud API. Meld fra i svaret til siden at WhatsApp bare tillater maler til nye kontakter.", ui: "Legg til en «Chat på WhatsApp»-knapp på siden." }),
  assisted({ id: "notion", name: "Notion", category: "productivity", summary: "Lagre skjemainnsendinger som rader i en Notion-database.", docs: "https://developers.notion.com/reference/post-page", fields: [key("token", "Integrasjonstoken", "NOTION_TOKEN", "ntn_… eller secret_…", { pattern: /^(ntn|secret)_[\w]{20,}$/, error: "Tokenet starter med ntn_ eller secret_." }), plain("db", "Database-ID", "NOTION_DATABASE_ID", "32 tegn", { pattern: /^[0-9a-f]{32}$|^[0-9a-f-]{36}$/i, error: "Database-ID er 32 tegn (fra adressen til databasen)." })], purpose: "Funksjonen oppretter en ny side (rad) i databasen med feltene fra skjemaet. Databasen må være delt med integrasjonen.", ui: "Legg til et kontaktskjema på siden som sender til funksjonen." }),
  assisted({ id: "airtable", name: "Airtable", category: "productivity", summary: "Lagre skjemainnsendinger som rader i en Airtable-tabell.", docs: "https://airtable.com/developers/web/api/create-records", fields: [key("token", "Personlig tilgangstoken", "AIRTABLE_TOKEN", "pat…", { pattern: /^pat[\w.]{20,}$/, error: "Tokenet starter med pat." }), plain("base", "Base-ID", "AIRTABLE_BASE_ID", "app…", { pattern: /^app[\w]{10,}$/, error: "Base-ID starter med app." }), plain("table", "Tabellnavn", "AIRTABLE_TABLE", "Henvendelser", { pattern: /^[\w .-]{1,60}$/, error: "Skriv inn tabellnavnet." })], purpose: "Funksjonen oppretter en ny rad i tabellen med feltene fra skjemaet. Gi tokenet bare tilgang til denne basen og bare skrive.", ui: "Legg til et kontaktskjema på siden som sender til funksjonen." }),
  assisted({ id: "chargebee", name: "Chargebee", category: "ecommerce", summary: "Abonnement og fakturering. Send kunden til en Chargebee-betalingsside.", docs: "https://apidocs.chargebee.com/docs/api/hosted_pages", fields: [plain("site", "Site-navn", "CHARGEBEE_SITE", "dittfirma-test", { pattern: /^[a-z0-9-]{3,}$/i, error: "Site-navnet er første del av adressen din hos Chargebee." }), key("apiKey", "API-nøkkel", "CHARGEBEE_API_KEY", "test_…", { pattern: /^(test|live)_[\w]{20,}$/, error: "Nøkkelen starter med test_ eller live_." }), plain("plan", "Plan-ID (item price)", "CHARGEBEE_ITEM_PRICE_ID", "premium-EUR-Monthly", { pattern: /^[\w-]{3,}$/, error: "Skriv inn pris-ID-en for planen." })], purpose: "Funksjonen oppretter en hosted checkout-side for abonnementet (CHARGEBEE_ITEM_PRICE_ID) og svarer med adressen.", ui: "Legg til en «Abonner»-knapp som kaller funksjonen og sender kunden videre til adressen den svarer med." }),
];

export const SOON: Connector[] = [
  soon("shopify", "Shopify", "ecommerce", "Bygg en nettbutikk med produkter fra Shopify."),
  soon("woocommerce", "WooCommerce", "ecommerce", "Åpen nettbutikk-plattform for WordPress."),
  soon("prestashop", "PrestaShop", "ecommerce", "Åpen nettbutikk-plattform."),
  soon("wix", "Wix", "ecommerce", "Nettsted, nettbutikk og booking."),
  soon("lightspeed", "Lightspeed", "ecommerce", "Kasse, varelager og salg."),
  soon("wave", "Wave", "ecommerce", "Regnskap og fakturering for småbedrifter."),
  soon("zoho-books", "Zoho Books", "ecommerce", "Regnskap og fakturering."),
  soon("linkedin", "LinkedIn", "marketing", "Profil og innlegg på LinkedIn."),
  soon("x", "X (Twitter)", "marketing", "Innlegg, brukere og trender fra X."),
  soon("semrush", "Semrush", "marketing", "SEO, nøkkelord og konkurrentanalyse."),
  soon("storyblok", "Storyblok", "marketing", "Headless CMS med visuell sidebygger."),
  soon("apollo", "Apollo.io", "sales", "Søk og berik B2B-kontakter og selskaper."),
  soon("clay", "Clay", "sales", "Salgsdata: personer og selskaper."),
  soon("salesforce", "Salesforce", "sales", "CRM og salgsdata."),
  soon("gmail", "Gmail", "google", "Les, send og administrer e-post."),
  soon("google-drive", "Google Drive", "google", "Last opp og last ned filer."),
  soon("google-sheets", "Google Sheets", "google", "Les og oppdater regneark."),
  soon("google-docs", "Google Docs", "google", "Lag og rediger dokumenter."),
  soon("google-slides", "Google Slides", "google", "Lag og administrer presentasjoner."),
  soon("google-calendar", "Google Calendar", "google", "Lag og administrer avtaler."),
  soon("google-business", "Google Business Profile", "google", "Steder, anmeldelser og innsikt."),
  soon("google-ads", "Google Ads", "google", "Kjør annonsekampanjer."),
  soon("gemini", "Gemini", "google", "Bygg med Googles AI-modeller."),
  soon("bigquery", "BigQuery", "google", "Spør og analyser data."),
  soon("fcm", "Firebase Cloud Messaging", "google", "Send push-varsler til enheter."),
  soon("outlook", "Microsoft Outlook", "microsoft", "Les, send og administrer e-post og kalender."),
  soon("teams", "Microsoft Teams", "microsoft", "Send meldinger og administrer kanaler."),
];

export const CATALOG: Connector[] = [...CLIENT, ...ASSISTED, ...SOON];
