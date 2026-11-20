import mongoose from 'mongoose';
import { User } from './models/User.js';
import { Note } from './models/Note.js';
import { Post } from './models/Post.js';
import { groupByInterestsPipeline, userPostsPipeline } from './queries.js';

const USED_BY = {
  'users._id_': 'Get user by id, admin users list (sorted by _id), $match in user posts',
  'users.email_1': 'Login, register duplicate check, share note by email',
  'users.interests_1': 'Group users by interests ($match stage)',
  'notes._id_': 'Get / update / delete note by id, admin all-notes list',
  'notes.owner_1_status_1__id_-1': 'My notes list + count (sorted newest first)',
  'notes.sharedWith.userId_1_status_1__id_-1': 'Shared-with-me list + count',
  'posts._id_': 'Get post by id, posts feed (sorted by _id)',
  'posts.author_1_status_1__id_-1': 'User posts $lookup, my posts count',
};

export const indexReport = async () => {
  const collections = [User, Note, Post];
  const result = [];
  for (const model of collections) {
    const name = model.collection.collectionName;
    const indexes = await model.collection.indexes();
    const count = await model.estimatedDocumentCount();
    for (const idx of indexes) {
      result.push({
        collection: name,
        name: idx.name,
        key: idx.key,
        multikey: name === 'users' && idx.name === 'interests_1',
        documents: count,
        usedBy: USED_BY[`${name}.${idx.name}`] || '',
      });
    }
  }
  return { collections: collections.length, indexes: result.length, data: result };
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
  };
};

const runCommand = (command) => mongoose.connection.db.command({ explain: command, verbosity: 'executionStats' });

export const explainAll = async (admin) => {
  const sampleUser = (await User.findOne({ status: 'active', role: 'user' }, { _id: 1, email: 1, interests: 1 })) || admin;
  const interest = sampleUser.interests?.[0] || 'chess';
  const queries = [
    { name: 'Login (find user by email)', collection: 'users', command: { find: 'users', filter: { email: sampleUser.email }, limit: 1 } },
    { name: 'Get user by id', collection: 'users', command: { find: 'users', filter: { _id: sampleUser._id }, limit: 1 } },
    { name: 'My notes list', collection: 'notes', command: { find: 'notes', filter: { owner: sampleUser._id, status: 'active' }, sort: { _id: -1 }, limit: 10 } },
    { name: 'My notes count', collection: 'notes', command: { count: 'notes', query: { owner: sampleUser._id, status: 'active' } } },
    {
      name: 'Shared with me list',
      collection: 'notes',
      command: { find: 'notes', filter: { 'sharedWith.userId': sampleUser._id, status: 'active' }, sort: { _id: -1 }, limit: 10 },
    },
    { name: 'Admin users list', collection: 'users', command: { find: 'users', filter: {}, sort: { _id: -1 }, limit: 10 } },
    { name: 'Admin all notes list', collection: 'notes', command: { find: 'notes', filter: {}, sort: { _id: -1 }, limit: 10 } },
    { name: 'Posts feed', collection: 'posts', command: { find: 'posts', filter: { status: 'active' }, sort: { _id: -1 }, limit: 10 } },
    {
      name: 'Scenario 1: group users by interests (all)',
      collection: 'users',
      command: { aggregate: 'users', pipeline: groupByInterestsPipeline({ limit: 10 }), cursor: {} },
    },
    {
      name: `Scenario 1: group users by interests (filter "${interest}")`,
      collection: 'users',
      command: { aggregate: 'users', pipeline: groupByInterestsPipeline({ interests: [interest], limit: 10 }), cursor: {} },
    },
    {
      name: 'Scenario 2: user posts ($lookup)',
      collection: 'users',
      command: { aggregate: 'users', pipeline: userPostsPipeline(sampleUser._id, { skip: 0, limit: 10 }), cursor: {} },
    },
  ];
  const data = [];
  for (const q of queries) {
    const raw = await runCommand(q.command);
    data.push({ name: q.name, collection: q.collection, command: q.command, ...summarize(raw), raw });
  }
  return { data, allUseIndex: data.every((d) => d.usesIndex && !d.collscan) };
};
