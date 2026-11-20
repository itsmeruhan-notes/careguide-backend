import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { AppError, conflict } from '../utils/http.js';
import { parse, schemas, toEmail } from '../utils/validation.js';
import { createdAudit } from '../utils/history.js';
import { publicUser } from './serializers.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.loginRateLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
  validate: false,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Try again in a minute.', fields: {} } }),
});

router.post('/register', loginLimiter, async (req, res) => {
  const input = parse(schemas.register, req.body);
  const email = toEmail(input.name);
  if (await User.exists({ email })) throw conflict('This nickname is already taken', { name: 'This nickname is already taken' });
  const user = new User({
    name: input.name,
    email,
    passwordHash: await bcrypt.hash(input.password, config.bcryptRounds),
    interests: input.interests || [],
    role: 'user',
    ...createdAudit(null),
  });
  user.createdBy = String(user._id);
  user.createdByName = user.name;
  user.updatedBy = String(user._id);
  user.updatedByName = user.name;
  user.history[0].byId = String(user._id);
  user.history[0].byName = user.name;
  await user.save();
  res.status(201).json({ token: signToken(user), user: publicUser(user, true) });
});

router.post('/login', loginLimiter, async (req, res) => {
  const input = parse(schemas.login, req.body);
  const user = await User.findOne({ email: input.email }, { history: 0 });
  const ok = user && (await bcrypt.compare(input.password, user.passwordHash));
  if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Nickname or password is incorrect.');
  if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled. Contact an admin.');
  res.json({ token: signToken(user), user: publicUser(user, true) });
});

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user, true) }));

export default router;
