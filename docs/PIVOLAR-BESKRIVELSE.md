# Pivolar: hva det er nå

Skrevet 24. oktober 2026. Status og tall er fra repoet i `H:\atelier` og fra søk samme dag. Det som ikke er prøvd i virkeligheten, er merket slik.

## Kort fortalt

Pivolar er ditt private verktøy for å bygge, importere, forbedre og publisere nettsteder og apper ved å snakke med en AI. Det er laget for deg alene i dag, ikke for andre. Du beskriver hva du vil ha, ser resultatet live ved siden av samtalen, og kan sende det videre til GitHub og Vercel. Det kan også lese inn eksisterende prosjekter (for eksempel de du har laget i Lovable) og fortsette arbeidet på dem.

Det er bygget på Next.js, Supabase (innlogging, prosjekter, forbruk, analyse) og Vercel (drift, AI Gateway, Sandbox). Det kjører på pivolar.com.

## Slik jobber du

1. **Start:** skriv hva du vil bygge på forsiden, eller importer: en ZIP, eller en GitHub-adresse (offentlig repo uten noe oppsett, privat med `GITHUB_TOKEN`).
2. **Bygg:** AI-en skriver filene. Forhåndsvisningen oppdateres mens den jobber. Du kan klikke på et element og endre det direkte, med eller uten AI, og gå tilbake til et tidligere punkt i samtalen.
3. **Importerte prosjekter:** enkle React-prosjekter vises i forhåndsvisningen, rene HTML-sider vises som side, og prosjekter med server (Next.js, TanStack med flere) kjøres i et isolert, midlertidig miljø på Vercel. Endringer går tilbake til GitHub som pull request, aldri rett på `main`.
4. **Utvid:** legg til betaling, nyhetsbrev, kontaktskjema, statistikk og mer under **Koblinger**.
5. **Kontroller:** **Kontroll** sjekker kodekvalitet, sikkerhet, SEO og lager innlegg for sosiale medier.
6. **Publiser:** ett klikk gir GitHub-repo og Vercel-side med delingsbilde, ikon, installerbar app, tester og sikkerhetshoder, og valgfri besøkstelling.
7. **Følg med:** **Analyse** viser besøk, **Forbruk** viser hva AI og drift koster deg.

## Hva det kan

**Bygge og endre**
- Chat som skriver og endrer filer, chat-modus uten endringer, tilbake til tidligere punkt, ferdige seksjoner du setter sammen, direkte redigering av element.
- Sammenligning av resultatet mot en referanse, og en løkke som gjentar en jobb til noe er riktig.
- Forslag til feil i forhåndsvisningen, forklart på vanlig norsk med en retting.

**Importere og eksportere**
- ZIP og GitHub. Rapport før noe lagres: rammeverk, pakker, tjenester, miljøvariabler, risiko og hva som ikke ble importert. Nøkler fjernes.
- Eksport som ZIP med rapport.

**Publisere**
- GitHub og Vercel, med tester, CI-fil, manifest, ikoner, delingsbilde, canonical-adresse, sitemap, robots.txt, strukturerte data og sikkerhetshoder.
- **Hosting-valg i publiseringsdialogen.** Pivolar leser siden og anbefaler hvor den bør ligge, med pris, kilde og dato for når prisen ble sjekket: Vercel, Cloudflare, Netlify, GitHub Pages, Render eller en egen server (Hetzner). En side med serverfunksjoner (kontaktskjema, påmelding, Google) anbefales på Vercel, siden funksjonene er skrevet for det. En ren side anbefales på Cloudflare. GitHub Pages sperres for sider som tar betalt, siden GitHub ikke tillater det. Vercel publiseres fra Pivolar. For de andre legger Pivolar koden på GitHub, skriver innstillingsfilen verten trenger (`netlify.toml`, `wrangler.jsonc`, `render.yaml`, `pages.yml` eller Docker med Caddy), og viser en knapp som åpner vertens egen deploy-side med repoet ditt.

**Koblinger** (43 tjenester)
- Ferdige og testet av Pivolar: Paddle, Stripe (betalingslenke), Resend (nyhetsbrev), Gmail (kontaktskjema) og Google Sheets (skjema til regneark).
- Enkle (bare offentlige verdier): Google Analytics (med samtykkebanner), Google Maps, Tally, Logo.dev, Shopify, Storyblok, og bekreftelse for Search Console og Bing.
- AI skriver funksjonen ut fra tjenestens dokumentasjon: Brevo, Mailgun, Klaviyo, beehiiv, HubSpot, Slack, Discord, Telegram, Twilio, GatewayAPI, WhatsApp, Notion, Airtable, Chargebee, WooCommerce, PrestaShop, Semrush, Apollo, Gemini.
- 18 står som «Kommer» fordi de trenger en felles innloggingsflyt (blant annet Drive, Calendar, Outlook, Teams, Salesforce, LinkedIn, X).

