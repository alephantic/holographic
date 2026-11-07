import type { ChatEntry, MessageRecord } from "../shared/entries.js";
import type { Attribution, Memory, MemoryKind, MemoryRef } from "../shared/memory.js";
import { MAX_MEMORY_TEXT } from "../shared/memory.js";
import type { NewCandidate } from "./db/memories.js";
import type { Provider } from "./providers.js";

// Project memory: proposing candidates from a conversation, and building the
// memory block a chat receives. The model proposes; the server decides what a
// candidate may claim, from who actually said the supporting words.

const MAX_CAPTURE_CHARS = 24_000;
export const MAX_MEMORY_CONTEXT_CHARS = 4_000;

const CAPTURE_SYSTEM =
  "You read one conversation from a creative studio and propose project memories for a person to review. " +
  "Propose two kinds only: a DECISION the person stated plainly as settled, or an OPEN idea or question the person is still considering. " +
  "Each candidate must point at exactly one message by its id and quote a short passage from it verbatim. " +
  "Say who the quoted words belong to: the person, the assistant, or text the person was quoting (a story, a document). " +
  "Do not propose anything from passages inside quotation marks or from the assistant's own suggestions as a decision. " +
  "Prefer fewer, well-grounded candidates. Answer with JSON only: " +
  '{"candidates":[{"kind":"decision"|"open","text":"one sentence","message_id":"...","quote":"verbatim words from that message","speaker":"person"|"assistant"|"quoted"}]}';

/** The conversation as the model sees it: every message labelled with its id and role. */
export function transcriptFor(chat: ChatEntry): string {
  const lines: string[] = [];
  let used = 0;
  for (const m of chat.messages) {
    const line = `[${m.id}] ${m.role}: ${m.content}`;
    if (used + line.length > MAX_CAPTURE_CHARS) {
      lines.push("[… earlier messages omitted to fit the limit …]");
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join("\n");
}

interface RawCandidate {
  kind?: unknown;
  text?: unknown;
  message_id?: unknown;
  quote?: unknown;
  speaker?: unknown;
}

const QUOTE_PAIRS: [string, string][] = [
  ["“", "”"],
  ['"', '"'],
  ["«", "»"],
];

/** True when `quote` sits inside quotation marks within `content`. */
export function isInsideQuotationMarks(content: string, quote: string): boolean {
  const at = content.indexOf(quote);
  if (at < 0) return false;
  for (const [open, close] of QUOTE_PAIRS) {
    const before = content.lastIndexOf(open, at);
    if (before < 0) continue;
    const closedBefore = open === close ? (content.slice(before + 1, at).split(open).length - 1) % 2 === 1 : content.indexOf(close, before) < at && content.indexOf(close, before) >= 0;
    if (closedBefore) continue;
    const after = content.indexOf(close, at + quote.length);
    if (after >= 0) return true;
  }
  return false;
}

/** Words that introduce pasted material; a quote that follows one of these (before a colon) is treated as quoted text. */
const PASTE_INTRO = /\b(page|pages|excerpt|passage|paste[sd]?|quot(?:e|ed|ing)|from the (?:story|book|manuscript|draft|novel))\b[^:\n]{0,80}:\s*$/i;

/**
 * Heuristic for pasted text without quotation marks: the quote is preceded, within
 * the same message, by an introduction such as "Here is a page:". A model's own
 * "quoted" judgement is honoured too. Neither can read every ambiguous message.
 */
export function looksPasted(content: string, quote: string): boolean {
  const at = content.indexOf(quote);
  if (at < 0) return false;
  const before = content.slice(Math.max(0, at - 160), at);
  return PASTE_INTRO.test(before);
}

export interface ValidatedCandidate extends NewCandidate {
  /** Why the server changed what the model proposed, if it did. */
  adjusted?: string;
}

/**
 * Turns the model's proposals into candidates the server can vouch for:
 * the message must exist, the quote must be verbatim in it, and who said it
 * decides what it may be. The assistant's words and quoted text are never decisions.
 */
export function validateCandidates(raw: unknown, chat: ChatEntry, newId: () => string): ValidatedCandidate[] {
  const list = (raw && typeof raw === "object" && Array.isArray((raw as { candidates?: unknown }).candidates)
    ? (raw as { candidates: RawCandidate[] }).candidates
    : []) as RawCandidate[];
  const byId = new Map<string, MessageRecord>(chat.messages.map((m) => [m.id, m]));
  const out: ValidatedCandidate[] = [];
  for (const c of list.slice(0, 20)) {
    if (typeof c.text !== "string" || !c.text.trim() || typeof c.message_id !== "string") continue;
    const message = byId.get(c.message_id);
    if (!message) continue;
    const text = c.text.trim().slice(0, MAX_MEMORY_TEXT);
    const quote = typeof c.quote === "string" && c.quote.trim() && message.content.includes(c.quote.trim()) ? c.quote.trim() : null;
    let kind: MemoryKind = c.kind === "decision" ? "decision" : "open";
    let attributedTo: Attribution = message.role === "assistant" ? "assistant" : c.speaker === "quoted" ? "quoted" : "person";
    let adjusted: string | undefined;
    if (message.role === "assistant") {
      attributedTo = "assistant";
    } else if (quote && (isInsideQuotationMarks(message.content, quote) || looksPasted(message.content, quote))) {
      attributedTo = "quoted";
    }
    if (kind === "decision" && attributedTo !== "person") {
      kind = "open";
      adjusted = attributedTo === "assistant" ? "Proposed as a decision, but these are the assistant's words; kept as an AI suggestion." : "Proposed as a decision, but the words are quoted text, not the person's own; kept as an open item.";
    }
    if (!quote) adjusted = (adjusted ? adjusted + " " : "") + "The proposed quote was not found verbatim in the message, so none is attached.";
    out.push({ id: newId(), kind, text, attributedTo, sourceEntryId: chat.id, sourceMessageId: message.id, sourceQuote: quote, ...(adjusted ? { adjusted } : {}) });
  }
  return out;
}

export async function proposeFromChat(chat: ChatEntry, provider: Provider, newId: () => string): Promise<ValidatedCandidate[]> {
  const answer = await provider.complete(CAPTURE_SYSTEM, transcriptFor(chat));
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    parsed = null;
  }
  return validateCandidates(parsed, chat, newId);
}

/**
 * The order memories are offered to a chat, and therefore which ones survive the
 * size limit: decisions before open items, newest first within each. Predictable
 * on purpose; no relevance ranking in this first version.
 */
export function orderForContext(accepted: Memory[]): Memory[] {
  const byRecency = (a: Memory, b: Memory) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1);
  return [...accepted.filter((m) => m.kind === "decision").sort(byRecency), ...accepted.filter((m) => m.kind === "open").sort(byRecency)];
}

