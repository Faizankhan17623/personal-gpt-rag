import { randomUUID } from 'node:crypto';
import { makeTitle, summarize } from './shared.js';

// Keeps chats in process memory. Used for tests and local runs without MONGODB_URI;
// everything is lost when the server restarts.
export function createMemoryStore() {
  const chats = new Map();
  const memories = new Map(); // owner → saved facts
  const usage = new Map(); // day → chunks uploaded
  const find = (owner, id) => {
    const chat = chats.get(id);
    return chat && chat.owner === owner ? chat : null;
  };
  const copy = chat => chat && structuredClone(chat);

  return {
    kind: 'memory',
    async listChats(owner) {
      return [...chats.values()].filter(chat => chat.owner === owner)
        .sort((a, b) => b.updatedAt - a.updatedAt).map(summarize);
    },
    async getChat(owner, id) {
      return copy(find(owner, id));
    },
    async createChat(owner) {
      const now = Date.now();
      const chat = { id: randomUUID(), owner, title: 'New chat', createdAt: now, updatedAt: now, messages: [], document: null };
      chats.set(chat.id, chat);
      return copy(chat);
    },
    async deleteChat(owner, id) {
      const chat = find(owner, id);
      if (chat) chats.delete(id);
      return copy(chat);
    },
    async addMessage(owner, id, message) {
      const chat = find(owner, id);
      if (!chat) return null;
      const saved = { id: randomUUID(), createdAt: Date.now(), sources: [], ...message };
      chat.messages.push(saved);
      if (message.role === 'user' && chat.title === 'New chat') chat.title = makeTitle(message.content);
      chat.updatedAt = saved.createdAt;
      return copy(saved);
    },
    async clearMessages(owner, id) {
      const chat = find(owner, id);
      if (!chat) return null;
      Object.assign(chat, { messages: [], updatedAt: Date.now() });
      return copy(chat);
    },
    async setDocument(owner, id, document) {
      const chat = find(owner, id);
      if (!chat) return null;
      Object.assign(chat, { document, updatedAt: Date.now() });
      return copy(chat);
    },
    async getMemories(owner) {
      return structuredClone(memories.get(owner) || []);
    },
    async setMemories(owner, items) {
      memories.set(owner, structuredClone(items));
      return items;
    },
    // Adds amount to the day's total unless that would go over max. Returns whether it was added.
    async useBudget(day, amount, max) {
      const used = (usage.get(day) || 0) + amount;
      if (used > max) return false;
      usage.set(day, used);
      return true;
    },
    async close() {},
  };
}