**Kontroll**
- Kode: store filer, kopiert kode.
- Sikkerhet: nøkler i koden, åpne databaseregler, usikker HTML, svake serverfunksjoner, pakker med kjente feil (mot den åpne databasen OSV) og en dyp AI-gjennomgang som bare rapporterer.
- SEO: beskrivelse, tittel, overskrifter, bilder uten tekst.
- SoMe: ferdige innlegg for X, Facebook, Instagram og LinkedIn med merkede lenker, delingslenker og delingsknapper på siden.

**Måling**
- Forbruk: kostnad per dag og type, budsjett.
- Analyse: besøk uten cookies, med kilde (søk, AI-søk, sosiale, henvisning, direkte, annonser), sider, land og enheter.

## Hva det koster å drive (uten tall)

- **AI** er den største posten, og den følger hvor mye du bygger. Forbruk-siden viser det.
- **Vercel** for Pivolar selv, pluss kjøringen av importerte prosjekter i Sandbox.
- **Supabase** for databasen.
- **Bilder, pakkesjekk og så videre** er små poster.
- Tjenestene du kobler til (Resend, Brevo og så videre) har egne priser.

## Mot tilsvarende tjenester

Prisene er fra søk 24. oktober 2026. De endres ofte og kildene er delvis uenige, så sjekk leverandørens side før du bruker tallene.

