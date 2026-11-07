import { describe, expect, it } from "vitest";
import { MAX_CHARS_PER_REQUEST, MAX_CHARS_PER_TURN, MAX_TURNS } from "../../shared/limits";
import { messageTooLong, selectContext } from "./context";
import type { MessageRecord } from "./types";

function msgs(count: number, size: number, firstRole: "user" | "assistant" = "user"): MessageRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    role: (i % 2 === 0) === (firstRole === "user") ? "user" : "assistant",
    content: `${i}:`.padEnd(size, "x"),
    createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
  }));
}

describe("selectContext", () => {
  it("sends a short conversation whole", () => {
    const s = selectContext(msgs(5, 100))!;
    expect(s.omitted).toBe(0);
    expect(s.turns).toHaveLength(5);
    expect(s.turns[0]?.role).toBe("user");
  });

  it("keeps only the most recent turns when there are too many", () => {
    const s = selectContext(msgs(41, 100))!;
    expect(s.turns.length).toBeLessThanOrEqual(MAX_TURNS);
    expect(s.omitted).toBe(41 - s.turns.length);
    expect(s.turns[0]?.role).toBe("user");
    expect(s.turns[s.turns.length - 1]?.content.startsWith("40:")).toBe(true);
  });

  it("stays under the total character budget", () => {
    const s = selectContext(msgs(20, 5_000))!;
    const total = s.turns.reduce((n, t) => n + t.content.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_CHARS_PER_REQUEST);
    expect(s.turns.length).toBe(6);
    expect(s.omitted).toBe(14);
  });

  it("stops at an oversized earlier message rather than sending it", () => {
    const m = msgs(5, 100);
    m[2]!.content = "y".repeat(MAX_CHARS_PER_TURN + 1);
    const s = selectContext(m)!;
    expect(s.startIndex).toBeGreaterThan(2);
    expect(s.turns[0]?.role).toBe("user");
  });

  it("refuses when the latest message itself is too long", () => {
    const m = msgs(1, MAX_CHARS_PER_TURN + 1);
    expect(selectContext(m)).toBeNull();
    expect(messageTooLong(m[0]!.content)).toMatch(/8,001 characters/);
    expect(messageTooLong("fine")).toBeNull();
  });
});
