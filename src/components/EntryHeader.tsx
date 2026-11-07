import { useState } from "react";
import { formatStamp } from "../lib/format";
import type { Entry } from "../lib/types";

interface Props {
  entry: Entry;
  onDelete?: (id: string) => void;
}

/** Small line above an opened entry: what it is, when it was made, and a quiet delete. */
export function EntryHeader({ entry, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const kind = entry.kind === "chat" ? "Chat" : "Saved";

  return (
    <div className="entry-header">
      <p className="entry-meta">
        {entry.sample ? (
          <>
            <span className="entry-tag">Sample</span>
            <span className="entry-meta-sep" aria-hidden="true">
              ·
            </span>
            <span>{kind.toLowerCase()} · a built-in example, not stored</span>
          </>
        ) : (
          <>
            <span>{kind}</span>
            <span className="entry-meta-sep" aria-hidden="true">
              ·
            </span>
            <time dateTime={entry.createdAt}>{formatStamp(entry.createdAt)}</time>
          </>
        )}
      </p>
      {!entry.sample && onDelete && (
        <div className="entry-actions">
          {confirming ? (
            <>
              <span className="entry-confirm-text">Delete this {kind.toLowerCase()}?</span>
              <button type="button" className="text-button text-button-danger" onClick={() => onDelete(entry.id)}>
                Delete
              </button>
              <button type="button" className="text-button" onClick={() => setConfirming(false)} autoFocus>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="text-button" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
