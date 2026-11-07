import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessGate } from "./components/AccessGate";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { MenuIcon, ComposeIcon } from "./components/icons";
import type { Mode } from "./components/ModeSelect";
import { SavedView } from "./components/SavedView";
import { Sidebar } from "./components/Sidebar";
import { Transfer, type TransferTarget } from "./components/Transfer";
import { MemoryView } from "./components/MemoryView";
import { selectContext } from "./lib/context";
import { fetchStatus, streamChat, type ApiStatus } from "./lib/api";
import { SAMPLE_ENTRIES } from "./lib/samples";
import {
  createChatEntry,
  createSavedEntry,
  loadLibrary,
  makeMessage,
  persistLibrary,
  removeEntry,
  updateChat,
  upsertEntry,
} from "./lib/store";
import { studio, StudioError } from "./lib/studio";
import { applyMerge, createExport, planMerge, type MergePreview } from "./lib/transfer";
import type { ChatEntry, Entry, Library, MessageRecord } from "./lib/types";
import type { MemoryRefLite, SourceRef } from "../shared/entries";
import type { Memory } from "../shared/memory";

const MODE_KEY = "holographic.mode";
const ACCESS_KEY = "holographic.accessKey";
const EMPTY: Library = { version: 1, entries: [] };

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* preference only */
  }
}

function readMode(): Mode {
  return readStored(MODE_KEY) === "save" ? "save" : "chat";
}

/** Where entries live right now. "studio" is the shared database behind the server; "browser" is this device's local storage. */
type Backend = "browser" | "studio";

