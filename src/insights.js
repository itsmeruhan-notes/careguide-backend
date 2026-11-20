import mongoose from 'mongoose';
import { User } from './models/User.js';
import { Note } from './models/Note.js';
import { Post } from './models/Post.js';
import { groupByInterestsPipeline, userPostsPipeline } from './queries.js';

const USED_BY = {
  'users._id_': 'Get user by id, admin users list (sorted by _id), $match in user posts',
  'users.email_1': 'Login, register duplicate check, share by nickname, nickname prefix search',
  'users.interests_1': 'Group users by interests ($match stage)',
  'notes._id_': 'Get / update / delete note by id, admin all-notes list',
  'notes.owner_1_status_1__id_-1': 'My notes list + count + search (sorted newest first)',
  'notes.sharedWith.userId_1_status_1__id_-1': 'Shared-with-me list + count',
  'posts._id_': 'Get post by id, posts feed (sorted by _id)',
  'posts.author_1_status_1__id_-1': 'User posts $lookup, my posts count',
};

const MULTIKEY = new Set(['users.interests_1', 'notes.sharedWith.userId_1_status_1__id_-1']);

export const serverInfo = async () => {
  const admin = mongoose.connection.db.admin();
  const [build, hello] = await Promise.all([admin.serverInfo(), mongoose.connection.db.command({ hello: 1 })]);
  return { version: build.version, engine: 'WiredTiger', topology: hello.setName ? `ReplicaSet: ${hello.setName}` : 'Standalone' };
};

export const indexReport = async () => {
  const collections = [User, Note, Post];
  const result = [];
  const collectionStats = [];
  for (const model of collections) {
    const name = model.collection.collectionName;
    const [indexes, count, stats, usage] = await Promise.all([
      model.collection.indexes(),
      model.estimatedDocumentCount(),
      model.collection.aggregate([{ $collStats: { storageStats: {} } }]).toArray().catch(() => []),
      model.collection.aggregate([{ $indexStats: {} }]).toArray().catch(() => []),
    ]);
    const sizes = stats[0]?.storageStats?.indexSizes || {};
    const st = stats[0]?.storageStats || {};
    collectionStats.push({ name, documents: count, dataSize: st.size || 0, avgDocSize: Math.round(st.avgObjSize || 0), storageSize: st.storageSize || 0, indexSize: st.totalIndexSize || 0, indexes: indexes.length });
    for (const idx of indexes) {
      const used = usage.find((u) => u.name === idx.name);
      result.push({
        collection: name,
        name: idx.name,
        key: idx.key,
        unique: idx.name === '_id_',
        compound: Object.keys(idx.key).length > 1,
        multikey: MULTIKEY.has(`${name}.${idx.name}`),
        sizeBytes: sizes[idx.name] || 0,
        ops: used ? Number(used.accesses?.ops || 0) : 0,
        since: used?.accesses?.since || null,
        documents: count,
        usedBy: USED_BY[`${name}.${idx.name}`] || '',
      });
    }
  }
  return { collections: collections.length, indexes: result.length, server: await serverInfo(), collectionStats, data: result };
};

const walk = (node, acc) => {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, acc));
  if (!node || typeof node !== 'object') return;
  if (typeof node.stage === 'string') acc.stages.add(node.stage);
  if (typeof node.indexName === 'string') acc.indexes.add(node.indexName);
  if (Array.isArray(node.indexesUsed)) node.indexesUsed.forEach((i) => acc.indexes.add(`${i} ($lookup)`));
  if (typeof node.collectionScans === 'number' && node.collectionScans > 0) acc.stages.add('COLLSCAN');
  for (const key of ['totalKeysExamined', 'totalDocsExamined']) {
    if (typeof node[key] === 'number') acc[key] += node[key];
  }
  if (typeof node.nReturned === 'number' && node.executionTimeMillis !== undefined) acc.nReturned += node.nReturned;
  if (typeof node.executionTimeMillis === 'number') acc.ms = Math.max(acc.ms, node.executionTimeMillis);
  if (typeof node.executionTimeMillisEstimate === 'number') acc.ms = Math.max(acc.ms, node.executionTimeMillisEstimate);
  for (const value of Object.values(node)) walk(value, acc);
};

