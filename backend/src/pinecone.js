import { Pinecone } from '@pinecone-database/pinecone';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, settings } from './config.js';
import { UserError } from './errors.js';

const EMBED_BATCH_SIZE = 96; // llama-text-embed-v2 accepts at most 96 inputs per request.
const UPSERT_BATCH_SIZE = 100;

// Wraps Pinecone embeddings and one index. Each chat's document lives in its own namespace.
// `pc` can be injected for tests.
export function createVectorStore({ pc, apiKey = settings().pineconeApiKey, indexName = settings().pineconeIndex } = {}) {
  let indexPromise;

  function client() {
    if (pc) return pc;
    if (!apiKey) throw new UserError('The server is missing PINECONE_API_KEY.', 500);
    pc = new Pinecone({ apiKey });
    return pc;
  }

  // Connects once, checking the index matches the embedding model.
  function index() {
    indexPromise ??= (async () => {
      if (!indexName) throw new UserError('The server is missing PINECONE_INDEX_NAME.', 500);
      const description = await client().indexes.describe(indexName);
      if (!description.status?.ready) throw new UserError(`The Pinecone index "${indexName}" is not ready yet.`, 503);
      const dense = description.schema?.fields?._values;
      if (dense?.type !== 'dense_vector' || dense.dimension !== EMBEDDING_DIMENSIONS || dense.metric !== 'cosine') {
        throw new UserError(`The Pinecone index "${indexName}" must be dense, ${EMBEDDING_DIMENSIONS}-dimensional and cosine.`, 500);
      }
      return client().index({ host: description.host });
    })().catch(error => { indexPromise = undefined; throw error; });
    return indexPromise;
  }

  // Returns one vector per text, in input order. inputType is 'passage' or 'query'.
  async function embed(texts, inputType) {
    const vectors = [];
    for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
      const response = await client().inference.embed({
        model: EMBEDDING_MODEL,
        inputs: batch,
        parameters: { inputType, dimension: EMBEDDING_DIMENSIONS, truncate: 'END' },
      });
      if (response.data?.length !== batch.length) throw new Error('The embedding service returned an unexpected number of vectors.');

      const ordered = Array(batch.length);
      for (const [position, embedding] of response.data.entries()) {
        const i = embedding.index ?? position;
        if (!Number.isInteger(i) || i < 0 || i >= batch.length || ordered[i]) throw new Error('The embedding service returned an invalid input index.');
        if (embedding.vectorType !== 'dense' || embedding.values?.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-dimensional dense embeddings.`);
        }
        ordered[i] = embedding.values;
      }
      vectors.push(...ordered);
    }
    return vectors;
  }

  async function upsert(namespace, records) {
    const target = await index();
    for (let start = 0; start < records.length; start += UPSERT_BATCH_SIZE) {
      await target.upsert({ records: records.slice(start, start + UPSERT_BATCH_SIZE), namespace });
    }
  }

  // Writes become visible asynchronously, so retry reads briefly.
  async function verify(namespace, records, { attempts = 10, delayMs = 1500 } = {}) {
    const target = await index();
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let visible = 0;
      for (let start = 0; start < records.length; start += UPSERT_BATCH_SIZE) {
        const batch = records.slice(start, start + UPSERT_BATCH_SIZE);
        const result = await target.fetch({ ids: batch.map(record => record.id), namespace });
        visible += batch.filter(record => result.records?.[record.id]).length;
      }
      if (visible === records.length) return;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    throw new UserError('The document was uploaded but is not searchable yet. Try asking again in a minute.', 503);
  }

  async function query(namespace, vector, topK) {
    const target = await index();
    const result = await target.query({ vector, topK, namespace, includeMetadata: true, includeValues: false });
    return result.matches || [];
  }

  async function deleteNamespace(namespace) {
    const target = await index();
    try {
      await target.deleteNamespace(namespace);
    } catch (error) {
      // Nothing was stored for this chat yet.
      if (error?.name !== 'PineconeNotFoundError' && !/not ?found|404/i.test(error?.message || '')) throw error;
    }
  }

  return { embed, upsert, verify, query, deleteNamespace };
}
