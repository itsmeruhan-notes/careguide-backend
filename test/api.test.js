import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { Note } from '../src/models/Note.js';
import { User } from '../src/models/User.js';
import { Post } from '../src/models/Post.js';

let ctx;
before(async () => {
  ctx = await setup();
});
after(async () => {
  await ctx.teardown();
});

test('health is ok', async () => {
  const res = await ctx.api.get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.db, 'up');
});

test('register, login, me, validation and duplicate email', async () => {
  const bad = await ctx.api.post('/auth/register').send({ name: 'A b', password: 'short' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.fields.name && bad.body.error.fields.password);

  const ok = await ctx.api.post('/auth/register').send({ name: 'NewPerson', password: 'Secret123', interests: ['Chess', 'chess'] });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.user.role, 'user');
  assert.equal(ok.body.user.name, 'newperson');
  assert.equal(ok.body.user.email, 'newperson@ruhan.lol');
  assert.deepEqual(ok.body.user.interests, ['chess']);
  assert.equal(ok.body.user.passwordHash, undefined);

  const stored = await User.findOne({ email: 'newperson@ruhan.lol' });
  assert.notEqual(stored.passwordHash, 'Secret123');
  assert.match(stored.passwordHash, /^\$2[aby]\$12\$/);
  assert.equal(stored.history[0].action, 'created');

  const dup = await ctx.api.post('/auth/register').send({ name: 'newperson', password: 'Secret123' });
  assert.equal(dup.status, 409);

  const wrong = await ctx.api.post('/auth/login').send({ email: 'newperson@ruhan.lol', password: 'Wrong1234' });
  const bare = await ctx.api.post('/auth/login').send({ email: 'newperson', password: 'Secret123' });
  assert.equal(bare.status, 400);
  assert.equal(wrong.status, 401);

  const me = await ctx.api.get('/auth/me').set('Authorization', `Bearer ${ok.body.token}`);
  assert.equal(me.body.user.email, 'newperson@ruhan.lol');
  const byEmail = await ctx.api.post('/auth/login').send({ email: 'newperson@ruhan.lol', password: 'Secret123' });
  assert.equal(byEmail.status, 200);

  const noToken = await ctx.api.get('/notes');
  assert.equal(noToken.status, 401);
  const badToken = await ctx.api.get('/notes').set('Authorization', 'Bearer abc');
  assert.equal(badToken.status, 401);
});

test('notes CRUD with ownership, pagination and history', async () => {
  const created = await ctx.as('karim').post('/notes', { title: 'Temp', content: 'v1' });
  assert.equal(created.status, 201);
  const id = created.body.note.id;

  const empty = await ctx.as('karim').post('/notes', { title: '' });
  assert.equal(empty.status, 400);

  const list = await ctx.as('karim').get('/notes?page=1&limit=2');
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 2);
  assert.equal(list.body.limit, 2);
  assert.ok(list.body.total >= 3);
  assert.equal(list.body.data[0].id, id);
  assert.equal(list.body.data[0].history, undefined);

  const otherGet = await ctx.as('sara').get(`/notes/${id}`);
  assert.equal(otherGet.status, 404);
  const otherPatch = await ctx.as('sara').patch(`/notes/${id}`, { title: 'hack' });
  assert.equal(otherPatch.status, 404);

  const upd = await ctx.as('karim').patch(`/notes/${id}`, { title: 'Temp 2', content: 'v2' });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.note.title, 'Temp 2');

  const hist = await ctx.as('karim').get(`/notes/${id}/history`);
  assert.equal(hist.body.data[0].action, 'updated');
  assert.equal(hist.body.data[0].before.title, 'Temp');
  assert.equal(hist.body.data[0].before.content, 'v1');
  assert.equal(hist.body.data[0].after.title, 'Temp 2');

  const del = await ctx.as('karim').delete(`/notes/${id}`);
  assert.equal(del.status, 204);
  const gone = await ctx.as('karim').get(`/notes/${id}`);
  assert.equal(gone.status, 404);
  const doc = await Note.findById(id);
  assert.equal(doc.status, 'deleted');

  const badId = await ctx.as('karim').get('/notes/not-an-id');
  assert.equal(badId.status, 404);
});