const pickPlan = (raw) =>
  raw?.queryPlanner?.winningPlan ||
  raw?.stages?.[0]?.$cursor?.queryPlanner?.winningPlan ||
  raw?.stages?.[0]?.$cursor?.queryPlanner ||
  raw?.queryPlanner ||
  {};

export const summarize = (explain) => {
  const acc = { stages: new Set(), indexes: new Set(), totalKeysExamined: 0, totalDocsExamined: 0, nReturned: 0, ms: 0 };
  walk(explain, acc);
  const stages = [...acc.stages];
  return {
    usesIndex: stages.includes('IXSCAN') || stages.includes('COUNT_SCAN') || stages.includes('EXPRESS_IXSCAN') || stages.includes('IDHACK') || stages.includes('EXPRESS_IDHACK'),
    collscan: stages.includes('COLLSCAN'),
    stages,
    indexes: [...acc.indexes],
    keysExamined: acc.totalKeysExamined,
    docsExamined: acc.totalDocsExamined,
    returned: acc.nReturned,
    ms: acc.ms,
    plan: pickPlan(explain),
  };
};

const runCommand = (command) => mongoose.connection.db.command({ explain: command, verbosity: 'executionStats' });

export const explainAll = async (admin) => {
  const sampleUser = (await User.findOne({ status: 'active', role: 'user' }, { _id: 1, email: 1, interests: 1 })) || admin;
  const interest = sampleUser.interests?.[0] || 'chess';
  const queries = [
    { name: 'Login (find user by email)', purpose: 'Sign in and nickname lookups', collection: 'users', command: { find: 'users', filter: { email: sampleUser.email }, limit: 1 } },
    { name: 'Get user by id', purpose: 'Profile pages and auth on every request', collection: 'users', command: { find: 'users', filter: { _id: sampleUser._id }, limit: 1 } },
    { name: 'My notes list', purpose: 'Home page, newest first', collection: 'notes', command: { find: 'notes', filter: { owner: sampleUser._id, status: 'active' }, sort: { _id: -1 }, limit: 10 } },
    { name: 'My notes count', purpose: 'Pagination total for My notes', collection: 'notes', command: { count: 'notes', query: { owner: sampleUser._id, status: 'active' } } },
    {
      name: 'Shared with me list',
      purpose: 'Notes other people shared with you',
      collection: 'notes',
      command: { find: 'notes', filter: { 'sharedWith.userId': sampleUser._id, status: 'active' }, sort: { _id: -1 }, limit: 10 },
    },
    { name: 'Admin users list', purpose: 'Admin › Users table', collection: 'users', command: { find: 'users', filter: {}, sort: { _id: -1 }, limit: 10 } },
    { name: 'Admin all notes list', purpose: 'Admin › All Notes table', collection: 'notes', command: { find: 'notes', filter: {}, sort: { _id: -1 }, limit: 10 } },
    { name: 'Posts feed', purpose: 'Public posts feed', collection: 'posts', command: { find: 'posts', filter: { status: 'active' }, sort: { _id: -1 }, limit: 10 } },
    {
      name: 'Scenario 1: group users by interests (all)',
      purpose: 'Interests page, one aggregate() call',
      collection: 'users',
      command: { aggregate: 'users', pipeline: groupByInterestsPipeline({ limit: 10 }), cursor: {} },
    },
    {
      name: `Scenario 1: group users by interests (filter "${interest}")`,
      purpose: 'Interests page with a filter chip',
      collection: 'users',
      command: { aggregate: 'users', pipeline: groupByInterestsPipeline({ interests: [interest], limit: 10 }), cursor: {} },
    },
    {
      name: 'Scenario 2: user posts ($lookup)',
      purpose: 'User profile page, single pipeline',
      collection: 'users',
      command: { aggregate: 'users', pipeline: userPostsPipeline(sampleUser._id, { skip: 0, limit: 10 }), cursor: {} },
    },
  ];
  const data = [];
  for (const q of queries) {
    const raw = await runCommand(q.command);
    data.push({ name: q.name, purpose: q.purpose, collection: q.collection, command: q.command, ...summarize(raw) });
  }
  return { data, allUseIndex: data.every((d) => d.usesIndex && !d.collscan) };
};
