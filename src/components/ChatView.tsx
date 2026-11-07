import { useEffect, useRef } from "react";
import type { ChatEntry } from "../lib/types";
import { EntryHeader } from "./EntryHeader";

interface Props {
  entry: ChatEntry;
  /** Partial assistant reply while streaming, or null. */
  pending: string | null;
  /** Index of the first message that will be sent with the next reply; earlier ones are kept but not sent. */
  contextStart: number;
  onDelete: (id: string) => void;
  /** Opens a saved entry that a reply drew on. */
  onOpenSource?: (id: string) => void;
  /** Opens the project memory, focused on one memory a reply cited. */
  onOpenMemory?: (id: string) => void;
  /** Proposes project memories from this chat; shown only when the studio is active. */
  onCapture?: () => void;
  captureState?: "idle" | "working" | "done";
  /** A message to scroll to and mark, e.g. the source of a memory. */
  highlightMessageId?: string | null;
}

export function ChatView({ entry, pending, contextStart, onDelete, onOpenSource, onOpenMemory, onCapture, captureState = "idle", highlightMessageId }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastMessageId = entry.messages[entry.messages.length - 1]?.id;

  // Keep the newest content in view as messages arrive and while a reply streams in.
  useEffect(() => {
    if (highlightMessageId) {
      document.getElementById(`message-${highlightMessageId}`)?.scrollIntoView({ block: "center" });
      return;
    }
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastMessageId, pending, highlightMessageId]);

  return (
    <div className="column chat" aria-label={`Chat: ${entry.title}`}>
      <EntryHeader entry={entry} onDelete={onDelete}>
        {onCapture && !entry.sample && (
          <button type="button" className="text-button" onClick={onCapture} disabled={captureState === "working"}>
            {captureState === "working" ? "Reading…" : captureState === "done" ? "Proposed, see Project memory" : "Remember this chat"}
          </button>
        )}
      </EntryHeader>
      <ol className="messages" aria-live="polite" aria-relevant="additions text">
        {entry.messages.map((m, i) => (
          <li key={m.id} id={`message-${m.id}`} className={`message message-${m.role}${m.id === highlightMessageId ? " message-highlight" : ""}`}>
            {i === contextStart && i > 0 && (
              <p className="context-divider" role="note">
                Earlier messages are kept here but aren't sent with new replies.
              </p>
            )}
            <div className="message-body">{m.content}</div>
            {m.note && <p className="message-note">{m.note}</p>}
            {m.role === "assistant" && m.memoryRefs && m.memoryRefs.length > 0 && (
              <p className="message-sources">
                <span className="message-sources-label">Memory</span>
                {m.memoryRefs.map((r) => (
                  <button key={r.id} type="button" className="source-chip" title={r.text} onClick={() => onOpenMemory?.(r.id)}>
                    {r.kind === "decision" ? "Decision" : "Open"}: {r.text.length > 40 ? `${r.text.slice(0, 40).trimEnd()}…` : r.text}
                  </button>
                ))}
              </p>
            )}
            {m.role === "assistant" && m.sources && (
              <p className="message-sources">
                {m.sources.length === 0 ? (
                  "No saved pages matched this question."
                ) : (
                  <>
                    <span className="message-sources-label">Sources</span>
                    {m.sources.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="source-chip"
                        title={s.title}
                        onClick={() => onOpenSource?.(s.id)}
                      >
                        {s.page !== undefined ? `Page ${s.page}` : s.title}
                      </button>
                    ))}
                  </>
                )}
              </p>
            )}
          </li>
        ))}
        {pending !== null && (
          <li className="message message-assistant" aria-busy="true">
            {pending ? (
              <div className="message-body">{pending}</div>
            ) : (
              <div className="message-body">
                <span className="thinking-dot" aria-label="Waiting for a reply" role="status" />
              </div>
            )}
          </li>
        )}
      </ol>
      <div ref={endRef} />
    </div>
  );
}
