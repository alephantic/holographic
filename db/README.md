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

## Local database with Docker

```bash
npm run db:up                 # starts postgres:17 with a persistent volume
npm run db:migrate            # creates the tables
npm run dev                   # with DATABASE_URL set in .env (see .env.example)
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

## Access

All storage routes sit behind the same access key as Chat (`HOLOGRAPHIC_ACCESS_KEY`). The database credential never leaves the server. Individual identity (who made an entry) is not implemented yet; the `author` columns are there for it.
