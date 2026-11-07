import { useRef, useState, type ChangeEvent } from "react";
import { applyMerge, createExport, exportFileName, parseExport, planMerge, type MergePreview } from "../lib/transfer";
import type { Library } from "../lib/types";

interface Props {
  library: Library;
  onImport: (next: Library) => void;
}

type ImportState =
  | { step: "idle" }
  | { step: "preview"; name: string; plan: MergePreview }
  | { step: "done"; added: number; skipped: number }
  | { step: "error"; reason: string };

/** Export the library as a JSON file, or import one with a preview first. Entries match by id, so re-importing adds nothing twice. */
export function Transfer({ library, onImport }: Props) {
  const [state, setState] = useState<ImportState>({ step: "idle" });
  const fileRef = useRef<HTMLInputElement>(null);
  const count = library.entries.length;

  const exportNow = () => {
    const now = new Date();
    const blob = new Blob([JSON.stringify(createExport(library, now), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(now);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const parsed = parseExport(await file.text());
    if (!parsed.ok) {
      setState({ step: "error", reason: parsed.reason });
      return;
    }
    setState({ step: "preview", name: file.name, plan: planMerge(library, parsed.entries) });
  };

  const confirm = () => {
    if (state.step !== "preview") return;
    onImport(applyMerge(library, state.plan));
    setState({ step: "done", added: state.plan.added.length, skipped: state.plan.skipped.length });
  };

  return (
    <div className="transfer" aria-live="polite">
      {state.step === "preview" ? (
        <div className="transfer-panel" role="group" aria-label="Import preview">
          <p className="transfer-text">
            <strong>{state.name}</strong>
            <br />
            {describe(state.plan)}
          </p>
          <div className="transfer-actions">
            {state.plan.added.length > 0 && (
              <button type="button" className="text-button text-button-primary" onClick={confirm}>
                Add {state.plan.added.length}
              </button>
            )}
            <button type="button" className="text-button" onClick={() => setState({ step: "idle" })}>
              {state.plan.added.length > 0 ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {state.step === "done" && (
            <p className="transfer-text">
              Added {state.added}{state.skipped > 0 ? `, ${state.skipped} already here` : ""}.
            </p>
          )}
          {state.step === "error" && (
            <p className="transfer-text transfer-error" role="alert">
              {state.reason}
            </p>
          )}
          <div className="transfer-actions">
            <button type="button" className="text-button" onClick={exportNow} disabled={count === 0}>
              Export
            </button>
            <button type="button" className="text-button" onClick={() => fileRef.current?.click()}>
              Import…
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pick} aria-label="Import file" />
          </div>
        </>
      )}
    </div>
  );
}

function describe(plan: MergePreview): string {
  const added = plan.added.length;
  const skipped = plan.skipped.length;
  if (added === 0 && skipped === 0) return "No entries found in this file.";
  if (added === 0) return `All ${skipped} ${skipped === 1 ? "entry is" : "entries are"} already here.`;
  const parts = [`${added} ${added === 1 ? "entry" : "entries"} to add`];
  if (skipped > 0) parts.push(`${skipped} already here`);
  return parts.join(", ") + ".";
}
