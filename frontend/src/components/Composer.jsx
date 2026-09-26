import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { newChat, uploadDoc, removeDoc, startTurn, appendToken, finishTurn, failTurn, showError } from "../store/chatSlice";
import { streamChat } from "../api";
import { createTypewriter } from "../typewriter";

const ACCEPT = ".pdf,.docx,.txt,.md";
const MAX_FILE_MB = 15;

export default function Composer() {
  const dispatch = useDispatch();
  const { activeId, streaming, uploading, activeDocument } = useSelector((s) => s.chat);
  const [text, setText] = useState("");
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  // Grow the textarea with its content, up to the CSS max-height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // Returns the active chat id, creating a chat first if needed.
  const ensureChat = async () => {
    if (activeId) return activeId;
    const action = await dispatch(newChat());
    return action.payload?.id;
  };

  const handleSend = async () => {
    const message = text.trim();
    if (!message || streaming || uploading) return;
    const id = await ensureChat();
    if (!id) return;
    setText("");
    dispatch(startTurn(message));

    // Smooth bursty network tokens into steady typing.
    const typer = createTypewriter((chunk) => dispatch(appendToken(chunk)));
    let done = null;
    let failure = null;
    await streamChat(id, message, {
      onToken: (token) => typer.push(token),
      onDone: (payload) => { done = payload; },
      onError: (error) => { failure = error; },
    });
    await typer.flush();
    if (done) dispatch(finishTurn(done));
    else dispatch(failTurn(failure?.message || "Something went wrong. Please try again."));
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // Allow picking the same file again.
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      dispatch(showError(`Files must be under ${MAX_FILE_MB} MB.`));
      return;
    }
    const id = await ensureChat();
    if (id) dispatch(uploadDoc({ id, file }));
  };

  return (
    <div className="composer-wrap">
      {activeDocument && !uploading && (
        <div className="doc-chip">
          📄 <strong>{activeDocument.name}</strong> · {activeDocument.chunks} chunks · answers use this document
          <button className="chip-remove" title="Remove document" disabled={streaming} onClick={() => dispatch(removeDoc(activeId))}>✕</button>
        </div>
      )}
      {uploading && (
        <div className="upload-loader">
          <span className="spinner" /> Reading and indexing your document…
        </div>
      )}

      <div className="composer">
        <div className="plus-wrap">
          <button
            className="plus-btn"
            aria-label={activeDocument ? "Replace the attached file" : "Attach files"}
            aria-describedby="attach-tooltip"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || streaming}
          >
            {uploading ? <span className="spinner" /> : "+"}
          </button>
          <span className="tooltip" id="attach-tooltip" role="tooltip">
            {activeDocument ? "Replace file" : "Attach files"}
            <span className="tooltip-hint">PDF, Word, TXT or Markdown</span>
          </span>
        </div>
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={handleFilePick} />

        <textarea
          ref={inputRef}
          className="composer-input"
          placeholder={activeDocument ? `Ask about ${activeDocument.name}…` : "Ask anything"}
          value={text}
          rows={1}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <button className="send-btn" onClick={handleSend} disabled={!text.trim() || streaming || uploading} title="Send">
          {streaming ? <span className="spinner dark" /> : "➤"}
        </button>
      </div>
      <div className="composer-hint">Answers can be wrong. Open “Sources” under an answer to check it against your document.</div>
    </div>
  );
}
