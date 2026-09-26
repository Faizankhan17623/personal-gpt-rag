import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { MAX_UPLOAD_BYTES } from './config.js';
import { UserError } from './errors.js';
import { indexDocument } from './ingest.js';
import { isSmallTalk, isFollowUp, cleanAnswer, retrieveSources, buildMessages } from './rag.js';
import { streamCompletion } from './llm.js';

const MAX_MESSAGE_CHARS = 4000;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const namespaceFor = chatId => `chat-${chatId}`;

// store: chat storage, vectors: Pinecone wrapper, complete: LLM streaming function.
export function createApp({ store, vectors, complete = streamCompletion, corsOrigins = [], rateLimits = true }) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({
    origin: corsOrigins.length ? corsOrigins : true,
    allowedHeaders: ['Content-Type', 'X-Session-Token'],
  }));
  app.use(express.json({ limit: '100kb' }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  const limit = (windowMinutes, limit) => rateLimits
    ? rateLimit({ windowMs: windowMinutes * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
      handler: (req, res) => res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' }) })
    : (req, res, next) => next();

  app.get('/api/health', (req, res) => res.json({ status: 'ok', store: store.kind }));

  // Each browser sends a random session token; chats are only visible to their owner.
  const api = express.Router();
  api.use((req, res, next) => {
    const token = req.get('X-Session-Token');
    if (!SESSION_TOKEN.test(token || '')) return res.status(401).json({ error: 'Missing or invalid session token.' });
    req.owner = token;
    next();
  });

  const loadChat = async (req, res, next) => {
    req.chat = await store.getChat(req.owner, req.params.id);
    if (!req.chat) return res.status(404).json({ error: 'Chat not found.' });
    next();
  };

  api.get('/chats', async (req, res) => {
    res.json({ chats: await store.listChats(req.owner) });
  });

  api.post('/chats', limit(10, 60), async (req, res) => {
    res.status(201).json({ chat: await store.createChat(req.owner) });
  });

  api.get('/chats/:id', loadChat, (req, res) => {
    const { owner, ...chat } = req.chat;
    res.json({ chat });
  });

  api.patch('/chats/:id', loadChat, async (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) : '';
    if (!title) throw new UserError('Enter a title.');
    await store.renameChat(req.owner, req.params.id, title);
    res.json({ ok: true, title });
  });

  api.delete('/chats/:id', loadChat, async (req, res) => {
    if (req.chat.document) await vectors.deleteNamespace(namespaceFor(req.chat.id));
    await store.deleteChat(req.owner, req.params.id);
    res.json({ ok: true });
  });

  // Clears the conversation but keeps the attached document.
  api.delete('/chats/:id/messages', loadChat, async (req, res) => {
    await store.clearMessages(req.owner, req.params.id);
    res.json({ ok: true });
  });

  api.post('/chats/:id/document', limit(10, 10), loadChat, upload.single('file'), async (req, res) => {
    if (!req.file) throw new UserError('Choose a file to upload.');
    const document = await indexDocument(vectors, namespaceFor(req.chat.id), {
      buffer: req.file.buffer,
      filename: Buffer.from(req.file.originalname, 'latin1').toString('utf8'),
    });
    await store.setDocument(req.owner, req.chat.id, document);
    res.json({ document: { name: document.name, chunks: document.chunks } });
  });

  api.delete('/chats/:id/document', loadChat, async (req, res) => {
    await vectors.deleteNamespace(namespaceFor(req.chat.id));
    await store.setDocument(req.owner, req.chat.id, null);
    res.json({ ok: true });
  });

  // Streams the answer as server-sent events: token*, then done or error.
  api.post('/chats/:id/messages', limit(5, 30), loadChat, async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) throw new UserError('Enter a message.');
    if (message.length > MAX_MESSAGE_CHARS) throw new UserError(`Keep messages under ${MAX_MESSAGE_CHARS.toLocaleString()} characters.`);

    const { chat } = req;
    const smallTalk = isSmallTalk(message);
    const hasDocument = Boolean(chat.document);
    let sources = [];
    if (hasDocument && !smallTalk) {
      // Follow-ups search with the last real question, not a greeting.
      const previous = isFollowUp(message)
        ? chat.messages.findLast(m => m.role === 'user' && !isSmallTalk(m.content))?.content || ''
        : '';
      sources = await retrieveSources(vectors, namespaceFor(chat.id), message, previous);
    }
    const messages = buildMessages({ message, history: chat.messages, sources, smallTalk, hasDocument });
    await store.addMessage(req.owner, chat.id, { role: 'user', content: message });

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const aborted = new AbortController();
    res.on('close', () => aborted.abort());

    try {
      const { text, truncated } = await complete(messages, token => send('token', { token }), { signal: aborted.signal });
      const content = cleanAnswer(text) + (truncated ? '\n\n*The answer reached its length limit. Ask a narrower follow-up for more.*' : '');
      const saved = await store.addMessage(req.owner, chat.id, { role: 'assistant', content, sources });
      const title = (await store.getChat(req.owner, chat.id))?.title;
      send('done', { message: saved, title });
    } catch (error) {
      if (!aborted.signal.aborted) {
        if (!(error instanceof UserError)) console.error('Chat failed:', error);
        send('error', { error: publicMessage(error) });
      }
    }
    res.end();
  });

  app.use('/api', api);
  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

  // Express 5 forwards rejected promises from async handlers here.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      const tooBig = error.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? `Files must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` : error.message });
    }
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (!(error instanceof UserError)) console.error(error);
    res.status(error instanceof UserError ? error.status : 500).json({ error: publicMessage(error) });
  });

  return app;
}

function publicMessage(error) {
  if (error instanceof UserError) return error.message;
  if (error?.name === 'TimeoutError') return 'The AI took too long to answer. Please try again.';
  return 'Something went wrong. Please try again.';
}
