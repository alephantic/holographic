import pg from "pg";
import { migrate } from "../server/db/migrate";

function isLocalHost(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * The suite truncates its database, so it must never be pointed at a real one:
 * the database name has to end in _test, and a remote host needs an explicit opt-in.
 */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run tests against database "${name}": test databases must be named *_test (they get truncated).`);
  }
  if (!isLocalHost(url) && process.env.HOLOGRAPHIC_ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error("Refusing to run tests against a remote database without HOLOGRAPHIC_ALLOW_REMOTE_TEST_DB=1.");
  }
}

// Prepares the test database: same migrations as everywhere else, then empty tables.
export default async function globalSetup() {
  const url = process.env.HOLOGRAPHIC_TEST_DATABASE_URL;
  if (!url) return;
  assertTestDatabase(url);
  const pool = new pg.Pool({ connectionString: url, ssl: isLocalHost(url) ? undefined : { rejectUnauthorized: true } });
  try {
    await migrate(pool);
    await pool.query("truncate memory_events, memories, projects, messages, entries");
  } finally {
    await pool.end();
  }
}
