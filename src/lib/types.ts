// Local data model for the first version of Holographic.
// Entries are stored as a single versioned document in localStorage so the
// shape can be migrated later (e.g. to hold pages of The Entrance Way).

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
