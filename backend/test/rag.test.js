import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, extractText } from '../src/documents.js';
import { buildRecords } from '../src/ingest.js';
import { isSmallTalk, isFollowUp, cleanAnswer, buildMessages, retrieveSources } from '../src/rag.js';
import { fakeVectors, vectorFor } from './helpers.js';

test('chunks overlap, prefer natural breaks and reject bad settings', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about Linux directories.`).join(' ');
  const chunks = chunkText(text, 300, 60);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every(chunk => chunk.length <= 300));
  assert.ok(chunks.slice(0, -1).every(chunk => chunk.endsWith('.')));
  assert.ok(chunks[1].startsWith(chunks[0].slice(-40).trim().split(' ').at(-1)) || text.includes(chunks[1]));
  assert.throws(() => chunkText('text', 100, 100), /overlap/);
});

test('text files are read and unsupported files are rejected clearly', async () => {
  assert.equal(await extractText(Buffer.from('Hello notes'), 'notes.md'), 'Hello notes');
  await assert.rejects(extractText(Buffer.from('x'), 'photo.png'), { name: 'UserError', message: /Unsupported file type ".png"/ });
});

test('record ids depend only on content', () => {
  const vectors = [vectorFor(1), vectorFor(2)];
  const first = buildRecords(['a', 'b'], vectors, 'one.pdf');
  const again = buildRecords(['a', 'b'], vectors, 'renamed.pdf');
  assert.deepEqual(first.records.map(r => r.id), again.records.map(r => r.id));
  assert.match(first.records[1].id, /^doc-[0-9a-f]{24}-chunk-1$/);
  assert.deepEqual(first.records[1].metadata, { text: 'b', chunkIndex: 1, source: 'one.pdf', model: 'llama-text-embed-v2' });
});

test('small talk and follow-ups are recognised', () => {
  for (const text of ['hello', 'Hi sir!', 'thank you', 'how are you', 'what is your name claire']) assert.ok(isSmallTalk(text), text);
  for (const text of ['hello what is Linux?', 'What is head?']) assert.ok(!isSmallTalk(text), text);
  assert.ok(isFollowUp('tell me more'));
  assert.ok(!isFollowUp('What is a directory?'));
});

test('answers keep Markdown but lose citation marks', () => {
  assert.equal(cleanAnswer('The **head** command [1] shows lines【2†L1-L4】.'), 'The **head** command shows lines.');
  assert.equal(cleanAnswer('See [source 1, 2] and `ls`.'), 'See and `ls`.');
});

test('prompts depend on document mode and small talk', () => {
  const history = [{ role: 'user', content: 'hi', sources: [] }, { role: 'assistant', content: 'Hello!', sources: [] }];
  const doc = buildMessages({ message: 'What is ls?', history, sources: [{ number: 1, text: 'ls lists files', chunk: 3 }], smallTalk: false, hasDocument: true });
  assert.match(doc[0].content, /Claire/);
  assert.match(doc[1].content, /only the document excerpts/);
  assert.deepEqual(doc.slice(2, 4), [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' }]);
  assert.deepEqual(JSON.parse(doc.at(-1).content), { question: 'What is ls?', documentExcerpts: [{ number: 1, text: 'ls lists files' }] });

  const greeting = buildMessages({ message: 'hello', history: [], sources: [], smallTalk: true, hasDocument: true });
  assert.match(greeting[1].content, /small talk/);
  assert.equal(greeting.at(-1).content, 'hello');

  const general = buildMessages({ message: 'What is 2+2?', history: [], sources: [], smallTalk: false, hasDocument: false });
  assert.match(general[1].content, /No document is attached/);
});

test('retrieval embeds the query (with the previous question for follow-ups)', async () => {
  const vectors = fakeVectors();
  await vectors.upsert('chat-1', buildRecords(['ls lists files', 'cd changes directory'], [vectorFor(1), vectorFor(2)], 'f.pdf').records);
  const sources = await retrieveSources(vectors, 'chat-1', 'give an example', 'What is ls?');
  assert.equal(vectors.calls.embed[0].inputType, 'query');
  assert.equal(vectors.calls.embed[0].texts[0], 'What is ls?\ngive an example');
  assert.deepEqual(sources.map(s => [s.number, s.chunk, s.text]), [[1, 1, 'ls lists files'], [2, 2, 'cd changes directory']]);
});
