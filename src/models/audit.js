import mongoose from 'mongoose';

export const auditFields = {
  createdBy: { type: String, default: '' },
  createdByName: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
  updatedByName: { type: String, default: '' },
  status: { type: String, default: 'active' },
  history: { type: [mongoose.Schema.Types.Mixed], default: [] },
};

export const schemaOptions = { timestamps: true, versionKey: false, minimize: false };
