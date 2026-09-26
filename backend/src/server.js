import { settings } from './config.js';
import { createStore } from './store/index.js';
import { createVectorStore } from './pinecone.js';
import { createApp } from './app.js';

const config = settings();
const store = await createStore(config.mongoUri);
if (store.kind === 'memory') console.warn('MONGODB_URI is not set: chats are kept in memory and lost on restart.');

const app = createApp({ store, vectors: createVectorStore(), corsOrigins: config.corsOrigins });
const server = app.listen(config.port, () => console.log(`Backend listening on port ${config.port}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(async () => {
    await store.close();
    process.exit(0);
  }));
}
