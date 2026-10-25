# Pivolar

Et privat verktøy for å bygge apper ved å snakke: du beskriver det du vil ha, AI-en skriver React/Tailwind-koden, og du ser resultatet live ved siden av samtalen.

## Slik fungerer det

- **Chat → kode:** Claude (via Vercel AI Gateway) bruker tre verktøy: `writeFile`, `editFile` og `deleteFile`.
- **Prosjektet bygges av samtalen.** Filene regnes ut fra malen pluss alle ferdige verktøykall i chatten (`src/lib/files.ts`). Det gir «Gå tilbake hit» gratis: å kutte historikken kutter også filene.
- **Forhåndsvisning:** Sandpack (React + TypeScript + Tailwind) kjører direkte i nettleseren, uten egen server.
- **Innlogging:** Supabase Auth (e-post og passord), og bare adresser i `APP_EMAIL` slipper inn (`src/proxy.ts`).
- **Lagring:** prosjekter og samtaler ligger i nettleseren (localStorage) i denne første etappen.

## Kjør lokalt

```sh
npm install
vercel link          # kobler til Vercel-prosjektet og gir AI Gateway-tilgang
vercel env pull      # henter VERCEL_OIDC_TOKEN (gyldig i 12 timer)
npm run dev
```

Legg Supabase-nøklene og `APP_EMAIL` i `.env.local` (se `.env.example`), og kjør `node --env-file=.env.local scripts/create-owner.mts` én gang for å opprette eieren.

## AI Gateway

AI Gateway krever et **betalingskort på Vercel-kontoen** for å låse opp de gratis kredittene (Vercel → AI). Uten kort får du meldingen «AI Gateway trenger et betalingskort». Modellen kan byttes med `AI_GATEWAY_MODEL` (standard `anthropic/claude-sonnet-5.5`).

## Miljøvariabler

| Variabel | Hva |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase-prosjektet (offentlige) |
| `SUPABASE_SERVICE_ROLE_KEY` | Bare server; brukes av `scripts/create-owner.mts` |
| `APP_EMAIL` | Hvem som får logge inn (kommaseparert) |
| `APP_PASSWORD` | Bare for `create-owner`; selve innloggingen går mot Supabase Auth |
| `AI_GATEWAY_MODEL` | Valgfri modell, `provider/modell` |
| `AI_GATEWAY_API_KEY` | Bare utenfor Vercel; på Vercel brukes OIDC automatisk |

## Bilder, fonter og delingsbilde

- **Bildesøk:** chatten har verktøyet `searchImages` (Unsplash, så Pexels, så Pixabay). Legg gratis nøkler i `.env.local` og i Vercel: `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY` (illustrasjoner). Uten nøkkel får appene tilfeldige plassholderbilder fra Picsum, og AI-en sier fra om det.
- **Egne bilder:** verktøyet `generateImage` lager emblemer, hero-scener, illustrasjoner og teksturer med en bildemodell via AI Gateway (`IMAGE_MODEL`, standard `google/imagen-4.0-generate-001`). Bildene lagres i Supabase Storage (bucket `pivolar-images`, migrasjon `20261023160000_pivolar_images.sql`) og kopieres inn i prosjektet ved publisering. Maks 3 per melding.
- **Fonter:** Google Fonts lastes med `@import` øverst i `/styles.css`. Ved publisering flyttes importene foran Tailwind.
- **Logo, favicon og delingsbilde:** AI-en lager `/brand.json`, `/public/favicon.svg` og `/public/logo.svg`. «Publiser» tegner `og.png` (1200x630) av dem og legger inn meta-tagger.
- **Flere sider og pakker:** `react-router-dom` (HashRouter), `recharts`, `date-fns`, `lucide-react`, `framer-motion`.

## Forbruk og budsjett

- `/forbruk` viser hva AI-bruken koster (kurve for gjenstående budsjett, forbruk per dag, denne måneden og totalt), med budsjett som påfylt beløp eller per måned og en «jeg har fylt på»-knapp. Måleren i toppen blir gul ved 80 % og rød når budsjettet er brukt opp.
- Er budsjettet brukt opp, stopper Pivolar ikke. Den spør om meldingen skal lagres til senere (vises som «Lagret melding» i prosjektet) eller slettes.
- Kostnaden er et estimat fra tokens og en prisliste (`PRICE_*` i `.env.example`). Kortet legges alltid inn hos Anthropic og Vercel, aldri i Pivolar.
- Trenger migrasjonen `20261023170000_pivolar_usage.sql` i Supabase.

## Bygg fra en referanse-side

