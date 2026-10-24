# Ønskeliste

Ting som er bestilt men ikke bygget. Koblingene legges inn i `src/lib/connectors/index.ts` (ett objekt per tjeneste).

## Neste
- **Sikkerhetspakke:** dyp skanning (flere sjekker enn i dag: tilgangsregler, avhengigheter med kjente feil, hemmeligheter i historikken) og en oversikt over pakker med kjente sårbarheter.
- **Koblingspakke (Connectors):** søkbar liste med kategorier, av/på per prosjekt og egne koblinger («Add custom»).

## Analyse (egen side som i Lovable)
Besøk siste 7 dager som kurve, fordelt på kilde (SEO og AI-søk, SoMe, henvisninger, direkte, annonser), mest besøkte sider, land og enheter, og antall som er inne akkurat nå. Krever egen telling på de publiserte sidene (en liten /api/-funksjon og lagring, uten cookies, slik at samtykkebanner ikke trengs), og lenker fra SEO-fanen (hvilke søkemotorer som sender besøk). Google Analytics-koblingen er en enklere start.

## Koblinger det er ønsket å ha
- **Betaling:** Paddle og Stripe (første versjon er bygget), Creem.
- **E-post og nyhetsbrev:** Resend (bygget), Brevo, Mailgun, Gmail, Microsoft Outlook, automatiske nyhetsbrev (utsending etter plan).
- **Meldinger og varsler:** Slack, Telegram, Discord, Microsoft Teams, WhatsApp Business, Twilio (SMS), GatewayAPI (SMS/RCS), Firebase Cloud Messaging (push).
- **Andre fra Lovables liste (kategorier):** Ecommerce (Shopify), Marketing, Productivity (Google Sheets, Drive, Calendar, Airtable, Notion), Google (Search Console, Maps), Microsoft, AWS, Security.
- **Google:** Google Analytics, Search Console (SEO-data inn i Kontroll), Google Business Profile (lokale bedrifter, anmeldelser), Google Ads, Maps Platform, Gmail, Drive, Sheets, Docs, Slides, Calendar, Gemini, BigQuery, Looker, Cloud API.
- **Nettbutikk og regnskap:** Shopify, WooCommerce, PrestaShop, Wix, Chargebee (abonnement), Lightspeed (kasse og lager), Wave, Zoho Books (regnskap og fakturering).
- **Markedsføring:** Brevo, Klaviyo (e-post og SMS-kampanjer), beehiiv (nyhetsbrev), Tally (skjemaer), Semrush (SEO og nøkkelord), Bing Webmaster Tools (søk, indeksering, URL-innsending), LinkedIn og X (innlegg og profil), Storyblok (CMS), Logo.dev (logoer fra domene), Apollo.io og Clay (B2B-kontakter).
- **SoMe:** automatisk utlegging til kontoene (krever innlogging mot hver plattform), innleggsplan.
