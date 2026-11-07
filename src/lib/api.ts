import { ACCESS_HEADER, type ChatEvent, type ChatTurn, type StatusResponse } from "../../shared/protocol";

export type ApiStatus =
  | { state: "loading" }
  | { state: "ready"; configured: true; model: string; accessRequired: boolean; storage: { configured: boolean } }
  | { state: "ready"; configured: false; model: null; accessRequired: boolean; storage: { configured: boolean } }
  | { state: "unreachable" };

export async function fetchStatus(signal?: AbortSignal): Promise<ApiStatus> {
  try {
    const res = await fetch("/api/status", { signal });
    if (!res.ok) return { state: "unreachable" };
    const body = (await res.json()) as StatusResponse;
    const storage = body.storage ?? { configured: false };
    return body.configured
      ? { state: "ready", configured: true, model: body.model, accessRequired: body.accessRequired, storage }
      : { state: "ready", configured: false, model: null, accessRequired: body.accessRequired, storage };
  } catch {
    return { state: "unreachable" };
  }
}

/** Checks an access key with the server. Resolves true when accepted. */
export async function verifyAccessKey(key: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/access", { method: "POST", headers: { [ACCESS_HEADER]: key }, signal });
    return res.status === 204;
  } catch {
    return false;
  }
}

export interface ChatFailure {
  code: string;
  message: string;
}

/**
 * Streams a reply from the server. `onText` receives each text chunk.
 * Resolves with null on success or a failure describing why no (or no further) reply came.
 */
export async function streamChat(
  turns: ChatTurn[],
  onText: (chunk: string) => void,
  signal?: AbortSignal,
  accessKey?: string | null,
): Promise<ChatFailure | null> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessKey ? { [ACCESS_HEADER]: accessKey } : {}) },
      body: JSON.stringify({ messages: turns }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { code: "unreachable", message: "The server isn't running, so this message couldn't be sent." };
  }

  if (!res.ok) {
    try {
      const event = (await res.json()) as ChatEvent;
      if (event.type === "error") return { code: event.code, message: event.message };
    } catch {
      /* fall through */
    }
    return { code: "upstream", message: `The server returned an error (${res.status}).` };
  }
  if (!res.body) return { code: "upstream", message: "The server sent an empty reply." };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as ChatEvent;
      if (event.type === "text") onText(event.text);
      else if (event.type === "error") return { code: event.code, message: event.message };
      else if (event.type === "done") return null;
    }
    if (done) break;
  }
  return null;
}
