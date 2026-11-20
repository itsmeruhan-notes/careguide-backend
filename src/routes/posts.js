import { Router } from 'express';
import { Post } from '../models/Post.js';
import { authenticate } from '../middleware/auth.js';
import { forbidden, notFound, paged, parsePaging, toObjectId } from '../utils/http.js';
import { parse, schemas } from '../utils/validation.js';
import { applyChanges, createdAudit } from '../utils/history.js';
import { postView } from './serializers.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const paging = parsePaging(req.query);
  const filter = { status: 'active' };
  const [posts, total] = await Promise.all([
    Post.find(filter, { history: 0 }).sort({ _id: -1 }).skip(paging.skip).limit(paging.limit).lean(),
    Post.countDocuments(filter),
  ]);
  res.json(paged(posts.map(postView), total, paging));
});

router.post('/', async (req, res) => {
  const input = parse(schemas.postCreate, req.body);
  const post = await Post.create({ ...input, author: req.user._id, authorName: req.user.name, ...createdAudit(req.user) });
  res.status(201).json({ post: postView(post) });
});

router.delete('/:id', async (req, res) => {
  const post = await Post.findById(toObjectId(req.params.id, 'Post'));
  if (!post || post.status !== 'active') throw notFound('Post');
  if (String(post.author) !== String(req.user._id) && req.user.role !== 'admin') throw forbidden();
  applyChanges(post, { status: 'deleted' }, req.user, 'deleted');
  await post.save();
  res.status(204).end();
});

export default router;
