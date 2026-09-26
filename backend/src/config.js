import 'dotenv/config';

const list = value => (value || '').split(',').map(item => item.trim()).filter(Boolean);

export const EMBEDDING_MODEL = 'llama-text-embed-v2';
export const EMBEDDING_DIMENSIONS = 1024; // The Pinecone index must be dense, 1024-dimensional, cosine.

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
