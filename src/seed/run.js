import mongoose from 'mongoose';
import { config } from '../config.js';
import { connectDb } from '../db.js';
import { seed } from './seed.js';

await connectDb(config.mongoUri);
if (process.argv.includes('--reset')) await mongoose.connection.db.dropDatabase().then(() => connectDb(config.mongoUri));
console.log(await seed());
await mongoose.disconnect();
