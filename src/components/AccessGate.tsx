import { useState, type FormEvent } from "react";
import { verifyAccessKey } from "../lib/api";

interface Props {
  /** Shown when a stored key was refused, e.g. after it was rotated. */
  reason?: string;
  /** What the key unlocks: just Chat, or the shared studio storage too. */
  scope: "chat" | "studio";
  onUnlocked: (key: string) => void;
}

/** One-time entry of the shared access key that lets this browser use Chat. */
export function AccessGate({ reason, scope, onUnlocked }: Props) {
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setError(null);
    const ok = await verifyAccessKey(trimmed);
    setChecking(false);
    if (ok) onUnlocked(trimmed);
    else setError("That key wasn't accepted.");
  };

  return (
    <form className="gate" onSubmit={submit} aria-label="Access key">
      <p className="gate-text">
        <strong>{reason ?? (scope === "studio" ? "The studio needs an access key." : "Chat needs an access key.")}</strong>{" "}
        {scope === "studio" ? "Until then, entries stay in this browser." : "Save works without one."}
      </p>
      <div className="gate-row">
        <input
          className="gate-input"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Access key"
          aria-label="Access key"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "gate-error" : undefined}
          autoComplete="off"
        />
        <button type="submit" className="gate-button" disabled={!key.trim() || checking}>
          {checking ? "Checking…" : "Unlock"}
        </button>
      </div>
      {error && (
        <p id="gate-error" className="gate-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
