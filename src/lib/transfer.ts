import type { Entry, Library } from "./types";

// Export and import of the local library as a single JSON document. The file
// is the library itself plus a small envelope, so a backup can be restored
// here, moved to another browser, or imported into shared storage later.

export const EXPORT_FORMAT = "holographic-export";
export const EXPORT_VERSION = 1;

export interface ExportDocument {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string; // ISO 8601
  library: Library;
}

export function createExport(library: Library, now = new Date()): ExportDocument {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    library: { version: 1, entries: library.entries.filter((e) => !e.sample) },
  };
}

export function exportFileName(now = new Date()): string {
  return `holographic-export-${now.toISOString().slice(0, 10)}.json`;
}

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.title !== "string") return false;
  if (typeof e.createdAt !== "string" || typeof e.updatedAt !== "string") return false;
  if (e.kind === "saved") return typeof e.body === "string";
  if (e.kind === "chat") return Array.isArray(e.messages);
  return false;
}

export type ParsedExport = { ok: true; entries: Entry[]; exportedAt: string | null } | { ok: false; reason: string };

/** Reads an export file's text. Accepts a bare library document too, for hand-made files. */
export function parseExport(text: string): ParsedExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "That file isn't JSON." };
  }
  if (!data || typeof data !== "object") return { ok: false, reason: "That file doesn't look like a Holographic export." };
  const doc = data as Partial<ExportDocument> & Partial<Library>;
  const library = doc.format === EXPORT_FORMAT ? doc.library : doc.version === 1 && Array.isArray(doc.entries) ? (doc as Library) : undefined;
  if (!library || !Array.isArray(library.entries)) return { ok: false, reason: "That file doesn't look like a Holographic export." };
  const entries = library.entries.filter(isEntry).filter((e) => !e.sample);
  return { ok: true, entries, exportedAt: typeof doc.exportedAt === "string" ? doc.exportedAt : null };
}

export interface MergePreview {
  /** Entries not present locally; they will be added. */
  added: Entry[];
  /** Entries whose id already exists locally; they are left untouched. */
  skipped: Entry[];
}

/** Plans an import: entries are matched by id, so importing the same file twice adds nothing twice. */
export function planMerge(library: Library, incoming: Entry[]): MergePreview {
  const existing = new Set(library.entries.map((e) => e.id));
  const seen = new Set<string>();
  const added: Entry[] = [];
  const skipped: Entry[] = [];
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    (existing.has(entry.id) ? skipped : added).push(entry);
  }
  return { added, skipped };
}

/** Applies a plan; added entries keep their own timestamps and sort in among the existing ones. */
export function applyMerge(library: Library, plan: MergePreview): Library {
  const entries = [...library.entries, ...plan.added].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return { version: 1, entries };
}