export function App() {
  // This browser's own entries: always loaded, persisted, and never removed by the app.
  const [localLibrary, setLocalLibrary] = useState<Library>(() => loadLibrary(localStorage));
  // The shared studio, once the server has storage and this browser is unlocked. Null until loaded.
  const [studioLibrary, setStudioLibrary] = useState<Library | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [status, setStatus] = useState<ApiStatus>({ state: "loading" });
  const [pending, setPending] = useState<{ chatId: string; text: string } | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [accessKey, setAccessKeyState] = useState<string | null>(() => readStored(ACCESS_KEY));
  const [accessRefused, setAccessRefused] = useState(false);
  // Project memory (studio only).
  const [view, setView] = useState<"entry" | "memory">("entry");
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryHighlight, setMemoryHighlight] = useState<string | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [captureState, setCaptureState] = useState<"idle" | "working" | "done">("idle");
  const abortRef = useRef<AbortController | null>(null);
  const accessKeyRef = useRef(accessKey);
  accessKeyRef.current = accessKey;
  const firstRender = useRef(true);

  const ready = status.state === "ready";
  const storageConfigured = ready && status.storage.configured;
  const unlocked = !ready || !status.accessRequired || accessKey !== null;
  const studioAvailable = storageConfigured && unlocked;
  // Once the studio is available it is the backend; the browser store is used
  // only when the studio can't be reached (never merely while it loads).
  const backend: Backend = studioAvailable && studioError === null ? "studio" : "browser";
  const studioLoading = backend === "studio" && studioLibrary === null;
  const backendRef = useRef(backend);
  backendRef.current = backend;
  // Studio writes run one after another, so a message can never reach the
  // server before the chat it belongs to has been created there.
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingWrites = useRef(0);
  // Mirrors pendingWrites for rendering: the app root carries data-pending while writes are outstanding.
  const [pendingCount, setPendingCount] = useState(0);

  // Leaving while a studio write is still on its way would risk losing it; ask first.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingWrites.current > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  const library = backend === "studio" ? (studioLibrary ?? EMPTY) : localLibrary;

  // Persist this browser's library whenever it changes (skip the initial load).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setStorageFailed(!persistLibrary(localStorage, localLibrary));
  }, [localLibrary]);

  const setMode = (next: Mode) => {
    setModeState(next);
    writeStored(MODE_KEY, next);
  };

  const dropAccessKey = useCallback(() => {
    setAccessKeyState(null);
    writeStored(ACCESS_KEY, null);
    setAccessRefused(true);
    setStudioLibrary(null);
  }, []);

  const setAccessKey = (next: string) => {
    setAccessKeyState(next);
    setAccessRefused(false);
    writeStored(ACCESS_KEY, next);
  };

  /** Reports a failed studio write. The interface keeps showing what the person did; the hint says it wasn't kept. */
  const reportStudio = useCallback(
    (error: unknown) => {
      if (error instanceof StudioError && error.code === "unauthorized") {
        dropAccessKey();
        return;
      }
      setStudioError(error instanceof Error ? error.message : "The studio couldn't be reached.");
    },
    [dropAccessKey],
  );

  /** Queues a studio write behind any earlier ones; failures are reported, never thrown. */
  const studioWrite = useCallback(
    (work: () => Promise<unknown>) => {
      pendingWrites.current += 1;
      setPendingCount(pendingWrites.current);
      writeQueue.current = writeQueue.current.then(() =>
        work()
          .then(() => setStudioError(null), reportStudio)
          .finally(() => {
            pendingWrites.current -= 1;
            setPendingCount(pendingWrites.current);
          }),
      );
    },
    [reportStudio],
  );

  const loadMemories = useCallback(async () => {
    try {
      const r = await studio.fetchProject(accessKeyRef.current);
      setMemories(r.memories);
      setMemoryError(null);
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "Couldn't load the project memory.");
    }
  }, []);

  const loadStudio = useCallback(async () => {
    try {
      const lib = await studio.fetchLibrary(accessKeyRef.current);
      setStudioLibrary(lib);
      setStudioError(null);
      void loadMemories();
    } catch (error) {
      setStudioLibrary(null);
      reportStudio(error);
    }
  }, [reportStudio, loadMemories]);

  // Ask the server what it offers; re-check (and refresh the studio) when the tab regains focus.
  useEffect(() => {
    const controller = new AbortController();
    const check = () => void fetchStatus(controller.signal).then(setStatus);
    check();
    window.addEventListener("focus", check);
    return () => {
      controller.abort();
      window.removeEventListener("focus", check);
    };
  }, []);

  useEffect(() => {
    if (!studioAvailable) {
      setStudioLibrary(null);
      return;
    }
    void loadStudio();
    const onFocus = () => void loadStudio();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [studioAvailable, loadStudio]);

  // Close the mobile drawer with Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  /** Applies a change to whichever library is showing. */
  const setLib = useCallback((fn: (lib: Library) => Library) => {
    if (backendRef.current === "studio") setStudioLibrary((lib) => fn(lib ?? EMPTY));
    else setLocalLibrary(fn);
  }, []);

  // ---- mutations: update the view at once, then tell the studio when it is the backend ----

  const addEntry = useCallback(
    (entry: Entry) => {
      setLib((lib) => upsertEntry(lib, entry));
      if (backendRef.current === "studio") studioWrite(() => studio.createEntry(entry, accessKeyRef.current));
    },
    [setLib, studioWrite],
  );

  const appendMessage = useCallback(
    (chatId: string, message: MessageRecord) => {
      setLib((lib) => updateChat(lib, chatId, (c) => ({ ...c, messages: [...c.messages, message] })));
      if (backendRef.current === "studio") studioWrite(() => studio.appendMessage(chatId, message, accessKeyRef.current));
    },
    [setLib, studioWrite],
  );

  const noteMessage = useCallback(
    (chatId: string, messageId: string, note: string) => {
      setLib((lib) => updateChat(lib, chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, note } : m)) })));
      if (backendRef.current === "studio") studioWrite(() => studio.setNote(chatId, messageId, note, accessKeyRef.current));
    },
    [setLib, studioWrite],
  );

  const deleteEntry = (id: string) => {
    if (pending?.chatId === id) abortRef.current?.abort();
    setLib((lib) => removeEntry(lib, id));
    if (backend === "studio") studioWrite(() => studio.deleteEntry(id, accessKeyRef.current));
    setActiveId((current) => (current === id ? null : current));
  };

  const samples = useMemo(() => (library.entries.length === 0 ? SAMPLE_ENTRIES : []), [library.entries.length]);

  const activeEntry: Entry | null = useMemo(() => {
    if (!activeId) return null;
    return library.entries.find((e) => e.id === activeId) ?? SAMPLE_ENTRIES.find((e) => e.id === activeId) ?? null;
  }, [activeId, library.entries]);

  const openEntry = (id: string, messageId: string | null = null) => {
    setActiveId(id);
    setView("entry");
    setHighlightMessageId(messageId);
    setCaptureState("idle");
    setDrawerOpen(false);
  };

  const startNew = () => {
    setActiveId(null);
    setView("entry");
    setHighlightMessageId(null);
    setDrawerOpen(false);
  };

  const openMemory = (highlightId: string | null = null) => {
    setView("memory");
    setMemoryHighlight(highlightId);
    setDrawerOpen(false);
    void loadMemories();
  };

  const memoryAction = async (work: () => Promise<unknown>) => {
    try {
      await work();
      setMemoryError(null);
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : "The change couldn't be saved.");
    }
    await loadMemories();
  };

  const captureChat = async (chatId: string) => {
    setCaptureState("working");
    try {
      await studio.capture(chatId, accessKeyRef.current);
      setCaptureState("done");
      await loadMemories();
    } catch (error) {
      setCaptureState("idle");
      setMemoryError(error instanceof Error ? error.message : "Nothing could be proposed.");
      setView("memory");
    }
  };

  const stop = () => abortRef.current?.abort();

  const runChat = useCallback(
    async (chat: ChatEntry) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setPending({ chatId: chat.id, text: "" });

      let reply = "";
      let sources: SourceRef[] | undefined;
      let memoryRefs: MemoryRefLite[] | undefined;
      let failure: { code: string; message: string } | null = null;
      // Only a bounded window of recent messages goes to the model; the whole chat stays stored.
      const context = selectContext(chat.messages);
      try {
        if (!context) throw new RangeError("too long");
        failure = await streamChat(
          context.turns,
          (chunk) => {
            reply += chunk;
            setPending((p) => (p && p.chatId === chat.id ? { ...p, text: reply } : p));
          },
          controller.signal,
          accessKeyRef.current,
          (found) => {
            sources = found;
          },
          (cited) => {
            memoryRefs = cited;
          },
        );
      } catch (error) {
        failure =
          error instanceof DOMException && error.name === "AbortError"
            ? { code: "aborted", message: reply ? "Stopped here." : "Stopped before a reply arrived." }
            : error instanceof RangeError
              ? { code: "too_long", message: "This message is too long to send. Shorten it or send it in parts." }
              : { code: "client", message: "Something went wrong while reading the reply." };
      }

      if (abortRef.current === controller) abortRef.current = null;
      setPending((p) => (p?.chatId === chat.id ? null : p));

      if (reply.trim()) {
        const assistant = makeMessage("assistant", reply);
        if (failure) assistant.note = failure.message;
        if (sources) assistant.sources = sources;
        if (memoryRefs && memoryRefs.length > 0) assistant.memoryRefs = memoryRefs;
        appendMessage(chat.id, assistant);
      } else if (failure) {
        const last = chat.messages[chat.messages.length - 1];
        if (last) noteMessage(chat.id, last.id, failure.message);
      }
      if (failure?.code === "unauthorized") dropAccessKey();
      if (failure?.code === "not_configured" || failure?.code === "unreachable") void fetchStatus().then(setStatus);
    },
    [appendMessage, noteMessage, dropAccessKey],
  );

  const submit = (text: string) => {
    if (view === "memory") setView("entry");
    if (mode === "save") {
      const entry = createSavedEntry(text);
      addEntry(entry);
      setActiveId(entry.id);
      return;
    }

    let chat: ChatEntry;
    if (activeEntry && activeEntry.kind === "chat" && !activeEntry.sample) {
      const message = makeMessage("user", text);
      chat = { ...activeEntry, messages: [...activeEntry.messages, message] };
      appendMessage(chat.id, message);
    } else {
      chat = createChatEntry(text);
      addEntry(chat);
      setActiveId(chat.id);
    }
    void runChat(chat);
  };

  // ---- export / import / send to studio ----

  const transferTarget: TransferTarget = useMemo(() => {
    if (backend === "studio") {
      const key = accessKey;
      const byId = new Map(library.entries.map((e) => [e.id, e]));
      return {
        name: "studio",
        count: library.entries.length,
        exportDocument: () => studio.fetchExport(key),
        plan: async (entries) => {
          const r = await studio.importEntries(entries, true, key);
          const incoming = new Map(entries.map((e) => [e.id, e]));
          return {
            added: r.added.map((id) => incoming.get(id)!),
            skipped: r.skipped.map((id) => byId.get(id) ?? incoming.get(id)!),
          };
        },
        apply: async (plan: MergePreview) => {
          await studio.importEntries(plan.added, false, key);
          await loadStudio();
        },
      };
    }
    return {
      name: "browser",
      count: localLibrary.entries.length,
      exportDocument: async () => createExport(localLibrary),
      plan: async (entries) => planMerge(localLibrary, entries),
      apply: async (plan) => setLocalLibrary((lib) => applyMerge(lib, plan)),
    };
  }, [backend, accessKey, library.entries, localLibrary, loadStudio]);

  const localPending = useMemo(() => {
    if (backend !== "studio" || studioLibrary === null) return [];
    const inStudio = new Set(library.entries.map((e) => e.id));
    return localLibrary.entries.filter((e) => !inStudio.has(e.id));
  }, [backend, studioLibrary, library.entries, localLibrary.entries]);

  const busy = pending !== null && pending.chatId === activeEntry?.id;

  const needsKey =
    ready && status.accessRequired && accessKey === null && (status.storage.configured || (mode === "chat" && status.configured));
  const footer = needsKey ? (
    <AccessGate
      scope={status.state === "ready" && status.storage.configured ? "studio" : "chat"}
      reason={accessRefused ? "That access key is no longer accepted." : undefined}
      onUnlocked={setAccessKey}
    />
  ) : (
    <Hint mode={mode} status={status} backend={backend} loading={studioLoading} storageFailed={storageFailed} studioError={studioError} />
  );

  return (
    <div className={`app${drawerOpen ? " drawer-open" : ""}`} data-pending={pendingCount > 0 ? "" : undefined}>
      <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      <Sidebar
        entries={library.entries}
        samples={samples}
        activeId={activeId}
        onSelect={openEntry}
        onNew={startNew}
        onClose={() => setDrawerOpen(false)}
        memory={
          backend === "studio"
            ? { active: view === "memory", toReview: (memories ?? []).filter((m) => m.status === "suggested").length, onOpen: () => openMemory() }
            : undefined
        }
        footer={
          <Transfer
            target={transferTarget}
            localPending={localPending}
            exportLocal={backend === "studio" ? async () => createExport(localLibrary) : undefined}
          />
        }
      />

      <main className="main" inert={drawerOpen}>
        <header className="topbar">
          <button type="button" className="icon-button" onClick={() => setDrawerOpen(true)} aria-label="Open sidebar">
            <MenuIcon size={20} />
          </button>
          <span className="wordmark topbar-wordmark">Holographic</span>
          <button type="button" className="icon-button" onClick={startNew} aria-label="New">
            <ComposeIcon size={19} />
          </button>
        </header>

        {view === "memory" && backend === "studio" ? (
          <>
            <div className="content" key="memory">
              <MemoryView
                memories={memories ?? []}
                loading={memories === null}
                error={memoryError}
                highlightId={memoryHighlight}
                onAccept={(id, text, note) => memoryAction(() => studio.acceptMemory(id, text, note, accessKeyRef.current))}
                onReject={(id, note) => memoryAction(() => studio.rejectMemory(id, note, accessKeyRef.current))}
                onCorrect={(id, text, kind, note) => memoryAction(() => studio.correctMemory(id, text, kind, note, accessKeyRef.current))}
                onOpenSource={(entryId, messageId) => openEntry(entryId, messageId)}
                loadHistory={(id) => studio.memoryHistory(id, accessKeyRef.current).then((r) => r.events)}
              />
            </div>
            <div className="dock">
              <Composer mode={mode} onModeChange={setMode} onSubmit={submit} busy={false} onStop={stop} held={studioLoading} />
              {footer}
            </div>
          </>
        ) : activeEntry ? (
          <>
            <div className="content" key={activeEntry.id}>
              {activeEntry.kind === "chat" ? (
                <ChatView
                  entry={activeEntry}
                  pending={pending?.chatId === activeEntry.id ? pending.text : null}
                  contextStart={activeEntry.sample ? 0 : (selectContext(activeEntry.messages)?.startIndex ?? 0)}
                  onDelete={deleteEntry}
                  onOpenSource={openEntry}
                  onOpenMemory={(id) => openMemory(id)}
                  onCapture={backend === "studio" ? () => void captureChat(activeEntry.id) : undefined}
                  captureState={captureState}
                  highlightMessageId={highlightMessageId}
                />
              ) : (
                <SavedView entry={activeEntry} onDelete={deleteEntry} />
              )}
            </div>
            <div className="dock">
              <Composer mode={mode} onModeChange={setMode} onSubmit={submit} busy={busy} onStop={stop} held={studioLoading} />
              {footer}
            </div>
          </>
        ) : (
          <div className="welcome">
            <h1 className="welcome-title">Begin with either a chat or a thought.</h1>
            <Composer mode={mode} onModeChange={setMode} onSubmit={submit} busy={false} onStop={stop} held={studioLoading} autoFocus />
            {footer}
          </div>
        )}
      </main>
    </div>
  );
}

