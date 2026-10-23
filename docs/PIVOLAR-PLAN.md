# Pivolar: audit and plan

Audit date: 2026-10-23. Scope: the repository in `H:\atelier` (folder name is historical).

## 1. Current state (Phase 0 audit)

| Area | What exists |
| --- | --- |
| Framework | Next.js 16.4.2 (App Router, Cache Components, `src/proxy.ts`), React 19, Tailwind 4, TypeScript |
| Package manager | npm (`package-lock.json`) |
| Auth | Single owner. `APP_PASSWORD` (+ optional `APP_EMAIL`), `APP_SECRET` signs an HS256 JWT cookie (`jose`). `proxy.ts` gates every route except `/login` |
| Project storage | Browser `localStorage` only (project list, chat messages, user edits, publish info). No server-side projects, no database |
| AI | Vercel AI SDK 7. Direct `ANTHROPIC_API_KEY` or AI Gateway. One provider path in `api/chat/route.ts` |
| Workspace | Chat, Sandpack preview (React + Tailwind CDN only), editable code view, click-to-edit with direct edit panel (no AI), compose-from-sections dialog |
| Publishing | `api/publish`: generated Vite project, GitHub REST (one commit), Vercel REST deployment. Needs `GITHUB_TOKEN`, `VERCEL_TOKEN` |
| Payments | None |
| Tests | `npm test`: direct-edit (12 cases), compose and palette (14 checks) |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities |

### Must be preserved
Chat building, Sandpack preview, inspector, direct edit panel, compose dialog, publish dialog, login, project list.

### Known limits and risks
- **Single user, browser storage.** Not multi-tenant. `localStorage` holds roughly 5 MB, which caps project size. Clearing the browser deletes projects.
- **Preview is Sandpack.** It runs only simple React + Tailwind projects. Imported Next.js, WordPress or Joomla projects cannot be previewed.
- **Tokens for GitHub/Vercel are server env vars** of a single owner, which is fine for one person and wrong for public users (needs a GitHub App and per-user OAuth).
- **No isolated execution.** Nothing runs imported code yet. Builds and tests of untrusted projects must never run in the Next.js server. They need a sandbox (Vercel Sandbox or a container service).
- **Anthropic terms.** Public, multi-user use of the AI features needs an API key under Anthropic's commercial terms. A Claude Code subscription must not be assumed to cover it.

## 2. Phases and what blocks them

| Phase | Needs | Status |
| --- | --- | --- |
| 0 Audit | none | done (this document) |
| 1 Accounts, server-side projects, dashboard | **Supabase** (database, auth and storage in one). Chosen 2026-10-23 as the cheapest: one vendor and one bill, 50,000 monthly users included in the free plan, Pro from about USD 25 a month for everything. Neon + Clerk would be two vendors and two bills. Free projects pause after a week without use, and the free plan allows two projects | **implemented 2026-10-23**: Supabase project `pivolar`, migration applied, owner login through Supabase Auth, projects mirrored to the account (see section 5). Still open: public sign-up (off), per-user quotas, audit log writes |
| 2 ZIP import, analysis, full export | none | **implemented now** |
| 3 GitHub import, branches, diffs | A GitHub App (client id, private key, webhook secret) created by the owner | next |
| 4 AI editing on imported code, isolated builds, tests, rollback | Sandbox runtime | after 3 |
| 5 Deployment adapters (Vercel, Cloudflare) | Cloudflare API token | partly exists (Vercel) |
| 6 Stripe and Paddle modules and wizards | Test-mode accounts | after 5 |
| 7 to 10 WordPress and Joomla | Sample sites and database dumps for real tests | later |
| 11 SaaS billing, quotas, hardening | Phase 1 | last |

Order change: phase 2 was done before phase 1, because it needs no new infrastructure and is useful for the single owner today. Phase 1 stays blocked until a database and auth provider are chosen.

## 3. Phase 2 design (implemented)

- **Import** (`/api/import/zip`, behind the login gate): the archive is read in memory, never written to disk and never executed.
  - Rejects: absolute paths, `..` segments, backslashes, drive letters, NUL bytes, over 2,000 entries, any entry over 1 MB or an archive over 8 MB unpacked, and suspicious compression ratios. The size check happens before decompression, using the sizes declared in the archive.
  - Skips with a note: `node_modules`, `.git`, build output, binary files (images, fonts, archives), lockfiles over the limit.
  - Secrets: `.env*` files and files with key-like contents are not imported. They are listed in the report.
- **Analysis**: framework, package manager, scripts, services (database, auth, payments), environment variables, risks, and whether the preview can run it.
- **Export** (`/api/export`): a ZIP with the project files, a generated `.env.example`, `README`, `PIVOLAR-MANIFEST.json` (included, omitted, manual steps) and `EXPORT-REPORT.md`. Secrets are never included: matching files are omitted and matching values redacted. Two modes: the files as they are, or a ready Vite project (for apps generated in Pivolar).
- **Limits (stated, not hidden):** binary assets are not stored in Pivolar yet, so images in an imported project are listed in the manifest as needing to be copied back by hand. Total stored text is capped at about 3 MB until projects move to a database (phase 1).

## 4. Phase 1 prerequisites (Supabase)

1. A new Supabase project for Pivolar (free plan allows two; the unused `volumcalc-db` can be paused or deleted to free one).
2. Environment variables in `.env.local` and in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public by design) and `SUPABASE_SERVICE_ROLE_KEY` (server only, never in browser code).
3. Plan: tables `projects`, `project_files`, `audit_log`, `usage`, each with row-level security so a user can only read and write rows where `owner_id = auth.uid()`. The server checks ownership again on every request. Existing single-user projects are moved from browser storage by an explicit "Flytt til konto" step, never silently.
4. Before the public launch: replace the single-owner password with Supabase Auth (email and password, magic link), and turn on rate limits.

## 5. Phase 1 as built

- **Login:** Supabase Auth (email and password). `src/proxy.ts` accepts a session only for addresses in `APP_EMAIL`, so the app stays private even though Supabase sign-ups are also switched off.
- **Storage model:** the browser's `localStorage` stays the fast working copy and the app code is unchanged. `src/lib/sync.ts` mirrors it to the account through `/api/sync` (row-level security, session client, no service role in the request path).
  - A local change bumps `rev`; it is sent after 1.5 s. `syncedRev` and `remoteAt` (the server's timestamp) are stored per project, so neither side depends on clocks agreeing.
  - On start and on window focus the browser pulls projects it does not have, or whose account copy changed while it has no unsent changes. If both sides changed, the local change wins and is sent.
  - Deletes go to a pending list first, so a failed delete cannot bring the project back on the next pull.
- **Moving old projects:** projects with a `p_` id are moved only when the user presses "Flytt til konto" on the home page. Each is uploaded first and renamed locally only after the account has it.
- **Limits:** one request carries a whole project and must stay under 4 MB (Vercel's body limit); larger ones are refused with a clear message. Pictures in chats are still not stored. Two devices editing the same project at the same moment resolve as last writer wins.
