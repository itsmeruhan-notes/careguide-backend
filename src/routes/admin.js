import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Note } from '../models/Note.js';
import { Post } from '../models/Post.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { AppError, badRequest, conflict, escapeRegex, notFound, paged, parsePaging, searchRegex, toObjectId } from '../utils/http.js';
import { parse, schemas, toEmail } from '../utils/validation.js';
import { applyChanges, createdAudit, historyPage } from '../utils/history.js';
import { listProjection } from './notes.js';
import { publicUser } from './serializers.js';
import { explainAll, indexReport } from '../insights.js';

const router = Router();
router.use(authenticate, requireAdmin);

router.get('/users', async (req, res) => {
  const paging = parsePaging(req.query);
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 60);
  const filter = q ? { email: { $regex: `^${escapeRegex(q)}` } } : {};
  const [users, total] = await Promise.all([
    User.find(filter, { history: 0, passwordHash: 0 }).sort(q ? { email: 1 } : { _id: -1 }).skip(paging.skip).limit(paging.limit),
    q ? User.countDocuments(filter) : User.estimatedDocumentCount(),
  ]);
  res.json(paged(users.map((u) => publicUser(u, true)), total, paging));
});

router.post('/users', async (req, res) => {
  const input = parse(schemas.adminCreateUser, req.body);
  const email = toEmail(input.name);
  if (await User.exists({ email })) throw conflict('This nickname is already taken', { name: 'This nickname is already taken' });
  const user = await User.create({
    name: input.name,
    email,
    role: input.role,
    bio: input.bio || '',
    interests: input.interests || [],
    passwordHash: await bcrypt.hash(input.password, config.bcryptRounds),
    ...createdAudit(req.user),
  });
  res.status(201).json({ user: publicUser(user, true) });
});

const loadUser = async (id) => {
  const user = await User.findById(toObjectId(id, 'User'));
  if (!user) throw notFound('User');
  return user;
};

const cascadeStatus = (userId, status, actor) => {
  const set = { status, updatedBy: String(actor._id), updatedByName: actor.name };
  const from = status === 'deleted' ? 'active' : 'deleted';
  return Promise.all([
    Note.updateMany({ owner: userId, status: from }, { $set: set }),
    Post.updateMany({ author: userId, status: from }, { $set: set }),
  ]);
};

router.patch('/users/:id', async (req, res) => {
  const user = await loadUser(req.params.id);
  const input = parse(schemas.adminUpdateUser, req.body);
  const self = String(user._id) === String(req.user._id);
  if (self && input.role && input.role !== 'admin') throw badRequest("You can't remove your own admin role", { role: "You can't remove your own admin role" });
  if (self && input.status === 'deleted') throw badRequest("You can't delete your own account");
  if (user.isDemo === 'Y' && (input.password || input.status === 'deleted' || (input.role && input.role !== user.role))) {
    throw new AppError(403, 'DEMO_ACCOUNT', 'Demo accounts cannot be deleted, demoted or have their password changed');
  }
  const { password, ...rest } = input;
  const changes = { ...rest };
  if (password) changes.passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const previousStatus = user.status;
  if (applyChanges(user, changes, req.user)) await user.save();
  if (input.status && input.status !== previousStatus) await cascadeStatus(user._id, input.status, req.user);
  res.json({ user: publicUser(user, true) });
});

router.delete('/users/:id', async (req, res) => {
  const user = await loadUser(req.params.id);
  if (String(user._id) === String(req.user._id)) throw badRequest("You can't delete your own account");
  if (user.isDemo === 'Y') throw new AppError(403, 'DEMO_ACCOUNT', 'Demo accounts cannot be deleted');
  if (user.status === 'deleted') return res.status(204).end();
  applyChanges(user, { status: 'deleted' }, req.user, 'deleted');
  await user.save();
  await cascadeStatus(user._id, 'deleted', req.user);
  res.status(204).end();
});

router.get('/users/:id/history', async (req, res) => {
  const user = await User.findById(toObjectId(req.params.id, 'User'), { history: 1 });
  if (!user) throw notFound('User');
  res.json(historyPage(user, parsePaging(req.query)));
});

router.get('/notes', async (req, res) => {
  const paging = parsePaging(req.query);
  const rx = searchRegex(req.query.q);
  const filter = rx ? { $or: [{ title: rx }, { ownerName: rx }] } : {};
  const [notes, total] = await Promise.all([
    Note.find(filter, listProjection).sort({ _id: -1 }).skip(paging.skip).limit(paging.limit).lean(),
    rx ? Note.countDocuments(filter) : Note.estimatedDocumentCount(),
  ]);
  res.json(
    paged(
      notes.map((n) => ({
        id: String(n._id),
        title: n.title,
        preview: n.preview,
        owner: { id: String(n.owner), name: n.ownerName },
        sharedCount: n.sharedWith.length,
        status: n.status,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        updatedByName: n.updatedByName,
      })),
      total,
      paging,
    ),
  );
});

router.get('/db/indexes', async (_req, res) => res.json(await indexReport()));

router.get('/db/explain', async (req, res) => res.json(await explainAll(req.user)));

export default router;
