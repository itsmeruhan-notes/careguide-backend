import mongoose from 'mongoose';
import { auditFields, schemaOptions } from './audit.js';

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId },
    authorName: { type: String, default: '' },
    title: { type: String, default: '' },
    body: { type: String, default: '' },
    tags: { type: [String], default: [] },
    authorRole: { type: String, default: 'user' },
    ...auditFields,
  },
  schemaOptions,
);

postSchema.index({ author: 1, status: 1, _id: -1 });

export const Post = mongoose.model('Post', postSchema);
