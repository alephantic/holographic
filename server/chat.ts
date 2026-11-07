import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { MAX_CHARS_PER_REQUEST, MAX_CHARS_PER_TURN, MAX_TURNS } from "../shared/limits.js";
import { ACCESS_HEADER, type ChatEvent, type ChatRequest, type ChatTurn, type StatusResponse } from "../shared/protocol.js";
import { accessGranted, accessKeyRequired } from "./access.js";
import { storageConfigured } from "./db/client.js";
import { selectProvider } from "./providers.js";

const SYSTEM_PROMPT =
  "You are the conversational side of Holographic, a composition studio for writing, design, music, " +
  "and research. Be a thoughtful collaborator: clear, concrete, and unhurried. Prefer plain prose; " +
  "use lists only when they genuinely help. Match the length of your reply to the question.";

type Validated = { turns: ChatTurn[] } | { error: string };

/** Checks the request shape and the shared limits, naming the problem so the interface can show it. */
function validate(body: unknown): Validated {
  if (!body || typeof body !== "object") return { error: "The request wasn't understood." };
  const { messages } = body as Partial<ChatRequest>;
  if (!Array.isArray(messages) || messages.length === 0) return { error: "The request had no messages." };
  if (messages.length > MAX_TURNS) {
    return { error: `Too many messages in one request (${messages.length}; the limit is ${MAX_TURNS}).` };
  }
  const turns: ChatTurn[] = [];
  let total = 0;
  for (const turn of messages) {
    if (!turn || typeof turn !== "object") return { error: "The request wasn't understood." };
    const { role, content } = turn as Partial<ChatTurn>;
    if (role !== "user" && role !== "assistant") return { error: "The request wasn't understood." };
    if (typeof content !== "string" || content.trim() === "") return { error: "A message was empty." };
    if (content.length > MAX_CHARS_PER_TURN) {
      return { error: `A message is too long (${content.length.toLocaleString()} characters; the limit is ${MAX_CHARS_PER_TURN.toLocaleString()}).` };
    }
    total += content.length;
    if (total > MAX_CHARS_PER_REQUEST) {
      return { error: `The conversation sent is too long (over ${MAX_CHARS_PER_REQUEST.toLocaleString()} characters in one request).` };
    }
    turns.push({ role, content });
  }
  if (turns[0]?.role !== "user" || turns[turns.length - 1]?.role !== "user") {
    return { error: "The request must start and end with your message." };
  }
  return { turns };
}

export const chatApp = new Hono();

chatApp.get("/status", (c) => {
  const provider = selectProvider();
  const accessRequired = accessKeyRequired();
  const storage = { configured: storageConfigured() };
  const status: StatusResponse = provider
    ? { configured: true, provider: provider.name, model: provider.model, accessRequired, storage }
    : { configured: false, provider: null, model: null, accessRequired, storage };
  return c.json(status);
});

/** Lets the interface check an access key once, before storing it. */
chatApp.post("/access", (c) => {
  if (!accessGranted(c.req.header(ACCESS_HEADER))) return c.body(null, 401);
  return c.body(null, 204);
});

chatApp.post("/chat", async (c) => {
  if (!accessGranted(c.req.header(ACCESS_HEADER))) {
    const event: ChatEvent = { type: "error", code: "unauthorized", message: "This Holographic needs an access key to chat." };
    return c.json(event, 401);
  }

  const provider = selectProvider();
  if (!provider) {
    const event: ChatEvent = {
      type: "error",
      code: "not_configured",
      message: "No model is connected. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to the server's .env to enable Chat.",
    };
    return c.json(event, 503);
  }

  const validated = validate(await c.req.json().catch(() => null));
  if ("error" in validated) {
    const event: ChatEvent = { type: "error", code: "bad_request", message: validated.error };
    return c.json(event, 400);
  }
  const { turns } = validated;

  return streamText(c, async (stream) => {
    const send = async (event: ChatEvent) => {
      await stream.writeln(JSON.stringify(event));
    };
    try {
      const result = await provider.reply(SYSTEM_PROMPT, turns, (text) => send({ type: "text", text }));
      if (result.refusal) await send({ type: "error", code: "refusal", message: result.refusal });
      else await send({ type: "done" });
    } catch (error) {
      console.error("chat error:", error);
      await send({ type: "error", code: "upstream", message: provider.describeError(error) });
    }
  });
});
