import test from 'node:test';
import assert from 'node:assert/strict';
import { streamCompletion } from '../src/llm.js';
import { createVectorStore } from '../src/pinecone.js';
import { vectorFor } from './helpers.js';

const sseBody = events => new Blob(events.map(e => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`)).stream();
const delta = (content, finish_reason = null) => ({ choices: [{ delta: { content }, finish_reason }] });

test('Groq streaming collects tokens and sends the right request', async () => {
  let request;
  const tokens = [];
  const result = await streamCompletion([{ role: 'user', content: 'hi' }], token => tokens.push(token), {
    apiKey: 'test-key', model: 'openai/gpt-oss-120b',
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return { ok: true, body: sseBody([delta('Hel'), delta('lo'), delta('', 'stop'), '[DONE]']) };
    },
  });
  assert.deepEqual(tokens, ['Hel', 'lo']);
  assert.deepEqual(result, { text: 'Hello', truncated: false });
  assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer test-key');
  assert.equal(request.body.stream, true);
  assert.equal(request.body.include_reasoning, false);
});

test('Groq errors become friendly messages', async () => {
  const failing = status => streamCompletion([], () => {}, { apiKey: 'k', fetchImpl: async () => ({ ok: false, status }) });
  await assert.rejects(failing(429), { status: 429, message: /too many requests/ });
  await assert.rejects(failing(401), /rejected the server API key/);
  await assert.rejects(streamCompletion([], () => {}, { apiKey: '' }), /GROQ_API_KEY/);
});

function fakePinecone({ dimension = 1024, embedIndexes } = {}) {
  const calls = { deleted: [] };
  return {
    calls,
    indexes: { describe: async () => ({ host: 'h', status: { ready: true }, schema: { fields: { _values: { type: 'dense_vector', dimension, metric: 'cosine' } } } }) },
    index: () => ({
      deleteNamespace: async namespace => {
        calls.deleted.push(namespace);
        if (namespace === 'missing') throw Object.assign(new Error('Namespace not found'), { name: 'PineconeNotFoundError' });
      },
    }),
    inference: {
      embed: async ({ inputs }) => ({
        data: inputs.map((_, i) => ({ vectorType: 'dense', values: vectorFor(i), index: embedIndexes?.[i] ?? i })),
      }),
    },
  };
}

test('embeddings keep input order and reject wrong index shapes', async () => {
  const store = createVectorStore({ pc: fakePinecone({ embedIndexes: [1, 0] }), indexName: 'test' });
  const [first, second] = await store.embed(['a', 'b'], 'passage');
  assert.deepEqual(first, vectorFor(1));
  assert.deepEqual(second, vectorFor(0));

  const wrong = createVectorStore({ pc: fakePinecone({ dimension: 3000 }), indexName: 'test' });
  await assert.rejects(wrong.deleteNamespace('x'), /must be dense, 1024-dimensional and cosine/);
  await assert.rejects(createVectorStore({ pc: fakePinecone(), indexName: '' }).deleteNamespace('x'), /PINECONE_INDEX_NAME/);
});

test('deleting a namespace that was never created is not an error', async () => {
  const pc = fakePinecone();
  await createVectorStore({ pc, indexName: 'test' }).deleteNamespace('missing');
  assert.deepEqual(pc.calls.deleted, ['missing']);
});
