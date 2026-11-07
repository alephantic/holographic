import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { closePool, directDatabaseUrl, getPool, loadDotEnv } from "./client.js";

// Applies db/migrations/*.sql in name order, once each, recording what ran in
// schema_migrations. The same files run locally (Docker) and in production.

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../../db/migrations");

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function migrate(pool: pg.Pool = getPool(directDatabaseUrl())): Promise<MigrationResult> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  try {
    await client.query(
      "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set((await client.query<{ version: string }>("select version from schema_migrations")).rows.map((r) => r.version));
    const applied: string[] = [];
    const alreadyApplied: string[] = [];
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (done.has(version)) {
        alreadyApplied.push(version);
        continue;
      }
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (version) values ($1)", [version]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${version} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      applied.push(version);
    }
    return { applied, alreadyApplied };
  } finally {
    client.release();
  }
}

// Run directly: `npm run db:migrate`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadDotEnv();
  migrate()
    .then((r) => {
      for (const v of r.alreadyApplied) console.log(`already applied  ${v}`);
      for (const v of r.applied) console.log(`applied          ${v}`);
      if (r.applied.length === 0) console.log("Schema is up to date.");
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}
