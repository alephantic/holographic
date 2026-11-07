# Holographic storage

Holographic's shared storage is ordinary PostgreSQL. The deployed app can point at Neon; the same code runs against a Postgres container on your machine or any other Postgres. Nothing in the code is Neon-specific: the server uses the standard `pg` driver over the normal Postgres protocol, so switching providers means changing `DATABASE_URL` and moving the data.

When `DATABASE_URL` is not set, the app behaves as before: entries stay in each browser's local storage.

## Schema

Defined in `db/migrations/0001_entries_and_messages.sql`.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `entries` | One row per saved thought or chat | `id` (text, the same id the browser made), `kind` (`saved` or `chat`), `title`, `body` (saved thoughts only), `created_at`, `updated_at`, `imported_at` (set when brought in from a browser export), `author` (reserved for the access model, null for now) |
| `messages` | Ordered messages of a chat | `id`, `entry_id`, `seq` (0-based position, unique per chat), `role`, `content`, `note` (why a message got no reply), `created_at`, `author` |
| `schema_migrations` | Which migration files have run | `version`, `applied_at` |

Every message is kept in full. Only a bounded recent window is sent to the model (`shared/limits.ts`); that is a request-time choice, not a storage one.

## Migrations

Migrations are plain SQL files in `db/migrations/`, applied in name order by `npm run db:migrate`, each inside a transaction and recorded in `schema_migrations`. Running the command again is harmless. To change the schema, add a new numbered file; never edit one that has run somewhere.

```bash
npm run db:migrate            # uses DATABASE_URL from the environment or .env
DATABASE_URL=... npm run db:migrate   # a specific database
```

## Which database am I talking to?

Routine commands never reach a hosted database by accident:

| Command | Database |
| --- | --- |
| `npm run dev`, `npm run db:migrate`, `db:export`, `db:restore` | The local Docker container on port 5433, always, whatever `.env` says |
| `npm run dev:browser` | None: entries stay in the browser |
| `npm run dev:neon`, `db:migrate:neon`, `db:export:neon`, `db:restore:neon` | Whatever `DATABASE_URL` in `.env` says (Neon after `neon deploy`), with remote access explicitly allowed |

The server refuses to open a connection to a non-local host unless it is running in production (Vercel) or `HOLOGRAPHIC_ALLOW_REMOTE_DB=1` is set, which the `:neon` scripts do for you. Running `tsx server/index.ts` by hand with a Neon URL in `.env` therefore exits with a message instead of connecting.

The browser-test suite truncates its database on every run, so it accepts only databases whose name ends in `_test`, and a remote one only with `HOLOGRAPHIC_ALLOW_REMOTE_TEST_DB=1`. To run it against Neon on purpose, create a `holographic_test` database on the branch, point `HOLOGRAPHIC_TEST_DATABASE_URL` at it with that flag set, and drop the database afterwards. It can never run against `neondb`.

## Local database with Docker

```bash
npm run db:up                 # starts postgres:17 with a persistent volume
npm run db:migrate            # creates the tables
npm run dev                   # talks to the container regardless of .env
```

Data lives in the Docker volume `holographic-pgdata` and survives `npm run db:down`. To start from nothing: `docker compose down -v`. The container listens on port 5433 (not 5432) so it never collides with a Postgres already installed on the machine; set `HOLOGRAPHIC_DB_PORT` to change that, and keep `DATABASE_URL` in step. The container's password is for local use only.

## Export and restore

Two formats, for two purposes.

- **Holographic export (JSON).** The same file the browser's Export produces. From the server: `GET /api/export` (needs the access key when one is set), or `npm run db:export -- backup.json`. Restore with `npm run db:restore -- backup.json`, which adds entries whose ids are missing and leaves existing ones untouched, so it can be run repeatedly. The browser's Import reads the same file, so a database export can also be loaded into a browser.
- **Full Postgres dump.** `pg_dump "$DATABASE_URL" > holographic.sql` and `psql "$DATABASE_URL" < holographic.sql`. Use this when moving the whole database between providers; it carries every row, including `schema_migrations`. `pg_dump` must be at least as new as the server; if the one on your machine is older (Homebrew's 14 against the container's 17, for example), use the container's: `docker compose exec -T db pg_dump -U holographic holographic > holographic.sql`.

## Moving away from Neon (or to it)

