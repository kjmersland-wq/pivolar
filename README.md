# Atelier

Et privat verktøy for å bygge apper ved å snakke: du beskriver det du vil ha, AI-en skriver React/Tailwind-koden, og du ser resultatet live ved siden av samtalen.

## Slik fungerer det

- **Chat → kode:** Claude (via Vercel AI Gateway) bruker tre verktøy: `writeFile`, `editFile` og `deleteFile`.
- **Prosjektet bygges av samtalen.** Filene regnes ut fra malen pluss alle ferdige verktøykall i chatten (`src/lib/files.ts`). Det gir «Gå tilbake hit» gratis: å kutte historikken kutter også filene.
- **Forhåndsvisning:** Sandpack (React + TypeScript + Tailwind) kjører direkte i nettleseren, uten egen server.
- **Innlogging:** ett passord og en signert cookie, bare for deg (`src/proxy.ts`).
- **Lagring:** prosjekter og samtaler ligger i nettleseren (localStorage) i denne første etappen.

## Kjør lokalt

```sh
npm install
vercel link          # kobler til Vercel-prosjektet og gir AI Gateway-tilgang
vercel env pull      # henter VERCEL_OIDC_TOKEN (gyldig i 12 timer)
npm run dev
```

Legg `APP_PASSWORD` og `APP_SECRET` i `.env.local` (se `.env.example`).

## AI Gateway

AI Gateway krever et **betalingskort på Vercel-kontoen** for å låse opp de gratis kredittene (Vercel → AI). Uten kort får du meldingen «AI Gateway trenger et betalingskort». Modellen kan byttes med `AI_GATEWAY_MODEL` (standard `anthropic/claude-sonnet-5.5`).

## Miljøvariabler

| Variabel | Hva |
|---|---|
| `APP_PASSWORD` | Passordet du skriver på innloggingssiden |
| `APP_SECRET` | Tilfeldig streng (32+ tegn) som signerer innloggingen |
| `AI_GATEWAY_MODEL` | Valgfri modell, `provider/modell` |
| `AI_GATEWAY_API_KEY` | Bare utenfor Vercel; på Vercel brukes OIDC automatisk |

## Etapper

1. **Fundament** (ferdig): utseende, chat, kodeskriving, live forhåndsvisning, kodevisning, enhetsvisning, «prøv å fikse», historikk, innlogging.
2. Redigerbar kode, bildeopplasting i chatten, klikk-og-endre i forhåndsvisningen.
3. Database for prosjekter (flere enheter) og versjonsliste.
4. Publisering: GitHub-repo og Vercel-deploy med ett klikk, og Supabase/Neon koblet på automatisk.

## Publisering

«Publiser»-knappen lager et vanlig Vite-prosjekt av appen, legger det i ett commit i et GitHub-repo og deployer det til Vercel. Legg i `.env.local`:

- `GITHUB_TOKEN` (repo-tillatelse): https://github.com/settings/tokens/new?scopes=repo&description=Atelier
- `VERCEL_TOKEN`: https://vercel.com/account/tokens
- Valgfritt: `GITHUB_OWNER`, `VERCEL_TEAM_ID`

Publiserer du igjen, oppdateres samme repo og samme Vercel-prosjekt.
