import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer, upload, fakeComplete } from './helpers.js';
import { DAILY_CHUNK_BUDGET } from '../src/ingest.js';

const NOTES = 'Linux is an operating system. The ls command lists files. The cd command changes directory.';

test('requests need a valid session token, and chats are private to it', async () => {
  const server = await startServer();
  try {
    assert.equal((await server.request('/chats', { token: null })).status, 401);
    assert.equal((await server.request('/chats', { token: 'short' })).status, 401);

    const { status, body } = await server.request('/chats', { method: 'POST' });
    assert.equal(status, 201);
    const other = { token: 'another-session-token-bbbb' };
    assert.deepEqual((await server.request('/chats', other)).body.chats, []);
    assert.equal((await server.request(`/chats/${body.chat.id}`, other)).status, 404);
    assert.equal((await server.request(`/chats/${body.chat.id}`, { ...other, method: 'DELETE' })).status, 404);
    assert.equal((await server.request('/chats')).body.chats.length, 1);
  } finally { await server.close(); }
});

test('uploading a document indexes it into the chat namespace', async () => {
  const server = await startServer();
  try {
    const { chat } = (await server.request('/chats', { method: 'POST' })).body;
    const { status, body } = await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('notes.txt', NOTES) });
    assert.equal(status, 200);
    assert.deepEqual(body.document, { name: 'notes.txt', chunks: 1 });
    assert.equal(server.vectors.namespaces.get(`chat-${chat.id}`).size, 1);
    assert.deepEqual(server.vectors.calls.deleted, [`chat-${chat.id}`], 'old document is replaced');
    assert.equal((await server.request('/chats')).body.chats[0].document.name, 'notes.txt');

    const bad = await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('photo.png', 'x') });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /Unsupported file type/);
    const empty = await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('empty.txt', '   ') });
    assert.match(empty.body.error, /No readable text/);
  } finally { await server.close(); }
});

test('document questions stream a grounded answer with sources and save it', async () => {
  const server = await startServer({ llm: fakeComplete('The ls command lists files [1].') });
  try {
    const { chat } = (await server.request('/chats', { method: 'POST' })).body;
    await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('notes.txt', NOTES) });

    const { status, body: events } = await server.request(`/chats/${chat.id}/messages`, { method: 'POST', json: { message: 'What does ls do?' } });
    assert.equal(status, 200);
    assert.deepEqual(events.filter(e => e.event === 'token').map(e => e.data.token).join(''), 'The ls command lists files [1].');
    const done = events.at(-1);
    assert.equal(done.event, 'done');
    assert.equal(done.data.message.content, 'The ls command lists files.');
    assert.equal(done.data.message.sources[0].text, NOTES);
    assert.equal(done.data.title, 'What does ls do?');

    const sent = server.llm.calls[0];
    assert.match(sent[1].content, /only the document excerpts/);
    assert.equal(JSON.parse(sent.at(-1).content).documentExcerpts[0].text, NOTES);

    const saved = (await server.request(`/chats/${chat.id}`)).body.chat;
    assert.deepEqual(saved.messages.map(m => m.role), ['user', 'assistant']);
    assert.equal(saved.owner, undefined);
  } finally { await server.close(); }
});

test('greetings skip document search; chats without a document use general mode', async () => {
  const server = await startServer({ llm: fakeComplete('Hello!') });
  try {
    const { chat } = (await server.request('/chats', { method: 'POST' })).body;
    await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('notes.txt', NOTES) });
    const embedsAfterUpload = server.vectors.calls.embed.length;
    await server.request(`/chats/${chat.id}/messages`, { method: 'POST', json: { message: 'hello sir' } });
    assert.equal(server.vectors.calls.embed.length, embedsAfterUpload);
    assert.match(server.llm.calls[0][1].content, /small talk/);

    const plain = (await server.request('/chats', { method: 'POST' })).body.chat;
    await server.request(`/chats/${plain.id}/messages`, { method: 'POST', json: { message: 'What is 2+2?' } });
    assert.match(server.llm.calls[1][1].content, /No document is attached/);
    assert.equal(server.vectors.calls.query.length, 0);
  } finally { await server.close(); }
});

test('clear keeps the document; deleting a chat or document removes its vectors', async () => {
  const server = await startServer();
  try {
    const { chat } = (await server.request('/chats', { method: 'POST' })).body;
    await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('notes.txt', NOTES) });
    await server.request(`/chats/${chat.id}/messages`, { method: 'POST', json: { message: 'What is Linux?' } });

    await server.request(`/chats/${chat.id}/messages`, { method: 'DELETE' });
    const cleared = (await server.request(`/chats/${chat.id}`)).body.chat;
    assert.equal(cleared.messages.length, 0);
    assert.equal(cleared.document.name, 'notes.txt');

    await server.request(`/chats/${chat.id}/document`, { method: 'DELETE' });
    assert.equal(server.vectors.namespaces.has(`chat-${chat.id}`), false);
    assert.equal((await server.request(`/chats/${chat.id}`)).body.chat.document, null);

    await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('notes.txt', NOTES) });
    assert.equal((await server.request(`/chats/${chat.id}`, { method: 'DELETE' })).status, 200);
    assert.equal(server.vectors.namespaces.has(`chat-${chat.id}`), false);
    assert.equal((await server.request('/chats')).body.chats.length, 0);
  } finally { await server.close(); }
});

