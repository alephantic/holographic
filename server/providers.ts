// Model providers. The server picks one from the environment; the client only
// ever sees the provider name and model id, never a credential.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ChatTurn } from "../shared/protocol.js";

export type ProviderName = "openai" | "anthropic";

export interface ReplyResult {
  /** Set when the model stopped for a reason the person should know about. */
  refusal?: string;
}

export interface Provider {
  name: ProviderName;
  model: string;
  /** Streams text chunks to `onText`; resolves when the reply is complete. */
  reply(system: string, turns: ChatTurn[], onText: (text: string) => Promise<void>): Promise<ReplyResult>;
  /** Maps an SDK error to a short message safe to show in the interface. */
  describeError(error: unknown): string;
}

/** Upper bound on reply length, so one request cannot run away. */
const MAX_OUTPUT_TOKENS = 2_000;

const DEFAULT_MODELS: Record<ProviderName, string> = {
  openai: "gpt-5",
  anthropic: "claude-opus-5-5",
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Returns the configured provider, or null when no credential is present. */
export function selectProvider(): Provider | null {
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
