// Project memory: candidate and established memories with their sources.

export type MemoryKind = "decision" | "open";
export type MemoryStatus = "suggested" | "accepted" | "rejected" | "superseded";
/** Who the supporting passage belongs to: the person, the assistant, or text the person quoted (e.g. a story page). */
export type Attribution = "person" | "assistant" | "quoted";

export interface MemorySource {
  entryId: string | null;
  entryTitle?: string;
  messageId: string | null;
  /** Verbatim passage from the source message. */
  quote: string | null;
}

export interface Memory {
  id: string;
  projectId: string;
  kind: MemoryKind;
  status: MemoryStatus;
  text: string;
  originalText: string;
  attributedTo: Attribution;
  proposedBy: "model" | "person";
  source: MemorySource;
  supersedes: string | null;
  supersededBy?: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEvent {
  id: number;
  memoryId: string;
  action: "proposed" | "accepted" | "rejected" | "edited" | "superseded" | "created";
  fromText: string | null;
  toText: string | null;
  note: string | null;
  at: string;
}

export interface Project {
  id: string;
  name: string;
}

/** A memory reference attached to an assistant reply. */
export interface MemoryRef {
  id: string;
  kind: MemoryKind;
  text: string;
}

export const MAX_MEMORY_TEXT = 1_000;
export const MAX_MEMORY_NOTE = 500;

/** Human label for how a memory came to be. */
export function attributionLabel(a: Attribution): string {
  return a === "person" ? "said by you" : a === "assistant" ? "AI suggestion" : "quoted text";
}
