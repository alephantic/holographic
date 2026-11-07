import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../shared/entries";
import type { Memory } from "../shared/memory";
import { assembleMemoryContext, citedRefs, isInsideQuotationMarks, looksPasted, MAX_MEMORY_CONTEXT_CHARS, orderForContext, transcriptFor, validateCandidates } from "./memory";

const at = "2026-11-07T10:00:00.000Z";
const chat: ChatEntry = {
  id: "chat-1",
  kind: "chat",
  title: "Planning",
  createdAt: at,
  updatedAt: at,
  messages: [
    { id: "m1", role: "user", content: "Decision: the studio will keep one shared key for now.", createdAt: at },
    { id: "m2", role: "assistant", content: "You could add a timeline view later.", createdAt: at },
    { id: "m3", role: "user", content: "Maybe a timeline, I'm not sure yet.", createdAt: at },
    { id: "m4", role: "user", content: "Here is the page: “Princhetta decided to leave the balcony forever.” What do you make of it?", createdAt: at },
    { id: "m5", role: "user", content: "From the manuscript, page 6:\nPrinchetta decided to burn the preface.\nIs that too abrupt?", createdAt: at },
  ],
};
let n = 0;
const newId = () => `id-${++n}`;

describe("validateCandidates", () => {
  it("keeps a person's explicit decision as a decision with its verbatim quote", () => {
    const out = validateCandidates({ candidates: [{ kind: "decision", text: "Keep one shared key for now.", message_id: "m1", quote: "keep one shared key for now", speaker: "person" }] }, chat, newId);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "decision", attributedTo: "person", sourceMessageId: "m1", sourceQuote: "keep one shared key for now" });
    expect(out[0]?.adjusted).toBeUndefined();
  });

  it("never lets the assistant's words become a decision", () => {
    const out = validateCandidates({ candidates: [{ kind: "decision", text: "Add a timeline view.", message_id: "m2", quote: "You could add a timeline view later.", speaker: "person" }] }, chat, newId);
    expect(out[0]).toMatchObject({ kind: "open", attributedTo: "assistant" });
    expect(out[0]?.adjusted).toMatch(/assistant's words/);
  });

  it("treats quoted story text as quoted, not as the person's decision", () => {
    const out = validateCandidates({ candidates: [{ kind: "decision", text: "Leave the balcony forever.", message_id: "m4", quote: "Princhetta decided to leave the balcony forever.", speaker: "person" }] }, chat, newId);
    expect(out[0]).toMatchObject({ kind: "open", attributedTo: "quoted" });
    expect(out[0]?.adjusted).toMatch(/quoted text/);
  });

  it("keeps a tentative idea open", () => {
    const out = validateCandidates({ candidates: [{ kind: "open", text: "A timeline view, undecided.", message_id: "m3", quote: "Maybe a timeline", speaker: "person" }] }, chat, newId);
    expect(out[0]).toMatchObject({ kind: "open", attributedTo: "person" });
  });

  it("drops candidates for unknown messages and detaches quotes that aren't verbatim", () => {
    const out = validateCandidates(
      { candidates: [{ kind: "open", text: "x", message_id: "nope", quote: "x", speaker: "person" }, { kind: "open", text: "Idea", message_id: "m3", quote: "not in the message", speaker: "person" }] },
      chat,
      newId,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.sourceQuote).toBeNull();
    expect(out[0]?.adjusted).toMatch(/not found verbatim/);
    expect(validateCandidates(null, chat, newId)).toEqual([]);
  });
});

describe("looksPasted", () => {
  it("treats text introduced as a page, excerpt, or paste as quoted even without quotation marks", () => {
    expect(looksPasted("From the manuscript, page 6:\nPrinchetta decided to burn the preface.", "Princhetta decided to burn the preface.")).toBe(true);
    expect(looksPasted("I pasted this: she left.", "she left.")).toBe(true);
    expect(looksPasted("We decided to burn the preface.", "decided to burn the preface")).toBe(false);
  });
  it("is applied during validation", () => {
    const out = validateCandidates({ candidates: [{ kind: "decision", text: "Burn the preface.", message_id: "m5", quote: "Princhetta decided to burn the preface.", speaker: "person" }] }, chat, newId);
    expect(out[0]).toMatchObject({ kind: "open", attributedTo: "quoted" });
  });
  it("honours the model's own quoted judgement", () => {
    const out = validateCandidates({ candidates: [{ kind: "decision", text: "x", message_id: "m3", quote: "Maybe a timeline", speaker: "quoted" }] }, chat, newId);
    expect(out[0]).toMatchObject({ kind: "open", attributedTo: "quoted" });
  });
});

