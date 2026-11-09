import { createHash } from 'node:crypto';
import { EMBEDDING_MODEL } from './config.js';
import { extractText, chunkText } from './documents.js';
import { UserError } from './errors.js';

// Pinecone Starter allows llama-text-embed-v2 250,000 tokens a minute and 5 million a month.
// A chunk is ~250 tokens, so 800 chunks (~200k tokens) embed without hitting the per-minute limit,
// and 2000 chunks a day (~500k tokens, a tenth of the month) stops one visitor spending the month.
const MAX_CHUNKS = 800;
export const DAILY_CHUNK_BUDGET = 2000;

// IDs depend only on the document contents, so re-uploading the same file overwrites its records.
export function buildRecords(chunks, vectors, filename) {
  const documentId = createHash('sha256').update(JSON.stringify({ model: EMBEDDING_MODEL, chunks })).digest('hex').slice(0, 24);
  return {
    documentId,
    records: chunks.map((text, i) => ({
      id: `doc-${documentId}-chunk-${i}`,
      values: vectors[i],
      metadata: { text, chunkIndex: i, source: filename, model: EMBEDDING_MODEL },
    })),
  };
}

// Reads, chunks, embeds and stores a file in the chat's namespace, replacing any previous document.
// store keeps the daily upload budget (in MongoDB, so it survives the server sleeping and restarting).
export async function indexDocument(vectors, store, namespace, { buffer, filename }) {
  const text = (await extractText(buffer, filename))?.trim();
  if (!text) throw new UserError('No readable text was found in this file. Scanned PDFs need OCR first.');

  const chunks = chunkText(text);
  if (chunks.length > MAX_CHUNKS) throw new UserError('This document is too long. Upload a shorter file (about 300 pages of text at most).');
  const today = new Date().toISOString().slice(0, 10);
  if (!(await store.useBudget(today, chunks.length, DAILY_CHUNK_BUDGET))) {
    throw new UserError('The server has reached today\'s upload limit. Please try again tomorrow.', 429);
  }
  const embeddings = await vectors.embed(chunks, 'passage');
  const { documentId, records } = buildRecords(chunks, embeddings, filename);

  try {
    await vectors.deleteNamespace(namespace);
    await vectors.upsert(namespace, records);
  } catch (error) {
    error.documentCleared = true; // The old document's vectors may be gone.
    throw error;
  }
  await vectors.verify(namespace, records);
  return { name: filename, documentId, chunks: records.length, characters: text.length };
}
