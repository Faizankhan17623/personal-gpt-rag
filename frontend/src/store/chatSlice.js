import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import * as api from "../api";

export const fetchChats = createAsyncThunk("chat/fetchChats", () => api.listChats());
export const newChat = createAsyncThunk("chat/newChat", () => api.createChat());
export const openChat = createAsyncThunk("chat/openChat", (id) => api.getChat(id));
export const removeChat = createAsyncThunk("chat/removeChat", async (id) => {
  await api.deleteChat(id);
  return id;
});
export const clearChat = createAsyncThunk("chat/clearChat", async (id) => {
  await api.clearChat(id);
  return id;
});
export const uploadDoc = createAsyncThunk("chat/uploadDoc", async ({ id, file }) => ({
  id,
  document: await api.uploadDocument(id, file),
}));
export const removeDoc = createAsyncThunk("chat/removeDoc", async (id) => {
  await api.removeDocument(id);
  return id;
});

const slice = createSlice({
  name: "chat",
  initialState: {
    chats: [], // sidebar list: { id, title, updatedAt, document }
    activeId: null,
    messages: [], // active chat: { id, role, content, sources }
    activeDocument: null, // { name, chunks }
    streaming: false,
    uploading: false,
    error: null,
    sidebarOpen: typeof window === "undefined" || window.innerWidth > 760,
    search: "",
  },
  reducers: {
    setSearch(state, action) {
      state.search = action.payload;
    },
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },
    dismissError(state) {
      state.error = null;
    },
    showError(state, action) {
      state.error = action.payload;
    },
    // Optimistically show the user's message and an empty answer to stream into.
    startTurn(state, action) {
      state.streaming = true;
      state.error = null;
      state.messages.push(
        { id: `user-${Date.now()}`, role: "user", content: action.payload, sources: [] },
        { id: `assistant-${Date.now()}`, role: "assistant", content: "", sources: [] }
      );
    },
    appendToken(state, action) {
      const last = state.messages.at(-1);
      if (last?.role === "assistant") last.content += action.payload;
    },
    // Replace the streamed text with the saved, cleaned answer and its sources.
    finishTurn(state, action) {
      state.streaming = false;
      const { message, title } = action.payload;
      state.messages[state.messages.length - 1] = message;
      const chat = state.chats.find((c) => c.id === state.activeId);
      if (chat) {
        if (title) chat.title = title;
        chat.updatedAt = message.createdAt;
        state.chats = [chat, ...state.chats.filter((c) => c.id !== chat.id)];
      }
    },
    failTurn(state, action) {
      state.streaming = false;
      const last = state.messages.at(-1);
      if (last?.role === "assistant" && !last.content) state.messages.pop();
      state.error = action.payload;
    },
  },
  extraReducers: (builder) => {
    const fail = (state, action) => {
      state.error = action.error.message;
    };
    builder
      .addCase(fetchChats.fulfilled, (state, action) => {
        state.chats = action.payload;
      })
      .addCase(fetchChats.rejected, fail)
      .addCase(newChat.fulfilled, (state, action) => {
        const { id, title, updatedAt } = action.payload;
        state.chats.unshift({ id, title, updatedAt, document: null });
        Object.assign(state, { activeId: id, messages: [], activeDocument: null, error: null });
      })
      .addCase(newChat.rejected, fail)
      .addCase(openChat.fulfilled, (state, action) => {
        const chat = action.payload;
        Object.assign(state, { activeId: chat.id, messages: chat.messages, activeDocument: chat.document, error: null });
      })
      .addCase(openChat.rejected, fail)
      .addCase(removeChat.fulfilled, (state, action) => {
        state.chats = state.chats.filter((c) => c.id !== action.payload);
        if (state.activeId === action.payload) Object.assign(state, { activeId: null, messages: [], activeDocument: null });
      })
      .addCase(removeChat.rejected, fail)
      .addCase(clearChat.fulfilled, (state, action) => {
        if (state.activeId === action.payload) state.messages = [];
      })
      .addCase(clearChat.rejected, fail)
      .addCase(uploadDoc.pending, (state) => {
        state.uploading = true;
        state.error = null;
      })
      .addCase(uploadDoc.fulfilled, (state, action) => {
        state.uploading = false;
        const { id, document } = action.payload;
        if (state.activeId === id) state.activeDocument = document;
        const chat = state.chats.find((c) => c.id === id);
        if (chat) chat.document = document;
      })
      .addCase(uploadDoc.rejected, (state, action) => {
        state.uploading = false;
        state.error = action.error.message;
      })
      .addCase(removeDoc.fulfilled, (state, action) => {
        if (state.activeId === action.payload) state.activeDocument = null;
        const chat = state.chats.find((c) => c.id === action.payload);
        if (chat) chat.document = null;
      })
      .addCase(removeDoc.rejected, fail);
  },
});

export const { setSearch, toggleSidebar, dismissError, showError, startTurn, appendToken, finishTurn, failTurn } = slice.actions;
export default slice.reducer;
