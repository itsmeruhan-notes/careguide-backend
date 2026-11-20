import { AppError } from '../utils/http.js';

export const notFoundHandler = (req, _res, next) => next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));

export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields || {} } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON', fields: {} } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request body is too large', fields: {} } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong', fields: {} } });
};
