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
}

export function ChatView({ entry, pending, contextStart, onDelete }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastMessageId = entry.messages[entry.messages.length - 1]?.id;

  // Keep the newest content in view as messages arrive and while a reply streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastMessageId, pending]);

  return (
    <div className="column chat" aria-label={`Chat: ${entry.title}`}>
      <EntryHeader entry={entry} onDelete={onDelete} />
      <ol className="messages" aria-live="polite" aria-relevant="additions text">
        {entry.messages.map((m, i) => (
          <li key={m.id} className={`message message-${m.role}`}>
            {i === contextStart && i > 0 && (
              <p className="context-divider" role="note">
                Earlier messages are kept here but aren't sent with new replies.
              </p>
            )}
            <div className="message-body">{m.content}</div>
            {m.note && <p className="message-note">{m.note}</p>}
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
