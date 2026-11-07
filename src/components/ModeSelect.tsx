import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { BookmarkIcon, ChatIcon, CheckIcon, ChevronDownIcon } from "./icons";

export type Mode = "chat" | "save";

export const MODES: { value: Mode; label: string; description: string }[] = [
  { value: "chat", label: "Chat", description: "Talk it through with a model" },
  { value: "save", label: "Save", description: "Keep a thought to reopen later" },
];

export function modeIcon(mode: Mode, size = 15) {
  return mode === "chat" ? <ChatIcon size={size} /> : <BookmarkIcon size={size} />;
}

interface Props {
  value: Mode;
  onChange: (mode: Mode) => void;
}

/** A compact listbox-style dropdown for choosing what the composer does. */
export function ModeSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<Mode>(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    setHighlight(value);
    listRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, value]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (mode: Mode) => {
    onChange(mode);
    close();
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const index = MODES.findIndex((m) => m.value === highlight);
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        const next = MODES[(index + (e.key === "ArrowDown" ? 1 : MODES.length - 1)) % MODES.length];
        if (next) setHighlight(next.value);
        break;
      }
      case "Home":
        e.preventDefault();
        setHighlight(MODES[0]!.value);
        break;
      case "End":
        e.preventDefault();
        setHighlight(MODES[MODES.length - 1]!.value);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(highlight);
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const current = MODES.find((m) => m.value === value)!;

  return (
    <div className="mode" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="mode-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Mode: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {modeIcon(value)}
        <span>{current.label}</span>
        <ChevronDownIcon size={14} className="mode-chevron" />
      </button>
      {open && (
        <ul
          id={listId}
          ref={listRef}
          className="mode-menu"
          role="listbox"
          tabIndex={-1}
          aria-label="Choose a mode"
          aria-activedescendant={`${listId}-${highlight}`}
          onKeyDown={onListKey}
        >
          {MODES.map((m) => (
            <li
              key={m.value}
              id={`${listId}-${m.value}`}
              role="option"
              aria-selected={m.value === value}
              data-highlight={m.value === highlight || undefined}
              className="mode-option"
              onMouseMove={() => setHighlight(m.value)}
              onClick={() => choose(m.value)}
            >
              <span className="mode-option-icon">{modeIcon(m.value)}</span>
              <span className="mode-option-text">
                <span className="mode-option-label">{m.label}</span>
                <span className="mode-option-desc">{m.description}</span>
              </span>
              {m.value === value && <CheckIcon size={15} className="mode-option-check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
