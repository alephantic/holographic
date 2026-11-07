import pg from "pg";
import { migrate } from "../server/db/migrate";

// Prepares the test database: same migrations as everywhere else, then empty tables.
export default async function globalSetup() {
  const url = process.env.HOLOGRAPHIC_TEST_DATABASE_URL;
  if (!url) return;
  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(pool);
    await pool.query("truncate messages, entries");
  } finally {
    await pool.end();
  }
}
