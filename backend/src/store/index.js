import { createMemoryStore } from './memoryStore.js';
import { createMongoStore } from './mongoStore.js';

// MongoDB when MONGODB_URI is set, otherwise an in-memory store for local testing.
export async function createStore(mongoUri) {
  return mongoUri ? createMongoStore(mongoUri) : createMemoryStore();
}
