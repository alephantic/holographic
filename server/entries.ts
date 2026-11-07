import { Hono, type Context } from "hono";
import { cleanEntry, isEntry, isMessageRecord, MAX_NOTE_LENGTH, type Entry } from "../shared/entries.js";
import { ACCESS_HEADER } from "../shared/protocol.js";
import { accessGranted } from "./access.js";
import { storageConfigured } from "./db/client.js";
import * as repo from "./db/repository.js";

// Studio storage routes. Every route needs the access key (when one is set)
// and a configured database; the database credential never leaves the server.

const MAX_IMPORT_ENTRIES = 2_000;

type Failure = { error: { code: string; message: string } };
const fail = (code: string, message: string): Failure => ({ error: { code, message } });

export const entriesApp = new Hono();

entriesApp.use("*", async (c, next) => {
  if (!accessGranted(c.req.header(ACCESS_HEADER))) return c.json(fail("unauthorized", "This Holographic needs an access key."), 401);
  if (!storageConfigured()) return c.json(fail("storage_not_configured", "Studio storage isn't set up on this server."), 503);
  await next();
});

/** Turns repository errors into responses; anything else is a storage outage, reported without details. */
function guarded(handler: (c: Context) => Promise<Response>) {
  return async (c: Context): Promise<Response> => {
    try {
      return await handler(c);
    } catch (error) {
      if (error instanceof repo.NotFoundError) return c.json(fail("not_found", error.message), 404);
      if (error instanceof repo.ConflictError) return c.json(fail("conflict", error.message), 409);
      console.error("storage error:", error);
      return c.json(fail("storage_unavailable", "The studio's storage couldn't be reached."), 503);
    }
  };
}

entriesApp.get("/entries", guarded(async (c) => c.json({ library: await repo.listLibrary() })));

entriesApp.get("/entries/:id", guarded(async (c) => {
  const entry = await repo.getEntry((c.req.param("id") ?? ""));
  if (!entry) return c.json(fail("not_found", "No such entry."), 404);
  return c.json({ entry });
}));

entriesApp.post("/entries", guarded(async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!isEntry(body)) return c.json(fail("bad_request", "That isn't a valid entry."), 400);
  const entry = cleanEntry(body);
  await repo.createEntry(entry);
  return c.json({ entry }, 201);
}));

entriesApp.post("/entries/:id/messages", guarded(async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!isMessageRecord(body)) return c.json(fail("bad_request", "That isn't a valid message."), 400);
  const entry = await repo.appendMessage((c.req.param("id") ?? ""), body);
  return c.json({ entry }, 201);
}));

entriesApp.patch("/entries/:id/messages/:messageId", guarded(async (c) => {
  const body = (await c.req.json().catch(() => null)) as { note?: unknown } | null;
  const note = body?.note;
  if (note !== null && (typeof note !== "string" || note.length > MAX_NOTE_LENGTH)) {
    return c.json(fail("bad_request", "A note must be a short string or null."), 400);
  }
  await repo.setMessageNote((c.req.param("id") ?? ""), (c.req.param("messageId") ?? ""), note);
  return c.body(null, 204);
}));

entriesApp.delete("/entries/:id", guarded(async (c) => {
  const removed = await repo.deleteEntry((c.req.param("id") ?? ""));
  return removed ? c.body(null, 204) : c.json(fail("not_found", "No such entry."), 404);
}));

/** Preview (dryRun: true) or perform an import of entries from a browser export. Existing ids are skipped. */
entriesApp.post("/import", guarded(async (c) => {
  const body = (await c.req.json().catch(() => null)) as { entries?: unknown; dryRun?: unknown } | null;
  if (!body || !Array.isArray(body.entries)) return c.json(fail("bad_request", "Send { entries, dryRun }."), 400);
  if (body.entries.length > MAX_IMPORT_ENTRIES) return c.json(fail("bad_request", `Send at most ${MAX_IMPORT_ENTRIES} entries per request.`), 400);
  const entries: Entry[] = [];
  for (const candidate of body.entries) {
    if (!isEntry(candidate)) return c.json(fail("bad_request", "One of the entries isn't valid."), 400);
    if (!candidate.sample) entries.push(cleanEntry(candidate));
  }
  const plan = await repo.importEntries(entries, body.dryRun === true);
  return c.json(plan);
}));

/** The whole studio as a Holographic export file. */
entriesApp.get("/export", guarded(async (c) => {
  const library = await repo.listLibrary();
  const now = new Date();
  c.header("Content-Disposition", `attachment; filename="holographic-export-${now.toISOString().slice(0, 10)}.json"`);
  return c.json({ format: "holographic-export", version: 1, exportedAt: now.toISOString(), library });
}));