| | Pris (oppgitt) | Det de gjør bra |
|---|---|---|
| **Lovable** | Pro 25 USD i måneden for 100 kreditter, Business 50 USD ([priser](https://lovable.dev/pricing)) | Alt i ett: database, innlogging, filer, betaling, e-post, domener, analyse, sikkerhetsskanning og 150+ koblinger bak ett klikk. Du ser det i skjermbildene du har sendt. |
| **Bolt.new** | Gratis 1 million tokens, Pro ca. 25 USD for 10 millioner ([priser](https://bolt.new/pricing)) | Rask bygging i nettleseren, uten at du trenger noe oppsett. |
| **v0** (Vercel) | Premium 20 USD og Team 30 USD per bruker, men Premium kan være utfaset for nye ([Vercel](https://vercel.com/blog/updated-v0-pricing)) | Tett koblet til Vercel, god på grensesnitt i React. |
| **Replit Agent** | Core ca. 20–25 USD med inkludert kreditt, ellers etter bruk ([Replit](https://docs.replit.com/help/pricing-and-plans.md)) | Kjører, hoster og lagrer alt på ett sted, med en agent som bygger og kjører koden. |
| **Pivolar** | Ingen abonnement. Du betaler bare det AI, Vercel og Supabase selv koster. | Se under. |

*Det jeg vet om de andre sine funksjoner, er fra deres egne sider og det du har vist meg, ikke fra at jeg har brukt dem side om side.*

### Der Pivolar står sterkt
- **Det er ditt.** Koden går til din GitHub og din Vercel. Ingen innelåsing, og du kan flytte hvor som helst. Importerte prosjekter fortsetter du på, og endringer går som pull request.
- **Åpen pris.** Forbruk viser hva hver ting koster. Det finnes ingen kreditter som forsvinner.
- **Kontroll og vekst i samme verktøy.** SEO, sikkerhetsgjennomgang, innlegg for sosiale medier og besøkstelling uten cookies følger med, og er skrevet for norske og europeiske regler.
- **Leser eksisterende prosjekter** (Lovable-repoer, ren HTML, Next.js) og kjører dem isolert, i stedet for bare å bygge nytt.
- **Tilpasset deg.** Norsk språk, og det du ber om kommer inn i verktøyet.

### Der de andre er foran
- **Innebygd backend.** Lovable og Replit gir konto og database for appen du bygger med ett klikk. Pivolar kan bare skrive koden mot Supabase, du setter det opp selv. Dette er det største gapet.
- **Domener.** Lovable lar deg koble eget domene fra tjenesten. Pivolar lar deg velge vert, men domenet kobler du selv hos verten. Utrullingen skjer bare automatisk på Vercel.
- **Selvtesting.** Lovables agent åpner appen og sjekker at skjemaet virker. Pivolar kan rette feil du sender inn, men tester ikke selv.
- **Flere brukere.** Pivolar er bygget for én eier. Det finnes ingen samarbeid, ingen kontoer for andre og ingen betaling for Pivolar selv.
- **Modenhet.** De har vært brukt av mange i lang tid. Mye av det i Pivolar er nytt og ikke prøvd i bred bruk.

## Hva som er prøvd og hva som ikke er det

**Prøvd av deg i virkeligheten**
- GitHub-import av `love-sync` (rapport og kjørt forhåndsvisning).
- Kjøring av analyse-migrasjonen i Supabase (tabellen `site_hits` finnes).

**Bygget, testet i kode, men ikke prøvd mot de ekte tjenestene**
- Publisering med miljøvariabler til Vercel, Resend, Paddle og alle de øvrige koblingene.
- Hosting-valget: anbefalingene og innstillingsfilene er testet i kode. Knappene som åpner Netlify, Cloudflare og Render med repoet ditt bruker adressemønstre jeg ikke har åpnet selv, og selve utrullingen hos disse er ikke prøvd. Kontroller at hver knapp åpner riktig side før du stoler på dem.
- Besøkstellingen fra en publisert side.
- Pakkesjekken mot OSV.
- Rask og dyp sikkerhetsskanning i selve dialogen.
- Statisk HTML-forhåndsvisning av `smalltenders` (er deployet, ikke bekreftet av deg).
- **Google-innlogging (Gmail og Sheets)** ligger lokalt og er ikke pushet. Det trenger at du lager en OAuth-klient hos Google først.

**Kjente begrensninger**
- Filer som bilder lagres ikke i Pivolar ennå, og må kopieres for hånd ved eksport.
- Sider som er publisert før besøkstellingen kom, må publiseres på nytt for å telle.
- «Kommer»-tjenestene kan ikke legges til.
- `README.md` sier fortsatt at prosjekter ligger i nettleseren. Det stemmer ikke lenger siden de nå ligger i Supabase, og den bør oppdateres.

## Veien til offentlig åpning

Dette er det som må på plass før andre får bruke Pivolar. Planen i `docs/PIVOLAR-PLAN.md` har fasene.

1. **Kontoer og kvoter.** Åpen registrering i stedet for kun eieren, og grenser per bruker for AI, kjøring og publisering.
2. **AI under kommersielle vilkår.** Offentlig bruk krever en API-nøkkel som dekkes av leverandørens kommersielle vilkår. Et privat abonnement kan ikke antas å dekke det.
3. **Egne tilganger per bruker.** `GITHUB_TOKEN` og `VERCEL_TOKEN` er i dag dine. Andre trenger sin egen innlogging (GitHub-app og OAuth) eller at Pivolar hoster for dem.
4. **Hosting for brukerne.** Første versjon av valget er bygget (se «Publisere»). For en åpen tjeneste gjenstår: automatisk utrulling til Netlify og Cloudflare med brukerens egen innlogging (i dag gjør brukeren det siste trinnet selv), serverfunksjoner som virker utenfor Vercel, og at prisene i katalogen holdes oppdatert (hver har en «sjekket»-dato i `src/lib/hosting/catalog.ts`). Før Pivolar åpnes må også spørsmålet om hvem som betaler for hostingen avgjøres: brukeren selv, eller Pivolar.
5. **Backend for appene.** Konto og database som Pivolar setter opp for hver app, med reglene allerede på plass. Dette er det største steget for å komme på høyde med Lovable.
6. **Betaling for Pivolar selv** (Paddle er foreslått siden de håndterer moms), med abonnement og kvoter koblet til.
7. **Misbruk og regler.** Moderering av det som publiseres (nettfisking), vilkår, personvern og sletting. Besøkstelleren og kontaktfunksjonene er åpne for alle på nettet og har egne vern, men må gjennomgås på nytt med mange brukere.
8. **Drift.** Vercel Pro (kommersiell bruk), Supabase på betalt plan, overvåking og sikkerhetskopier.

## Hvor du er nå

Du har et fungerende, bredt verktøy for deg selv som dekker det meste av arbeidsflyten til de store tjenestene, med mer eierskap og åpen pris, men uten deres innebygde backend, domener og modenhet. Det som skiller det fra et produkt andre kan kjøpe, er punkt 1 til 8 over, ikke mangel på funksjoner.
