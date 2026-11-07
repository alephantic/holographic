// Export the database as a Holographic JSON file, or restore one into it.
//   npm run db:export -- backup.json
//   npm run db:restore -- backup.json
// Restore adds entries whose ids are missing and skips the rest, so it is safe to repeat.
import { readFile, writeFile } from "node:fs/promises";
import { closePool, loadDotEnv, storageConfigured } from "../server/db/client.js";
import { importEntries, listLibrary } from "../server/db/repository.js";
import { isEntry } from "../shared/entries.js";

const [command, file] = process.argv.slice(2);

async function main() {
  loadDotEnv();
  if (!storageConfigured()) throw new Error("DATABASE_URL is not set");
  if (command === "export") {
    if (!file) throw new Error("Usage: npm run db:export -- <file.json>");
    const library = await listLibrary();
    const doc = { format: "holographic-export", version: 1, exportedAt: new Date().toISOString(), library };
    await writeFile(file, JSON.stringify(doc, null, 2));
    console.log(`Exported ${library.entries.length} entries to ${file}`);
    return;
  }
  if (command === "restore") {
    if (!file) throw new Error("Usage: npm run db:restore -- <file.json>");
    const raw = JSON.parse(await readFile(file, "utf8")) as { library?: { entries?: unknown[] }; entries?: unknown[] };
    const list = raw.library?.entries ?? raw.entries;
    if (!Array.isArray(list)) throw new Error("That file isn't a Holographic export");
    const entries = list.filter(isEntry).filter((e) => !e.sample);
    const dropped = list.length - entries.length;
    const plan = await importEntries(entries, false);
    console.log(`Restored ${plan.added.length} entries; ${plan.skipped.length} already present${dropped ? `; ${dropped} skipped as malformed or sample` : ""}.`);
    return;
  }
  throw new Error("Usage: db-transfer export|restore <file.json>");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
