import { MAX_CHARS_PER_REQUEST, MAX_CHARS_PER_TURN, MAX_TURNS } from "../../shared/limits";
import type { ChatTurn } from "../../shared/protocol";
import type { MessageRecord } from "./types";

export interface ContextSelection {
  /** Turns to send, oldest first, always starting with a user turn and ending with the latest message. */
  turns: ChatTurn[];
  /** Index into `messages` of the first message included; everything before it is not sent. */
  startIndex: number;
  /** How many earlier messages were left out. */
  omitted: number;
}

/**
 * Chooses the most recent messages that fit the request limits. The whole
 * conversation stays in storage; only this window reaches the model.
 * Returns null when the latest message alone exceeds the per-turn limit.
 */
export function selectContext(messages: MessageRecord[]): ContextSelection | null {
  if (messages.length === 0) return null;
  const last = messages[messages.length - 1]!;
  if (last.content.length > MAX_CHARS_PER_TURN) return null;

  let start = messages.length;
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const count = messages.length - i;
    if (count > MAX_TURNS || m.content.length > MAX_CHARS_PER_TURN || chars + m.content.length > MAX_CHARS_PER_REQUEST) break;
    chars += m.content.length;
    start = i;
  }
  // The model expects the window to open with a user turn.
  while (start < messages.length && messages[start]!.role !== "user") start++;

  return {
    turns: messages.slice(start).map((m) => ({ role: m.role, content: m.content })),
    startIndex: start,
    omitted: start,
  };
}

/** Human-readable reason a message can't be sent, or null when it can. */
export function messageTooLong(text: string): string | null {
  if (text.length <= MAX_CHARS_PER_TURN) return null;
  return `This message is ${text.length.toLocaleString()} characters; the most that can be sent at once is ${MAX_CHARS_PER_TURN.toLocaleString()}. Shorten it or send it in parts.`;
}
