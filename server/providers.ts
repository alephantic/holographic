// Model providers. The server picks one from the environment; the client only
// ever sees the provider name and model id, never a credential.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ChatTurn } from "../shared/protocol.js";

export type ProviderName = "openai" | "anthropic" | "test";

export interface ReplyResult {
  /** Set when the model stopped for a reason the person should know about. */
  refusal?: string;
}

export interface Provider {
  name: ProviderName;
  model: string;
  /** Streams text chunks to `onText`; resolves when the reply is complete. */
  reply(system: string, turns: ChatTurn[], onText: (text: string) => Promise<void>): Promise<ReplyResult>;
  /** One non-streamed completion, used for structured work such as proposing memories. */
  complete(system: string, user: string): Promise<string>;
  /** Maps an SDK error to a short message safe to show in the interface. */
  describeError(error: unknown): string;
}

/** Upper bound on reply length, so one request cannot run away. */
const MAX_OUTPUT_TOKENS = 2_000;

const DEFAULT_MODELS: Record<Exclude<ProviderName, "test">, string> = {
  openai: "gpt-5",
  anthropic: "claude-opus-5-5",
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Returns the configured provider, or null when no credential is present. */
export function selectProvider(): Provider | null {
  // A deterministic stand-in for automated tests only; never available in production.
  if (env("HOLOGRAPHIC_TEST_PROVIDER") === "1" && process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") return testProvider();
  if (env("OPENAI_API_KEY")) return openAiProvider(env("HOLOGRAPHIC_MODEL") ?? DEFAULT_MODELS.openai);
  if (env("ANTHROPIC_API_KEY")) return anthropicProvider(env("HOLOGRAPHIC_MODEL") ?? DEFAULT_MODELS.anthropic);
  return null;
}

function openAiProvider(model: string): Provider {
  return {
    name: "openai",
    model,
    async reply(system, turns, onText) {
      const client = new OpenAI(); // reads OPENAI_API_KEY from the environment
      const stream = await client.chat.completions.create({
        model,
        stream: true,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: "system", content: system }, ...turns.map((t) => ({ role: t.role, content: t.content }))],
      });
      let finish: string | null | undefined;
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.delta?.content) await onText(choice.delta.content);
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      if (finish === "content_filter") return { refusal: "The model declined to answer this message." };
      return {};
    },
    async complete(system, user) {
      const client = new OpenAI();
      const r = await client.chat.completions.create({
        model,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      return r.choices[0]?.message?.content ?? "";
    },
    describeError(error) {
      if (error instanceof OpenAI.AuthenticationError) return "The server's OpenAI API key was rejected.";
      if (error instanceof OpenAI.RateLimitError) return "The model is rate-limited right now. Try again shortly.";
      if (error instanceof OpenAI.NotFoundError) return `The model "${model}" was not found. Check HOLOGRAPHIC_MODEL in .env.`;
      if (error instanceof OpenAI.APIConnectionError) return "Could not reach the model service.";
      if (error instanceof OpenAI.APIError) return `Model error (${error.status ?? "unknown"}): ${error.message}`;
      return "The model request failed.";
    },
  };
}

function anthropicProvider(model: string): Provider {
  return {
    name: "anthropic",
    model,
    async reply(system, turns, onText) {
      const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
      const stream = client.messages.stream({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        messages: turns.map((t) => ({ role: t.role, content: t.content })),
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") await onText(event.delta.text);
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        return { refusal: final.stop_details?.explanation ?? "The model declined to answer this message." };
      }
      return {};
    },
    async complete(system, user) {
      const client = new Anthropic();
      const r = await client.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        messages: [{ role: "user", content: user }],
      });
      return r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    },
    describeError(error) {
      if (error instanceof Anthropic.AuthenticationError) return "The server's Anthropic API key was rejected.";
      if (error instanceof Anthropic.RateLimitError) return "The model is rate-limited right now. Try again shortly.";
      if (error instanceof Anthropic.NotFoundError) return `The model "${model}" was not found. Check HOLOGRAPHIC_MODEL in .env.`;
      if (error instanceof Anthropic.APIConnectionError) return "Could not reach the model service.";
      if (error instanceof Anthropic.APIError) return `Model error (${error.status}): ${error.message}`;
      return "The model request failed.";
    },
  };
}

/**
 * Test-only provider: replies echo what they were given so tests can check the
 * context, and memory proposals follow simple textual markers in the conversation.
 * Enabled by HOLOGRAPHIC_TEST_PROVIDER=1 outside production.
 */
function testProvider(): Provider {
  return {
    name: "test",
    model: "test-model",
    async reply(system, turns, onText) {
      const last = turns[turns.length - 1]?.content ?? "";
      const memoryBlock = /PROJECT MEMORY:[\s\S]*?(?=\n\n<<<|$)/.exec(system)?.[0] ?? "";
      // Labels come only from item lines ("[MD1] DECISION: …"), not from the rules' example.
      const refs = [...memoryBlock.matchAll(/^\[(M[DO]\d+)\] (?:DECISION|OPEN):/gm)].map((m) => m[1] ?? "").filter(Boolean);
      let text: string;
      if (/where did we leave|where are we|status of the project/i.test(last)) {
        text = refs.length
          ? `Decided so far: ${refs.filter((r) => r.startsWith("MD")).join(", ") || "nothing established"}. Still open: ${refs.filter((r) => r.startsWith("MO")).join(", ") || "nothing recorded"}. Suggestion (mine, not a decision): review the open items next. ${refs.map((r) => `[${r}]`).join(" ")}`
          : "No project memory is established yet, so I can't say where this was left.";
      } else if (/mayor|bicycle/i.test(last)) {
        text = "The saved pages and project memory don't cover that, so I don't know.";
      } else {
        text = `Test reply to: ${last.slice(0, 60)}`;
      }
      await onText(text);
      return {};
    },
    async complete(_system, user) {
      // Proposals: a user line beginning "Decision:" -> decision; "Maybe" -> open; an assistant line with "You could" -> suggestion.
      const candidates: unknown[] = [];
      for (const m of user.matchAll(/^\[([^\]]+)\] (user|assistant): ([\s\S]*?)(?=\n\[|$)/gm)) {
        const [, id, role, content] = m;
        const text = content!.trim();
        if (role === "user" && /^Decision:/i.test(text)) {
          candidates.push({ kind: "decision", text: text.replace(/^Decision:\s*/i, ""), message_id: id, quote: text.split("\n")[0], speaker: "person" });
        } else if (role === "user" && /^Maybe/i.test(text)) {
          candidates.push({ kind: "open", text: text, message_id: id, quote: text.split("\n")[0], speaker: "person" });
        } else if (role === "assistant" && /You could/i.test(text)) {
          candidates.push({ kind: "decision", text: text, message_id: id, quote: text.split("\n")[0], speaker: "assistant" });
        } else if (role === "user" && /decided to/i.test(text)) {
          // A pasted story line: the naive proposal calls it a decision; the server must not.
          const quote = /“([^”]+)”/.exec(text)?.[1] ?? text.split("\n")[0];
          candidates.push({ kind: "decision", text: quote, message_id: id, quote, speaker: "person" });
        }
      }
      return JSON.stringify({ candidates });
    },
    describeError: () => "Test provider error.",
  };
}
