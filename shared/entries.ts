// The entry model shared by the browser store, the server, and the export file.

export type EntryKind = "chat" | "saved";

export interface MessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string; // ISO 8601
  /** Present when the message could not be answered (e.g. no model connected). */
  note?: string;
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
  return true;
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
    })),
  };
}
