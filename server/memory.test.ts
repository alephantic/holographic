import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../shared/entries";
import type { Memory } from "../shared/memory";
import { assembleMemoryContext, citedRefs, isInsideQuotationMarks, transcriptFor, validateCandidates } from "./memory";

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

  it("stays within its budget", () => {
    const many = Array.from({ length: 200 }, (_, i) => memory(`m${i}`, "open", "x".repeat(100)));
    const { text, refs } = assembleMemoryContext(many);
    expect(text.length).toBeLessThan(5_000);
    expect(refs.length).toBeLessThan(200);
  });
});

describe("citedRefs", () => {
  it("returns only the memories whose labels the reply cited", () => {
    const { refs } = assembleMemoryContext([memory("a", "decision", "Keep one key."), memory("b", "open", "Timeline.")]);
    expect(citedRefs("We settled the key [MD1]; the timeline is open.", refs).map((r) => r.id)).toEqual(["a"]);
    expect(citedRefs("Nothing cited.", refs)).toEqual([]);
  });
});
