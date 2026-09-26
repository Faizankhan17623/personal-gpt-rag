// API client for the backend. VITE_API_URL is the backend base URL ending in /api.
const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// A random per-browser token keeps each visitor's chats private.
function sessionToken() {
  const KEY = "rag-chat-session";
  let token = null;
  try {
    token = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: fall back to a token for this page load only.
  }
  if (!token || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    token = crypto.randomUUID().replaceAll("-", "");
    try {
      localStorage.setItem(KEY, token);
    } catch {
      // Ignore; chats just won't persist across reloads.
    }
  }
  return token;
}
const TOKEN = sessionToken();

async function request(path, { json, body, method = "GET" } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: { "X-Session-Token": TOKEN, ...(json ? { "Content-Type": "application/json" } : {}) },
      body: json ? JSON.stringify(json) : body,
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export const listChats = async () => (await request("/chats")).chats;
export const createChat = async () => (await request("/chats", { method: "POST" })).chat;
export const getChat = async (id) => (await request(`/chats/${id}`)).chat;
export const renameChat = (id, title) => request(`/chats/${id}`, { method: "PATCH", json: { title } });
export const deleteChat = (id) => request(`/chats/${id}`, { method: "DELETE" });
export const clearChat = (id) => request(`/chats/${id}/messages`, { method: "DELETE" });
export const removeDocument = (id) => request(`/chats/${id}/document`, { method: "DELETE" });

export async function uploadDocument(id, file) {
  const form = new FormData();
  form.append("file", file);
  return (await request(`/chats/${id}/document`, { method: "POST", body: form })).document;
}

// Streams an answer: onToken(text) per piece, onDone({ message, title }) at the end.
export async function streamChat(id, message, { onToken, onDone, onError, signal }) {
  let response;
  try {
    response = await fetch(`${BASE}/chats/${id}/messages`, {
      method: "POST",
      headers: { "X-Session-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal,
    });
  } catch (error) {
    if (error.name !== "AbortError") onError(new Error("Could not reach the server. Check your connection and try again."));
    return;
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    onError(new Error(data.error || `Request failed (${response.status}).`));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const event = frame.match(/^event: (.*)$/m)?.[1];
        const data = frame.match(/^data: (.*)$/m)?.[1];
        if (!event || !data) continue;
        const payload = JSON.parse(data);
        if (event === "token") onToken(payload.token);
        else if (event === "done") { finished = true; onDone(payload); }
        else if (event === "error") { finished = true; onError(new Error(payload.error)); }
      }
    }
  } catch (error) {
    if (error.name === "AbortError") return;
  }
  if (!finished && !signal?.aborted) onError(new Error("The connection dropped while the answer was streaming."));
}
