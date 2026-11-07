import type pg from "pg";
import type { Attribution, Memory, MemoryEvent, MemoryKind, MemoryStatus, Project } from "../../shared/memory.js";
import { getPool } from "./client.js";
import { ConflictError, NotFoundError } from "./repository.js";

// All SQL for project memory. One project is enough for the first experiment;
// `ensureProject` creates it on first use.

export const DEFAULT_PROJECT: Project = { id: "default", name: "Project" };

interface MemoryRow {
  id: string;
  project_id: string;
  kind: MemoryKind;
  status: MemoryStatus;
  text: string;
  original_text: string;
  attributed_to: Attribution;
  proposed_by: "model" | "person";
  source_entry_id: string | null;
  source_entry_title: string | null;
  source_message_id: string | null;
  source_quote: string | null;
  supersedes: string | null;
  superseded_by: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `m.id, m.project_id, m.kind, m.status, m.text, m.original_text, m.attributed_to, m.proposed_by,
  m.source_entry_id, e.title as source_entry_title, m.source_message_id, m.source_quote, m.supersedes,
  (select n.id from memories n where n.supersedes = m.id limit 1) as superseded_by, m.note, m.created_at, m.updated_at`;
const FROM = "from memories m left join entries e on e.id = m.source_entry_id";

function toMemory(r: MemoryRow): Memory {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    status: r.status,
    text: r.text,
    originalText: r.original_text,
    attributedTo: r.attributed_to,
    proposedBy: r.proposed_by,
    source: {
      entryId: r.source_entry_id,
      ...(r.source_entry_title ? { entryTitle: r.source_entry_title } : {}),
      messageId: r.source_message_id,
      quote: r.source_quote,
    },
    supersedes: r.supersedes,
    supersededBy: r.superseded_by,
    note: r.note,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function ensureProject(project: Project = DEFAULT_PROJECT, pool: pg.Pool = getPool()): Promise<Project> {
  await pool.query("insert into projects (id, name) values ($1, $2) on conflict (id) do nothing", [project.id, project.name]);
  return project;
}

export async function listMemories(projectId: string, pool: pg.Pool = getPool()): Promise<Memory[]> {
  const r = await pool.query<MemoryRow>(`select ${COLUMNS} ${FROM} where m.project_id = $1 order by m.created_at asc, m.id`, [projectId]);
  return r.rows.map(toMemory);
}

export async function getMemory(id: string, pool: pg.Pool = getPool()): Promise<Memory | null> {
  const r = await pool.query<MemoryRow>(`select ${COLUMNS} ${FROM} where m.id = $1`, [id]);
  return r.rows[0] ? toMemory(r.rows[0]) : null;
}

export interface NewCandidate {
  id: string;
  kind: MemoryKind;
  text: string;
  attributedTo: Attribution;
  sourceEntryId: string;
  sourceMessageId: string;
  sourceQuote: string | null;
}

/** Stores proposed candidates in one transaction. Skips any whose exact quote is already a memory of this source message. */
export async function proposeCandidates(projectId: string, candidates: NewCandidate[], pool: pg.Pool = getPool()): Promise<Memory[]> {
  const client = await pool.connect();
  const ids: string[] = [];
  try {
    await client.query("begin");
    const base = Date.now();
    for (const [i, c] of candidates.entries()) {
      const dup = await client.query(
        "select 1 from memories where project_id = $1 and source_message_id = $2 and (source_quote = $3 or text = $4) and status <> 'rejected'",
        [projectId, c.sourceMessageId, c.sourceQuote, c.text],
      );
      if (dup.rows.length > 0) continue;
      // Explicit, increasing timestamps: now() would give every row in this transaction the same one.
      const createdAt = new Date(base + i);
      await client.query(
        `insert into memories (id, project_id, kind, status, text, original_text, attributed_to, proposed_by, source_entry_id, source_message_id, source_quote, created_at, updated_at)
         values ($1, $2, $3, 'suggested', $4, $4, $5, 'model', $6, $7, $8, $9, $9)`,
        [c.id, projectId, c.kind, c.text, c.attributedTo, c.sourceEntryId, c.sourceMessageId, c.sourceQuote, createdAt],
      );
      await client.query("insert into memory_events (memory_id, action, to_text) values ($1, 'proposed', $2)", [c.id, c.text]);
      ids.push(c.id);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  if (ids.length === 0) return [];
  const r = await pool.query<MemoryRow>(`select ${COLUMNS} ${FROM} where m.id = any($1::text[]) order by m.created_at, m.id`, [ids]);
  return r.rows.map(toMemory);
}

/** Accepts a suggestion, optionally with corrected wording and a note. The proposed wording stays in original_text. */
export async function acceptMemory(id: string, text: string | undefined, note: string | undefined, pool: pg.Pool = getPool()): Promise<Memory> {
  const current = await getMemory(id, pool);
  if (!current) throw new NotFoundError(`Memory ${id} not found`);
  if (current.status !== "suggested") throw new ConflictError(`Memory ${id} is ${current.status}, not suggested`);
  const next = text?.trim() || current.text;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("update memories set status = 'accepted', text = $2, note = coalesce($3, note), updated_at = now() where id = $1", [id, next, note ?? null]);
    if (next !== current.text) {
      await client.query("insert into memory_events (memory_id, action, from_text, to_text, note) values ($1, 'edited', $2, $3, $4)", [id, current.text, next, note ?? null]);
    }
    await client.query("insert into memory_events (memory_id, action, to_text, note) values ($1, 'accepted', $2, $3)", [id, next, note ?? null]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return (await getMemory(id, pool))!;
}

export async function rejectMemory(id: string, note: string | undefined, pool: pg.Pool = getPool()): Promise<Memory> {
  const current = await getMemory(id, pool);
  if (!current) throw new NotFoundError(`Memory ${id} not found`);
  if (current.status === "rejected") return current;
  await pool.query("update memories set status = 'rejected', note = coalesce($2, note), updated_at = now() where id = $1", [id, note ?? null]);
  await pool.query("insert into memory_events (memory_id, action, from_text, note) values ($1, 'rejected', $2, $3)", [id, current.text, note ?? null]);
  return (await getMemory(id, pool))!;
}

/**
 * Corrects an accepted memory: the old row becomes superseded and a new accepted
 * row takes its place, keeping the source and recording the change.
 */
export async function supersedeMemory(
  id: string,
  newId: string,
  text: string,
  kind: MemoryKind | undefined,
  note: string | undefined,
  pool: pg.Pool = getPool(),
): Promise<Memory> {
  const current = await getMemory(id, pool);
  if (!current) throw new NotFoundError(`Memory ${id} not found`);
  if (current.status !== "accepted") throw new ConflictError(`Only an accepted memory can be corrected; ${id} is ${current.status}`);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into memories (id, project_id, kind, status, text, original_text, attributed_to, proposed_by, source_entry_id, source_message_id, source_quote, supersedes, note)
       values ($1, $2, $3, 'accepted', $4, $5, $6, 'person', $7, $8, $9, $10, $11)`,
      [newId, current.projectId, kind ?? current.kind, text, current.originalText, current.attributedTo, current.source.entryId, current.source.messageId, current.source.quote, id, note ?? null],
    );
    await client.query("update memories set status = 'superseded', updated_at = now() where id = $1", [id]);
    await client.query("insert into memory_events (memory_id, action, from_text, to_text, note) values ($1, 'superseded', $2, $3, $4)", [id, current.text, text, note ?? null]);
    await client.query("insert into memory_events (memory_id, action, from_text, to_text, note) values ($1, 'created', $2, $3, $4)", [newId, current.text, text, note ?? null]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return (await getMemory(newId, pool))!;
}

export async function memoryHistory(id: string, pool: pg.Pool = getPool()): Promise<MemoryEvent[]> {
  // Walk the supersedes chain backwards so the history covers every earlier wording.
  const chain: string[] = [];
  let cursor: string | null = id;
  while (cursor && chain.length < 50) {
    chain.push(cursor);
    const r: { rows: { supersedes: string | null }[] } = await pool.query("select supersedes from memories where id = $1", [cursor]);
    cursor = r.rows[0]?.supersedes ?? null;
  }
  const r = await pool.query<{ id: number; memory_id: string; action: MemoryEvent["action"]; from_text: string | null; to_text: string | null; note: string | null; at: Date }>(
    "select id, memory_id, action, from_text, to_text, note, at from memory_events where memory_id = any($1::text[]) order by at, id",
    [chain],
  );
  return r.rows.map((e) => ({ id: e.id, memoryId: e.memory_id, action: e.action, fromText: e.from_text, toText: e.to_text, note: e.note, at: e.at.toISOString() }));
}

export async function setMessageMemoryRefs(entryId: string, messageId: string, refs: unknown, pool: pg.Pool = getPool()): Promise<void> {
  await pool.query("update messages set memory_refs = $3 where entry_id = $1 and id = $2", [entryId, messageId, JSON.stringify(refs)]);
}
