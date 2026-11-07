// Wire protocol shared by the server and the client.
// Kept deliberately small: the client never sees credentials, only this.

export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatTurn[];
}

export type StatusResponse = (
  | { configured: true; provider: "openai" | "anthropic"; model: string }
  | { configured: false; provider: null; model: null }
) & {
  /** True when chat and storage requests must carry an access key (x-holographic-key). */
  accessRequired: boolean;
  /** Whether the server has shared "studio" storage (a database) behind it. */
  storage: { configured: boolean };
};

/** Header carrying the shared access key, when one is configured. */
export const ACCESS_HEADER = "x-holographic-key";

import type { SourceRef } from "./entries";

/** Newline-delimited JSON events streamed back from POST /api/chat. */
export type ChatEvent =
  /** Sent before any text when saved pages were searched for this turn; `sources` may be empty. */
  | { type: "sources"; sources: SourceRef[] }
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; code: ChatErrorCode; message: string };

export type ChatErrorCode = "not_configured" | "unauthorized" | "bad_request" | "upstream" | "refusal";