function Hint({
  mode,
  status,
  backend,
  loading,
  storageFailed,
  studioError,
}: {
  mode: Mode;
  status: ApiStatus;
  backend: Backend;
  loading: boolean;
  storageFailed: boolean;
  studioError: string | null;
}) {
  let lead = "";
  let rest = "";
  if (studioError) {
    lead = "The studio couldn't be reached.";
    rest = `${studioError} Until it is, new entries stay in this browser.`;
  } else if (storageFailed && backend === "browser") {
    lead = "Couldn't write to this browser's storage.";
    rest = "Entries won't survive a reload.";
  } else if (loading) {
    rest = "Loading the studio…";
  } else if (mode === "save") {
    rest = backend === "studio" ? "Saved to the studio, shared across your devices." : "Saved entries stay in this browser.";
  } else if (status.state === "unreachable") {
    lead = "Server not reachable.";
    rest = "Chat can't send until it is. Save still works.";
  } else if (status.state === "ready" && !status.configured) {
    lead = "No model connected.";
    rest = "Add OPENAI_API_KEY or ANTHROPIC_API_KEY to the server's .env to chat. Save works without it.";
  } else if (status.state === "ready") {
    rest = `Replies come from ${status.model}.${backend === "studio" ? " Saved pages and accepted project memory are given with each question; chats are kept in the studio." : ""}`;
  }
  return (
    <p className="hint" role="status">
      {lead && <strong>{lead}</strong>}
      {lead && rest ? " " : ""}
      {rest}
    </p>
  );
}
