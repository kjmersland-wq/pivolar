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
| 1 Accounts, server-side projects, dashboard | A database and an auth service (decision needed: for example Neon + Auth.js/Clerk, or Supabase) | **blocked on provider choice**; the single-user dashboard is extended in phase 2 |
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
