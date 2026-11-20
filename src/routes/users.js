import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Note } from '../models/Note.js';
import { Post } from '../models/Post.js';
import { authenticate } from '../middleware/auth.js';
import { AppError, notFound, paged, parsePaging, toObjectId } from '../utils/http.js';
import { parse, schemas } from '../utils/validation.js';
import { applyChanges } from '../utils/history.js';
import { groupByInterests, userPostsPipeline } from '../queries.js';
import { publicUser } from './serializers.js';

const router = Router();
router.use(authenticate);

router.patch('/me', async (req, res) => {
  const input = parse(schemas.updateMe, req.body);
  const user = await User.findById(req.user._id);
  if (applyChanges(user, input, req.user)) await user.save();
  res.json({ user: publicUser(user, true) });
});

router.patch('/me/password', async (req, res) => {
  const input = parse(schemas.changePassword, req.body);
  const user = await User.findById(req.user._id);
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new AppError(400, 'BAD_PASSWORD', 'Current password is incorrect', { currentPassword: 'Current password is incorrect' });
  }
  if (user.isDemo === 'Y') throw new AppError(403, 'DEMO_ACCOUNT', 'Demo account passwords cannot be changed');
  applyChanges(user, { passwordHash: await bcrypt.hash(input.newPassword, config.bcryptRounds) }, req.user, 'password_changed');
  await user.save();
  res.json({ ok: true });
});

router.get('/me/stats', async (req, res) => {
  const [notes, sharedWithMe, sharedByMe, posts] = await Promise.all([
    Note.countDocuments({ owner: req.user._id, status: 'active' }),
    Note.countDocuments({ 'sharedWith.userId': req.user._id, status: 'active' }),
    Note.countDocuments({ owner: req.user._id, status: 'active', 'sharedWith.0': { $exists: true } }),
    Post.countDocuments({ author: req.user._id, status: 'active' }),
  ]);
  res.json({ notes, sharedWithMe, sharedByMe, posts });
});

router.get('/grouped-by-interests', async (req, res) => {
  const paging = parsePaging(req.query);
  const raw = [].concat(req.query.interest || []).flatMap((v) => String(v).split(','));
  const interests = [...new Set(raw.map((v) => v.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
  const { data, total } = await groupByInterests({ interests, sort: req.query.sort, skip: paging.skip, limit: paging.limit });
  res.json(paged(data.map((g) => ({ ...g, members: g.members.map((m) => ({ id: String(m.id), name: m.name })) })), total, paging));
});

router.get('/:id', async (req, res) => {
  const user = await User.findById(toObjectId(req.params.id, 'User'), { history: 0, passwordHash: 0 });
  if (!user || user.status !== 'active') throw notFound('User');
  res.json({ user: publicUser(user) });
});

router.get('/:id/posts', async (req, res) => {
  const paging = parsePaging(req.query);
  const [row] = await User.aggregate(userPostsPipeline(toObjectId(req.params.id, 'User'), paging));
  if (!row) throw notFound('User');
  const total = row.posts?.total?.[0]?.n || 0;
  res.json({
    user: { id: String(row._id), name: row.name, bio: row.bio, interests: row.interests, role: row.role, createdAt: row.createdAt },
    posts: paged(
      (row.posts?.data || []).map((p) => ({
        id: String(p._id),
        title: p.title,
        body: p.body,
        author: { id: String(row._id), name: row.name },
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      total,
      paging,
    ),
  });
});

export default router;
