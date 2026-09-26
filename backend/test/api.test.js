import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, upload, fakeComplete } from './helpers.js';

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
    assert.equal((await server.request(`/chats/${chat.id}`, { method: 'PATCH', json: { title: '' } })).status, 400);
    assert.equal((await server.request(`/chats/${chat.id}`, { method: 'PATCH', json: { title: 'Linux notes' } })).body.title, 'Linux notes');

    const events = (await server.request(`/chats/${chat.id}/messages`, { method: 'POST', json: { message: 'Hi there, what is Linux?' } })).body;
    assert.deepEqual(events.at(-1), { event: 'error', data: { error: 'The AI took too long to answer. Please try again.' } });
  } finally { await server.close(); }
});
