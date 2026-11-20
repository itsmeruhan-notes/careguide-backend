import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/http.js';

export const clientIp = (req) => req.headers['cf-connecting-ip'] || req.ip;

const tooMany = (message) => (_req, res) => res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message, fields: {} } });

export const limiter = ({ windowMs, limit, message, key = clientIp, skipSuccessfulRequests = false }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: key,
    skipSuccessfulRequests,
    validate: false,
    handler: tooMany(message),
  });

const hasOperatorKey = (value, depth = 0) => {
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some((v) => hasOperatorKey(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || k === 'prototype' || hasOperatorKey(v, depth + 1));
  }
  return false;
};

export const rejectOperatorKeys = (req, _res, next) => {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query) || hasOperatorKey(req.params)) {
    return next(new AppError(400, 'BAD_REQUEST', 'Request contains forbidden keys'));
  }
  next();
};

export const requireJson = (req, _res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] !== '0' && !req.is('application/json')) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON'));
  }
  next();
};
