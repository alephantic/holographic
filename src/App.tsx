import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { MenuIcon, ComposeIcon } from "./components/icons";
import type { Mode } from "./components/ModeSelect";
import { SavedView } from "./components/SavedView";
import { Sidebar } from "./components/Sidebar";
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
import type { ChatEntry, Entry, Library } from "./lib/types";

const MODE_KEY = "holographic.mode";

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "save" ? "save" : "chat";
  } catch {
    return "chat";
  }
}

export function App() {
  const [library, setLibrary] = useState<Library>(() => loadLibrary(localStorage));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [status, setStatus] = useState<ApiStatus>({ state: "loading" });
  const [pending, setPending] = useState<{ chatId: string; text: string } | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const firstRender = useRef(true);

  // Persist the library whenever it changes (skip the initial load).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setStorageFailed(!persistLibrary(localStorage, library));
  }, [library]);

  const setMode = (next: Mode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* preference only */
    }
  };

  // Ask the server whether a model is connected; re-check when the tab regains focus.
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

  // Close the mobile drawer with Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const samples = useMemo(() => (library.entries.length === 0 ? SAMPLE_ENTRIES : []), [library.entries.length]);

  const activeEntry: Entry | null = useMemo(() => {
    if (!activeId) return null;
    return library.entries.find((e) => e.id === activeId) ?? SAMPLE_ENTRIES.find((e) => e.id === activeId) ?? null;
  }, [activeId, library.entries]);

  const openEntry = (id: string) => {
    setActiveId(id);
    setDrawerOpen(false);
  };

  const startNew = () => {
    setActiveId(null);
    setDrawerOpen(false);
  };

  const deleteEntry = (id: string) => {
    if (pending?.chatId === id) abortRef.current?.abort();
    setLibrary((lib) => removeEntry(lib, id));
    setActiveId((current) => (current === id ? null : current));
  };

  const stop = () => abortRef.current?.abort();

  const runChat = useCallback(async (chat: ChatEntry) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPending({ chatId: chat.id, text: "" });

    let reply = "";
    let failure: { code: string; message: string } | null = null;
    try {
      failure = await streamChat(
        chat.messages.map((m) => ({ role: m.role, content: m.content })),
        (chunk) => {
          reply += chunk;
          setPending((p) => (p && p.chatId === chat.id ? { ...p, text: reply } : p));
        },
        controller.signal,
      );
    } catch (error) {
      failure =
        error instanceof DOMException && error.name === "AbortError"
          ? { code: "aborted", message: reply ? "Stopped here." : "Stopped before a reply arrived." }
          : { code: "client", message: "Something went wrong while reading the reply." };
    }

    if (abortRef.current === controller) abortRef.current = null;
    setPending((p) => (p?.chatId === chat.id ? null : p));

    setLibrary((lib) =>
      updateChat(lib, chat.id, (c) => {
        if (reply.trim()) {
          const assistant = makeMessage("assistant", reply);
          if (failure) assistant.note = failure.message;
          return { ...c, messages: [...c.messages, assistant] };
        }
        if (!failure) return c;
        const messages = c.messages.map((m, i) => (i === c.messages.length - 1 ? { ...m, note: failure!.message } : m));
        return { ...c, messages };
      }),
    );
    if (failure?.code === "not_configured" || failure?.code === "unreachable") void fetchStatus().then(setStatus);
  }, []);

  const submit = (text: string) => {
    if (mode === "save") {
      const entry = createSavedEntry(text);
      setLibrary((lib) => upsertEntry(lib, entry));
      setActiveId(entry.id);
      return;
    }

    let chat: ChatEntry;
    if (activeEntry && activeEntry.kind === "chat" && !activeEntry.sample) {
      chat = { ...activeEntry, messages: [...activeEntry.messages, makeMessage("user", text)] };
      setLibrary((lib) => updateChat(lib, chat.id, () => chat));
    } else {
      chat = createChatEntry(text);
      setLibrary((lib) => upsertEntry(lib, chat));
      setActiveId(chat.id);
    }
    void runChat(chat);
  };

  const busy = pending !== null && pending.chatId === activeEntry?.id;

  return (
    <div className={`app${drawerOpen ? " drawer-open" : ""}`}>
      <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      <Sidebar
        entries={library.entries}
        samples={samples}
        activeId={activeId}
        onSelect={openEntry}
        onNew={startNew}
        onClose={() => setDrawerOpen(false)}
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

        {activeEntry ? (
          <>
            <div className="content" key={activeEntry.id}>
              {activeEntry.kind === "chat" ? (
                <ChatView
                  entry={activeEntry}
                  pending={pending?.chatId === activeEntry.id ? pending.text : null}
                  onDelete={deleteEntry}
                />
              ) : (
                <SavedView entry={activeEntry} onDelete={deleteEntry} />
              )}
            </div>
            <div className="dock">
              <Composer mode={mode} onModeChange={setMode} onSubmit={submit} busy={busy} onStop={stop} />
              <Hint mode={mode} status={status} storageFailed={storageFailed} />
            </div>
          </>
        ) : (
          <div className="welcome">
            <h1 className="welcome-title">Begin with either a chat or a thought.</h1>
            <Composer mode={mode} onModeChange={setMode} onSubmit={submit} busy={false} onStop={stop} autoFocus />
            <Hint mode={mode} status={status} storageFailed={storageFailed} />
          </div>
        )}
      </main>
    </div>
  );
}

function Hint({ mode, status, storageFailed }: { mode: Mode; status: ApiStatus; storageFailed: boolean }) {
  let lead = "";
  let rest = "";
  if (storageFailed) {
    lead = "Couldn't write to this browser's storage.";
    rest = "Entries won't survive a reload.";
  } else if (mode === "save") {
    rest = "Saved entries stay in this browser.";
  } else if (status.state === "unreachable") {
    lead = "Server not reachable.";
    rest = "Chat can't send until it is. Save still works.";
  } else if (status.state === "ready" && !status.configured) {
    lead = "No model connected.";
    rest = "Add OPENAI_API_KEY or ANTHROPIC_API_KEY to the server's .env to chat. Save works without it.";
  } else if (status.state === "ready") {
    rest = `Replies come from ${status.model}.`;
  }
  return (
    <p className="hint" role="status">
      {lead && <strong>{lead}</strong>}
      {lead && rest ? " " : ""}
      {rest}
    </p>
  );
}
