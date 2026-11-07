import { describe, expect, it } from "vitest";
import {
  STORAGE_KEY,
  createChatEntry,
  createSavedEntry,
  deriveTitle,
  loadLibrary,
  persistLibrary,
  removeEntry,
  updateChat,
  upsertEntry,
  type KeyValueStorage,
} from "./store";
import { makeMessage } from "./store";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe("deriveTitle", () => {
  it("uses the first non-empty line", () => {
    expect(deriveTitle("\n\n  A thought  \nmore")).toBe("A thought");
  });
  it("truncates long lines at a word boundary with an ellipsis", () => {
    const t = deriveTitle("The quick brown fox jumps over the lazy dog and keeps running far away", 30);
    expect(t.length).toBeLessThanOrEqual(31);
    expect(t.endsWith("…")).toBe(true);
    expect(t).toBe("The quick brown fox jumps…");
  });
  it("falls back to Untitled", () => {
    expect(deriveTitle("   \n ")).toBe("Untitled");
  });
});

describe("library persistence", () => {
  it("round-trips a saved entry", () => {
    const storage = memoryStorage();
    const entry = createSavedEntry("Keep this.\nSecond line.");
    expect(persistLibrary(storage, upsertEntry(loadLibrary(storage), entry))).toBe(true);
    const reloaded = loadLibrary(storage);
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0]).toEqual(entry);
    expect(reloaded.entries[0]?.kind === "saved" && reloaded.entries[0].body).toBe("Keep this.\nSecond line.");
  });

  it("returns an empty library for missing, corrupt, or wrong-version data", () => {
    expect(loadLibrary(memoryStorage()).entries).toEqual([]);
    expect(loadLibrary(memoryStorage({ [STORAGE_KEY]: "{not json" })).entries).toEqual([]);
    expect(loadLibrary(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 2, entries: [] }) })).entries).toEqual([]);
  });

  it("drops malformed entries and never loads samples from storage", () => {
    const good = createSavedEntry("fine");
    const stored = { version: 1, entries: [good, { id: "x" }, { ...createSavedEntry("s"), sample: true }] };
    const lib = loadLibrary(memoryStorage({ [STORAGE_KEY]: JSON.stringify(stored) }));
    expect(lib.entries.map((e) => e.id)).toEqual([good.id]);
  });

  it("reports failure when storage throws", () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadLibrary(broken).entries).toEqual([]);
    expect(persistLibrary(broken, { version: 1, entries: [] })).toBe(false);
  });
});

describe("entries", () => {
  it("puts the newest entry first and replaces by id", () => {
    const a = createSavedEntry("a");
    const b = createSavedEntry("b");
    let lib = upsertEntry(upsertEntry({ version: 1, entries: [] }, a), b);
    expect(lib.entries.map((e) => e.title)).toEqual(["b", "a"]);
    lib = upsertEntry(lib, { ...a, title: "a2" });
    expect(lib.entries.map((e) => e.title)).toEqual(["a2", "b"]);
    expect(removeEntry(lib, b.id).entries.map((e) => e.title)).toEqual(["a2"]);
  });

  it("appends messages to a chat and bumps updatedAt", () => {
    const chat = createChatEntry("Hello", new Date("2026-01-01T00:00:00Z"));
    const lib = updateChat(
      { version: 1, entries: [chat] },
      chat.id,
      (c) => ({ ...c, messages: [...c.messages, makeMessage("assistant", "Hi")] }),
      new Date("2026-01-02T00:00:00Z"),
    );
    const updated = lib.entries[0];
    expect(updated?.kind === "chat" && updated.messages.map((m) => m.content)).toEqual(["Hello", "Hi"]);
    expect(updated?.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });
});
