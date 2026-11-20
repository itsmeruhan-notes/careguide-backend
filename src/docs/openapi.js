const page = [
  { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } },
];
const search = [{ name: 'q', in: 'query', schema: { type: 'string' }, description: 'search text' }];
const id = (name = 'id') => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const body = (properties, required = []) => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', properties, required } } },
});
const s = { type: 'string' };
const op = (tag, summary, extra = {}) => ({ tags: [tag], summary, responses: { 200: { description: 'OK' } }, ...extra });

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: "Ruhan's Notes API",
    version: '1.0.0',
    description: 'Secure notes with JWT, roles (user/admin), sharing, pagination and MongoDB aggregations. Lists return { data, page, limit, total, totalPages }.',
  },
  servers: [{ url: '/careguide/api' }, { url: '/' }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  security: [{ bearer: [] }],
  paths: {
    '/health': { get: op('System', 'API and database health', { security: [] }) },
    '/auth/register': { post: op('Auth', 'Register (role user)', { security: [], requestBody: body({ name: { type: 'string', description: 'nickname; the email is generated from it' }, password: s, interests: { type: 'array', items: s } }, ['name', 'password']) }) },
    '/auth/login': { post: op('Auth', 'Login, returns JWT', { security: [], requestBody: body({ email: { type: 'string', description: 'full email address' }, password: s }, ['email', 'password']) }) },
    '/auth/me': { get: op('Auth', 'Current user') },
    '/users/me': { patch: op('Me', 'Update name, bio, interests', { requestBody: body({ bio: s, interests: { type: 'array', items: s } }) }) },
    '/users/me/password': { patch: op('Me', 'Change password', { requestBody: body({ currentPassword: s, newPassword: s }, ['currentPassword', 'newPassword']) }) },
    '/users/me/stats': { get: op('Me', 'My counts') },
    '/notes': {
      get: op('Notes', 'List my notes or notes shared with me', { parameters: [...search, { name: 'scope', in: 'query', schema: { type: 'string', enum: ['mine', 'shared'] } }, { name: 'sort', in: 'query', schema: { type: 'string', enum: ['newest', 'oldest'] } }, ...page] }),
      post: op('Notes', 'Create note', { requestBody: body({ title: s, content: s }, ['title']) }),
    },
    '/notes/{id}': {
      get: op('Notes', 'Get note (owner, shared user or admin)', { parameters: [id()] }),
      patch: op('Notes', 'Update note (owner or write access)', { parameters: [id()], requestBody: body({ title: s, content: s }) }),
      delete: op('Notes', 'Soft delete note (owner)', { parameters: [id()] }),
    },
    '/notes/{id}/history': { get: op('Notes', 'Change history (owner or admin)', { parameters: [id(), ...page] }) },
    '/notes/{id}/shares': { put: op('Sharing', 'Share or change access', { parameters: [id()], requestBody: body({ email: s, access: { type: 'string', enum: ['read', 'write'] } }, ['email', 'access']) }) },
    '/notes/{id}/shares/{userId}': { delete: op('Sharing', 'Revoke access', { parameters: [id(), id('userId')] }) },
    '/posts': {
      get: op('Posts', 'Posts feed (q searches title, body, tags, author)', { parameters: [...search, ...page] }),
      post: op('Posts', 'Create post', { requestBody: body({ title: s, body: s, tags: { type: 'array', items: s } }, ['title', 'body']) }),
    },
    '/posts/{id}': { delete: op('Posts', 'Delete post (author or admin)', { parameters: [id()] }) },
    '/users/grouped-by-interests': {
      get: op('Aggregations', 'Scenario 1: users grouped by interests (one aggregate call)', {
        parameters: [{ name: 'interest', in: 'query', schema: s, description: 'comma separated filter' }, { name: 'sort', in: 'query', schema: { type: 'string', enum: ['count', 'name'] } }, { name: 'q', in: 'query', schema: s, description: 'search interest names' }, { name: 'minMembers', in: 'query', schema: { type: 'integer' } }, ...page],
      }),
    },
    '/users': { get: op('Users', 'Find users by nickname prefix (uses email index)', { parameters: [...search, ...page] }) },
    '/users/{id}': { get: op('Users', 'Public profile', { parameters: [id()] }) },
    '/users/{id}/posts': { get: op('Aggregations', 'Scenario 2: user + posts via $lookup', { parameters: [id(), ...page] }) },
    '/admin/users': {
      get: op('Admin', 'List all users (q = nickname prefix, uses email index)', { parameters: [...search, { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'deleted'] } }, { name: 'role', in: 'query', schema: { type: 'string', enum: ['user', 'admin'] } }, ...page] }),
      post: op('Admin', 'Create user', { requestBody: body({ name: s, password: s, role: { type: 'string', enum: ['user', 'admin'] }, interests: { type: 'array', items: s } }, ['name', 'password']) }),
    },
    '/admin/users/{id}': {
      patch: op('Admin', 'Update user', { parameters: [id()], requestBody: body({ role: s, status: s, interests: { type: 'array', items: s }, password: s }) }),
      delete: op('Admin', 'Soft delete user and their notes/posts', { parameters: [id()] }),
    },
    '/admin/users/{id}/history': { get: op('Admin', 'User change history', { parameters: [id(), ...page] }) },
    '/admin/notes': { get: op('Admin', "Everyone's notes with counts (q searches title, owner, content)", { parameters: [...search, { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'deleted'] } }, { name: 'sharing', in: 'query', schema: { type: 'string', enum: ['shared', 'private'] } }, { name: 'sort', in: 'query', schema: { type: 'string', enum: ['newest', 'oldest', 'title', 'owner'] } }, ...page] }) },
    '/admin/db/indexes': { get: op('Admin', 'Index list per collection') },
    '/admin/db/explain': { get: op('Admin', 'explain() summary for every main query') },
  },
};
