import { Hono } from "hono";
import { streamText } from "hono/streaming";
import { ACCESS_HEADER, type ChatEvent, type ChatRequest, type ChatTurn, type StatusResponse } from "../shared/protocol.js";
import { accessGranted, accessKeyRequired } from "./access.js";
import { selectProvider } from "./providers.js";

// Per-request caps. They bound what one call can cost; they are not access control.
const MAX_TURNS = 24;
const MAX_CHARS_PER_TURN = 8_000;
const MAX_CHARS_PER_REQUEST = 32_000;

const SYSTEM_PROMPT =
  "You are the conversational side of Holographic, a composition studio for writing, design, music, " +
  "and research. Be a thoughtful collaborator: clear, concrete, and unhurried. Prefer plain prose; " +
  "use lists only when they genuinely help. Match the length of your reply to the question.";

function validate(body: unknown): ChatTurn[] | null {
  if (!body || typeof body !== "object") return null;
  const { messages } = body as Partial<ChatRequest>;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_TURNS) return null;
  const turns: ChatTurn[] = [];
  let total = 0;
  for (const turn of messages) {
    if (!turn || typeof turn !== "object") return null;
    const { role, content } = turn as Partial<ChatTurn>;
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" || content.trim() === "" || content.length > MAX_CHARS_PER_TURN) return null;
    total += content.length;
    if (total > MAX_CHARS_PER_REQUEST) return null;
    turns.push({ role, content });
  }
  if (turns[0]?.role !== "user" || turns[turns.length - 1]?.role !== "user") return null;
  return turns;
}

export const chatApp = new Hono();

chatApp.get("/status", (c) => {
  const provider = selectProvider();
  const accessRequired = accessKeyRequired();
  const status: StatusResponse = provider
    ? { configured: true, provider: provider.name, model: provider.model, accessRequired }
    : { configured: false, provider: null, model: null, accessRequired };
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

  const turns = validate(await c.req.json().catch(() => null));
  if (!turns) {
    const event: ChatEvent = { type: "error", code: "bad_request", message: "Malformed chat request." };
    return c.json(event, 400);
  }

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
