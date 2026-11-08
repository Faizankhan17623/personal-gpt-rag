import { createHash } from 'node:crypto';
import { EMBEDDING_MODEL } from './config.js';
import { extractText, chunkText } from './documents.js';
import { UserError } from './errors.js';

const MAX_CHUNKS = 2000;

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
export async function indexDocument(vectors, namespace, { buffer, filename }) {
  const text = (await extractText(buffer, filename))?.trim();
  if (!text) throw new UserError('No readable text was found in this file. Scanned PDFs need OCR first.');

  const chunks = chunkText(text);
  // Bounds memory (~2000 vectors) and embedding quota per upload.
  if (chunks.length > MAX_CHUNKS) throw new UserError('This document is too long. Upload a shorter file (about 1,500 pages of text at most).');
  const embeddings = await vectors.embed(chunks, 'passage');
  const { documentId, records } = buildRecords(chunks, embeddings, filename);

  await vectors.deleteNamespace(namespace);
  await vectors.upsert(namespace, records);
  await vectors.verify(namespace, records);
  return { name: filename, documentId, chunks: records.length, characters: text.length };
}
