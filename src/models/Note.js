import mongoose from 'mongoose';
import { auditFields, schemaOptions } from './audit.js';

const shareSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    access: { type: String, default: 'read' },
    sharedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const noteSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    content: { type: String, default: '' },
    owner: { type: mongoose.Schema.Types.ObjectId },
    ownerName: { type: String, default: '' },
    ownerEmail: { type: String, default: '' },
    sharedWith: { type: [shareSchema], default: [] },
    ...auditFields,
  },
  schemaOptions,
);

noteSchema.index({ owner: 1, status: 1, _id: -1 });
noteSchema.index({ 'sharedWith.userId': 1, status: 1, _id: -1 });

export const Note = mongoose.model('Note', noteSchema);
