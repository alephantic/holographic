# Holographic — working notes for Claude Code

Read `README.md` for the vision. This file is the practical state of the project so a new session can continue without re-discovery. Update the "Where things stand" section whenever the state changes.

## What this is

One ChatGPT-style interface with two ways to begin: Chat (streams a model reply through our server) or Save (keeps a thought). Two people use it: Brennan and Maggie. Design quality is the top priority: ChatGPT-level restraint, no decoration, compact sidebar, balanced composer, app fills the viewport. Keep the current visual design and the working Chat/Save experience intact when adding anything.

## Stack and layout

- Client: Vite + React 19 + TypeScript in `src/`. Styles in `src/styles.css` (light and dark via `prefers-color-scheme`, reduced motion respected).
- Server: Hono in `server/` (`app.ts` is the app; `index.ts` runs it locally; `providers.ts` picks OpenAI or Anthropic from env; `access.ts` is the access-key gate; `chat.ts` the routes). `api/index.ts` exposes the same app as a Vercel function via `getRequestListener` (Vercel calls it Node-style; the Hono Vercel adapter hangs there, don't switch back).
- Shared: `shared/protocol.ts` (wire types), `shared/limits.ts` (24 turns / 8,000 chars per message / 32,000 per request / 2,000 output tokens).
- Data model: `shared/entries.ts` (types, validators, size caps). Two stores: the browser's localStorage document (`src/lib/store.ts`, always present, never deleted by the app) and, when `DATABASE_URL` is set, the shared "studio" in PostgreSQL. The client (`src/lib/studio.ts`, `src/App.tsx`) uses the studio when the server has storage and the browser is unlocked, otherwise the browser store. Samples in `src/lib/samples.ts` are never stored. Export/import in `src/lib/transfer.ts` matches entries by id.
- Storage layer: `server/db/client.ts` (pg Pool from `DATABASE_URL`, TLS for non-local hosts, plain node-postgres, nothing Neon-specific), `server/db/migrate.ts` (applies `db/migrations/*.sql` once each), `server/db/repository.ts` (all SQL), `server/entries.ts` (routes under /api: entries, messages, import with dryRun, export). Docs in `db/README.md`. Local Postgres: `docker-compose.yml` on port 5433 (5432 is taken by a Homebrew Postgres 14 on this machine; its `pg_dump` is too old for the container, use `docker compose exec -T db pg_dump`).
- Tests: Vitest units in `src/lib/*.test.ts`; Playwright in `e2e/` using the installed Chrome (`channel: "chrome"`), on its own ports with keys blanked, plus a "locked" server pair for the access-key flow, plus a "studio" project against real Postgres that runs only when `HOLOGRAPHIC_TEST_DATABASE_URL` is set (use `postgres://holographic:holographic@localhost:5433/holographic_test` after `npm run db:up`; its global setup migrates and truncates that database).

## Commands

- `npm run dev` — client on :5173, API on :8787 (reads `.env`). `npm run db:up` / `db:migrate` / `db:export -- f.json` / `db:restore -- f.json` for the local database.
- `npm run check` — typecheck, unit tests, build. `npm run test:e2e` — browser tests.
- `node scripts/screenshots.mjs` — screenshots at desktop and mobile widths (needs `npm run dev` running).
- Deploy: `npx vercel@65.12.1 deploy --prod --yes` from this directory (project is linked; `.vercel/` is ignored). Pushing to GitHub does not deploy.

## Environment variables (names only; never print values)

Local `.env` (git-ignored) and Vercel Production: `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`), `HOLOGRAPHIC_MODEL` (currently gpt-6-luna), `HOLOGRAPHIC_ACCESS_KEY` (shared key the interface asks for once; it also gates all storage routes), `DATABASE_URL` (optional; unset means browser-only storage). Do not add `PORT` on Vercel.

## Accounts and places

- GitHub: `alephantic/holographic`, branch `main`. Push with `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin main` (the macOS keychain holds a stale credential for another account; `gh` is logged in as alephantic).
- Vercel: account `mbu09a-8433`, team `mbu09a-gmailcoms-projects`, project `holographic`, production URL https://holographic-five.vercel.app. Not connected to GitHub (the Vercel account lacks access to the alephantic org).

## Rules the owner has set

- Never print, log, or commit secret values. `.env`, `.env.local`, `.vercel/` stay ignored.
- Do not deploy, change production settings, create accounts or credentials, grant access, transmit manuscripts to a new service, or make paid model calls without explaining the exact step and asking first.
- Never fake a model reply. When no model is configured, say so and keep Save working.
- Work in stages; stop at the checkpoints below and report honestly what passed and what didn't.
- Inspect existing code before deciding implementation details.

## Where things stand (updated 2026-11-07, storage foundation checkpoint)

Built and tested locally, not yet deployed; production still runs `9e7ffb5` (browser-only storage, shared access key):

- PostgreSQL storage foundation: schema + migration runner, repository, key-protected routes, client "studio" mode with browser fallback, "Send to studio" migration (preview, id matching, originals kept), server export route, `db:export`/`db:restore` scripts, Docker Compose local database. Independence test done: export from one database, restore twice into a fresh one, identical content hashes; pg_dump round trip.
- Decided: PostgreSQL, Neon for the deployed app first, local Docker Postgres, tested path away from Neon. Cassandra stays a possible future experiment; not implemented. The memory experiment comes after this foundation is reviewed.

Awaiting the owner at the checkpoint:

1. **Access model** (not implemented; ask before implementing): per-person access keys mapped server-side to "Brennan" / "Maggie" with `author` recorded on entries and messages, in one shared studio; the open choice is default visibility (everyone sees everything vs. private by default with a share toggle). Until decided, the single shared key gates everything and `author` stays null.
2. **Neon provisioning** (do not do without approval): Vercel dashboard → Storage → Create Database → Neon (free plan) → connect to project `holographic` → run `npm run db:migrate` with the injected connection string → then redeploy. Expected cost $0 (free plan is capped, not metered).
3. **Deploy** of the current commit when asked; migrate real browser data only when asked (each browser sends its own entries, or export/import).

Known gaps: assistant replies render as plain text (no Markdown); saved entries can't be edited in place; mobile checks used Chrome device emulation, not real iOS Safari; studio writes are optimistic (the hint reports a failed write but the view keeps what was typed).
