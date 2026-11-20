import { Router } from 'express';
import { Note } from '../models/Note.js';
import { User } from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { badRequest, forbidden, notFound, paged, parsePaging, searchRegex, toObjectId } from '../utils/http.js';
import { parse, schemas } from '../utils/validation.js';
import { applyChanges, createdAudit, historyPage } from '../utils/history.js';
import { accessFor, noteView } from './serializers.js';

const router = Router();
router.use(authenticate);

export const listProjection = {
  title: 1,
  preview: { $substrCP: ['$content', 0, 200] },
  owner: 1,
  ownerName: 1,
  sharedWith: 1,
  status: 1,
  createdAt: 1,
  updatedAt: 1,
  updatedByName: 1,
};

const listItem = (note, user) => ({
  id: String(note._id),
  title: note.title,
  preview: note.preview,
  owner: { id: String(note.owner), name: note.ownerName },
  sharedCount: note.sharedWith.length,
  sharedWith: note.sharedWith.map((s) => ({ userId: String(s.userId), name: s.name, access: s.access })),
  access: accessFor(note, user),
  status: note.status,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
  updatedByName: note.updatedByName,
});

const loadNote = async (id, user) => {
  const note = await Note.findById(toObjectId(id, 'Note'));
  if (!note || note.status !== 'active') throw notFound('Note');
  const access = accessFor(note, user);
  if (!access) throw notFound('Note');
  return { note, access };
};

router.get('/', async (req, res) => {
  const paging = parsePaging(req.query);
  const scope = req.query.scope === 'shared' ? 'shared' : 'mine';
  const filter =
    scope === 'shared' ? { 'sharedWith.userId': req.user._id, status: 'active' } : { owner: req.user._id, status: 'active' };
  const rx = searchRegex(req.query.q);
  if (rx) filter.$or = [{ title: rx }, { content: rx }];
  const [notes, total] = await Promise.all([
    Note.find(filter, listProjection).sort({ _id: req.query.sort === 'oldest' ? 1 : -1 }).skip(paging.skip).limit(paging.limit).lean(),
    Note.countDocuments(filter),
  ]);
  res.json(paged(notes.map((n) => listItem(n, req.user)), total, paging));
});

router.post('/', async (req, res) => {
  const input = parse(schemas.noteCreate, req.body);
  const note = await Note.create({
    title: input.title,
    content: input.content,
    owner: req.user._id,
    ownerName: req.user.name,
    ownerEmail: req.user.email,
    ...createdAudit(req.user),
  });
  res.status(201).json({ note: noteView(note, 'owner') });
});

router.get('/:id', async (req, res) => {
  const { note, access } = await loadNote(req.params.id, req.user);
  res.json({ note: noteView(note, access) });
});

router.patch('/:id', async (req, res) => {
  const { note, access } = await loadNote(req.params.id, req.user);
  if (!['owner', 'write'].includes(access)) throw forbidden('You have read-only access to this note');
  const input = parse(schemas.noteUpdate, req.body);
  const changes = {};
  if (input.title !== undefined) changes.title = input.title;
  if (input.content !== undefined) changes.content = input.content;
  if (applyChanges(note, changes, req.user)) await note.save();
  res.json({ note: noteView(note, access) });
});

router.delete('/:id', async (req, res) => {
  const { note, access } = await loadNote(req.params.id, req.user);
  if (access !== 'owner') throw forbidden('Only the owner can delete this note');
  applyChanges(note, { status: 'deleted' }, req.user, 'deleted');
  await note.save();
  res.status(204).end();
});

router.get('/:id/history', async (req, res) => {
  const note = await Note.findById(toObjectId(req.params.id, 'Note'), { owner: 1, history: 1 });
  if (!note) throw notFound('Note');
  const isOwner = String(note.owner) === String(req.user._id);
  if (!isOwner && req.user.role !== 'admin') throw notFound('Note');
  res.json(historyPage(note, parsePaging(req.query)));
});

router.put('/:id/shares', async (req, res) => {
  const { note, access } = await loadNote(req.params.id, req.user);
  if (access !== 'owner') throw forbidden('Only the owner can share this note');
  const input = parse(schemas.share, req.body);
  if (input.email === req.user.email) throw badRequest('You already own this note', { email: 'You already own this note' });
  const target = await User.findOne({ email: input.email, status: 'active' }, { name: 1, email: 1 });
  if (!target) throw badRequest('No user found with this email', { email: 'No user found with this email' });
  const shares = note.sharedWith.map((s) => s.toObject());
  const existing = shares.find((s) => String(s.userId) === String(target._id));
  if (existing && existing.access === input.access) return res.json({ note: noteView(note, access) });
  const next = existing
    ? shares.map((s) => (String(s.userId) === String(target._id) ? { ...s, access: input.access } : s))
    : [...shares, { userId: target._id, name: target.name, email: target.email, access: input.access, sharedAt: new Date() }];
  applyChanges(note, { sharedWith: next }, req.user, existing ? 'access_changed' : 'shared', {
    target: { userId: String(target._id), name: target.name, access: input.access },
  });
  await note.save();
  res.json({ note: noteView(note, access) });
});

router.delete('/:id/shares/:userId', async (req, res) => {
  const { note, access } = await loadNote(req.params.id, req.user);
  if (access !== 'owner') throw forbidden('Only the owner can change sharing');
  const shares = note.sharedWith.map((s) => s.toObject());
  const target = shares.find((s) => String(s.userId) === req.params.userId);
  if (!target) throw notFound('Share');
  applyChanges(
    note,
    { sharedWith: shares.filter((s) => String(s.userId) !== req.params.userId) },
    req.user,
    'unshared',
    { target: { userId: String(target.userId), name: target.name, access: target.access } },
  );
  await note.save();
  res.json({ note: noteView(note, access) });
});

export default router;
