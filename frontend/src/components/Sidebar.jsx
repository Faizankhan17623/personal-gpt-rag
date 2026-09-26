import { useDispatch, useSelector } from "react-redux";
import { newChat, openChat, removeChat, setSearch, toggleSidebar } from "../store/chatSlice";
import { APP_NAME } from "../config";

export default function Sidebar() {
  const dispatch = useDispatch();
  const { chats, activeId, search, sidebarOpen, streaming } = useSelector((s) => s.chat);

  const filtered = chats.filter((c) => (c.title || "").toLowerCase().includes(search.toLowerCase()));
  const closeOnMobile = () => {
    if (window.innerWidth <= 760) dispatch(toggleSidebar());
  };

  if (!sidebarOpen) {
    return (
      <div className="sidebar collapsed">
        <button className="icon-btn" title="Open sidebar" onClick={() => dispatch(toggleSidebar())}>☰</button>
        <button className="icon-btn" title="New chat" disabled={streaming} onClick={() => dispatch(newChat())}>✎</button>
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

        <button className="new-chat-btn" disabled={streaming} onClick={() => { dispatch(newChat()); closeOnMobile(); }}>
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
            <div
              key={c.id}
              className={`chat-item ${c.id === activeId ? "active" : ""}`}
              onClick={() => { if (!streaming && c.id !== activeId) dispatch(openChat(c.id)); closeOnMobile(); }}
            >
              <span className="chat-title">
                {c.document && <span className="doc-dot" title={c.document.name}>📄</span>}
                {c.title}
              </span>
              <button
                className="del-btn"
                title="Delete chat"
                disabled={streaming}
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
      </aside>
    </>
  );
}
