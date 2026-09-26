// Checks the Pinecone setup: index shape, embedding round trip and stored namespaces.
import { Pinecone } from '@pinecone-database/pinecone';
import { settings } from './config.js';
import { createVectorStore } from './pinecone.js';

const { pineconeApiKey, pineconeIndex, groqApiKey } = settings();
const missing = [['PINECONE_API_KEY', pineconeApiKey], ['PINECONE_INDEX_NAME', pineconeIndex], ['GROQ_API_KEY', groqApiKey]]
  .filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  console.error(`Missing in backend/.env: ${missing.join(', ')}. Copy backend/.env.example to backend/.env and fill them in.`);
  process.exit(1);
}
const pc = new Pinecone({ apiKey: pineconeApiKey });
const vectors = createVectorStore({ pc, indexName: pineconeIndex });

try {
  const [vector] = await vectors.embed(['connection test'], 'query');
  await vectors.query('connection-test', vector, 1);
  console.log(`Index "${pineconeIndex}" is ready and matches the ${vector.length}-dimensional embeddings.`);

  const description = await pc.indexes.describe(pineconeIndex);
  const stats = await pc.index({ host: description.host }).describeIndexStats();
  const namespaces = Object.entries(stats.namespaces || {});
  console.log(`Records: ${stats.totalRecordCount ?? 0} in ${namespaces.length} chat namespace(s).`);
  for (const [name, { recordCount }] of namespaces.slice(0, 20)) console.log(`- ${name}: ${recordCount} chunks`);
} catch (error) {
  console.error('Pinecone check failed:', error.message);
  process.exitCode = 1;
}
