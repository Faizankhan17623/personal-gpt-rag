import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { newChat, openChat, removeChat, setSearch, toggleSidebar, forgetMemory, forgetAllMemories } from "../store/chatSlice";
import { APP_NAME } from "../config";

// What the assistant remembers about the user across chats, with ways to forget it.
function MemoryPanel() {
  const dispatch = useDispatch();
  const memories = useSelector((s) => s.chat.memories);
  const [open, setOpen] = useState(false);
  return (
    <div className="memory-panel">
      <button className="new-chat-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="ic">🧠</span> Memory ({memories.length})
        <span className="memory-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="memory-body">
          {memories.length === 0 ? (
            <div className="empty-recents">Nothing yet. Tell me about yourself and I'll remember it in every chat.</div>
          ) : (
            <>
              <ul className="memory-list">
                {memories.map((m) => (
                  <li key={m.id} className="memory-item">
                    <span>{m.text}</span>
                    <button className="memory-del" title="Forget this" aria-label={`Forget: ${m.text}`} onClick={() => dispatch(forgetMemory(m.id))}>✕</button>
                  </li>
                ))}
              </ul>
              <button
                className="memory-clear"
                onClick={() => { if (window.confirm("Forget everything in memory?")) dispatch(forgetAllMemories()); }}
              >
                Forget all
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const dispatch = useDispatch();
  const { chats, activeId, search, sidebarOpen } = useSelector((s) => s.chat);

  const filtered = chats.filter((c) => (c.title || "").toLowerCase().includes(search.toLowerCase()));
  const closeOnMobile = () => {
    if (window.innerWidth <= 760) dispatch(toggleSidebar());
  };

  if (!sidebarOpen) {
    return (
      <div className="sidebar collapsed">
        <button className="icon-btn" title="Open sidebar" onClick={() => dispatch(toggleSidebar())}>☰</button>
        <button className="icon-btn" title="New chat" onClick={() => dispatch(newChat())}>✎</button>
      </div>
    );
  }

  return (
    <>
      <div className="sidebar-backdrop" onClick={() => dispatch(toggleSidebar())} />
      <aside className="sidebar">
        <div className="sidebar-top">
          <span className="brand">{APP_NAME}</span>
          <button className="icon-btn" title="Close sidebar" onClick={() => dispatch(toggleSidebar())}>⟨</button>
        </div>

        <button className="new-chat-btn" onClick={() => { dispatch(newChat()); closeOnMobile(); }}>
          <span className="ic">✎</span> New chat
        </button>

        <div className="search-box">
          <span className="ic">⌕</span>
          <input placeholder="Search chats" value={search} onChange={(e) => dispatch(setSearch(e.target.value))} />
        </div>

        <div className="recents-label">Recents</div>

        <nav className="chat-list">
          {filtered.length === 0 && <div className="empty-recents">{search ? "No matching chats" : "No chats yet"}</div>}
          {filtered.map((c) => (
            <div key={c.id} className={`chat-item ${c.id === activeId ? "active" : ""}`}>
              <button
                className="chat-title"
                aria-current={c.id === activeId ? "page" : undefined}
                onClick={() => { if (c.id !== activeId) dispatch(openChat(c.id)); closeOnMobile(); }}
              >
                {c.document && <span className="doc-dot" title={c.document.name}>📄</span>}
                {c.title}
              </button>
              <button
                className="del-btn"
                title="Delete chat"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete "${c.title}"? This also deletes its document.`)) dispatch(removeChat(c.id));
                }}
              >
                🗑
              </button>
            </div>
          ))}
        </nav>

        <MemoryPanel />
      </aside>
    </>
  );
}
