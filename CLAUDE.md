# Holographic — working notes for Claude Code

Read `README.md` for the vision. This file is the practical state of the project so a new session can continue without re-discovery. Update the "Where things stand" section whenever the state changes.

## What this is

One ChatGPT-style interface with two ways to begin: Chat (streams a model reply through our server) or Save (keeps a thought). Two people use it: Brennan and Maggie. Design quality is the top priority: ChatGPT-level restraint, no decoration, compact sidebar, balanced composer, app fills the viewport. Keep the current visual design and the working Chat/Save experience intact when adding anything.

## Stack and layout

- Client: Vite + React 19 + TypeScript in `src/`. Styles in `src/styles.css` (light and dark via `prefers-color-scheme`, reduced motion respected).
- Server: Hono in `server/` (`app.ts` is the app; `index.ts` runs it locally; `providers.ts` picks OpenAI or Anthropic from env; `access.ts` is the access-key gate; `chat.ts` the routes). `api/index.ts` exposes the same app as a Vercel function via `getRequestListener` (Vercel calls it Node-style; the Hono Vercel adapter hangs there, don't switch back).
- Shared: `shared/protocol.ts` (wire types), `shared/limits.ts` (24 turns / 8,000 chars per message / 32,000 per request / 2,000 output tokens).
- Data: entries live in the browser's localStorage as one versioned document (`src/lib/types.ts`, `src/lib/store.ts`). Samples in `src/lib/samples.ts` are never stored. Export/import in `src/lib/transfer.ts` matches entries by id.
- Tests: Vitest units in `src/lib/*.test.ts`; Playwright in `e2e/` using the installed Chrome (`channel: "chrome"`), on its own ports with keys blanked, plus a second "locked" server pair for the access-key flow.

## Commands

- `npm run dev` — client on :5173, API on :8787 (reads `.env`).
- `npm run check` — typecheck, unit tests, build. `npm run test:e2e` — browser tests.
- `node scripts/screenshots.mjs` — screenshots at desktop and mobile widths (needs `npm run dev` running).
- Deploy: `npx vercel@65.12.1 deploy --prod --yes` from this directory (project is linked; `.vercel/` is ignored). Pushing to GitHub does not deploy.

## Environment variables (names only; never print values)

Local `.env` (git-ignored) and Vercel Production: `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`), `HOLOGRAPHIC_MODEL` (currently gpt-6-luna), `HOLOGRAPHIC_ACCESS_KEY` (shared key the interface asks for once; Save works without it). Do not add `PORT` on Vercel.

## Accounts and places

- GitHub: `alephantic/holographic`, branch `main`. Push with `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin main` (the macOS keychain holds a stale credential for another account; `gh` is logged in as alephantic).
- Vercel: account `mbu09a-8433`, team `mbu09a-gmailcoms-projects`, project `holographic`, production URL https://holographic-five.vercel.app. Not connected to GitHub (the Vercel account lacks access to the alephantic org).

## Rules the owner has set

- Never print, log, or commit secret values. `.env`, `.env.local`, `.vercel/` stay ignored.
- Do not deploy, change production settings, create accounts or credentials, grant access, transmit manuscripts to a new service, or make paid model calls without explaining the exact step and asking first.
- Never fake a model reply. When no model is configured, say so and keep Save working.
- Work in stages; stop at the checkpoints below and report honestly what passed and what didn't.
- Inspect existing code before deciding implementation details.

## Where things stand (updated 2026-11-07)

Done and pushed (`02cd19c`): the interface, access-key gate, bounded context window for long chats (with a visible divider), per-message limit in the composer, local Export/Import. Production is still running the previous commit (`9e7ffb5`); the owner has not yet asked for a redeploy.

Agreed plan, awaiting the owner's answers before any provisioning:

1. **Stage 1, durable shared storage.** Recommended: Neon Postgres via the Vercel Marketplace (free plan, capped not metered; `DATABASE_URL` injected into the project as a secret; the server is the only database client). Access model proposed: one personal access key each for Brennan and Maggie (server maps key to person, author recorded on every entry and message), one shared studio workspace. Open questions for the owner: (a) go with Neon? (b) default visibility: everyone sees everything, or private by default with a share toggle later? (c) OK to replace the single shared key with two personal keys? Also planned: a key-protected export route for the whole studio and a restore command.
2. **Stage 2, migration.** A "Send to studio" action beside Import that uploads a browser's local entries with the same preview and id matching; local originals are never deleted; each browser must migrate itself unless exported and imported elsewhere.
3. **Checkpoint.** Report and stop before Stage 3.
4. **Stage 3, only after approval.** A small source-linked memory experiment: plain search over a small set of material from one project, answers that show the retrieved sources and separate them from the model's interpretation, tested with known answers, an outdated idea, and a question whose answer isn't in the material. No vector database.

Known gaps: assistant replies render as plain text (no Markdown); saved entries can't be edited in place; mobile checks used Chrome device emulation, not real iOS Safari.
