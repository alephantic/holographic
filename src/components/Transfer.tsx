import { useRef, useState, type ChangeEvent } from "react";
import { exportFileName, parseExport, type ExportDocument, type MergePreview } from "../lib/transfer";
import type { Entry } from "../lib/types";

/** Where entries are kept right now: this browser, or the shared studio behind the server. */
export interface TransferTarget {
  name: "browser" | "studio";
  count: number;
  exportDocument: () => Promise<ExportDocument>;
  plan: (entries: Entry[]) => Promise<MergePreview>;
  apply: (plan: MergePreview) => Promise<void>;
}

interface Props {
  target: TransferTarget;
  /** Entries in this browser that the studio doesn't have yet; offered as "Send to studio". */
  localPending?: Entry[];
}

type State =
  | { step: "idle" }
  | { step: "preview"; label: string; plan: MergePreview; verb: string }
  | { step: "done"; text: string }
  | { step: "error"; reason: string };

/** Export, import with a preview, and (in the studio) send this browser's entries up. Entries match by id, so repeating adds nothing twice. */
export function Transfer({ target, localPending = [] }: Props) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (work: () => Promise<State>) => {
    setBusy(true);
    try {
      setState(await work());
    } catch (error) {
      setState({ step: "error", reason: error instanceof Error ? error.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  };

  const exportNow = () =>
    run(async () => {
      const now = new Date();
      const doc = await target.exportDocument();
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(now);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { step: "idle" };
    });

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    await run(async () => {
      const parsed = parseExport(text);
      if (!parsed.ok) return { step: "error", reason: parsed.reason };
      return { step: "preview", label: file.name, plan: await target.plan(parsed.entries), verb: "Add" };
    });
  };

  const sendLocal = () =>
    run(async () => ({ step: "preview", label: "This browser's entries", plan: await target.plan(localPending), verb: "Send" }));

  const confirm = () => {
    if (state.step !== "preview") return;
    const { plan, verb } = state;
    void run(async () => {
      await target.apply(plan);
      const where = target.name === "studio" ? " to the studio" : "";
      const kept = verb === "Send" ? " The originals stay in this browser." : "";
      return { step: "done", text: `${verb === "Send" ? "Sent" : "Added"} ${plan.added.length}${where}${plan.skipped.length ? `, ${plan.skipped.length} already there` : ""}.${kept}` };
    });
  };

  if (state.step === "preview") {
    const { plan, verb, label } = state;
    return (
      <div className="transfer transfer-panel" role="group" aria-label="Import preview" aria-live="polite">
        <p className="transfer-text">
          <strong>{label}</strong>
          <br />
          {describe(plan, target.name)}
        </p>
        <div className="transfer-actions">
          {plan.added.length > 0 && (
            <button type="button" className="text-button text-button-primary" onClick={confirm} disabled={busy}>
              {verb} {plan.added.length}
            </button>
          )}
          <button type="button" className="text-button" onClick={() => setState({ step: "idle" })} disabled={busy}>
            {plan.added.length > 0 ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="transfer" aria-live="polite">
      {state.step === "done" && <p className="transfer-text">{state.text}</p>}
      {state.step === "error" && (
        <p className="transfer-text transfer-error" role="alert">
          {state.reason}
        </p>
      )}
      <div className="transfer-actions">
        <button type="button" className="text-button" onClick={exportNow} disabled={busy || target.count === 0}>
          Export
        </button>
        <button type="button" className="text-button" onClick={() => fileRef.current?.click()} disabled={busy}>
          Import…
        </button>
        {target.name === "studio" && localPending.length > 0 && (
          <button type="button" className="text-button" onClick={sendLocal} disabled={busy}>
            Send to studio ({localPending.length})
          </button>
        )}
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pick} aria-label="Import file" />
      </div>
    </div>
  );
}

function describe(plan: MergePreview, where: "browser" | "studio"): string {
  const added = plan.added.length;
  const skipped = plan.skipped.length;
  const here = where === "studio" ? "in the studio" : "here";
  if (added === 0 && skipped === 0) return "No entries found.";
  if (added === 0) return `All ${skipped} ${skipped === 1 ? "entry is" : "entries are"} already ${here}.`;
  const parts = [`${added} ${added === 1 ? "entry" : "entries"} to add`];
  if (skipped > 0) parts.push(`${skipped} already ${here}`);
  return parts.join(", ") + ".";
}
