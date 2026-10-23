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
