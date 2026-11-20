import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Note } from '../models/Note.js';
import { Post } from '../models/Post.js';
import { createdAudit, applyChanges } from '../utils/history.js';
import { toEmail } from '../utils/validation.js';

export const DEMO = {
  admin: { name: 'ruhan', password: 'Admin1234' },
  user: { name: 'demo', password: 'User1234' },
};

const PEOPLE = [
  { key: 'ruhan', name: DEMO.admin.name, password: DEMO.admin.password, role: 'admin', isDemo: 'Y', bio: 'Builder of this app. Admin.', interests: ['chess', 'mongodb', 'reading'] },
  { key: 'demo', name: DEMO.user.name, password: DEMO.user.password, role: 'user', isDemo: 'Y', bio: 'Try the app with me.', interests: ['reading', 'travel', 'music'] },
  { key: 'karim', name: 'karim', password: 'Karim1234', role: 'user', bio: 'Backend dev, chess lover', interests: ['chess', 'mongodb', 'coding'] },
  { key: 'sara', name: 'sara', password: 'Sara1234', role: 'user', bio: 'Designer who reads a lot', interests: ['reading', 'design', 'music'] },
  { key: 'mim', name: 'mim', password: 'Mim12345', role: 'user', bio: 'Traveller and photographer', interests: ['travel', 'photography', 'chess'] },
];

const NOTES = [
  { owner: 'ruhan', title: 'Index plan for notes', content: 'owner + status + _id covers the my-notes list and its count.\nsharedWith.userId + status + _id covers the shared list.\nEverything else rides on _id.', shares: [['karim', 'write'], ['sara', 'read']] },
  { owner: 'ruhan', title: 'Weekend chores', content: 'Groceries\nLaundry\nCall home', shares: [] },
  { owner: 'demo', title: 'Welcome to Ruhan\'s Notes', content: 'Create notes, share them read-only or with edit access, and see the full history of every change.', shares: [['ruhan', 'read']] },
  { owner: 'demo', title: 'Books to read', content: 'Designing Data-Intensive Applications\nThe Pragmatic Programmer\nClean Architecture', shares: [['sara', 'write']] },
  { owner: 'karim', title: 'Chess openings', content: 'Italian Game\nQueen\'s Gambit\nSicilian Defence', shares: [['demo', 'read'], ['mim', 'read']] },
  { owner: 'karim', title: 'Mongo aggregation cheatsheet', content: '$match early, $project only what you need, $unwind arrays, $group, $sort, $facet for paging.', shares: [['demo', 'write']] },
  { owner: 'sara', title: 'Design system tokens', content: 'Primary #2563EB, radius 8/12/16, Inter font.', shares: [['ruhan', 'write']] },
  { owner: 'mim', title: 'Trip plan: Sylhet', content: 'Day 1 Ratargul\nDay 2 Jaflong\nDay 3 tea gardens', shares: [['demo', 'read']] },
];

const POSTS = [
  { author: 'ruhan', title: 'Why I only made five indexes', tags: ['mongodb', 'indexing'], body: 'Every index costs writes and memory. I mapped each list and lookup to one index and let _id handle the rest.' },
  { author: 'ruhan', title: 'Soft delete with history', tags: ['mongodb', 'audit'], body: 'Nothing is hard-deleted. Each document keeps its own history array with the old values.' },
  { author: 'karim', title: 'Learning MongoDB indexes', tags: ['mongodb', 'indexing'], body: 'Compound indexes follow the ESR rule: equality, sort, range. Put equality fields first.' },
  { author: 'karim', title: 'A chess puzzle a day', tags: ['chess'], body: 'Ten minutes of tactics every morning improved my rating more than long games.' },
  { author: 'sara', title: 'Reading list for designers', tags: ['design', 'reading'], body: 'Refactoring UI, The Design of Everyday Things, and Don\'t Make Me Think.' },
  { author: 'mim', title: 'Best light for photos', tags: ['photography'], body: 'Golden hour is real. Shoot an hour after sunrise or before sunset.' },
  { author: 'demo', title: 'Hello from the demo account', tags: ['welcome'], body: 'Log in as demo / User1234 to try sharing.' },
];

export const seed = async () => {
  const users = {};
  for (const p of PEOPLE) {
    users[p.key] = new User({
      name: p.name,
      email: toEmail(p.name),
      passwordHash: await bcrypt.hash(p.password, config.bcryptRounds),
      role: p.role,
      bio: p.bio,
      interests: p.interests,
      isDemo: p.isDemo || 'N',
      ...createdAudit(null),
    });
  }
  await User.insertMany(Object.values(users));

  for (const n of NOTES) {
    const owner = users[n.owner];
    const note = new Note({ title: n.title, content: n.content, owner: owner._id, ownerName: owner.name, ownerEmail: owner.email, ...createdAudit(owner) });
    for (const [key, access] of n.shares) {
      const target = users[key];
      const next = [...note.sharedWith.map((s) => s.toObject()), { userId: target._id, name: target.name, email: target.email, access, sharedAt: new Date() }];
      applyChanges(note, { sharedWith: next }, owner, 'shared', { target: { userId: String(target._id), name: target.name, access } });
    }
    await note.save();
  }

  for (const p of POSTS) {
    const author = users[p.author];
    await Post.create({ title: p.title, body: p.body, tags: p.tags, author: author._id, authorName: author.name, authorRole: author.role, ...createdAudit(author) });
  }
  return { users: PEOPLE.length, notes: NOTES.length, posts: POSTS.length };
};

export const seedIfEmpty = async () => {
  if (await User.estimatedDocumentCount()) return null;
  const result = await seed();
  console.log('Seeded demo data', result);
  return result;
};
