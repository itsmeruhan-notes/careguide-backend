import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { AppError, forbidden } from '../utils/http.js';

const unauthorized = (message = 'Please sign in') => new AppError(401, 'UNAUTHORIZED', message);

export const signToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role, name: user.name }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, algorithm: 'HS256' });

export const authenticate = async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(unauthorized());
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return next(unauthorized('Your session has expired. Please sign in again.'));
  }
  if (!mongoose.isValidObjectId(payload.sub)) return next(unauthorized());
  const user = await User.findById(payload.sub, { history: 0 });
  if (!user || user.status !== 'active') return next(unauthorized('This account is disabled'));
  req.user = user;
  next();
};

export const requireAdmin = (req, _res, next) => (req.user?.role === 'admin' ? next() : next(forbidden()));
