import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI = mongo.getUri('careguide');
process.env.SEED_ON_EMPTY = 'true';
console.log(`In-memory MongoDB at ${process.env.MONGO_URI}`);
await import('../src/server.js');
