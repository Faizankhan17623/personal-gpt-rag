import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Composer from "./Composer";
import { clearChat, dismissError, toggleSidebar } from "../store/chatSlice";
import { APP_NAME } from "../config";

function Welcome() {
  return (
    <div className="welcome">
      <h1>What can I help with?</h1>
      <p>Attach a PDF, Word, TXT or Markdown file with <strong>+</strong> and ask about it, or just chat.</p>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="typing" aria-label="Thinking">
      <span></span>
      <span></span>
      <span></span>
    </span>
  );
}

// Code and commands in answers get a Copy button.
function CodeBlock({ node: _node, ...props }) {
  const ref = useRef(null);
  const [label, setLabel] = useState("Copy");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current.innerText.replace(/\n$/, ""));
      setLabel("✓ Copied");
    } catch {
      setLabel("Copy failed"); // Clipboard blocked by the browser.
    }
    setTimeout(() => setLabel("Copy"), 2000);
  };
  return (
    <div className="code-block">
      <button className="copy-btn" onClick={copy} aria-label="Copy code">{label}</button>
      <pre ref={ref} {...props} />
    </div>
  );
}
const MARKDOWN_COMPONENTS = { pre: CodeBlock };

// The document excerpts an answer was based on, hidden until asked for.
function Sources({ sources }) {
  const [open, setOpen] = useState(false);
  if (!sources?.length) return null;
  return (
    <div className="sources">
      <button className="sources-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "▾" : "▸"} Sources ({sources.length})
      </button>
      {open && (
        <ol className="sources-list">
          {sources.map((s) => (
            <li key={s.number}>
              <div className="source-meta">Chunk {s.chunk} · match {Math.round(s.score * 100)}%</div>
              <div className="source-text">{s.text}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function ChatWindow() {
  const dispatch = useDispatch();
  const { messages, streaming, activeId, activeDocument, error, sidebarOpen } = useSelector((s) => s.chat);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const hasMessages = messages.length > 0;

  return (
    <main className="chat-window">
      <header className="chat-header">
        {!sidebarOpen && (
          <button className="icon-btn mobile-only" title="Open sidebar" onClick={() => dispatch(toggleSidebar())}>☰</button>
        )}
        <span className="model-name">{APP_NAME}</span>
        {activeDocument && <span className="header-doc" title={activeDocument.name}>📄 {activeDocument.name}</span>}
        {activeId && hasMessages && (
          <button className="header-btn" disabled={streaming} title="Clear this conversation (keeps the document)" onClick={() => dispatch(clearChat(activeId))}>
            Clear chat
          </button>
        )}
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => dispatch(dismissError())} aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className={`chat-body ${hasMessages ? "" : "centered"}`}>
        {!hasMessages ? (
          <Welcome />
        ) : (
          <div className="messages">
            {messages.map((m, i) => {
              const isStreamingThis = m.role === "assistant" && streaming && i === messages.length - 1;
              return (
                <div key={m.id} className={`msg ${m.role}`}>
                  <div className="bubble">
                    {m.role === "assistant" && !m.content && streaming ? (
                      <TypingDots />
                    ) : m.role === "assistant" ? (
                      <>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{m.content}</ReactMarkdown>
                        {isStreamingThis && <span className="caret" />}
                        {!isStreamingThis && <Sources sources={m.sources} />}
                        {m.memoryUpdated && <div className="memory-note">✓ Memory updated</div>}
                      </>
                    ) : (
                      <p className="user-text">{m.content}</p>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <Composer />
    </main>
  );
}
