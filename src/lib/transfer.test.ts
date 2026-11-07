import { describe, expect, it } from "vitest";
import { createChatEntry, createSavedEntry } from "./store";
import { applyMerge, createExport, exportFileName, parseExport, planMerge } from "./transfer";
import type { Library } from "./types";

describe("export and import", () => {
  const a = createSavedEntry("first", new Date("2026-01-01T00:00:00Z"));
  const b = createChatEntry("hello", new Date("2026-01-02T00:00:00Z"));
  const lib: Library = { version: 1, entries: [b, a] };

  it("round-trips through the export file and leaves samples out", () => {
    const doc = createExport({ version: 1, entries: [...lib.entries, { ...a, id: "s", sample: true }] }, new Date("2026-03-04T05:06:07Z"));
    expect(doc.library.entries.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(exportFileName(new Date("2026-03-04T05:06:07Z"))).toBe("holographic-export-2026-03-04.json");
    const parsed = parseExport(JSON.stringify(doc));
    expect(parsed.ok && parsed.entries).toEqual([b, a]);
    expect(parsed.ok && parsed.exportedAt).toBe("2026-03-04T05:06:07.000Z");
  });

  it("rejects files that aren't exports", () => {
    expect(parseExport("nope").ok).toBe(false);
    expect(parseExport('{"hello":1}').ok).toBe(false);
    expect(parseExport("[]").ok).toBe(false);
  });

  it("imports into an empty library and is a no-op the second time", () => {
    const empty: Library = { version: 1, entries: [] };
    const first = planMerge(empty, [a, b]);
    expect(first.added.map((e) => e.id)).toEqual([a.id, b.id]);
    const merged = applyMerge(empty, first);
    expect(merged.entries.map((e) => e.id)).toEqual([b.id, a.id]); // newest first, by updatedAt

    const again = planMerge(merged, [a, b, b]);
    expect(again.added).toEqual([]);
    expect(again.skipped.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(applyMerge(merged, again).entries).toHaveLength(2);
  });

  it("preserves content and timestamps of imported entries", () => {
    const merged = applyMerge({ version: 1, entries: [] }, planMerge({ version: 1, entries: [] }, [b]));
    const chat = merged.entries[0];
    expect(chat?.kind === "chat" && chat.messages[0]?.content).toBe("hello");
    expect(chat?.createdAt).toBe("2026-01-02T00:00:00.000Z");
  });
});
