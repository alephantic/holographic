import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { MAX_CHARS_PER_TURN } from "../../shared/limits";
import { ArrowUpIcon, StopIcon } from "./icons";
import { ModeSelect, type Mode } from "./ModeSelect";

interface Props {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onSubmit: (text: string) => void;
  /** True while a chat reply is streaming; the submit button becomes Stop. */
  busy: boolean;
  onStop: () => void;
  /** True while the shared studio is still loading; typing is fine, sending waits. */
  held?: boolean;
  autoFocus?: boolean;
}

const PLACEHOLDER: Record<Mode, string> = {
  chat: "Message Holographic",
  save: "Write a thought to keep",
};

export function Composer({ mode, onModeChange, onSubmit, busy, onStop, held = false, autoFocus }: Props) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Chat messages are capped by what one request can carry; saved thoughts are not.
  const limit = mode === "chat" ? MAX_CHARS_PER_TURN : null;
  const overLimit = limit !== null && text.length > limit;
  const showCount = limit !== null && text.length > limit * 0.8;
  const canSubmit = text.trim().length > 0 && !busy && !held && !overLimit;

  const fit = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, []);

  useLayoutEffect(fit, [text, fit]);

  useEffect(() => {
    // Only grab focus where a keyboard is likely present; on touch devices this
    // would pop the keyboard before the person has chosen what to do.
    if (autoFocus && window.matchMedia("(pointer: fine)").matches) textareaRef.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(text.trim());
    setText("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="composer"
      aria-label={mode === "chat" ? "Chat composer" : "Save composer"}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={textareaRef}
        className="composer-input"
        rows={1}
        value={text}
        placeholder={PLACEHOLDER[mode]}
        aria-label={PLACEHOLDER[mode]}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck
      />
      <div className="composer-row">
        <ModeSelect value={mode} onChange={onModeChange} />
        {showCount && (
          <span className={`composer-count${overLimit ? " composer-count-over" : ""}`} role="status">
            {text.length.toLocaleString()} / {limit!.toLocaleString()}
            {overLimit && <span className="visually-hidden">. Too long to send; shorten it or send it in parts.</span>}
          </span>
        )}
        {busy ? (
          <button key="stop" type="button" className="composer-send" onClick={onStop} aria-label="Stop generating">
            <StopIcon size={16} />
          </button>
        ) : (
          <button
            key="send"
            type="submit"
            className="composer-send"
            disabled={!canSubmit}
            aria-label={mode === "chat" ? "Send message" : "Save thought"}
          >
            <ArrowUpIcon size={18} />
          </button>
        )}
      </div>
    </form>
  );
}
