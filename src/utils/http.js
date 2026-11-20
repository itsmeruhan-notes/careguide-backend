import mongoose from 'mongoose';

export class AppError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do this') => new AppError(403, 'FORBIDDEN', message);
export const badRequest = (message, fields) => new AppError(400, 'BAD_REQUEST', message, fields);
export const conflict = (message, fields) => new AppError(409, 'CONFLICT', message, fields);

export const toObjectId = (id, what = 'Resource') => {
  if (!mongoose.isValidObjectId(id)) throw notFound(what);
  return new mongoose.Types.ObjectId(String(id));
};

export const parsePaging = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 10));
  return { page, limit, skip: (page - 1) * limit };
};

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const searchRegex = (q) => {
  const text = String(q || '').trim().slice(0, 100);
  return text ? new RegExp(escapeRegex(text), 'i') : null;
};

export const paged = (data, total, { page, limit }) => ({
  data,
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});