test('bad input gets clear errors, and LLM failures arrive as stream errors', async () => {
  const failing = { complete: async () => { throw Object.assign(new Error('Groq down'), { name: 'TimeoutError' }); }, calls: [] };
  const server = await startServer({ llm: failing });
  try {
    const { chat } = (await server.request('/chats', { method: 'POST' })).body;
    assert.equal((await server.request(`/chats/${chat.id}/messages`, { method: 'POST', json: { message: '  ' } })).status, 400);
    assert.match((await server.request(`/chats/${chat.id}/messages`, { method: 'POST', json: { message: 'x'.repeat(4001) } })).body.error, /4,000/);

    const events = (await server.request(`/chats/${chat.id}/messages`, { method: 'POST', json: { message: 'Hi there, what is Linux?' } })).body;
    assert.deepEqual(events.at(-1), { event: 'error', data: { error: 'The AI took too long to answer. Please try again.' } });
  } finally { await server.close(); }
});

test('the default route and health check need no session token', async () => {
  const server = await startServer();
  try {
    const base = (await server.request('/health', { token: null }));
    assert.deepEqual(base, { status: 200, body: { status: 'ok', store: server.store.kind } });
    const root = await fetch(server.url + '/');
    assert.equal(root.status, 200);
    assert.deepEqual(await root.json(), { message: 'This is the default route of the backend', success: true });
  } finally { await server.close(); }
});

test('a failed upload never leaves a stale document, and deleting the chat still removes its vectors', async () => {
  const server = await startServer();
  try {
    const { chat } = (await server.request('/chats', { method: 'POST' })).body;
    await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('notes.txt', NOTES) });

    // Pinecone fails after the old document's vectors were deleted.
    server.vectors.upsert = async () => { throw new Error('Pinecone down'); };
    const failed = await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('book.txt', 'Another document.') });
    assert.equal(failed.status, 500);
    assert.equal((await server.request(`/chats/${chat.id}`)).body.chat.document, null);

    // Vectors left behind with no document recorded are still cleaned up.
    server.vectors.namespaces.set(`chat-${chat.id}`, new Map([['orphan', {}]]));
    await server.request(`/chats/${chat.id}`, { method: 'DELETE' });
    assert.equal(server.vectors.namespaces.has(`chat-${chat.id}`), false);
  } finally { await server.close(); }
});

test('oversized documents, broken Word files and full chats get clear errors', async () => {
  const server = await startServer();
  try {
    const { chat } = (await server.request('/chats', { method: 'POST' })).body;
    const long = await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('big.txt', 'a'.repeat(2_000_000)) });
    assert.match(long.body.error, /too long/);
    assert.equal(server.vectors.calls.embed.length, 0, 'nothing is embedded');

    const docx = await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('old.docx', 'not a zip') });
    assert.equal(docx.status, 400);
    assert.match(docx.body.error, /Could not read this Word file/);

    for (let i = 0; i < 1000; i++) await server.store.addMessage(server.token, chat.id, { role: 'user', content: 'x' });
    const full = await server.request(`/chats/${chat.id}/messages`, { method: 'POST', json: { message: 'One more?' } });
    assert.equal(full.status, 400);
    assert.match(full.body.error, /chat is full/);
  } finally { await server.close(); }
});

test('a failed embedding keeps the old document; a chat deleted mid-upload or mid-answer leaves nothing behind', async () => {
  const deleting = { calls: [], complete: async (messages, onToken) => {
    await server.store.deleteChat(server.token, deleting.chatId);
    onToken('Partial answer');
    return { text: 'Partial answer', truncated: false };
  } };
  const server = await startServer({ llm: deleting });
  try {
    const { chat } = (await server.request('/chats', { method: 'POST' })).body;
    await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('notes.txt', NOTES) });

    // Embedding fails before anything is deleted: notes.txt stays attached and searchable.
    const embed = server.vectors.embed;
    server.vectors.embed = async () => { throw new Error('Rate limited'); };
    assert.equal((await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('book.txt', 'Another document.') })).status, 500);
    assert.equal((await server.request(`/chats/${chat.id}`)).body.chat.document.name, 'notes.txt');
    assert.equal(server.vectors.namespaces.has(`chat-${chat.id}`), true);
    server.vectors.embed = embed;

    // The chat is deleted while its upload is saving.
    const upsert = server.vectors.upsert;
    server.vectors.upsert = async (namespace, records) => {
      await server.store.deleteChat(server.token, chat.id);
      await upsert(namespace, records);
    };
    await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('book.txt', 'Another document.') });
    assert.equal(server.vectors.namespaces.has(`chat-${chat.id}`), false);
    server.vectors.upsert = upsert;

    // The chat is deleted while its answer is streaming.
    deleting.chatId = (await server.request('/chats', { method: 'POST' })).body.chat.id;
    const events = (await server.request(`/chats/${deleting.chatId}/messages`, { method: 'POST', json: { message: 'What is Linux?' } })).body;
    assert.deepEqual(events.at(-1), { event: 'error', data: { error: 'This chat was deleted.' } });
  } finally { await server.close(); }
});

