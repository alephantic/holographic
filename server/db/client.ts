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
  const value = process.env.DATABASE_URL_UNPOOLED?.trim();
  return value ? value : databaseUrl();
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

/** Shared connection pool, created on first use. Small on purpose: serverless functions should hold few connections. */
export function getPool(url: string | undefined = databaseUrl()): pg.Pool {
  if (pool) return pool;
  if (!url) throw new Error("DATABASE_URL is not set");
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
