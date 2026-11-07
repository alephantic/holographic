import { ACCESS_HEADER } from "../../shared/protocol";
import type { ExportDocument } from "./transfer";
import type { ChatEntry, Entry, Library, MessageRecord } from "./types";
import type { Memory, MemoryEvent, Project } from "../../shared/memory";

// Client for the server's studio storage routes. Every call carries the
// access key when one is in use; the database itself is never reachable
// from the browser.

export class StudioError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, key: string | null, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      // Writes should finish even if the page is closed a moment later.
      keepalive: init.method !== undefined && init.method !== "GET",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { [ACCESS_HEADER]: key } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new StudioError("unreachable", "The server isn't reachable.");
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new StudioError(body?.error?.code ?? "upstream", body?.error?.message ?? `The server returned an error (${res.status}).`);
  }
  return body as T;
}

export const studio = {
  fetchLibrary: (key: string | null) => call<{ library: Library }>("/entries", key).then((r) => r.library),
  createEntry: (entry: Entry, key: string | null) =>
    call<{ entry: Entry }>("/entries", key, { method: "POST", body: JSON.stringify(entry) }).then((r) => r.entry),
  appendMessage: (chatId: string, message: MessageRecord, key: string | null) =>
    call<{ entry: ChatEntry }>(`/entries/${encodeURIComponent(chatId)}/messages`, key, { method: "POST", body: JSON.stringify(message) }).then(
      (r) => r.entry,
    ),
  setNote: (chatId: string, messageId: string, note: string | null, key: string | null) =>
    call<void>(`/entries/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`, key, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    }),
  deleteEntry: (id: string, key: string | null) => call<void>(`/entries/${encodeURIComponent(id)}`, key, { method: "DELETE" }),
  importEntries: (entries: Entry[], dryRun: boolean, key: string | null) =>
    call<{ added: string[]; skipped: string[] }>("/import", key, { method: "POST", body: JSON.stringify({ entries, dryRun }) }),
  fetchExport: (key: string | null) => call<ExportDocument>("/export", key),

  // Project memory
  fetchProject: (key: string | null) => call<{ project: Project; memories: Memory[] }>("/project", key),
  capture: (entryId: string, key: string | null) =>
    call<{ proposed: Memory[]; adjustments: Record<string, string>; considered: number }>("/project/capture", key, {
      method: "POST",
      body: JSON.stringify({ entryId }),
    }),
  acceptMemory: (id: string, text: string | undefined, note: string | undefined, key: string | null) =>
    call<{ memory: Memory }>(`/memories/${encodeURIComponent(id)}/accept`, key, { method: "POST", body: JSON.stringify({ text, note }) }).then((r) => r.memory),
  rejectMemory: (id: string, note: string | undefined, key: string | null) =>
    call<{ memory: Memory }>(`/memories/${encodeURIComponent(id)}/reject`, key, { method: "POST", body: JSON.stringify({ note }) }).then((r) => r.memory),
  correctMemory: (id: string, text: string, kind: "decision" | "open" | undefined, note: string | undefined, key: string | null) =>
    call<{ memory: Memory }>(`/memories/${encodeURIComponent(id)}/correct`, key, { method: "POST", body: JSON.stringify({ text, kind, note }) }).then((r) => r.memory),
  memoryHistory: (id: string, key: string | null) => call<{ memory: Memory; events: MemoryEvent[] }>(`/memories/${encodeURIComponent(id)}/history`, key),
};
