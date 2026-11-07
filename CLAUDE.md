# Holographic — working notes for Claude Code

Read `README.md` for the vision. This file is the practical state of the project so a new session can continue without re-discovery. Update the "Where things stand" section whenever the state changes.

## What this is

One ChatGPT-style interface with two ways to begin: Chat (streams a model reply through our server) or Save (keeps a thought). Two people use it: Brennan and Maggie. Design quality is the top priority: ChatGPT-level restraint, no decoration, compact sidebar, balanced composer, app fills the viewport. Keep the current visual design and the working Chat/Save experience intact when adding anything.

## Stack and layout

- Client: Vite + React 19 + TypeScript in `src/`. Styles in `src/styles.css` (light and dark via `prefers-color-scheme`, reduced motion respected).
- Server: Hono in `server/` (`app.ts` is the app; `index.ts` runs it locally; `providers.ts` picks OpenAI or Anthropic from env; `access.ts` is the access-key gate; `chat.ts` the routes). `api/index.ts` exposes the same app as a Vercel function via `getRequestListener` (Vercel calls it Node-style; the Hono Vercel adapter hangs there, don't switch back).
- Shared: `shared/protocol.ts` (wire types), `shared/limits.ts` (24 turns / 8,000 chars per message / 32,000 per request / 2,000 output tokens).
- Data model: `shared/entries.ts` (types, validators, size caps). Two stores: the browser's localStorage document (`src/lib/store.ts`, always present, never deleted by the app) and, when `DATABASE_URL` is set, the shared "studio" in PostgreSQL. The client (`src/lib/studio.ts`, `src/App.tsx`) uses the studio when the server has storage and the browser is unlocked, otherwise the browser store. Samples in `src/lib/samples.ts` are never stored. Export/import in `src/lib/transfer.ts` matches entries by id.
- Retrieval (source-linked memory experiment): `server/retrieval.ts` (Postgres full-text search over saved entries, verbatim passages framed as source material in the system prompt, bounded by `shared/limits.ts`), wired into `server/chat.ts` when storage is configured; `GET /api/search?q=` for inspection; sources stored on assistant messages (`messages.sources`, migration 0002) and shown as chips in `ChatView`. Details in `db/README.md`.
- Project memory (first experiment, local only until deployed): `server/memory.ts` (capture prompt, deterministic validation: assistant words and quoted text can never be decisions; verbatim quote required), `server/db/memories.ts` (projects, memories with supersede chain, memory_events; migration 0003), `server/memories.ts` (routes: /api/project, /api/project/capture, /api/memories/:id/accept|reject|correct|history), accepted memories go to every chat as a labelled block (`[MD1]`, `[MO1]`) via `server/chat.ts`, cited labels stored on `messages.memory_refs`. Client: `MemoryView.tsx`, "Remember this chat" in `ChatView`, memory chips, sidebar "Project memory". `HOLOGRAPHIC_TEST_PROVIDER=1` enables a deterministic test model (never in production).
- Storage layer: `server/db/client.ts` (pg Pool from `DATABASE_URL`, TLS for non-local hosts, plain node-postgres, nothing Neon-specific), `server/db/migrate.ts` (applies `db/migrations/*.sql` once each), `server/db/repository.ts` (all SQL), `server/entries.ts` (routes under /api: entries, messages, import with dryRun, export). Docs in `db/README.md`. Local Postgres: `docker-compose.yml` on port 5433 (5432 is taken by a Homebrew Postgres 14 on this machine; its `pg_dump` is too old for the container, use `docker compose exec -T db pg_dump`).
- Tests: Vitest units in `src/lib/*.test.ts`; Playwright in `e2e/` using the installed Chrome (`channel: "chrome"`), on its own ports with keys blanked, plus a "locked" server pair for the access-key flow, plus a "studio" project against real Postgres that runs only when `HOLOGRAPHIC_TEST_DATABASE_URL` is set (use `postgres://holographic:holographic@localhost:5433/holographic_test` after `npm run db:up`; its global setup migrates and truncates that database).

## Commands

- `npm run dev` — client on :5173, API on :8787, always against the local Docker database (port 5433) whatever `.env` says. `npm run dev:neon` uses `.env` (Neon) with remote access allowed; `npm run dev:browser` uses no database. Same pattern for `db:migrate`, `db:export -- f.json`, `db:restore -- f.json` and their `:neon` variants (`scripts/with-db.mjs`). The server refuses a remote database unless NODE_ENV=production, VERCEL=1, or HOLOGRAPHIC_ALLOW_REMOTE_DB=1.
- `npm run check` — typecheck, unit tests, build. `npm run test:e2e` — browser tests.
- `node scripts/screenshots.mjs` — screenshots at desktop and mobile widths (needs `npm run dev` running).
- Deploy: `npx vercel@65.12.1 deploy --prod --yes` from this directory (project is linked; `.vercel/` is ignored). Pushing to GitHub does not deploy.

## Environment variables (names only; never print values)

Local `.env` (git-ignored) and Vercel Production: `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`), `HOLOGRAPHIC_MODEL` (currently gpt-6-luna), `HOLOGRAPHIC_ACCESS_KEY` (shared key the interface asks for once; it also gates all storage routes), `DATABASE_URL` (optional; unset means browser-only storage). Do not add `PORT` on Vercel.

