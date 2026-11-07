import { useEffect, useState } from "react";
import { attributionLabel, type Memory, type MemoryEvent } from "../../shared/memory";
import { formatStamp } from "../lib/format";

interface Props {
  memories: Memory[];
  loading: boolean;
  error: string | null;
  /** Memory to draw attention to, e.g. one a reply cited. */
  highlightId: string | null;
  onAccept: (id: string, text: string | undefined, note: string | undefined) => Promise<void>;
  onReject: (id: string, note: string | undefined) => Promise<void>;
  onCorrect: (id: string, text: string, kind: "decision" | "open", note: string | undefined) => Promise<void>;
  onOpenSource: (entryId: string, messageId: string | null) => void;
  loadHistory: (id: string) => Promise<MemoryEvent[]>;
}

/** The project's memory: suggestions to review, then what has been accepted, with sources and history. */
export function MemoryView({ memories, loading, error, highlightId, onAccept, onReject, onCorrect, onOpenSource, loadHistory }: Props) {
  const suggested = memories.filter((m) => m.status === "suggested");
  const decisions = memories.filter((m) => m.status === "accepted" && m.kind === "decision");
  const open = memories.filter((m) => m.status === "accepted" && m.kind === "open");
  const rejected = memories.filter((m) => m.status === "rejected").length;
  const superseded = memories.filter((m) => m.status === "superseded").length;

  return (
    <div className="column memory" aria-label="Project memory">
      <div className="entry-header">
        <p className="entry-meta">
          <span>Project memory</span>
          <span className="entry-meta-sep" aria-hidden="true">·</span>
          <span>{decisions.length} decided, {open.length} open{suggested.length ? `, ${suggested.length} to review` : ""}</span>
        </p>
      </div>
      {error && (
        <p className="memory-error" role="alert">
          {error}
        </p>
      )}
      {loading && memories.length === 0 && <p className="memory-empty">Loading…</p>}
      {!loading && memories.length === 0 && !error && (
        <p className="memory-empty">Nothing yet. Open a chat and choose “Remember this chat” to propose decisions and open questions from it.</p>
      )}

      {suggested.length > 0 && (
        <Section title="To review" hint="Suggested from a conversation. Nothing counts until you accept it.">
          {suggested.map((m) => (
            <MemoryItem key={m.id} memory={m} mode="review" highlighted={m.id === highlightId} onAccept={onAccept} onReject={onReject} onCorrect={onCorrect} onOpenSource={onOpenSource} loadHistory={loadHistory} />
          ))}
        </Section>
      )}
      {decisions.length > 0 && (
        <Section title="Decisions" hint="Settled, as you accepted them.">
          {decisions.map((m) => (
            <MemoryItem key={m.id} memory={m} mode="accepted" highlighted={m.id === highlightId} onAccept={onAccept} onReject={onReject} onCorrect={onCorrect} onOpenSource={onOpenSource} loadHistory={loadHistory} />
          ))}
        </Section>
      )}
      {open.length > 0 && (
        <Section title="Open" hint="Ideas and questions still being considered.">
          {open.map((m) => (
            <MemoryItem key={m.id} memory={m} mode="accepted" highlighted={m.id === highlightId} onAccept={onAccept} onReject={onReject} onCorrect={onCorrect} onOpenSource={onOpenSource} loadHistory={loadHistory} />
          ))}
        </Section>
      )}
      {(rejected > 0 || superseded > 0) && (
        <p className="memory-empty">
          {[rejected ? `${rejected} rejected` : "", superseded ? `${superseded} earlier wording${superseded === 1 ? "" : "s"} kept in history` : ""].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="memory-section">
      <h2 className="memory-heading">
        {title} <span className="memory-hint">{hint}</span>
      </h2>
      <ul className="memory-list">{children}</ul>
    </section>
  );
}

function MemoryItem({
  memory,
  mode,
  highlighted,
  onAccept,
  onReject,
  onCorrect,
  onOpenSource,
  loadHistory,
}: {
  memory: Memory;
  mode: "review" | "accepted";
  highlighted: boolean;
} & Pick<Props, "onAccept" | "onReject" | "onCorrect" | "onOpenSource" | "loadHistory">) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.text);
  const [kind, setKind] = useState(memory.kind);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<MemoryEvent[] | null>(null);

  useEffect(() => {
    setText(memory.text);
    setKind(memory.kind);
  }, [memory.text, memory.kind]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      setEditing(false);
      setNote("");
    } finally {
      setBusy(false);
    }
  };

  const changed = text.trim() !== memory.text || kind !== memory.kind;
  const sourceLabel = memory.source.entryTitle ? `from “${memory.source.entryTitle}”` : "source unavailable";

  return (
    <li className={`memory-item${highlighted ? " memory-item-highlight" : ""}`} id={`memory-${memory.id}`} data-kind={memory.kind} data-status={memory.status}>
      <div className="memory-row">
        <span className={`memory-kind memory-kind-${memory.kind}`}>{memory.kind === "decision" ? "Decision" : "Open"}</span>
        {!editing ? (
          <p className="memory-text">{memory.text}</p>
        ) : (
          <div className="memory-edit">
            <textarea className="memory-textarea" value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label="Memory text" />
            <div className="memory-edit-row">
              <label className="memory-kind-select">
                <select value={kind} onChange={(e) => setKind(e.target.value as "decision" | "open")} aria-label="Kind">
                  <option value="decision">Decision</option>
                  <option value="open">Open</option>
                </select>
              </label>
              <input className="memory-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (optional)" aria-label="Correction note" />
            </div>
          </div>
        )}
      </div>
      <p className="memory-meta">
        <span className={`memory-attr memory-attr-${memory.attributedTo}`}>{attributionLabel(memory.attributedTo)}</span>
        {memory.source.entryId ? (
          <button type="button" className="text-button memory-source" onClick={() => onOpenSource(memory.source.entryId!, memory.source.messageId)}>
            {sourceLabel}
          </button>
        ) : (
          <span>{sourceLabel}</span>
        )}
        {memory.source.quote && <q className="memory-quote">{memory.source.quote}</q>}
        {memory.text !== memory.originalText && <span className="memory-edited">edited from the proposal</span>}
        {memory.supersedes && <span className="memory-edited">corrected</span>}
      </p>
      <div className="memory-actions">
        {mode === "review" && !editing && (
          <>
            <button type="button" className="text-button text-button-primary" disabled={busy} onClick={() => run(() => onAccept(memory.id, undefined, undefined))}>
              Accept
            </button>
            <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="text-button" disabled={busy} onClick={() => run(() => onReject(memory.id, undefined))}>
              Reject
            </button>
          </>
        )}
        {mode === "accepted" && !editing && (
          <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(true)}>
            Correct
          </button>
        )}
        {editing && (
          <>
            <button
              type="button"
              className="text-button text-button-primary"
              disabled={busy || !text.trim() || (mode === "accepted" && !changed)}
              onClick={() =>
                run(() => (mode === "review" ? onAccept(memory.id, text.trim(), note.trim() || undefined) : onCorrect(memory.id, text.trim(), kind, note.trim() || undefined)))
              }
            >
              {mode === "review" ? "Accept as edited" : "Save correction"}
            </button>
            <button type="button" className="text-button" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        )}
        <button
          type="button"
          className="text-button"
          onClick={async () => setHistory(history ? null : await loadHistory(memory.id))}
          aria-expanded={history !== null}
        >
          {history ? "Hide history" : "History"}
        </button>
      </div>
      {history && (
        <ol className="memory-history">
          {history.map((e) => (
            <li key={e.id}>
              <span className="memory-history-when">{formatStamp(e.at)}</span> {describeEvent(e)}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function describeEvent(e: MemoryEvent): string {
  const note = e.note ? ` — “${e.note}”` : "";
  switch (e.action) {
    case "proposed":
      return `proposed: “${e.toText ?? ""}”`;
    case "accepted":
      return `accepted${note}`;
    case "rejected":
      return `rejected${note}`;
    case "edited":
      return `wording changed from “${e.fromText ?? ""}” to “${e.toText ?? ""}”${note}`;
    case "superseded":
      return `superseded: “${e.fromText ?? ""}” → “${e.toText ?? ""}”${note}`;
    case "created":
      return `correction recorded${note}`;
  }
}
