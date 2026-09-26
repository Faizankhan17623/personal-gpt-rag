import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { makeTitle, summarize } from './shared.js';

const sourceSchema = new mongoose.Schema({ number: Number, chunk: Number, score: Number, text: String }, { _id: false });
const messageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  sources: { type: [sourceSchema], default: [] },
  createdAt: { type: Number, required: true },
}, { _id: false });
const chatSchema = new mongoose.Schema({
  _id: { type: String, default: randomUUID },
  owner: { type: String, required: true, index: true },
  title: { type: String, default: 'New chat' },
  createdAt: { type: Number, required: true },
  updatedAt: { type: Number, required: true, index: true },
  messages: { type: [messageSchema], default: [] },
  document: { type: new mongoose.Schema({ name: String, documentId: String, chunks: Number, characters: Number }, { _id: false }), default: null },
}, { versionKey: false });

const toChat = doc => {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
};

// Stores chats in MongoDB so they survive restarts and redeploys.
export async function createMongoStore(uri) {
  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10000 }).asPromise();
  const Chat = connection.model('Chat', chatSchema);
  const mine = (owner, id) => ({ _id: id, owner });

  return {
    kind: 'mongo',
    async listChats(owner) {
      const chats = await Chat.find({ owner }, { messages: 0 }).sort({ updatedAt: -1 }).limit(200).lean();
      return chats.map(chat => summarize(toChat(chat)));
    },
    async getChat(owner, id) {
      return toChat(await Chat.findOne(mine(owner, id)).lean());
    },
    async createChat(owner) {
      const now = Date.now();
      return toChat((await Chat.create({ owner, createdAt: now, updatedAt: now })).toObject());
    },
    async renameChat(owner, id, title) {
      return toChat(await Chat.findOneAndUpdate(mine(owner, id), { title, updatedAt: Date.now() }, { returnDocument: 'after' }).lean());
    },
    async deleteChat(owner, id) {
      return toChat(await Chat.findOneAndDelete(mine(owner, id)).lean());
    },
    async addMessage(owner, id, message) {
      const saved = { id: randomUUID(), createdAt: Date.now(), sources: [], ...message };
      const chat = await Chat.findOneAndUpdate(mine(owner, id), { $push: { messages: saved }, updatedAt: saved.createdAt }, { returnDocument: 'after', projection: { title: 1 } });
      if (!chat) return null;
      if (message.role === 'user' && chat.title === 'New chat') {
        await Chat.updateOne(mine(owner, id), { title: makeTitle(message.content) });
      }
      return saved;
    },
    async clearMessages(owner, id) {
      return toChat(await Chat.findOneAndUpdate(mine(owner, id), { messages: [], updatedAt: Date.now() }, { returnDocument: 'after' }).lean());
    },
    async setDocument(owner, id, document) {
      return toChat(await Chat.findOneAndUpdate(mine(owner, id), { document, updatedAt: Date.now() }, { returnDocument: 'after' }).lean());
    },
    async close() {
      await connection.close();
    },
  };
}
