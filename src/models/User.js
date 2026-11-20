import mongoose from 'mongoose';
import { auditFields, schemaOptions } from './audit.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    passwordHash: { type: String, default: '' },
    role: { type: String, default: 'user' },
    bio: { type: String, default: '' },
    interests: { type: [String], default: [] },
    isDemo: { type: String, default: 'N' },
    ...auditFields,
  },
  schemaOptions,
);

userSchema.index({ email: 1 });
userSchema.index({ interests: 1 });

export const User = mongoose.model('User', userSchema);
