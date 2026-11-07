import type { Entry } from "../lib/types";
import { BookmarkIcon, ChatIcon, CloseIcon, ComposeIcon } from "./icons";

interface Props {
  entries: Entry[];
  samples: Entry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

export function Sidebar({ entries, samples, activeId, onSelect, onNew, onClose }: Props) {
  return (
    <nav className="sidebar" aria-label="Sidebar">
      <div className="sidebar-top">
        <span className="wordmark">Holographic</span>
        <button type="button" className="icon-button sidebar-close" onClick={onClose} aria-label="Close sidebar">
          <CloseIcon size={18} />
        </button>
      </div>

      <button type="button" className="sidebar-new" onClick={onNew}>
        <ComposeIcon size={16} />
        <span>New</span>
      </button>

      <div className="sidebar-scroll">
        <section className="sidebar-section" aria-labelledby="recents-heading">
          <h2 id="recents-heading" className="sidebar-heading">
            Recents
          </h2>
          {entries.length === 0 ? (
            <p className="sidebar-empty">Nothing saved yet.</p>
          ) : (
            <ul className="sidebar-list">
              {entries.map((entry) => (
                <SidebarItem key={entry.id} entry={entry} active={entry.id === activeId} onSelect={onSelect} />
              ))}
            </ul>
          )}
        </section>

        {samples.length > 0 && (
          <section className="sidebar-section" aria-labelledby="samples-heading">
            <h2 id="samples-heading" className="sidebar-heading">
              Samples
            </h2>
            <ul className="sidebar-list">
              {samples.map((entry) => (
                <SidebarItem key={entry.id} entry={entry} active={entry.id === activeId} onSelect={onSelect} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </nav>
  );
}

function SidebarItem({ entry, active, onSelect }: { entry: Entry; active: boolean; onSelect: (id: string) => void }) {
  const kind = entry.kind === "chat" ? "chat" : "saved";
  const label = entry.sample ? `Sample ${kind}` : kind.charAt(0).toUpperCase() + kind.slice(1);
  return (
    <li>
      <button
        type="button"
        className="sidebar-item"
        aria-current={active ? "page" : undefined}
        onClick={() => onSelect(entry.id)}
        title={`${label}: ${entry.title}`}
      >
        <span className="visually-hidden">{`${label}: `}</span>
        <span className="sidebar-item-icon" aria-hidden="true">
          {entry.kind === "chat" ? <ChatIcon size={15} /> : <BookmarkIcon size={15} />}
        </span>
        <span className="sidebar-item-title">{entry.title}</span>
      </button>
    </li>
  );
}
