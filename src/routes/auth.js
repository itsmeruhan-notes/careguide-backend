import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { AppError, conflict, forbidden } from '../utils/http.js';
import { limiter } from '../middleware/security.js';
import { parse, schemas, toEmail } from '../utils/validation.js';
import { createdAudit } from '../utils/history.js';
import { publicUser } from './serializers.js';

const router = Router();

const loginLimiter = limiter({ windowMs: 60 * 1000, limit: config.loginRateLimit, message: 'Too many attempts. Try again in a minute.' });
const failedLoginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: Math.max(5, Math.ceil(config.loginRateLimit / 2)),
  skipSuccessfulRequests: true,
  key: (req) => `email:${String(req.body?.email || '').trim().toLowerCase().slice(0, 120)}`,
  message: 'Too many failed attempts for this account. Try again in 15 minutes.',
});

router.get('/config', (_req, res) => res.json({ registration: config.allowRegistration }));

router.post('/register', loginLimiter, async (req, res) => {
  if (!config.allowRegistration) throw forbidden('Registration is closed. Ask an admin for an account.');
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

router.post('/login', loginLimiter, failedLoginLimiter, async (req, res) => {
  const input = parse(schemas.login, req.body);
  const user = await User.findOne({ email: input.email }, { history: 0 });
  const ok = user && (await bcrypt.compare(input.password, user.passwordHash));
  if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  if (user.status !== 'active') throw new AppError(403, 'ACCOUNT_DISABLED', 'This account is disabled. Contact an admin.');
  res.json({ token: signToken(user), user: publicUser(user, true) });
});

router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.user, true) }));

export default router;
