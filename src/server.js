import mongoose from 'mongoose';
import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { seedIfEmpty } from './seed/seed.js';

if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-only-secret-change-me') {
  console.error('JWT_SECRET must be set in production');
  process.exit(1);
}

await connectDb(config.mongoUri);
if (config.seedOnEmpty) await seedIfEmpty();

const server = createApp().listen(config.port, () => console.log(`API listening on :${config.port}`));

const shutdown = async () => {
  server.close();
  await mongoose.disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