1. Create the destination database and run `npm run db:migrate` against it.
2. Either `npm run db:restore` with a JSON export, or restore a `pg_dump`.
3. Point `DATABASE_URL` at the destination. No code changes.

Neon requires TLS; the client turns it on for any non-local host. A self-hosted Postgres reachable over the internet should also use TLS (`?sslmode=require`).

Hosted providers often give two connection strings: a pooled one (PgBouncer, for the app's request traffic) and a direct one. The app uses `DATABASE_URL`; migrations and the export/restore scripts use `DATABASE_URL_UNPOOLED` when it is set, since pooled connections reject the session-level work migrations need. With a single plain Postgres, set only `DATABASE_URL`.

## Access

All storage routes sit behind the same access key as Chat (`HOLOGRAPHIC_ACCESS_KEY`). The database credential never leaves the server. Individual identity (who made an entry) is not implemented yet; the `author` columns are there for it.

## Source-linked memory (first experiment)

When studio storage is configured, every chat question is also run as a search over the saved entries, server-side, inside the same key-protected chat route (`server/retrieval.ts`):

1. PostgreSQL full-text search (`to_tsvector('english', title || ' ' || body)`) is matched against the question. First every meaningful word must match (`websearch_to_tsquery`); if nothing matches, any word may (`to_tsquery` with `|`), keeping only pages that rank at least a third as well as the best one. Ranking is `ts_rank_cd` normalised by document length. No embeddings, no external service, no index yet (fine for a handful of pages; add a GIN index on that expression when the corpus grows).
2. At most 3 entries are quoted verbatim (3,000 characters each, 6,000 in total, cut with a visible marker) into the system prompt inside `<<< SOURCE n: page 5 — "title" (entry id) >>>` blocks, after rules that say the passages are source material rather than instructions, that the model should name the page it draws on, keep the text's words apart from its own reading, and say when the passages don't support an answer. When nothing matches, the prompt says so and forbids inventing a citation.
3. The stream's first event lists the sources that were quoted (`{type: "sources"}`), the reply records them on the assistant message (`messages.sources`, migration 0002), and the interface shows them as clickable chips that open the saved entry. An empty list is shown as "No saved pages matched this question."

Page numbers come only from the entry's heading (`… — Page 5`); an entry without one is labelled by its title. `GET /api/search?q=` (key required) shows what a question would retrieve. Nothing from a reply is ever written back into a saved entry, and nothing is remembered across chats beyond what is stored in the chat itself.

## Project memory (first experiment)

Tables from migration 0003: `projects` (one row, `default`, for now), `memories`, and `memory_events`; plus `messages.memory_refs`, the accepted memories an assistant reply cited.

A memory is a one-sentence **decision** or **open** item (idea or question), tied to one source message by `source_entry_id`, `source_message_id`, and a verbatim `source_quote`. `attributed_to` records whose words the quote is: `person`, `assistant`, or `quoted` (text the person pasted, such as a story page). `status` is `suggested` until someone accepts or rejects it; a correction to an accepted memory inserts a new accepted row with `supersedes` pointing at the old one, which becomes `superseded`. `original_text` never changes, and every step is a row in `memory_events`.

How it moves: "Remember this chat" (`POST /api/project/capture`) sends the conversation, with message ids, to the model and asks for candidates as JSON (one model call). The server then validates each one: the message must exist, the quote must appear verbatim in it, and whoever said it decides what it may be. The assistant's words and quoted text can never become a decision; they are kept as open items, labelled "AI suggestion" or "quoted text", with the adjustment noted in the capture response. Only accepted memories reach a chat: they are given to the model in a labelled block (`[MD1] DECISION: …`, `[MO1] OPEN: …`, with the source entry and attribution), capped at 4,000 characters, with rules to keep decisions apart from open questions, to cite labels, to say when something isn't established, and to mark any next step as a suggestion. The labels a reply cites are stored on the message and shown as chips.

Routes (key required): `GET /api/project`, `POST /api/project/capture`, `POST /api/memories/:id/accept|reject|correct`, `GET /api/memories/:id/history`. `HOLOGRAPHIC_TEST_PROVIDER=1` (never in production) swaps in a deterministic model for tests.

Where a retrieval component such as Hindsight could fit later: behind `server/retrieval.ts` (which pages to quote) and, separately, behind the capture step (which passages to propose from). Holographic's own records stay the source of truth either way; a replacement would only change how candidates and passages are found, not where they are stored or how they are reviewed.
