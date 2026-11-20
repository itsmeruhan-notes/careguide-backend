import mongoose from 'mongoose';
import { User } from './models/User.js';
import { Note } from './models/Note.js';
import { Post } from './models/Post.js';

export const connectDb = async (uri) => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { autoIndex: false });
  await Promise.all([User.syncIndexes(), Note.syncIndexes(), Post.syncIndexes()]);
};
