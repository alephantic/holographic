import { isEntry } from "../../shared/entries";
import type { ChatEntry, Entry, Library, MessageRecord, SavedEntry } from "./types";

export const STORAGE_KEY = "holographic.library.v1";

/** Minimal subset of the Web Storage API, so the store can be tested without a DOM. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const emptyLibrary = (): Library => ({ version: 1, entries: [] });

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** First meaningful line of the text, trimmed to a sidebar-friendly length. */
export function deriveTitle(text: string, max = 56): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "Untitled";
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > max * 0.6 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

export function loadLibrary(storage: KeyValueStorage): Library {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return emptyLibrary();
  }
  if (!raw) return emptyLibrary();
  try {
    const parsed = JSON.parse(raw) as Partial<Library>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return emptyLibrary();
    // Drop anything malformed rather than failing the whole library; never load samples from disk.
    const entries = parsed.entries.filter(isEntry).filter((e) => !e.sample);
    return { version: 1, entries };
  } catch {
    return emptyLibrary();
  }
}

export function persistLibrary(storage: KeyValueStorage, library: Library): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(library));
    return true;
  } catch {
    return false;
  }
}

export function createSavedEntry(body: string, now = new Date()): SavedEntry {
  const at = now.toISOString();
  return { id: newId(), kind: "saved", title: deriveTitle(body), body, createdAt: at, updatedAt: at };
}

export function createChatEntry(firstMessage: string, now = new Date()): ChatEntry {
  const at = now.toISOString();
  return {
    id: newId(),
    kind: "chat",
    title: deriveTitle(firstMessage),
    createdAt: at,
    updatedAt: at,
    messages: [{ id: newId(), role: "user", content: firstMessage, createdAt: at }],
  };
}

export function makeMessage(role: MessageRecord["role"], content: string, now = new Date()): MessageRecord {
  return { id: newId(), role, content, createdAt: now.toISOString() };
}

/** Returns a new library with `entry` inserted at the front (most recent first). */
export function upsertEntry(library: Library, entry: Entry): Library {
  const rest = library.entries.filter((e) => e.id !== entry.id);
  return { version: 1, entries: [entry, ...rest] };
}

export function removeEntry(library: Library, id: string): Library {
  return { version: 1, entries: library.entries.filter((e) => e.id !== id) };
}

/** Apply `update` to the chat with `id`, bumping updatedAt. No-op if the chat does not exist. */
export function updateChat(library: Library, id: string, update: (chat: ChatEntry) => ChatEntry, now = new Date()): Library {
  const entries = library.entries.map((e) =>
    e.id === id && e.kind === "chat" ? { ...update(e), updatedAt: now.toISOString() } : e,
  );
  return { version: 1, entries };
}
