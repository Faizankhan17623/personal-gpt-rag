import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/store/memoryStore.js';

export const DIMENSIONS = 1024;
export const vectorFor = seed => Array.from({ length: DIMENSIONS }, (_, i) => ((i * 31 + seed) % 97) / 97 + 0.01);

// In-memory stand-in for the Pinecone wrapper.
export function fakeVectors() {
  const namespaces = new Map();
  const calls = { embed: [], query: [], deleted: [] };
  return {
    namespaces, calls,
    async embed(texts, inputType) {
      calls.embed.push({ texts, inputType });
      return texts.map((_, i) => vectorFor(i));
    },
    async upsert(namespace, records) {
      const stored = namespaces.get(namespace) || new Map();
      for (const record of records) stored.set(record.id, record);
      namespaces.set(namespace, stored);
    },
    async verify() {},
    async query(namespace, vector, topK) {
      calls.query.push({ namespace, topK });
      return [...(namespaces.get(namespace)?.values() || [])].slice(0, topK)
        .map((record, i) => ({ id: record.id, score: 0.9 - i / 10, metadata: record.metadata }));
    },
    async deleteNamespace(namespace) {
      calls.deleted.push(namespace);
      namespaces.delete(namespace);
    },
  };
}

// Fake LLM that streams a fixed answer in two tokens and records what it was sent.
export function fakeComplete(answer = 'Linux is an operating system.') {
  const calls = [];
  const complete = async (messages, onToken) => {
    calls.push(messages);
    const half = Math.ceil(answer.length / 2);
    onToken(answer.slice(0, half));
    onToken(answer.slice(half));
    return { text: answer, truncated: false };
  };
  return { complete, calls };
}

// Starts the app on a random port and returns a small fetch client.
export async function startServer(options = {}) {
  const store = options.store || createMemoryStore();
  const vectors = options.vectors || fakeVectors();
  const llm = options.llm || fakeComplete();
  const app = createApp({ store, vectors, complete: llm.complete, rateLimits: false });
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const request = async (path, { token = 'test-session-token-aaaa', ...init } = {}) => {
    const response = await fetch(base + path, {
      ...init,
      headers: { ...(token ? { 'X-Session-Token': token } : {}), ...(init.json ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      body: init.json ? JSON.stringify(init.json) : init.body,
    });
    const type = response.headers.get('content-type') || '';
    const body = type.includes('event-stream') ? parseEvents(await response.text()) : await response.json();
    return { status: response.status, body };
  };

  return { store, vectors, llm, request, close: () => new Promise(resolve => server.close(resolve)) };
}

function parseEvents(text) {
  return text.split('\n\n').filter(Boolean).map(block => {
    const event = block.match(/^event: (.*)$/m)?.[1];
    const data = block.match(/^data: (.*)$/m)?.[1];
    return { event, data: data && JSON.parse(data) };
  });
}

export function upload(filename, content) {
  const form = new FormData();
  form.append('file', new Blob([content]), filename);
  return form;
}