test('sharing read and write access', async () => {
  const { body } = await ctx.as('karim').post('/notes', { title: 'Shared', content: 'hello' });
  const id = body.note.id;

  const self = await ctx.as('karim').put(`/notes/${id}/shares`, { email: 'karim', access: 'read' });
  assert.equal(self.status, 400);
  const unknown = await ctx.as('karim').put(`/notes/${id}/shares`, { email: 'ghost', access: 'read' });
  assert.equal(unknown.status, 400);

  const share = await ctx.as('karim').put(`/notes/${id}/shares`, { email: 'sara', access: 'read' });
  assert.equal(share.status, 200);
  const saraId = share.body.note.sharedWith[0].userId;

  const read = await ctx.as('sara').get(`/notes/${id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.note.access, 'read');
  const readEdit = await ctx.as('sara').patch(`/notes/${id}`, { content: 'nope' });
  assert.equal(readEdit.status, 403);

  const shared = await ctx.as('sara').get('/notes?scope=shared');
  assert.ok(shared.body.data.some((n) => n.id === id));

  await ctx.as('karim').put(`/notes/${id}/shares`, { email: 'sara', access: 'write' });
  const write = await ctx.as('sara').patch(`/notes/${id}`, { content: 'edited by sara' });
  assert.equal(write.status, 200);
  const saraDelete = await ctx.as('sara').delete(`/notes/${id}`);
  assert.equal(saraDelete.status, 403);
  const saraShare = await ctx.as('sara').put(`/notes/${id}/shares`, { email: 'demo', access: 'read' });
  assert.equal(saraShare.status, 403);

  const hist = await ctx.as('karim').get(`/notes/${id}/history`);
  assert.equal(hist.body.data[0].byName, 'sara');
  assert.equal(hist.body.data[0].before.content, 'hello');

  const revoke = await ctx.as('karim').delete(`/notes/${id}/shares/${saraId}`);
  assert.equal(revoke.status, 200);
  const after = await ctx.as('sara').get(`/notes/${id}`);
  assert.equal(after.status, 404);
});

test('admin: users management, all notes, forbidden for users', async () => {
  const forbidden = await ctx.as('user').get('/admin/users');
  assert.equal(forbidden.status, 403);

  const users = await ctx.as('admin').get('/admin/users?limit=2');
  assert.equal(users.status, 200);
  assert.equal(users.body.data.length, 2);
  assert.ok(users.body.totalPages >= 3);

  const created = await ctx.as('admin').post('/admin/users', { name: 'tanvir', password: 'Tanvir123', interests: ['chess'] });
  assert.equal(created.status, 201);
  const uid = created.body.user.id;

  const upd = await ctx.as('admin').patch(`/admin/users/${uid}`, { bio: 'Hi', role: 'admin' });
  assert.equal(upd.body.user.role, 'admin');
  const hist = await ctx.as('admin').get(`/admin/users/${uid}/history`);
  assert.equal(hist.body.data[0].before.role, 'user');
  assert.equal(created.body.user.email, 'tanvir@ruhan.lol');

  const tLogin = await ctx.login('tanvir', 'Tanvir123');
  assert.ok(tLogin);
  const del = await ctx.as('admin').delete(`/admin/users/${uid}`);
  assert.equal(del.status, 204);
  const blocked = await ctx.api.post('/auth/login').send({ email: 'tanvir@ruhan.lol', password: 'Tanvir123' });
  assert.equal(blocked.status, 403);
  const oldToken = await ctx.api.get('/auth/me').set('Authorization', `Bearer ${tLogin}`);
  assert.equal(oldToken.status, 401);

  const demoDel = await ctx.as('admin').delete(`/admin/users/${(await User.findOne({ email: 'demo@ruhan.lol' }))._id}`);
  assert.equal(demoDel.status, 403);

  const all = await ctx.as('admin').get('/admin/notes?limit=50');
  const owners = new Set(all.body.data.map((n) => n.owner.name));
  assert.ok(owners.size >= 4);

  const adminView = await ctx.as('admin').get(`/notes/${(await Note.findOne({ ownerName: 'mim' }))._id}`);
  assert.equal(adminView.body.note.access, 'admin');
  const adminEdit = await ctx.as('admin').patch(`/notes/${adminView.body.note.id}`, { title: 'x' });
  assert.equal(adminEdit.status, 403);
});

test('scenario 1: group by interests', async () => {
  const res = await ctx.as('user').get('/users/grouped-by-interests?limit=50');
  assert.equal(res.status, 200);
  const chess = res.body.data.find((g) => g.interest === 'chess');
  assert.ok(chess.count >= 3);
  assert.ok(chess.members.some((m) => m.name === 'karim'));
  assert.equal(res.body.data[0].count >= res.body.data.at(-1).count, true);

  const filtered = await ctx.as('user').get('/users/grouped-by-interests?interest=reading,travel');
  assert.deepEqual(filtered.body.data.map((g) => g.interest).sort(), ['reading', 'travel']);

  const searched = await ctx.as('user').get('/users/grouped-by-interests?q=CH');
  assert.deepEqual(searched.body.data.map((g) => g.interest), ['chess']);
  const big = await ctx.as('user').get('/users/grouped-by-interests?minMembers=3');
  assert.ok(big.body.data.every((g) => g.count >= 3));
  assert.ok(big.body.data[0].members[0].role);
  const paged = await ctx.as('user').get('/users/grouped-by-interests?limit=2&page=2&sort=name');
  assert.equal(paged.body.data.length, 2);
  assert.ok(paged.body.total > 4);
});

test('scenario 2: user posts with $lookup', async () => {
  const karim = await User.findOne({ email: 'karim@ruhan.lol' });
  const res = await ctx.as('user').get(`/users/${karim._id}/posts?limit=1`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, 'karim');
  assert.equal(res.body.posts.total, 2);
  assert.equal(res.body.posts.data.length, 1);
  assert.equal(res.body.posts.totalPages, 2);
  const missing = await ctx.as('user').get('/users/64b000000000000000000000/posts');
  assert.equal(missing.status, 404);
});

test('posts feed, create and delete rules', async () => {
  const created = await ctx.as('sara').post('/posts', { title: 'Hi', body: 'There' });
  assert.equal(created.status, 201);
  const feed = await ctx.as('karim').get('/posts?limit=3');
  assert.equal(feed.body.data[0].id, created.body.post.id);
  const notMine = await ctx.as('karim').delete(`/posts/${created.body.post.id}`);
  assert.equal(notMine.status, 403);
  const mine = await ctx.as('sara').delete(`/posts/${created.body.post.id}`);
  assert.equal(mine.status, 204);
  assert.equal((await Post.findById(created.body.post.id)).status, 'deleted');
});

test('profile update and password change', async () => {
  const upd = await ctx.as('sara').patch('/users/me', { bio: 'New bio', interests: ['Design'] });
  assert.equal(upd.body.user.bio, 'New bio');
  const wrong = await ctx.as('sara').patch('/users/me/password', { currentPassword: 'bad', newPassword: 'Another123' });
  assert.equal(wrong.status, 400);
  const ok = await ctx.as('sara').patch('/users/me/password', { currentPassword: 'Sara1234', newPassword: 'Another123' });
  assert.equal(ok.status, 200);
  assert.ok(await ctx.login('sara', 'Another123'));
  const stats = await ctx.as('karim').get('/users/me/stats');
  assert.equal(typeof stats.body.notes, 'number');
});

test('server-side search on every list', async () => {
  const mine = await ctx.as('karim').get('/notes?q=CHESS');
  assert.deepEqual(mine.body.data.map((n) => n.title), ['Chess openings']);
  const shared = await ctx.as('user').get('/notes?scope=shared&q=openings');
  assert.equal(shared.body.total, 1);
  const posts = await ctx.as('user').get('/posts?q=indexing');
  assert.ok(posts.body.data.length >= 2);
  assert.ok(posts.body.data.every((p) => Array.isArray(p.tags)));
  const tricky = await ctx.as('user').get('/posts?q=' + encodeURIComponent('(.*'));
  assert.equal(tricky.status, 200);
  const users = await ctx.as('user').get('/users?q=ka');
  assert.deepEqual(users.body.data.map((u) => u.name), ['karim']);
  const adminUsers = await ctx.as('admin').get('/admin/users?q=s');
  assert.ok(adminUsers.body.data.every((u) => u.name.startsWith('s')));
  const admins = await ctx.as('admin').get('/admin/users?role=admin');
  assert.ok(admins.body.data.length >= 1 && admins.body.data.every((u) => u.role === 'admin'));
  const sharedOnly = await ctx.as('admin').get('/admin/notes?sharing=shared&sort=title&limit=50');
  assert.ok(sharedOnly.body.data.every((n) => n.sharedCount > 0));
  assert.equal(typeof sharedOnly.body.counts.deleted, 'number');
  const adminNotes = await ctx.as('admin').get('/admin/notes?q=mim');
  assert.ok(adminNotes.body.data.length >= 1);
  const tagged = await ctx.as('sara').post('/posts', { title: 'Tagged', body: 'x', tags: ['#Design', 'ui'] });
  assert.deepEqual(tagged.body.post.tags, ['design', 'ui']);
  assert.equal(tagged.body.post.author.role, 'user');
});

test('only the planned indexes exist', async () => {
  const names = async (model) => (await model.collection.indexes()).map((i) => i.name).sort();
  assert.deepEqual(await names(User), ['_id_', 'email_1', 'interests_1']);
  assert.deepEqual(await names(Note), ['_id_', 'owner_1_status_1__id_-1', 'sharedWith.userId_1_status_1__id_-1']);
  assert.deepEqual(await names(Post), ['_id_', 'author_1_status_1__id_-1']);
});

test('every main query uses an index (explain)', async () => {
  const res = await ctx.as('admin').get('/admin/db/explain');
  assert.equal(res.status, 200);
  for (const q of res.body.data) {
    assert.equal(q.collscan, false, `${q.name} does COLLSCAN: ${q.stages.join(',')}`);
    assert.equal(q.usesIndex, true, `${q.name} uses no index: ${q.stages.join(',')}`);
  }
  const idx = await ctx.as('admin').get('/admin/db/indexes');
  assert.equal(idx.body.collections, 3);
});
