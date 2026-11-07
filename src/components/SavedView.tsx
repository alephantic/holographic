import type { SavedEntry } from "../lib/types";
import { EntryHeader } from "./EntryHeader";

interface Props {
  entry: SavedEntry;
  onDelete: (id: string) => void;
}

export function SavedView({ entry, onDelete }: Props) {
  return (
    <article className="column saved" aria-label={`Saved: ${entry.title}`}>
      <EntryHeader entry={entry} onDelete={onDelete} />
      <div className="saved-body">{entry.body}</div>
    </article>
  );
}
