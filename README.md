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

**Prosjektkjøring (Sandbox):** hver kjøring tilhører brukeren som startet den. Navnet bygges av en kortversjon av brukerens id og prosjekt-id, så andre kan ikke stoppe eller bruke den selv om de kjenner prosjekt-id-en. En kjøring lever høyst `SANDBOX_MAX_MINUTES` minutter (standard 120, aldri over 480) fra den ble startet. Når filer sendes til den, holdes den i live 10 minutter fra nå, men aldri forbi grensen, og gjentatte kall legger ikke på mer tid. Når grensen nås, stoppes kjøringen og brukeren får beskjed.

## Import fra WordPress (uten AI)

`POST /api/import/cms` (bare for innlogget bruker, med rate limit og på/av-bryteren `IMPORT_DISABLED`) leser et WordPress-nettsted inn i Pivolars innholdsmodell med vanlig kode. Eieren må bekrefte at nettstedet er hans eller hennes (`confirmOwner`).

- `probe`: er det WordPress, kan innholdet leses gjennom REST-API-et (`/wp-json`, eller `?rest_route=`), og hvor mye finnes (sider, innlegg, bilder)?
- `fetch`: henter sider, innlegg og bilder med tak: 150 sider og innlegg, 400 bilder, 100 sekunder totalt og 5 MB per JSON-svar. Resultatet er en `SiteModel` (`src/lib/import/model.ts`): sider med tittel, adresse, SEO-felt fra Yoast, og innholdet som typede blokker (overskrift, tekst med lenker, bilde, galleri, liste, sitat, knapp, kolonner, tabell, innbygging). Det som ikke kan gjøres om til en blokk (skjemaer, video, kortkoder) blir værende som `unknown`-blokker og står i advarslene.
- `src/lib/import/safe-fetch.ts` er den eneste måten noe hentes på: adressen sjekkes før den åpnes, etter hver videresending, og når forbindelsen opprettes, og hvert svar har tidsgrense og størrelsesgrense (også etter utpakking). `robots.txt` følges, og sider den forbyr blir hoppet over.
- `src/lib/import/clean.ts` renser HTML til blokker: ingen script, stil, hendelser eller `javascript:`-adresser kommer gjennom, bare lenker og enkel utheving i tekst.
- `src/lib/import/skeleton.ts` lager det AI-en senere skal lese: strukturen og noen få ord per tekst. Selve teksten ligger i `slots` og går aldri gjennom modellen.

Ikke på plass ennå: nedlasting av bildene til Supabase Storage, lagring av modellen i databasen, grensesnitt, og Joomla, Drupal, Wix og Squarespace.
