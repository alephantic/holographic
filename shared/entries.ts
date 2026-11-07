// The entry model shared by the browser store, the server, and the export file.

export type EntryKind = "chat" | "saved";

/** A saved entry that was quoted to the model for a reply. Only real ids and titles; page is parsed from the entry, never invented. */
export interface SourceRef {
  id: string;
  title: string;
  /** Page number parsed from the entry's heading, when it has one. */
  page?: number;
}

export interface MessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string; // ISO 8601
  /** Present when the message could not be answered (e.g. no model connected). */
  note?: string;
  /** For assistant replies: which saved entries were consulted. An empty list means retrieval ran and found nothing. */
  sources?: SourceRef[];
  /** For assistant replies: which accepted project memories the reply cited. */
  memoryRefs?: MemoryRefLite[];
  /** For assistant replies: how many accepted memories were left out of the request by the size limit. */
  memoryOmitted?: number;
}

/** A cited project memory, as stored on a message. */
export interface MemoryRefLite {
  id: string;
  kind: "decision" | "open";
  text: string;
}

interface EntryBase {
  id: string;
  kind: EntryKind;
  /** Short label shown in Recents; derived from the content at creation time. */
  title: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** True only for the built-in examples; sample entries are never persisted. */
  sample?: true;
}

export interface SavedEntry extends EntryBase {
  kind: "saved";
  body: string;
}

export interface ChatEntry extends EntryBase {
  kind: "chat";
  messages: MessageRecord[];
}

export type Entry = SavedEntry | ChatEntry;

export interface Library {
  version: 1;
  entries: Entry[];
}

// Size bounds for anything accepted over the wire or from a file.
export const MAX_ID_LENGTH = 64;
export const MAX_TITLE_LENGTH = 200;
export const MAX_BODY_LENGTH = 500_000;
export const MAX_MESSAGE_LENGTH = 200_000;
export const MAX_NOTE_LENGTH = 500;
export const MAX_MESSAGES_PER_CHAT = 5_000;
export const MAX_SOURCES_PER_MESSAGE = 10;

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

function isIso(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

export function isMessageRecord(value: unknown): value is MessageRecord {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  if (typeof m.id !== "string" || !ID.test(m.id)) return false;
  if (m.role !== "user" && m.role !== "assistant") return false;
  if (!isText(m.content, MAX_MESSAGE_LENGTH) || !isIso(m.createdAt)) return false;
  if (m.note !== undefined && !isText(m.note, MAX_NOTE_LENGTH)) return false;
  if (m.sources !== undefined) {
    if (!Array.isArray(m.sources) || m.sources.length > MAX_SOURCES_PER_MESSAGE || !m.sources.every(isSourceRef)) return false;
  }
  if (m.memoryRefs !== undefined) {
    if (!Array.isArray(m.memoryRefs) || m.memoryRefs.length > 50 || !m.memoryRefs.every(isMemoryRefLite)) return false;
  }
  if (m.memoryOmitted !== undefined && !(Number.isInteger(m.memoryOmitted) && (m.memoryOmitted as number) >= 0)) return false;
  return true;
}

export function isMemoryRefLite(value: unknown): value is MemoryRefLite {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return typeof r.id === "string" && ID.test(r.id) && (r.kind === "decision" || r.kind === "open") && isText(r.text, 1_000);
}

export function isSourceRef(value: unknown): value is SourceRef {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== "string" || !ID.test(s.id) || !isText(s.title, MAX_TITLE_LENGTH)) return false;
  return s.page === undefined || (typeof s.page === "number" && Number.isInteger(s.page) && s.page > 0);
}

/** Structural check used by the browser store, the import path, and the server. */
export function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || !ID.test(e.id)) return false;
  if (!isText(e.title, MAX_TITLE_LENGTH) || !isIso(e.createdAt) || !isIso(e.updatedAt)) return false;
  if (e.kind === "saved") return isText(e.body, MAX_BODY_LENGTH);
  if (e.kind === "chat") {
    return Array.isArray(e.messages) && e.messages.length <= MAX_MESSAGES_PER_CHAT && e.messages.every(isMessageRecord);
  }
  return false;
}

/** Strips anything that isn't part of the model (e.g. the sample flag) before storing or sending. */
export function cleanEntry(entry: Entry): Entry {
  if (entry.kind === "saved") {
    return { id: entry.id, kind: "saved", title: entry.title, body: entry.body, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
  }
  return {
    id: entry.id,
    kind: "chat",
    title: entry.title,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    messages: entry.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      ...(m.note ? { note: m.note } : {}),
      ...(m.sources ? { sources: m.sources.map((r) => ({ id: r.id, title: r.title, ...(r.page ? { page: r.page } : {}) })) } : {}),
      ...(m.memoryRefs ? { memoryRefs: m.memoryRefs.map((r) => ({ id: r.id, kind: r.kind, text: r.text })) } : {}),
      ...(m.memoryOmitted ? { memoryOmitted: m.memoryOmitted } : {}),
    })),
  };
}
