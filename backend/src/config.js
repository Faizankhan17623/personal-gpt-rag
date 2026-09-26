import 'dotenv/config';

const list = value => (value || '').split(',').map(item => item.trim()).filter(Boolean);

export const EMBEDDING_MODEL = 'llama-text-embed-v2';
// Output sizes llama-text-embed-v2 supports. The index can be any dense cosine index at least
// 384-dimensional: embeddings use the largest size that fits and are zero-padded to the index
// dimension (e.g. 2048 + 952 zeros for a 3000-dimensional index). Padding preserves cosine similarity.
export const MODEL_DIMENSIONS = [384, 512, 768, 1024, 2048];

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;
export const TOP_K = 5;
export const HISTORY_MESSAGES = 10; // Last five question/answer turns sent to the model.

// Read lazily so tests can change process.env.
export function settings() {
  return {
    port: Number(process.env.PORT) || 4000,
    mongoUri: process.env.MONGODB_URI?.trim() || '',
    corsOrigins: list(process.env.CORS_ORIGIN),
    pineconeApiKey: process.env.PINECONE_API_KEY?.trim() || '',
    pineconeIndex: process.env.PINECONE_INDEX_NAME?.trim() || '',
    groqApiKey: process.env.GROQ_API_KEY?.trim() || '',
    groqModel: process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
  };
}