test('the assistant remembers facts across chats, and the user can forget them', async () => {
  const seen = [];
  const remember = async (message, memories) => {
    seen.push(message);
    if (/Sam/.test(message)) return { add: ["The user's name is Sam."], forget: [] };
    if (/Delhi/.test(message)) return { add: ['The user lives in Delhi.'], forget: [] };
    if (/Pune/.test(message)) return { add: ['The user lives in Pune.'], forget: [memories.findIndex(m => /Delhi/.test(m.text)) + 1] };
    throw new Error('Groq down');
  };
  const server = await startServer({ remember });
  try {
    const ask = async (message) => {
      const { chat } = (await server.request('/chats', { method: 'POST' })).body;
      return (await server.request(`/chats/${chat.id}/messages`, { method: 'POST', json: { message } })).body.at(-1);
    };
    assert.deepEqual((await ask('My name is Sam')).data.memories.map(m => m.text), ["The user's name is Sam."]);
    await ask('I live in Delhi');
    assert.equal((await ask('hello')).data.memories, undefined, 'small talk skips remembering');
    assert.equal((await ask('What is Linux?')).data.memories, undefined, 'nothing about the user: no extra AI call');
    const moved = await ask('I moved to Pune');
    assert.deepEqual(moved.data.memories.map(m => m.text), ["The user's name is Sam.", 'The user lives in Pune.']);
    const failed = await ask('I like tea');
    assert.equal(failed.event, 'done', 'a failed memory call does not break the answer');
    assert.deepEqual(seen, ['My name is Sam', 'I live in Delhi', 'I moved to Pune', 'I like tea']);

    // A new chat gets the saved facts, not the forgotten one.
    await ask('What is Linux?');
    const context = server.llm.calls.at(-1).map(m => m.content).join('\n');
    assert.match(context, /name is Sam/);
    assert.match(context, /lives in Pune/);
    assert.doesNotMatch(context, /Delhi/);

    const { memories } = (await server.request('/memories')).body;
    assert.equal(memories.length, 2);
    assert.deepEqual((await server.request('/memories', { token: 'another-session-token-bbbb' })).body.memories, []);
    assert.equal((await server.request(`/memories/${memories[0].id}`, { method: 'DELETE' })).body.memories.length, 1);
    assert.deepEqual((await server.request('/memories', { method: 'DELETE' })).body.memories, []);
    assert.deepEqual((await server.request('/memories')).body.memories, []);
  } finally { await server.close(); }
});

test('the daily upload budget lives in the store, so restarts do not reset it', async () => {
  const server = await startServer();
  try {
    const day = `test-${randomUUID()}`; // Never today, so a shared test database's real budget is untouched.
    assert.equal(await server.store.useBudget(day, 6, 10), true);
    assert.equal(await server.store.useBudget(day, 6, 10), false);
    assert.equal(await server.store.useBudget(day, 4, 10), true, 'a refused upload is not counted');
    assert.equal(await server.store.useBudget(`${day}-next`, DAILY_CHUNK_BUDGET, DAILY_CHUNK_BUDGET), true, 'each day starts fresh');

    const { chat } = (await server.request('/chats', { method: 'POST' })).body;
    const useBudget = server.store.useBudget;
    server.store.useBudget = async () => false;
    const refused = await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('notes.txt', NOTES) });
    server.store.useBudget = useBudget;
    assert.equal(refused.status, 429);
    assert.match(refused.body.error, /today's upload limit/);
  } finally { await server.close(); }
});

test('a second upload to the same chat is refused while the first is running', async () => {
  const server = await startServer();
  try {
    const { chat } = (await server.request('/chats', { method: 'POST' })).body;
    const embed = server.vectors.embed;
    let entered, release;
    const inside = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    server.vectors.embed = async (...args) => { entered(); await gate; return embed(...args); };

    const first = server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('notes.txt', NOTES) });
    await inside;
    const second = await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('book.txt', 'Another document.') });
    assert.equal(second.status, 409);
    release();
    assert.equal((await first).status, 200);
    server.vectors.embed = embed;
    assert.equal((await server.request(`/chats/${chat.id}/document`, { method: 'POST', body: upload('book.txt', 'Another document.') })).status, 200, 'free again afterwards');
  } finally { await server.close(); }
});