describe("isInsideQuotationMarks", () => {
  it("detects curly and straight quotes and ignores text outside them", () => {
    expect(isInsideQuotationMarks("She said “go home now” and left.", "go home")).toBe(true);
    expect(isInsideQuotationMarks('He wrote "we decided" earlier.', "we decided")).toBe(true);
    expect(isInsideQuotationMarks("We decided to go.", "decided to go")).toBe(false);
  });
});

describe("transcriptFor", () => {
  it("labels every message with its id and role", () => {
    const t = transcriptFor(chat);
    expect(t).toContain("[m1] user: Decision: the studio");
    expect(t).toContain("[m2] assistant: You could");
  });
});

const memory = (id: string, kind: Memory["kind"], text: string, extra: Partial<Memory> = {}): Memory => ({
  id,
  projectId: "default",
  kind,
  status: "accepted",
  text,
  originalText: text,
  attributedTo: "person",
  proposedBy: "model",
  source: { entryId: "chat-1", entryTitle: "Planning", messageId: "m1", quote: text },
  supersedes: null,
  note: null,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

describe("assembleMemoryContext", () => {
  it("labels decisions and open items separately, with sources and attribution", () => {
    const { text, refs } = assembleMemoryContext([
      memory("a", "decision", "Keep one shared key."),
      memory("b", "open", "A timeline view.", { attributedTo: "assistant" }),
    ]);
    expect(text).toContain('[MD1] DECISION: Keep one shared key. (from "Planning")');
    expect(text).toContain("[MO1] OPEN: A timeline view. (from \"Planning\") [AI suggestion the person accepted as an open item]");
    expect(text).toMatch(/say so instead of inventing it/);
    expect(refs.map((r) => r.label)).toEqual(["MD1", "MO1"]);
  });

  it("says plainly when nothing is accepted", () => {
    const { text, refs } = assembleMemoryContext([]);
    expect(text).toMatch(/nothing has been accepted yet/);
    expect(refs).toEqual([]);
  });

  it("orders decisions first, newest first, and names what it left out", () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => memory(`o${i}`, "open", `open ${i} ` + "x".repeat(150), { updatedAt: `2026-11-0${1 + (i % 7)}T00:00:00.000Z` })),
      ...Array.from({ length: 10 }, (_, i) => memory(`d${i}`, "decision", `decision ${i} ` + "x".repeat(150), { updatedAt: `2026-11-0${1 + (i % 7)}T00:00:00.000Z` })),
    ];
    const ordered = orderForContext(many);
    expect(ordered.slice(0, 10).every((m) => m.kind === "decision")).toBe(true);
    expect(ordered[0]!.updatedAt >= ordered[9]!.updatedAt).toBe(true);
    const { text, refs, omitted } = assembleMemoryContext(many);
    expect(refs.length + omitted.length).toBe(40);
    expect(refs.every((r) => r.kind === "decision") || refs.filter((r) => r.kind === "decision")).toBeTruthy();
    expect(text).toMatch(new RegExp(`NOT INCLUDED: ${omitted.length} more accepted memories were left out because this block is limited to 4,000 characters`));
    expect(text).toMatch(/You have not seen them/);
    const body = text.split("\n\n")[1] ?? "";
    expect(body.length).toBeLessThanOrEqual(MAX_MEMORY_CONTEXT_CHARS);
    // Everything included precedes everything omitted in context order.
    const includedIds = new Set(refs.map((r) => r.id));
    const firstOmitted = ordered.findIndex((m) => !includedIds.has(m.id));
    expect(ordered.slice(firstOmitted).every((m) => !includedIds.has(m.id))).toBe(true);
  });

  it("has no omission note when everything fits", () => {
    const { text, omitted } = assembleMemoryContext([memory("a", "decision", "Keep one shared key.")]);
    expect(omitted).toEqual([]);
    expect(text).not.toMatch(/NOT INCLUDED/);
  });
});

describe("citedRefs", () => {
  it("returns only the memories whose labels the reply cited", () => {
    const { refs } = assembleMemoryContext([memory("a", "decision", "Keep one key."), memory("b", "open", "Timeline.")]);
    expect(citedRefs("We settled the key [MD1]; the timeline is open.", refs).map((r) => r.id)).toEqual(["a"]);
    expect(citedRefs("Nothing cited.", refs)).toEqual([]);
  });
});
