import type pg from "pg";
import type { ChatEntry, Entry, Library, MessageRecord } from "../../shared/entries.js";
import { getPool } from "./client.js";

// All SQL for entries and messages lives here. Everything above this file
// works with the shared Entry model and never sees a row.

interface EntryRow {
  id: string;
  kind: "chat" | "saved";
  title: string;
  body: string | null;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  entry_id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  note: string | null;
  created_at: Date;
}

function toMessage(r: MessageRow): MessageRecord {
  return { id: r.id, role: r.role, content: r.content, createdAt: r.created_at.toISOString(), ...(r.note ? { note: r.note } : {}) };
}

function assemble(entryRows: EntryRow[], messageRows: MessageRow[]): Entry[] {
  const byEntry = new Map<string, MessageRecord[]>();
  for (const m of messageRows) {
    const list = byEntry.get(m.entry_id) ?? [];
    list.push(toMessage(m));
    byEntry.set(m.entry_id, list);
  }
  return entryRows.map((r) => {
    const base = { id: r.id, title: r.title, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() };
    if (r.kind === "saved") return { ...base, kind: "saved" as const, body: r.body ?? "" };
    return { ...base, kind: "chat" as const, messages: byEntry.get(r.id) ?? [] };
  });
}

export class ConflictError extends Error {}
export class NotFoundError extends Error {}

/** Every entry, newest first, with full message history. Fine for a small studio; paginate later if needed. */
export async function listLibrary(pool: pg.Pool = getPool()): Promise<Library> {
  const entries = await pool.query<EntryRow>("select id, kind, title, body, created_at, updated_at from entries order by updated_at desc, id");
  const messages = await pool.query<MessageRow>(
    "select id, entry_id, seq, role, content, note, created_at from messages order by entry_id, seq",
  );
  return { version: 1, entries: assemble(entries.rows, messages.rows) };
}

export async function getEntry(id: string, pool: pg.Pool = getPool()): Promise<Entry | null> {
  const entries = await pool.query<EntryRow>("select id, kind, title, body, created_at, updated_at from entries where id = $1", [id]);
  if (entries.rows.length === 0) return null;
  const messages = await pool.query<MessageRow>(
    "select id, entry_id, seq, role, content, note, created_at from messages where entry_id = $1 order by seq",
    [id],
  );
  return assemble(entries.rows, messages.rows)[0] ?? null;
}

async function insertEntry(client: pg.PoolClient, entry: Entry, importedAt: Date | null): Promise<void> {
  await client.query(
    `insert into entries (id, kind, title, body, created_at, updated_at, imported_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.id, entry.kind, entry.title, entry.kind === "saved" ? entry.body : null, entry.createdAt, entry.updatedAt, importedAt],
  );
  if (entry.kind === "chat") {
    for (const [seq, m] of entry.messages.entries()) {
      await client.query(
        `insert into messages (id, entry_id, seq, role, content, note, created_at) values ($1, $2, $3, $4, $5, $6, $7)`,
        [m.id, entry.id, seq, m.role, m.content, m.note ?? null, m.createdAt],
      );
    }
  }
}

/** Creates an entry the app just made. Fails with ConflictError if the id already exists. */
export async function createEntry(entry: Entry, pool: pg.Pool = getPool()): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query("select 1 from entries where id = $1", [entry.id]);
    if (existing.rows.length > 0) throw new ConflictError(`Entry ${entry.id} already exists`);
    await insertEntry(client, entry, null);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Appends one message to a chat and bumps its updated_at. Returns the updated chat. */
export async function appendMessage(entryId: string, message: MessageRecord, pool: pg.Pool = getPool()): Promise<ChatEntry> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const entry = await client.query<{ kind: string }>("select kind from entries where id = $1 for update", [entryId]);
    if (entry.rows.length === 0) throw new NotFoundError(`Entry ${entryId} not found`);
    if (entry.rows[0]?.kind !== "chat") throw new ConflictError(`Entry ${entryId} is not a chat`);
    const dup = await client.query("select 1 from messages where id = $1", [message.id]);
    if (dup.rows.length > 0) throw new ConflictError(`Message ${message.id} already exists`);
    const next = await client.query<{ seq: number }>("select coalesce(max(seq) + 1, 0) as seq from messages where entry_id = $1", [entryId]);
    await client.query(
      `insert into messages (id, entry_id, seq, role, content, note, created_at) values ($1, $2, $3, $4, $5, $6, $7)`,
      [message.id, entryId, next.rows[0]!.seq, message.role, message.content, message.note ?? null, message.createdAt],
    );
    await client.query("update entries set updated_at = greatest(updated_at, $2::timestamptz) where id = $1", [entryId, message.createdAt]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  const updated = await getEntry(entryId, pool);
  if (!updated || updated.kind !== "chat") throw new NotFoundError(`Entry ${entryId} not found`);
  return updated;
}

/** Records why a message got no reply. */
export async function setMessageNote(entryId: string, messageId: string, note: string | null, pool: pg.Pool = getPool()): Promise<void> {
  const result = await pool.query("update messages set note = $3 where entry_id = $1 and id = $2", [entryId, messageId, note]);
  if (result.rowCount === 0) throw new NotFoundError(`Message ${messageId} not found`);
}

export async function deleteEntry(id: string, pool: pg.Pool = getPool()): Promise<boolean> {
  const result = await pool.query("delete from entries where id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export interface ImportPlan {
  added: string[];
  skipped: string[];
}

/**
 * Brings entries in from a browser export, keeping their ids and timestamps.
 * Entries whose id already exists are skipped, so the same file can be sent
 * again safely. With dryRun the plan is returned and nothing is written.
 */
export async function importEntries(entries: Entry[], dryRun: boolean, pool: pg.Pool = getPool()): Promise<ImportPlan> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const ids = [...new Set(entries.map((e) => e.id))];
    const existing = new Set(
      (await client.query<{ id: string }>("select id from entries where id = any($1::text[])", [ids])).rows.map((r) => r.id),
    );
    const seen = new Set<string>();
    const plan: ImportPlan = { added: [], skipped: [] };
    const now = new Date();
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      if (existing.has(entry.id)) {
        plan.skipped.push(entry.id);
        continue;
      }
      plan.added.push(entry.id);
      if (!dryRun) await insertEntry(client, entry, now);
    }
    await client.query(dryRun ? "rollback" : "commit");
    return plan;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function countEntries(pool: pg.Pool = getPool()): Promise<number> {
  const r = await pool.query<{ n: string }>("select count(*)::text as n from entries");
  return Number(r.rows[0]?.n ?? 0);
}