## Accounts and places

- GitHub: `alephantic/holographic`, branch `main`. Push with `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin main` (the macOS keychain holds a stale credential for another account; `gh` is logged in as alephantic).
- Vercel: account `mbu09a-8433`, team `mbu09a-gmailcoms-projects`, project `holographic`, production URL https://holographic-five.vercel.app. Not connected to GitHub (the Vercel account lacks access to the alephantic org).
- Neon: org `org-sparkling-snow-75219709` ("Holographic", Free plan), project `super-boat-79001807`, branch `production`, database `neondb`, schema migrated. `.neon` (ignored) pins it; `neon.ts` declares only Postgres. The Neon CLI (`neon`, v9) needs Node ≥ 22.20: use `nvm use 22.23.4` (the default shell Node is still 22.15.0). `neon deploy` pulls `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` into `.env`, so local `npm run dev` currently talks to Neon; point `DATABASE_URL` at the Docker container (port 5433) to work locally instead. Neon agent skills are installed under `.claude/skills/` (uncommitted; owner to decide).

## Rules the owner has set

- Never print, log, or commit secret values. `.env`, `.env.local`, `.vercel/` stay ignored.
- Do not deploy, change production settings, create accounts or credentials, grant access, transmit manuscripts to a new service, or make paid model calls without explaining the exact step and asking first.
- Never fake a model reply. When no model is configured, say so and keep Save working.
- Work in stages; stop at the checkpoints below and report honestly what passed and what didn't.
- Inspect existing code before deciding implementation details.

## Where things stand (updated 2026-11-07, project memory prepared for a small live test; not deployed)

Production (commit `212b3c6` deployed; migrations 0001–0002 on Neon) runs studio storage, the shared key, and source-linked search. Five Princhetta pages live there and must not be touched. The Hindsight comparison lives in `../hindsight-experiment/` (container stopped, volume kept).

Built and tested locally, **not deployed, migration 0003 not on Neon**: project memory (capture, review, recall, corrections with history) with a visible, predictable memory limit (4,000 chars; decisions first, newest first; omitted count told to the model, shown under replies, and marked in the Project memory view), a shared-project scope note, and pasted-text handling (quotation marks, or an introduction such as "page …:" / "from the manuscript:"). Rollback: `db/rollback/0003_project_memory.down.sql` (by hand). Tests: 41 unit, 56 browser on fixtures with the test provider; one real-model capture/recall on a fixture locally.

To go live, with the owner's approval: `npm run db:migrate:neon` (0003, additive) → `npx vercel@65.12.1 deploy --prod --yes` → "Remember this chat" on a real conversation, review, then ask a fresh chat where the project stands. Costs: one model call per capture (cents), plus up to 4,000 extra characters per chat request.

Known limits: one shared project; no relevance ranking (fixed order, cap); model judgement decides what is proposed and how it is worded; pasted text with neither quotation marks nor an introduction is not recognised as quoted; no Markdown in replies; saved entries not editable in place.
