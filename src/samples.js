import mongoose from 'mongoose';
import { z } from 'zod';
import { groupByInterestsPipeline, userPostsPipeline } from './queries.js';
import { summarize } from './insights.js';
import { badRequest, notFound } from './utils/http.js';

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Pick a user');
const interest = z.string().trim().toLowerCase().regex(/^[a-z0-9 ._-]{1,30}$/, 'Pick an interest');
const email = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{1,30}@[a-z0-9.-]{1,60}$/, 'Enter an email');

const USER_FIELDS = { name: 1, email: 1, role: 1, interests: 1, status: 1, createdAt: 1 };
const NOTE_FIELDS = { title: 1, ownerName: 1, 'sharedWith.name': 1, 'sharedWith.access': 1, status: 1, updatedAt: 1 };
const POST_FIELDS = { title: 1, authorName: 1, tags: 1, createdAt: 1 };

const oid = (v) => new mongoose.Types.ObjectId(v);
const show = (v) => JSON.stringify(v, (_k, x) => (x instanceof mongoose.Types.ObjectId ? `ObjectId("${x}")` : x)).replace(/"ObjectId\(\\"([0-9a-f]{24})\\"\)"/g, 'ObjectId("$1")');

export const SAMPLES = {
  userByEmail: {
    title: 'Find a user by email',
    description: 'Sign-in lookup. Equality on the email index.',
    params: { email },
    build: (p) => ({ kind: 'find', collection: 'users', filter: { email: p.email }, projection: USER_FIELDS, limit: 1 }),
  },
  notesOfUser: {
    title: "A user's latest notes",
    description: 'My Notes list: equality on owner + status, newest first from the index.',
    params: { user: objectId },
    build: (p) => ({ kind: 'find', collection: 'notes', filter: { owner: oid(p.user), status: 'active' }, sort: { _id: -1 }, projection: NOTE_FIELDS, limit: 5 }),
  },
  countNotesOfUser: {
    title: "Count a user's notes",
    description: 'Pagination total. Answered from the index alone (COUNT_SCAN).',
    params: { user: objectId },
    build: (p) => ({ kind: 'count', collection: 'notes', filter: { owner: oid(p.user), status: 'active' } }),
  },
  sharedWithUser: {
    title: 'Notes shared with a user',
    description: 'Shared-with-me list on the multikey sharedWith.userId index.',
    params: { user: objectId },
    build: (p) => ({ kind: 'find', collection: 'notes', filter: { 'sharedWith.userId': oid(p.user), status: 'active' }, sort: { _id: -1 }, projection: NOTE_FIELDS, limit: 5 }),
  },
  usersWithInterest: {
    title: 'Users with an interest',
    description: 'Equality on the multikey interests index.',
    params: { interest },
    build: (p) => ({ kind: 'find', collection: 'users', filter: { interests: p.interest, status: 'active' }, projection: USER_FIELDS, limit: 10 }),
  },
  groupByInterests: {
    title: 'Scenario 1: users grouped by interests',
    description: 'One aggregate() call: $match → $project → $unwind → $group → $sort → $facet.',
    params: {},
    build: () => ({ kind: 'aggregate', collection: 'users', pipeline: groupByInterestsPipeline({ limit: 5, membersPerGroup: 5 }) }),
  },
  postsOfUser: {
    title: "Scenario 2: a user's posts ($lookup)",
    description: 'Single pipeline joining users → posts on the author index.',
    params: { user: objectId },
    build: (p) => ({ kind: 'aggregate', collection: 'users', pipeline: userPostsPipeline(oid(p.user), { skip: 0, limit: 5 }) }),
  },
  latestPosts: {
    title: 'Latest posts feed',
    description: 'Feed sorted by _id (time ordered), no extra index needed.',
    params: {},
    build: () => ({ kind: 'find', collection: 'posts', filter: { status: 'active' }, sort: { _id: -1 }, projection: POST_FIELDS, limit: 5 }),
  },
};

export const sampleList = () =>
  Object.entries(SAMPLES).map(([key, s]) => ({ key, title: s.title, description: s.description, params: Object.keys(s.params) }));

const shellOf = (q) => {
  if (q.kind === 'count') return `db.${q.collection}.countDocuments(${show(q.filter)})`;
  if (q.kind === 'aggregate') return `db.${q.collection}.aggregate([\n  ${q.pipeline.map(show).join(',\n  ')}\n])`;
  return `db.${q.collection}.find(${show(q.filter)}, ${show(q.projection)})${q.sort ? `.sort(${show(q.sort)})` : ''}.limit(${q.limit})`;
};

const clean = (doc) => {
  if (Array.isArray(doc)) return doc.map(clean);
  if (doc instanceof mongoose.Types.ObjectId) return String(doc);
  if (doc instanceof Date) return doc.toISOString();
  if (doc && typeof doc === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(doc)) if (!['passwordHash', 'history'].includes(k)) out[k] = clean(v);
    return out;
  }
  return doc;
};

export const runSample = async (key, query) => {
  const sample = SAMPLES[key];
  if (!sample) throw notFound('Sample query');
  const parsed = z.object(sample.params).safeParse(query);
  if (!parsed.success) throw badRequest(parsed.error.issues[0].message);
  const q = sample.build(parsed.data);
  const coll = mongoose.connection.db.collection(q.collection);
  const started = process.hrtime.bigint();
  let results;
  let command;
  if (q.kind === 'count') {
    results = [{ count: await coll.countDocuments(q.filter) }];
    command = { count: q.collection, query: q.filter };
  } else if (q.kind === 'aggregate') {
    results = await coll.aggregate(q.pipeline).toArray();
    command = { aggregate: q.collection, pipeline: q.pipeline, cursor: {} };
  } else {
    const cursor = coll.find(q.filter, { projection: q.projection, limit: q.limit });
    if (q.sort) cursor.sort(q.sort);
    results = await cursor.toArray();
    command = { find: q.collection, filter: q.filter, projection: q.projection, limit: q.limit, ...(q.sort ? { sort: q.sort } : {}) };
  }
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  const explain = await mongoose.connection.db.command({ explain: command, verbosity: 'executionStats' });
  const { plan, ...stats } = summarize(explain);
  return {
    key,
    title: sample.title,
    collection: q.collection,
    shell: shellOf(q),
    results: clean(results),
    resultCount: results.length,
    wallMs: Math.round(wallMs * 100) / 100,
    ...stats,
    plan,
  };
};
