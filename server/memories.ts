import { Hono, type Context } from "hono";
import { MAX_MEMORY_NOTE, MAX_MEMORY_TEXT } from "../shared/memory.js";
import { ACCESS_HEADER } from "../shared/protocol.js";
import { accessGranted } from "./access.js";
import { storageConfigured } from "./db/client.js";
import * as mem from "./db/memories.js";
import { newId } from "./db/ids.js";
import { ConflictError, getEntry, NotFoundError } from "./db/repository.js";
import { assembleMemoryContext, MAX_MEMORY_CONTEXT_CHARS, proposeFromChat } from "./memory.js";
import { selectProvider } from "./providers.js";

// Project memory routes: propose from a chat, review, correct, and read history.
// Same access key and storage requirement as every other content route.

type Failure = { error: { code: string; message: string } };
const fail = (code: string, message: string): Failure => ({ error: { code, message } });

export const memoriesApp = new Hono();

memoriesApp.use("*", async (c, next) => {
  if (!accessGranted(c.req.header(ACCESS_HEADER))) return c.json(fail("unauthorized", "This Holographic needs an access key."), 401);
  if (!storageConfigured()) return c.json(fail("storage_not_configured", "Studio storage isn't set up on this server."), 503);
  await next();
});

function guarded(handler: (c: Context) => Promise<Response>) {
  return async (c: Context): Promise<Response> => {
    try {
      return await handler(c);
    } catch (error) {
      if (error instanceof NotFoundError) return c.json(fail("not_found", error.message), 404);
      if (error instanceof ConflictError) return c.json(fail("conflict", error.message), 409);
      console.error("memory error:", error);
      return c.json(fail("storage_unavailable", "The studio's storage couldn't be reached."), 503);
    }
  };
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);

memoriesApp.get("/project", guarded(async (c) => {
  const project = await mem.ensureProject();
  const memories = await mem.listMemories(project.id);
  // What a chat would receive right now, so the interface can show what is and isn't included.
  const context = assembleMemoryContext(memories.filter((m) => m.status === "accepted"));
  return c.json({
    project,
    memories,
    context: { limit: MAX_MEMORY_CONTEXT_CHARS, included: context.refs.map((r) => r.id), omitted: context.omitted.map((m) => m.id) },
  });
}));

/** Reads one chat and proposes candidate memories from it (one model call). Nothing is accepted here. */
memoriesApp.post("/project/capture", guarded(async (c) => {
  const body = (await c.req.json().catch(() => null)) as { entryId?: unknown } | null;
  const entryId = typeof body?.entryId === "string" ? body.entryId : "";
  if (!entryId) return c.json(fail("bad_request", "Send { entryId }."), 400);
  const entry = await getEntry(entryId);
  if (!entry) return c.json(fail("not_found", "No such entry."), 404);
  if (entry.kind !== "chat") return c.json(fail("bad_request", "Only a chat can be captured."), 400);
  const provider = selectProvider();
  if (!provider) return c.json(fail("not_configured", "No model is connected, so nothing can be proposed."), 503);
  const project = await mem.ensureProject();
  const candidates = await proposeFromChat(entry, provider, newId);
  const stored = await mem.proposeCandidates(project.id, candidates);
  const adjustments = Object.fromEntries(candidates.filter((x) => x.adjusted).map((x) => [x.id, x.adjusted]));
  return c.json({ proposed: stored, adjustments, considered: candidates.length });
}));

memoriesApp.post("/memories/:id/accept", guarded(async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown; note?: unknown };
  return c.json({ memory: await mem.acceptMemory(c.req.param("id") ?? "", text(body.text, MAX_MEMORY_TEXT), text(body.note, MAX_MEMORY_NOTE)) });
}));

memoriesApp.post("/memories/:id/reject", guarded(async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { note?: unknown };
  return c.json({ memory: await mem.rejectMemory(c.req.param("id") ?? "", text(body.note, MAX_MEMORY_NOTE)) });
}));

/** Corrects an accepted memory: a new accepted row supersedes it; the old one and the change are kept. */
memoriesApp.post("/memories/:id/correct", guarded(async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: unknown; kind?: unknown; note?: unknown };
  const next = text(body.text, MAX_MEMORY_TEXT);
  if (!next) return c.json(fail("bad_request", "Send the corrected text."), 400);
  const kind = body.kind === "decision" || body.kind === "open" ? body.kind : undefined;
  return c.json({ memory: await mem.supersedeMemory(c.req.param("id") ?? "", newId(), next, kind, text(body.note, MAX_MEMORY_NOTE)) });
}));

memoriesApp.get("/memories/:id/history", guarded(async (c) => {
  const memory = await mem.getMemory(c.req.param("id") ?? "");
  if (!memory) return c.json(fail("not_found", "No such memory."), 404);
  return c.json({ memory, events: await mem.memoryHistory(memory.id) });
}));
