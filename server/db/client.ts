import { existsSync } from "node:fs";
import pg from "pg";

// The one place that knows how to reach Postgres. Plain node-postgres over the
// standard protocol, so the same code talks to Neon, a Docker container, or
// any other Postgres; only DATABASE_URL changes.

let pool: pg.Pool | null = null;

export function databaseUrl(): string | undefined {
  const value = process.env.DATABASE_URL?.trim();
  return value ? value : undefined;
}

/**
 * Connection for migrations, dumps, and scripts. Hosted Postgres often offers a
 * pooled URL for app traffic (PgBouncer, which rejects session-level work) and a
 * direct one; `neon env pull` writes the direct one as DATABASE_URL_UNPOOLED.
 */
export function directDatabaseUrl(): string | undefined {
  const pooled = databaseUrl();
  const direct = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!pooled || !direct) return pooled;
  // Only trust the direct URL when it plainly names the same database as DATABASE_URL;
  // a stale DATABASE_URL_UNPOOLED in the environment must never redirect a script elsewhere.
  try {
    const a = new URL(pooled);
    const b = new URL(direct);
    const sameHost = a.hostname.replace("-pooler", "") === b.hostname.replace("-pooler", "");
    if (sameHost && a.pathname === b.pathname) return direct;
  } catch {
    /* fall through */
  }
  console.warn("DATABASE_URL_UNPOOLED does not match DATABASE_URL; using DATABASE_URL.");
  return pooled;
}

export function storageConfigured(): boolean {
  return databaseUrl() !== undefined;
}

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "db";
  } catch {
    return false;
  }
}

/** True in a deployed runtime (Vercel sets both) or when a developer has opted in explicitly. */
function remoteAllowed(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL === "1" || process.env.HOLOGRAPHIC_ALLOW_REMOTE_DB === "1";
}

export class RemoteDatabaseRefused extends Error {}

/** Shared connection pool, created on first use. Small on purpose: serverless functions should hold few connections. */
export function getPool(url: string | undefined = databaseUrl()): pg.Pool {
  if (pool) return pool;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!isLocal(url) && !remoteAllowed()) {
    throw new RemoteDatabaseRefused(
      `Refusing to connect to a remote database (${hostOf(url)}) outside production. ` +
        "Use the :neon scripts (npm run dev:neon, db:migrate:neon, ...) or set HOLOGRAPHIC_ALLOW_REMOTE_DB=1 to do this on purpose.",
    );
  }
  // TLS is decided below from the host; a `sslmode` query parameter would make
  // node-postgres warn about its changing semantics, so it is removed here.
  const connectionString = stripSslMode(url);
  pool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    // Hosted Postgres (Neon included) requires TLS; a local container does not offer it.
    ssl: isLocal(url) ? undefined : { rejectUnauthorized: true },
  });
  return pool;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown host";
  }
}

function stripSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return url;
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

/** Reads .env into the environment when present (variables already set win). For scripts and the local server. */
export function loadDotEnv(): void {
  if (!existsSync(".env")) return;
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    console.warn("Could not read .env:", error);
  }
}