- Skriv i chatten at du vil lage noe i samme stil som, eller en kopi av, en side (for eksempel «lag en kopi av https://…»). AI-en kaller `analyzeSite`, som åpner siden i en ekte nettleser på 1280 px bredde, ruller gjennom den og måler skrifter, farger (hex), CSS-variabler, seksjoner (topp, høyde, padding), hver tekstblokk og hvert bilde med posisjon og størrelse, kort og rutenett, faste elementer og header. Du får også skjermbilder. Målingen kjører bare mot offentlige adresser (interne adresser og lokale nettverk blokkeres).
- Er det en referanse i samtalen, vises **Sammenlign** i topplinjen. Den bytter forhåndsvisningen til en fast 1280 px bred ramme, måler resultatet med samme script og viser avvikene mot referansen (seksjonshøyder, avstander, skriftstørrelser, farger, kort, manglende tekst). **Be Pivolar rette avvikene** sender listen til chatten som en presis rettelsesbestilling.
- Lokalt brukes Chrome på maskinen (sett `CHROME_PATH` hvis den ikke finnes); på Vercel brukes `@sparticuz/chromium`.
- Bruk det på dine egne sider eller sider du har rett til å gjenskape. Bildene i en kopi hentes fra originalen og følger ikke med ved publisering.

## Etapper

1. **Fundament** (ferdig): utseende, chat, kodeskriving, live forhåndsvisning, kodevisning, enhetsvisning, «prøv å fikse», historikk, innlogging.
2. Redigerbar kode, bildeopplasting i chatten, klikk-og-endre i forhåndsvisningen.
3. Database for prosjekter (flere enheter) og versjonsliste.
4. Publisering: GitHub-repo og Vercel-deploy med ett klikk, og Supabase/Neon koblet på automatisk.

## Publisering

«Publiser»-knappen lager et vanlig Vite-prosjekt av appen, legger det i ett commit i et GitHub-repo og deployer det til Vercel. Legg i `.env.local`:

- `GITHUB_TOKEN` (repo-tillatelse): https://github.com/settings/tokens/new?scopes=repo&description=Pivolar
- `VERCEL_TOKEN`: https://vercel.com/account/tokens
- Valgfritt: `GITHUB_OWNER`, `VERCEL_TEAM_ID`

Publiserer du igjen, oppdateres samme repo og samme Vercel-prosjekt.

## Import og eksport (fase 2)

- **Importer ZIP** på forsiden: arkivet leses i minnet (aldri pakket ut til disk eller kjørt), og du får en rapport før prosjektet opprettes. Avvises: stier med `..`, absolutte stier, for mange eller for store filer, pakkebomber. `.env` og nøkkelfiler tas ikke med.
- **Eksporter** i arbeidsflaten: ZIP med alle filer, `.env.example`, `EXPORT-REPORT.md` og `PIVOLAR-MANIFEST.json`. Nøkler fjernes. Binærfiler (bilder) lagres ikke i Pivolar ennå og må kopieres tilbake for hånd.
- Plan, revisjon og faser: `docs/PIVOLAR-PLAN.md`.

## Koble til Google

Gmail-kontaktskjema og Google Sheets bruker din egen Google-konto. Du lager en «app» hos Google én gang, og Pivolar logger inn med den.

1. Gå til [Google Cloud Console](https://console.cloud.google.com/), lag et prosjekt og slå på **Gmail API** og **Google Sheets API** (APIs & Services → Library).
2. **OAuth consent screen**: velg *External*, fyll inn navn og e-post, og legg til deg selv under *Test users*.
3. **Credentials → Create credentials → OAuth client ID → Web application.** Under *Authorized redirect URIs* legger du inn `https://DIN-PIVOLAR-ADRESSE/api/oauth/google/callback`.
4. Legg `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` og `OAUTH_ENCRYPTION_KEY` (se `.env.example`) inn i Vercel og deploy på nytt.
5. Kjør migrasjonen `supabase/migrations/20261024140000_pivolar_oauth.sql` i Supabase (SQL Editor).
6. I et prosjekt: **Koblinger → Gmail** (eller Sheets) → **Koble til Google**, og velg Tillat.

Viktig om tokenene: står appen din i *Testing*-modus hos Google, slutter tilgangen å virke etter 7 dager. Trykk *Publish app* på consent screen for å unngå det. Appen vises da som «ikke verifisert» for andre, men det er bare deg som bruker den, og du kan fortsette.

Pivolar ber bare om det den trenger: `gmail.send` (sende, ikke lese e-posten din) og `spreadsheets`. Tokenet lagres kryptert, vises aldri i nettleseren, og sendes bare til Vercel ved publisering av et prosjekt som bruker det.

## Kvoter og hard stopp

Alt som koster penger kontrolleres på serveren før arbeidet starter. Sjekkene i nettleseren er bare en bekvemmelighet.

**Rekkefølge for hver AI-forespørsel** (`src/lib/quota/gate.ts`): innlogget, ikke slått av, ikke for mange forespørsler, tjenestens dagsgrense, og så brukerens eget budsjett. Før modellen kjører settes et beløp av mot budsjettet (`reserve_usage`, atomisk), og beløpet gis tilbake når forespørselen er ferdig. Mange forespørsler samtidig kan derfor ikke til sammen bruke mer enn det som er igjen. En reservasjon som aldri frigis, teller ikke etter 15 minutter.

**Grenser per forespørsel:** `maxOutputTokens` per steg, tidsavbrudd (under plattformens 300 s), en kostnadsgrense som stopper forespørselen med en forklaring, 25 steg, løkkevakten og høyst tre bilder. Forespørselen avvises over 12 MB.

**Rate limit per bruker** (`rate_limit`): chat 20 per minutt, analyse 10 per 10 min, kjøring av prosjekt 10 per time, import 20 per time, publisering 20 per time, eksport 30 per 10 min, pull request 30 per time. Tallene står i `src/lib/quota/config.ts`.

**Miljøvariabler (alle valgfrie):**

| Variabel | Standard | Hva |
|---|---|---|
| `AI_DISABLED` | av | `1` stanser all AI umiddelbart (nødbrems) |
| `IMPORT_DISABLED` | av | `1` stanser import fra GitHub og ZIP |
| `REQUEST_CAP_USD` | 1.5 | mest én forespørsel kan koste (maks 50) |
| `MAX_OUTPUT_TOKENS` | 16000 | mest modellen skriver per steg (maks 64000) |
| `REQUEST_TIMEOUT_MS` | 240000 | avbryter en forespørsel etter så lang tid (maks 280000) |
| `GLOBAL_DAILY_USD` | ingen | mest hele tjenesten bruker på AI per døgn |
| `QUOTA_ALLOW_UNSET` | av | `1` slipper forespørsler gjennom mens databasefunksjonene mangler. Bare mellom en deploy og dens migrasjon. |

**Oppsett:** kjør `supabase/migrations/20261024160000_pivolar_quota.sql` i Supabase **før** du deployer. Migrasjonen bare legger til, og gamle versjoner av appen virker som før. Mangler funksjonene, avviser serveren AI-forespørsler med beskjed om å kjøre den (det er med vilje: «usikker» skal aldri bety «gratis»).

## Stack og hosting

Pivolar leser et prosjekt og setter det i en av tre grupper med faste regler, uten AI (`src/lib/stack/classify.ts`): **Statisk** (bare filer), **Avansert frontend** (React, Next.js og lignende, bygget til filer eller rendret på serveren) og **Fullstack** (en server som må gå hele tiden, eget Docker-oppsett eller egen database). Hver gruppe har med seg en grunn i klartekst.

Gruppen går inn i en fast tabell (`src/lib/hosting/rules.ts`) som sier hvilken vert som passer best, med pris fra tallene i `src/lib/hosting/catalog.ts` (hver pris har dato og kilde, og må oppdateres for hånd):

| Gruppe | Første valg |
|---|---|
| Statisk, frontend som filer | Cloudflare (gratis), så Netlify, GitHub Pages og Vercel |
| Frontend med serverrendering | Vercel |
| Fullstack | Hetzner (ca. 6 EUR), så Render og Railway |

Importrapporten viser gruppen og anbefalt vert. Knappen **Hosting** i et prosjekt viser rangeringen og lar deg legge oppsettsfilene i prosjektet (filer som finnes fra før blir ikke overskrevet). For en server lages `Dockerfile` for språket (Node, Python eller PHP), `docker-compose.yml` med databasen prosjektet trenger, `.dockerignore`, en workflow som ber Coolify bygge på nytt, og `HOSTING.md` med stegene for Coolify og Dokku. Startkommandoen er gjettet ut fra rammeverket, så sjekk den.

**Prosjektkjøring (Sandbox):** hver kjøring tilhører brukeren som startet den. Navnet bygges av en kortversjon av brukerens id og prosjekt-id, så andre kan ikke stoppe eller bruke den selv om de kjenner prosjekt-id-en. En kjøring lever høyst `SANDBOX_MAX_MINUTES` minutter (standard 120, aldri over 480) fra den ble startet. Når filer sendes til den, holdes den i live 10 minutter fra nå, men aldri forbi grensen, og gjentatte kall legger ikke på mer tid. Når grensen nås, stoppes kjøringen og brukeren får beskjed. En bruker kan ha høyst `SANDBOX_MAX_CONCURRENT` kjøringer i gang samtidig (standard 2, aldri over 10). Antallet telles på serveren fra brukerens egne kjøringer før noe starter, en kjøring som er stoppet teller ikke, og kan listen ikke leses, startes ingenting.

## Import fra WordPress (uten AI)

`POST /api/import/cms` (bare for innlogget bruker, med rate limit og på/av-bryteren `IMPORT_DISABLED`) leser et WordPress-nettsted inn i Pivolars innholdsmodell med vanlig kode. Eieren må bekrefte at nettstedet er hans eller hennes (`confirmOwner`).

- `probe`: er det WordPress, kan innholdet leses gjennom REST-API-et (`/wp-json`, eller `?rest_route=`), og hvor mye finnes (sider, innlegg, bilder)?
- `fetch`: henter sider, innlegg og bilder med tak: 150 sider og innlegg, 400 bilder, 100 sekunder totalt og 5 MB per JSON-svar. Resultatet er en `SiteModel` (`src/lib/import/model.ts`): sider med tittel, adresse, SEO-felt fra Yoast, og innholdet som typede blokker (overskrift, tekst med lenker, bilde, galleri, liste, sitat, knapp, kolonner, tabell, innbygging). Det som ikke kan gjøres om til en blokk (skjemaer, video, kortkoder) blir værende som `unknown`-blokker og står i advarslene.
- `src/lib/import/safe-fetch.ts` er den eneste måten noe hentes på: adressen sjekkes før den åpnes, etter hver videresending, og når forbindelsen opprettes, og hvert svar har tidsgrense og størrelsesgrense (også etter utpakking). `robots.txt` følges, og sider den forbyr blir hoppet over.
- `src/lib/import/clean.ts` renser HTML til blokker: ingen script, stil, hendelser eller `javascript:`-adresser kommer gjennom, bare lenker og enkel utheving i tekst.
- `src/lib/import/skeleton.ts` lager det AI-en senere skal lese: strukturen og noen få ord per tekst. Selve teksten ligger i `slots` og går aldri gjennom modellen.

Ikke på plass ennå: nedlasting av bildene til Supabase Storage, lagring av modellen i databasen, grensesnitt, og Joomla, Drupal, Wix og Squarespace.

### Bilder fra importen

`fetch` lagrer sider og bildeliste som en jobb (`import_jobs`). `images` henter så de neste bildene, noen få om gangen (hvert kall jobber høyst 45 sekunder og kan gjentas til `status` er `images_done`). `get` gir modellen med bildene fylt inn, der bildeadressene er byttet ut med `/images/<fil>`.

Hvert bilde hentes gjennom den sikre henteren (og `robots.txt`), sjekkes på de første bytene i stedet for på filtypen nettstedet oppgir, skaleres til maks 2000 piksler og lagres på nytt som WebP. Da forsvinner posisjon, kamera og forfatter fra bildet, og alt som lå skjult i filen. Bildet lagres én gang under et navn laget av innholdet (samme bilde brukt flere steder blir én fil). SVG tas ikke inn, siden den kan inneholde script.

Grenser: 400 bilder, 10 MB per bilde, 150 MB nedlasting per import, 50 millioner piksler per bilde, og 500 MB lagret per bruker. Filene ligger i bøtta `pivolar-assets` under brukerens egen mappe. Bilder som ikke kan lagres beholder den gamle adressen og står i advarslene.

Oppsett: kjør `supabase/migrations/20261024180000_pivolar_import_assets.sql` i Supabase.

### Fra import til prosjekt

Knappen **Importer fra WordPress** på startsiden tar deg gjennom hele løpet: sjekk nettstedet, hent innholdet og bildene, og **Åpne som prosjekt**. Prosjektet lages uten AI av faste maler (`src/lib/import/site-project.ts`):

- Hver side og hvert innlegg ligger som data (`/content/pages/*.ts`) og vises av ferdige blokk-komponenter (`/components/Blocks.tsx`). Designet endres på ett sted, og AI-en jobber med komponentene, aldri med tekstene.
- Hver side ligger på adressen den hadde, så gamle lenker, bokmerker og søketreff virker. Lenker mellom sidene er gjort om til lenker på det nye nettstedet. Har det gamle nettstedet ingen egen forside, lages en som lister siste innlegg.
- Menyen følger det gamle nettstedet. Tittel og beskrivelse per side kommer fra det gamle SEO-feltet.
- Koden skriver aldri tekst som HTML: den lille markeringen som er igjen (lenker og utheving) leses av en egen tolker, og alt annet vises som tekst. Innbygging av annet enn video og kart vises som lenke.
- Bildene peker på lagringen (`pivolar-assets`). Ved publisering lastes de ned til nettstedet og koden peker på kopiene (`bundleStorageImages` kjenner nå begge bøttene, tar opptil 400 bilder, seks om gangen).
- `IMPORT.md` i prosjektet sier hva som ikke kom med (skjemaer, video, kortkoder), hvilke programtillegg som ble brukt, og advarsler.
- Vercel og GitHub Pages får en regel som åpner siden for alle adresser som ikke er filer (Netlify, Cloudflare, Render og Caddy hadde den fra før).

Begrensning: nettstedet er en enkeltsideapp, så en søkemotor ser innholdet først etter at JavaScript har kjørt. For SEO bør den ferdige utgaven forhåndsrendres (planlagt: statisk eksport).

### Ferdige sider for søkemotorer

Et importert nettsted tegnes av en ruter i nettleseren, så en søkemotor som ikke kjører JavaScript ville sett en tom side. Derfor bygger publiseringen også hver side som ferdig HTML (`vite build`, deretter `vite build --ssr` og `scripts/prerender.mjs`). Det er den samme koden som tegner siden i nettleseren, uten AI.

- Hver adresse får en egen fil (`om-oss/index.html`) med egen tittel, beskrivelse, canonical-adresse og delingsbilde, og et sitemap med alle sidene når nettstedets adresse er kjent (`VERCEL_PROJECT_PRODUCTION_URL` eller `SITE_URL`). Uten kjent adresse får ingen side en canonical som peker på forsiden.
- Nettleseren tar over den ferdige siden (`hydrateRoot`) når den hører til adressen, og tegner fra bunnen ellers (ukjent adresse, gammel kopi). Vertene åpner derfor fortsatt nettstedet på ukjente adresser.
- Adressene kommer fra et annet nettsted. Hver blir sjekket før noe skrives: ingen `..`, skråstrek eller ugyldig koding i en mappe, ingenting under `assets`, `images` eller `api`, og filen må ligge i byggemappen. Tekst fra det gamle nettstedet escapes og leses aldri som mønster.
- Prosjekter som ikke er importert bygges som før.

### Utseendet fra det gamle nettstedet

Importen leser hovedfargen, sidefargene og skrifttypene fra det gamle nettstedets egen kode, uten AI: `theme-color`, fargevariablene i temaet (`--wp--preset--color--primary` og lignende, ikke WordPress' standardpalett), `body`- og `h1`-reglene, og de tre første stilarkene fra nettstedets eget domene (med robots.txt og de vanlige grensene).

- Verdiene blir bare farger og vanlige skriftnavn. Alt annet (`url(...)`, `}`, gradienter, variabler som ikke lar seg løse) kastes, og sjekkes på nytt når prosjektet bygges.
- Den faste malen er laget for lyse sider. Hovedfargen mørknes til den kan leses som lenke (kontrast minst 4,5), tekstfargen må ha kontrast minst 7, og et mørkt nettsted beholder hovedfargen men får lys bakgrunn.
- Google Fonts-adressene følger med som `@import`. Skrifttyper som lastes fra det gamle nettstedet selv kan ikke følge med, og står som advarsel.
- Hovedfargen brukes også i `brand.json`, så delingsbildet og `theme-color` passer.

### Designforslag fra AI (valgfritt)

Alt i importen skjer med vanlig kode. AI brukes på ett sted, og bare hvis eieren trykker «Foreslå design med AI» i importvinduet (`/api/import/design`).

- **Hva AI leser:** en kort beskrivelse (høyst 6 000 tegn): navn, beskrivelse, språk, hovedfarge og begynnelsen av noen få sider. Ikke sidene selv.
- **Hva AI svarer med:** et lite forslag med faste valg: topp (enkel eller midtstilt), bunn (én linje eller kolonner), hjørner, luft, et skriftpar fra en fast liste og en overskrift med en linje tekst til forsiden, eventuelt med en knapp til en side som finnes. Ingen kode, ingen adresser, ingen stiler, ingen verktøy.
- **Kontroll:** svaret kuttes ned til disse feltene (`sanitizeDesign`): ukjente valg blir standard, tekst mister `<`, `>` og kontrolltegn og kuttes i lengde, og en knapp utenfor siden fjernes. Det samme gjøres på nytt når prosjektet bygges. Beskrivelsen av nettstedet er merket som data i instruksjonen.
- **Grenser:** den samme porten som chatten (innlogget, AI av/på, døgntak for tjenesten, brukerens budsjett med beløp satt av og gitt tilbake), egen kvote på 10 forslag i timen, høyst 1 200 tokens ut, 60 sekunder, og kostnaden telles i forbruket.
- Skriftparet brukes bare når det gamle nettstedet ikke hadde egne skrifter som kunne følge med.


### Lagringsgrense og logg ved import

- **Nettleserlagringen** er liten (ca. 5 MB). Før prosjektet lages, måles størrelsen mot det som er ledig (høyst ca. 2,4 millioner tegn til sammen, med margin). Er nettstedet for stort, utelates de eldste innleggene til det passer, og det står i importnotatet (`IMPORT.md`) og i meldingen. Sidene utelates aldri, og innleggene som ble utelatt ligger fortsatt i importen på serveren. Passer ikke engang sidene, stopper importen med en klar melding om å slette gamle prosjekter.
- **Eierbekreftelsen** («dette er mitt nettsted») skrives til `audit_log` når importen er lagret, med adresse, jobb og antall sider. Brukeren kan lese sin egen logg, men ikke skrive til den: det skjer gjennom funksjonen `log_audit`, som bare skriver for den innloggede, bare for handlinger på listen, og bare små data. Oppsett: kjør `supabase/migrations/20261024200000_pivolar_audit.sql` i Supabase. Mangler funksjonen, stoppes ikke importen.

### Andre nettsteder: Joomla, Drupal, Wix og Squarespace

Finnes det ingen åpen API (eller WordPress har stengt den), leser importen sidene ved å tegne dem i en nettleser (Chromium) og lese den ferdige siden. Samme rensing som for WordPress gjør hovedinnholdet til blokker, uten AI. Kontrollen sier hvilket system nettstedet bruker (`detectCms`) og om det kan leses på denne måten.

- **Hva som hentes:** forsiden, menyen, sidene i `sitemap.xml` og lenker på forsiden, høyst 40 sider og 60 åpnede sider, innen 90 sekunder. Menyen, topp og bunn, sidekolonner og informasjonskapsel-bannere regnes ikke som innhold, og den første `h1` blir sidens tittel. Et innlegg gjenkjennes på `article:published_time`.
- **Nettleseren er skrudd ned:** hver forespørsel går til en offentlig adresse (samme kontroll som analysatoren), bilder, skrifter og medier lastes aldri ned (bildene hentes senere av bildesteget, som sjekker hver fil), en side kan ikke sende den til et annet domene, den åpner ingen vinduer og laster ikke ned filer, og den lukkes etter en fast tid uansett. robots.txt følges, og eierbekreftelsen kreves som før.
- **Adresser:** bare vanlige sider på samme nettsted. Filer, admin- og innloggingsområder og adresser med tegn som ruteren ville lest som mønster (`:`, `*`, `(`) hoppes over.
- **Egen kvote:** 5 slike lesinger i timen (`render`), i tillegg til importkvoten.
- **Grenser:** Skjemaer, søk, handlekurv og alt bak innlogging følger ikke med. Det står i importnotatet. Alt som ikke er en vanlig side (for eksempel innhold som bare lastes ved klikk) må legges til for hånd.

## Innlogging og database for appene (Supabase)

Koblingen «Innlogging og database (Supabase)» gir en app konto, innlogging og tabeller der hver bruker bare ser sine egne rader. Eieren skriver tabellene i noen få linjer, og vanlig kode lager SQL-en og filene, uten AI:

```
oppgaver: tittel text!, ferdig ja/nei, frist dato
produkter [offentlig]: navn text!, pris tall
```

- **SQL (`supabase/schema.sql`):** hver tabell får `id`, `owner_id` (satt av databasen til den innloggede brukeren), `created_at`, radnivå-sikkerhet og fire regler (se, legg til, endre, slett egne rader). En rad kan ikke gis til en annen. `[offentlig]` gir i tillegg en lesing for alle, aldri skriving. Kjøres SQL-en på nytt, beholdes dataene, og regler som ikke lenger gjelder fjernes. Eieren kjører den selv i SQL Editor.
- **Navn:** bare små bokstaver, tall og understrek (æ, ø og å blir ae, o og a). Ord databasen har opptatt og `id`, `owner_id` og `created_at` avvises, og ingenting annet enn slike navn kommer inn i SQL-en (testet med 2 000 tilfeldige tekster).
- **Filene i appen:** `/lib/supabase.ts` (klienten), `/lib/useTable.ts` (les og skriv en tabell, med feilmeldinger på norsk), `/lib/db-types.ts` (radtyper) og `/components/AuthGate.tsx` (innlogging, ny konto, utlogging). Faste filer som er typesjekket mot de ekte typene til React og Supabase. AI-en bygger bare skjermbildene på toppen og blir bedt om å la dem være.
- **Nøkler:** bare adressen og den offentlige nøkkelen (anon eller publishable) kommer inn i koden, slik Supabase er laget for. Den hemmelige nøkkelen (`service_role` / `sb_secret_`) avvises, også når den er pakket inn som JWT.
- **Etterpå:** kjør SQL-en, slå på e-postinnlogging og legg til sidens adresse under Authentication → URL Configuration. Publisering legger SQL-en i `supabase/` i prosjektet, ikke under `src/`.

Under tabellfeltet kan eieren skrive en setning om appen og trykke «Foreslå tabeller med AI» (`/api/backend/suggest`). AI-en fyller bare ut et lite skjema (tabeller, kolonner, typer, og om noe skal være offentlig). Svaret skrives som linjer og leses av nøyaktig de samme kontrollene som tabeller skrevet for hånd: en tabell som ikke består (opptatte ord, ugyldige navn) utelates hel, og høyst 10 tabeller slipper gjennom. Eieren ser linjene i feltet og kan endre dem før noe lages. Samme porter som chatten gjelder (innlogget, AI av/på, døgntak, budsjett), pluss egen kvote på 15 forslag i timen, høyst 1 000 tokens ut og 40 sekunder.

## Fra prosjektet til nettleseren og GitHub

- **Ny fane:** knappen «Ny fane» i verktøylinjen åpner forhåndsvisningen alene i en egen nettleserfane (`/p/<id>/full`), slik en besøkende ser siden. Fanen leser det samme prosjektet og følger med mens AI-en bygger i den andre fanen.
- **Eksporter til GitHub:** i eksportdialogen kan et Pivolar-prosjekt sendes til et GitHub-repo som et ferdig Vite-prosjekt, i én commit, uten at noe publiseres noe sted og uten nøkler. Valg av repo-navn og privat/offentlig. Bruker `GITHUB_TOKEN` og publiseringsruten med bare GitHub slått på. Importerte prosjekter sendes som pull request i stedet.
- **Nyhetsbrev og del-rad i «Sett sammen»:** to nye seksjoner. Nyhetsbrevet har et e-postfelt med skjult felt mot spam og sender til `/api/subscribe`, funksjonen Resend-koblingen legger inn (forhåndsvisningen sier fra at den virker først etter publisering). Del-raden har knapper for Facebook, X, LinkedIn, WhatsApp, e-post og «Kopier lenke», som åpner hvert nettverks egen delingsside uten skript fra dem.

### Mer-panelet (prosjektsiden)

Knappen «Mer» i verktøylinjen åpner prosjektets egen side, som «More» i Lovable. Menyen til venstre går til dialogene prosjektet bruker (analyse, database og koblinger, kontroll av sikkerhet og SEO, hosting, publisering og eksport) og til forbruket. Innstillingene er samlet i seksjoner:

- **Prosjektdetaljer:** navn (kan endres), opphav, antall meldinger, AI-endringer (ferdige filendringer AI-en har gjort), dine egne endringer, filer, forbruk denne måneden og prosjekt-id.
- **Publisering:** sist publisert, lenker til siden og repoet, og snarveier til publisering, hosting og forhåndsvisning i egen fane.
- **Hemmeligheter:** hvilke koblinger som har lagrede verdier og hvor mange. Verdiene vises aldri, og hver kobling kan fjernes.
- **Git:** hvor en importert kode kommer fra og pull request, eller eksport til GitHub.
- **Handlinger og faresone:** dupliser prosjektet (samtale, filer og opphav, men ikke publiseringen, så kopien ikke kan overskrive den opprinnelige siden) og slett prosjektet, som spør to ganger.

## Prompt-hjelperen

Knappen «Prompt-hjelper» under tekstfeltet på forsiden åpner en veiviser: du velger hva du skal lage (landingsside, nettbutikk, portefølje, kafé, firma, forening, blogg, timebestilling eller app), skriver navn, hva dere gjør og hvem det er for, og velger mål, stemning, aksentfarge, seksjoner, funksjoner, språk og bilder. Vanlig kode setter det sammen til en komplett bestilling (`src/lib/prompt/builder.ts`):

- Hver bestilling har de samme delene: hva som skal bygges, målgruppe og hva en besøkende skal gjøre, seksjoner i rekkefølge, funksjoner (som kobles til under Koblinger uten nøkler i koden), design etter stemningen, bilder, språk, og krav til mobil, kontrast, overskrifter, brand.json og SEO.
- Fakta som mangler (priser, adresse, telefon, navn) skal bli plassholdere i hakeparentes, ikke oppfunnet.
- Teksten til høyre kan redigeres fritt. Den følger valgene til du endrer den selv, og kan bygges på nytt fra valgene. En liste viser det som mangler, uten å stoppe noe.
- **Skjerp med AI (valgfritt)** (`/api/prompt/improve`) skriver om hele bestillingen til noe mer presist, uten å fjerne valg eller finne på fakta. Samme porter som chatten (innlogget, AI av/på, døgntak, budsjett), egen kvote på 20 i timen, høyst 1 600 tokens ut og 45 sekunder. Svaret renses til ren tekst og vises i tekstfeltet, så du ser det før noe sendes. Ingen verktøy: AI-en kan bare svare med tekst.
- Valgene «Legg i tekstfeltet» og «Bygg nå» sender den ferdige teksten videre.

## Bilde av åpningssiden på hvert prosjekt

Prosjektlisten viser nå et utsnitt av åpningssiden til hvert prosjekt. Forhåndsvisningen tegner selv et lite JPEG av toppen av siden (biblioteket html-to-image lastes inn i forhåndsvisningen første gang), ca. 6 sekunder etter at siden har satt seg, bare i skrivebordsvisning og høyst én gang i minuttet. Bildet sendes opp som tekst, kontrolleres (bare en liten JPEG slipper gjennom, både før lagring og ved lesing, siden teksten kommer fra kode AI-en har skrevet) og lagres i nettleseren (IndexedDB). Uten bilde vises en farge. Bildene følger ikke med til andre enheter, og slettes når prosjektet slettes. Prosjekter som kjøres på serveren (importert Next.js med mer) og rene HTML-sider får ikke bilde ennå.

## Kunnskap: faste instrukser per prosjekt

I Mer-panelet (seksjonen «Kunnskap») skriver eieren varige regler for AI-en i akkurat det prosjektet: tone, språk, hva den ikke skal røre og fakta om virksomheten, høyst 4 000 tegn. Ett klikk legger til vanlige regler (alltid norsk, uformell tone, ingen emojier, bare fargene i brand.json, små endringer, korte svar, ikke røre /api).

- **Lagring:** som én skjult prosjektfil (`/KNOWLEDGE.md`), satt av eierens egne redigeringer helt i starten av samtalen. Den synker til kontoen som resten av prosjektet uten ny migrasjon, og å gå tilbake i samtalen tar den aldri bort.
- **Beskyttet:** AI-en kan ikke skrive, endre eller slette filen, den vises ikke i filkart eller kodevisning, og den publiseres og eksporteres aldri.
- **Bruk:** hver melding til AI-en får instruksene som en egen del av systemprompten, i en avgrenset blokk. Teksten renses (kontrolltegn og tagger som kunne lukket blokken fjernes). De gir ingen nye verktøy og kan ikke oppheve reglene ellers, og en melding fra eieren som strider mot dem, går foran.

Prompt-hjelperen kan også lagre språk, tone, fakta om virksomheten og aksentfargen som faste regler (Kunnskap) for prosjektet. Det er en avkrysning under bestillingen, på som standard, og den viser reglene som lagres. De settes på prosjektet idet det opprettes, og gjelder i alle meldinger. Et hurtigforslag på forsiden arver ikke regler du valgte tidligere.

## Automatisk utrulling til Netlify og Cloudflare Pages

Velger du Netlify eller Cloudflare i publiseringsdialogen og har lagt inn nøklene, legger Pivolar siden ut selv etter at koden er på GitHub. Uten nøklene gjelder det gamle: koden og innstillingsfilene på GitHub, og en knapp som åpner vertens egen utrullingsside.

**Nøkler** (miljøvariabler, bare for deg som eier; de vises aldri i nettleseren):
- Netlify: `NETLIFY_TOKEN` (User settings → Applications → Personal access tokens).
- Cloudflare: `CLOUDFLARE_API_TOKEN` med tillatelsen «Cloudflare Pages: Edit», og `CLOUDFLARE_ACCOUNT_ID`.

**Slik går det** (`src/lib/deploy/`):
1. Nettstedet opprettes hos verten (eller finnes fra før med samme navn), så adressen er kjent.
2. Prosjektet bygges i en isolert, midlertidig maskin (Vercel Sandbox, `npm install` og `npm run build`) med adressen som `SITE_URL`, slik at canonical, sitemap og ferdig HTML for importerte nettsteder får riktig adresse. Ingen nøkler eller annet av eierens miljø sendes inn i maskinen, og den stoppes alltid etterpå.
3. Filene i `dist` sjekkes (gyldige navn, høyst 2 000 filer, 25 MB per fil og 80 MB til sammen, og en `index.html`), og `_redirects` (alle adresser som ikke er filer åpner forsiden) og `_headers` (sikkerhetshoder) legges til hvis siden ikke har egne.
4. Netlify: filsammendrag med SHA-1, bare filene Netlify ber om lastes opp, og Pivolar venter til utleggingen er klar. Cloudflare: direkte opplasting (samme API som Wrangler) der hver fil får navn etter BLAKE3-hash, bare de som mangler lastes opp, og en utlegging lages fra fillisten.
5. Nøkkelen sendes bare til verten den hører til, og en utlegging som feiler eller en bygging som feiler laster ingenting opp.

**Begrensninger:** siden kan ikke ha serverfunksjoner under `/api` (de virker bare på Vercel). Selve byggingen tar ofte 1–3 minutter. API-kallene er bygd etter vertenes dokumenterte flyt og testet mot en etterlikning, ikke mot de ekte tjenestene, så første utlegging bør du følge selv.


## Domene: finn, kjøp og koble til

I Mer-panelet åpner «Domene» en dialog som finner domener som passer til prosjektet, lar deg kjøpe ett hos Cloudflare Registrar og kobler det til siden (`src/lib/domains/`, `/api/domains`).

- **Forslag og rangering:** navn lages av prosjektets eget navn, nøkkelord fra tittel og beskrivelse og noen enkle varianter, med de vanligste endelsene. «Flere ideer med AI» ber modellen om bare ord (aldri kjøp), som renses til gyldige navn og sjekkes som resten. Alle sjekkes live mot registeret og rangeres med vanlig poengsum, best først: samme som prosjektnavnet, kort, uten bindestrek og tall, kjent endelse (.com, .no for norske prosjekter, .shop for butikk), billig første år og fornyelse som ikke hopper. Hvert forslag viser pris, poeng og begrunnelsen, og det som ikke kan kjøpes står sist uten rang. .no selges ikke av Cloudflare, og dialogen sier det.
- **Kjøp:** er slått av til du setter `DOMAIN_BUY_ENABLED=true`, og har et tak per domene (`DOMAIN_MAX_USD`, standard 30, aldri over 200). Du må skrive domenet for å bekrefte, og dialogen viser pris, fornyelse, at kjøpet ikke kan refunderes og at det betales med betalingsmetoden på Cloudflare-kontoen. Rett før kjøpet sjekkes prisen mot registeret på nytt: den må være uendret, i dollar, ikke premium og under taket, ellers kjøpes ingenting. Forsøket skrives til loggen **før** noe kjøpes, og kan loggen ikke skrives, kjøpes ingenting (kjør `20261024220000_pivolar_audit_domains.sql`). Maks 5 kjøp i døgnet, en lås mot dobbeltklikk, ingen automatisk fornyelse, og et kjøp prøves aldri på nytt av seg selv. Ingen svar i tide regnes som «ukjent», ikke «feilet», så du ikke kjøper to ganger.
- **Nøkkel:** `CLOUDFLARE_API_TOKEN` trenger i tillegg til Pages-tillatelsen også Registrar (skrive), og Zone (lese og endre DNS, og opprette soner). Samme nøkkel som for utrullingen, og den sendes bare til Cloudflare.
- **Koble til:** verten får vite om domenet (Cloudflare Pages, Netlify eller Vercel), og DNS-oppføringene skrives i domenets sone hos Cloudflare, uten at du må åpne noe: Pages får proxy på, mens Netlify og Vercel får det av, så de kan lage sertifikatet selv. Er domenet kjøpt et annet sted (også .no), kan dialogen legge det til i Cloudflare, skrive oppføringene og si hvilke to navnetjenere du må bytte til hos den som har domenet. Ellers får du oppføringene å sette for hånd.
- **Lovable** bruker tjenesten Entri til å sette DNS hos mange leverandører. Her gjør Pivolar det samme direkte mot Cloudflare, siden det er samme konto som kjøpet.
- **Ikke prøvd mot de ekte tjenestene.** Registrar-API-et er i beta, og kallene er bygd etter Cloudflares dokumentasjon og testet mot en etterlikning. Prøv først med et sjekk-søk, og kjøp noe lite for å se hele løpet.

## Store GitHub-repoer

Et repo er ikke lenger for stort fordi arkivet er stort. Pivolar leser arkivet mens det kommer inn, en fil om gangen (`src/lib/github/thin.ts`), og holder bare det som kan beholdes: tekst- og kodefiler under 150 KB. Bilder, lyd, video, avhengigheter, byggemapper og store datafiler blir i repoet og står i rapporten (de 200 første enkeltvis, resten talt opp). Det som holdes, pakkes i et lite ZIP som går gjennom nøyaktig de samme kontrollene som en opplastet ZIP: stier, størrelser, bare tekst og filer som kan inneholde hemmeligheter. Grensene er 500 MB for repoet og 400 MB lest fra nettet, innen 100 sekunder. Lenger kommer du med ZIP eller et mindre repo.

**Du mister ikke noe:** det du redigerer og legger til er tekstfiler, og endringene går som pull request mot repoet, der alt annet blir som det er. For forhåndsvisningen av et prosjekt som kjører på serveren klones et offentlig repo inne i den isolerte maskinen (hele repoet, uansett størrelse, uten at noen nøkkel er der). Et privat repo kopieres fortsatt inn herfra, med de gamle størrelsesgrensene.

## Legge til bilder, lyd og PDF

I Mer-panelet, under «Filer», slipper du bilder (png, jpg, webp, gif, avif), lyd (mp3, m4a, aac, ogg, wav, webm) og pdf, høyst 25 MB per fil, 10 om gangen, 100 per prosjekt og 1 GB per bruker. Filene går rett fra nettleseren til lagring (`pivolar-uploads`) med en signert adresse som serveren deler ut etter å ha sjekket filtype, navn, størrelse og at du har plass, så ingenting stort går gjennom serveren. Svg, html og alt annet som kan kjøre avvises, både her og av selve bøtta.

- **Listen** over filene ligger som én skjult prosjektfil (`/UPLOADS.json`), på samme måte som Kunnskap: den følger prosjektet til kontoen, vises ikke i kodevisningen, AI-en kan ikke endre den, og den publiseres og eksporteres aldri. Alt i den kontrolleres på nytt når den brukes (adressen må peke inn i Pivolars egen bøtte).
- **AI-en** får en liste over filene med adresser i hver melding («Bruk bildet hero.jpg i toppseksjonen»), og blir bedt om å bruke adressen slik den står.
- **Publisering** kopierer filene inn i siden (`public/images` for bilder, `public/files` for lyd og pdf) og bytter adressene.
- **Pull request** til et importert GitHub-prosjekt tar med filene som er brukt: koden endres til `/uploads/<navn>`, og filene legges i `public/uploads/` som egne blobs i samme commit. Dialogen viser dem som «fil du la til».
- **Oppsett:** kjør `supabase/migrations/20261024240000_pivolar_uploads.sql` i SQL Editor. Uten den sier opplastingen fra seg med en tydelig melding.

## Video og lyd ved import: bare lenker

Et nettsted med mye video og lyd (for eksempel slow-blues.com) fyller ikke lagringen. Ingen video- eller lydfiler kopieres (`src/lib/import/embeds.ts`):

- **YouTube** beholdes som adresse, og siden viser videoens eget bilde (`i.ytimg.com`, lest fra YouTube når siden vises, ikke lagret hos oss) med en avspillingsknapp. Spilleren (`youtube-nocookie.com`) lastes først når du trykker, så siden er lett, personvennlig og ingenting spiller av seg selv.
- **Vimeo** gir ikke bildet uten å spørre, så det spørres én gang ved import (Vimeos åpne oEmbed-adresse, høyst 15 oppslag og 15 sekunder), og bare adressen til bildet på Vimeos egne servere beholdes. Feiler oppslaget, blir det en vanlig spiller.
- **Videofiler og lydfiler** (`<video>`, `<audio>`, WordPress sine video- og lydblokker) beholdes som adresser og spilles av fra det gamle nettstedet, uten forhåndslasting (`preload="none"`), med posterbildet som adresse. Mp4 og mp3 velges først når flere formater finnes.
- **Mediebiblioteket** i WordPress: video- og lydfiler regnes ikke som bilder og kopieres aldri. Bilder som ingen side viser, hentes heller ikke, så lagringen går bare til bilder du faktisk ser.
- **SoundCloud, Spotify, kart og andre rammer** forblir lenker eller kart som før.
- Rapporten (og `IMPORT.md`) sier hvor mange videoer og lydfiler som bare er lenket, og at de spilles fra det gamle nettstedet så lenge det er på nett. Skal filene bli i prosjektet, legger du dem til under Filer i Mer-panelet.

## Flyttesjekk (Lovable og andre Vite + Supabase-prosjekter)

Importerte prosjekter med egen `package.json` får en «Flytting»-seksjon i Mer-panelet. Den leser filene (ingen kjøring, ingen nettverk) og lager en avkrysningsliste: migrasjoner i rekkefølge, tabeller uten radnivå-sikkerhet eller regler, filbøtter, edge-funksjoner, navnene på hemmelighetene de leser (med hvor man får dem), webhook-adresser, Paddle/Stripe-ider, `VITE_`-variabler, gammel Supabase-adresse i koden, Lovable-rester og Cloudflare Pages-innstillinger. Verdier av hemmeligheter vises aldri. Avkrysning lagres i nettleseren per prosjekt. Koden ligger i `src/lib/move/check.ts`, testen i `tests/move.test.mts`.