/** Short stable labels for the model: MD1 for decisions, MO1 for open items, in context order. */
export function labelMemories(accepted: Memory[]): { label: string; memory: Memory }[] {
  let d = 0;
  let o = 0;
  return orderForContext(accepted).map((m) => ({ label: m.kind === "decision" ? `MD${++d}` : `MO${++o}`, memory: m }));
}

/**
 * The block of established memory a chat receives. Only accepted memories,
 * each with its label, kind, source, and attribution, bounded in size.
 */
export interface MemoryContext {
  text: string;
  /** Memories actually included, in context order, with their labels. */
  refs: (MemoryRef & { label: string })[];
  /** Accepted memories left out because the block reached its limit. */
  omitted: Memory[];
}

export function assembleMemoryContext(accepted: Memory[]): MemoryContext {
  const labelled = labelMemories(accepted);
  const refs: (MemoryRef & { label: string })[] = [];
  const omitted: Memory[] = [];
  const lines: string[] = [];
  let used = 0;
  let full = false;
  for (const { label, memory } of labelled) {
    const src = memory.source.entryTitle ? ` (from "${memory.source.entryTitle}")` : "";
    const who = memory.attributedTo === "person" ? "" : memory.attributedTo === "assistant" ? " [AI suggestion the person accepted as an open item]" : " [quoted text]";
    const line = `[${label}] ${memory.kind === "decision" ? "DECISION" : "OPEN"}: ${memory.text}${src}${who}`;
    if (full || used + line.length > MAX_MEMORY_CONTEXT_CHARS) {
      full = true; // once the limit is reached, nothing later is included, so the order stays predictable
      omitted.push(memory);
      continue;
    }
    lines.push(line);
    used += line.length;
    refs.push({ id: memory.id, kind: memory.kind, text: memory.text, label });
  }
  if (lines.length === 0) {
    return {
      text:
        "PROJECT MEMORY: nothing has been accepted yet. If asked where the project stands, say that no decisions or open questions are established, and do not invent any.",
      refs,
      omitted,
    };
  }
  const rules =
    "PROJECT MEMORY: the items below are what the person has accepted as this project's established memory, each with a label. " +
    "DECISION items are settled; OPEN items are still being considered. When asked where the project stands, answer from these only, " +
    "keep decisions apart from open questions, and cite the label of each item you use, like [MD1]. " +
    "If something isn't established here, say so instead of inventing it. Anything you propose as a next step must be marked as your suggestion, not a decision.";
  const omittedNote =
    omitted.length > 0
      ? `\n\nNOT INCLUDED: ${omitted.length} more accepted ${omitted.length === 1 ? "memory was" : "memories were"} left out because this block is limited to ${MAX_MEMORY_CONTEXT_CHARS.toLocaleString()} characters (${omitted.filter((m) => m.kind === "decision").length} decisions, ${omitted.filter((m) => m.kind === "open").length} open). You have not seen them; if a question may depend on them, say that part of the project memory wasn't available to you.`
      : "";
  return { text: `${rules}\n\n${lines.join("\n")}${omittedNote}`, refs, omitted };
}

/** Which memories a reply actually drew on, by the labels it cited. */
export function citedRefs(reply: string, refs: (MemoryRef & { label: string })[]): MemoryRef[] {
  const cited = new Set([...reply.matchAll(/\[(M[DO]\d+)\]/g)].map((m) => m[1]));
  return refs.filter((r) => cited.has(r.label)).map(({ id, kind, text }) => ({ id, kind, text }));
}
