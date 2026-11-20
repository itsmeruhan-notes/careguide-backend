# Ruhan's Notes — Backend

REST API for a secure note-taking app with role-based access, note sharing, full change history and MongoDB aggregations.

**Live app:** https://ruhan.lol/careguide

## Stack

Node.js 24 · Express 5 · MongoDB 8 · Mongoose 9 · JWT · bcrypt · zod · Docker

## Features

| Area | What it does |
|---|---|
| Authentication | Register and sign in, JWT sessions, bcrypt password hashing, rate-limited sign-in |
| Roles | **User** manages their own notes; **Admin** also manages users and can read everyone's notes |
| Notes | Create, update, soft delete, list, search, sort, paginate |
| Sharing | Owner shares a note as **read only** or **can edit**; only the owner can delete or re-share |
| History | Every change keeps the old and new value, who made it and when |
| Posts | Public posts with tags, visible to every member |
| Interests | Users grouped by interest (aggregation) |
| User posts | A user's profile with their posts (aggregation with `$lookup`) |
| Admin | User management (add, edit, soft delete, restore), all notes, DB insights with live query plans |
| Lists | Every list is paginated, searched, filtered and sorted on the server |

## Data model — 3 collections

Rules followed on purpose:

- **No constraints in the database.** No `required`, `unique`, `enum`, `min/max` in schemas; all validation lives in the service layer.
- **Every field has a default**, so documents never contain `null`.
- **Audit fields on every document:** created/updated time, by whom, and a `status` for soft delete.
- **History lives inside each document** (`history[]` with old and new values). No separate log collection.
- **Fields instead of extra collections.** Small, intentional redundancy (owner name, author name, shared user names) so lists never need joins.

| Collection | Holds |
|---|---|
| `users` | nickname, email, password hash, role, bio, interests, audit, history |
| `notes` | title, content, owner, embedded share list with access level, audit, history |
| `posts` | author, title, body, tags, audit, history |

The share list is embedded in the note: it is small, always read with the note, and avoids a fourth collection.

## Indexing strategy

Indexes are declared in code with `schema.index(...)` and applied with `syncIndexes()`, which also drops anything that is not declared.

**5 custom indexes + the default `_id` index on each collection. Nothing else.**

| Collection | Index | Why it exists |
|---|---|---|
| users | `{ email: 1 }` | Sign-in, duplicate check on register, finding a user to share with, nickname prefix search |
| users | `{ interests: 1 }` *(multikey)* | `$match` stage of the group-by-interests aggregation |
| notes | `{ owner: 1, status: 1, _id: -1 }` | "My notes" list, its count and search, newest first |
| notes | `{ 'sharedWith.userId': 1, status: 1, _id: -1 }` *(multikey)* | "Shared with me" list and its count |
| posts | `{ author: 1, status: 1, _id: -1 }` | `$lookup` from a user to their posts, and post counts |
| all | `_id` (default) | Get by id, admin lists and the posts feed, all ordered by `_id` |

- **Equality first, then sort.** `owner`/`status` are equality filters and `_id: -1` gives newest-first straight from the index: no in-memory sort, pagination walks the index, counts become `COUNT_SCAN`.
- **`_id` is time-ordered**, so it replaces a `createdAt` index everywhere.
- **No `{ owner: 1 }` index** — it is a prefix of the compound index.
- **Nothing on `role`, `status`, `title`, `name`, dates or tags** — no required query filters or sorts on them alone.
- **Email is not `unique` in the database** (no DB constraints); uniqueness is checked in the service.

Documented trade-offs instead of extra indexes (admin-only screens, small data): sorting all notes by title or owner name is done in memory, the deleted-notes counter scans the collection, and free-text search uses a case-insensitive regex over the already filtered set.

### Verified with `explain()`

The test suite fails if any main query does a `COLLSCAN` or if an index exists that is not in the table above. `npm run explain` prints the plans.

| Query | Plan | Index |
|---|---|---|
| Sign-in lookup | `EXPRESS_IXSCAN` | `email_1` |
| Get user by id | `EXPRESS_IXSCAN` | `_id_` |
| My notes list | `LIMIT → FETCH → IXSCAN` | `owner_1_status_1__id_-1` |
| My notes count | `COUNT_SCAN` | `owner_1_status_1__id_-1` |
| Shared with me | `LIMIT → FETCH → IXSCAN` | `sharedWith.userId_1_status_1__id_-1` |
| Admin lists, posts feed | `LIMIT → FETCH → IXSCAN` | `_id_` |
| Group by interests | `FETCH → IXSCAN` | `interests_1` |
| User posts `$lookup` | `IXSCAN` + `$lookup` | `_id_` + `author_1_status_1__id_-1` |

## Aggregations

### Users grouped by interests — exactly one `aggregate()` call

```js
User.aggregate([
  { $match: { interests: { $gte: '' }, status: 'active' } },  // or { $in: [...] } when filtered
  { $project: { name: 1, role: 1, interests: 1 } },
  { $unwind: '$interests' },
  { $group: { _id: '$interests', count: { $sum: 1 }, members: { $push: { id: '$_id', name: '$name', role: '$role' } } } },
  { $sort: { count: -1, _id: 1 } },
  { $facet: { data: [{ $skip }, { $limit }, { $project }], total: [{ $count: 'n' }] } },
])
```

- `$match` first so the planner uses the multikey `interests_1` index. Without a filter, `{ $gte: '' }` keeps only users with at least one interest and turns the match into an index range scan.
- `$project` before `$unwind` keeps documents small.
- `$facet` returns the page and the total in the same call. Optional stages add interest-name search and a minimum member count.

### A user's posts — one pipeline with `$lookup`

```js
User.aggregate([
  { $match: { _id: userId, status: 'active' } },
  { $lookup: {
      from: 'posts', localField: '_id', foreignField: 'author',
      pipeline: [
        { $match: { status: 'active' } },
        { $sort: { _id: -1 } },
        { $facet: { data: [{ $skip }, { $limit }, { $project }], total: [{ $count: 'n' }] } },
      ],
      as: 'posts',
  } },
  { $project: { name: 1, bio: 1, interests: 1, role: 1, createdAt: 1, posts: { $first: '$posts' } } },
])
```

`localField/foreignField` with a sub-pipeline lets MongoDB use `author_1_status_1__id_-1` for the join, and the posts come back sorted and paginated from the index.

## Security

- bcrypt (12 rounds); hashes are never returned.
- JWT with expiry; the user is re-checked on every request, so a deleted account is locked out immediately.
- Rate-limited sign-in and register, `helmet`, request size limit, uniform error format without stack traces.
- Input is validated with zod before it reaches the database; queries are built from validated values only, and search text is regex-escaped.
- A note you cannot access returns "not found", so ids cannot be probed.
- MongoDB runs with authentication on a private Docker network with no published port. API docs are disabled in production.

## Run locally

```bash
npm ci
npm run dev:memory   # in-memory MongoDB with sample data
npm test             # API tests on an in-memory MongoDB
npm run lint
npm run explain      # query plan summary
```

Configuration comes from environment variables; see `.env.example`.

## Project layout

```
src/
  models/      schemas, audit fields, schema.index
  routes/      auth, notes, posts, users, admin
  middleware/  JWT auth, admin guard, errors
  utils/       validation, history, pagination, search
  queries.js   the two aggregation pipelines
  insights.js  index report and explain summaries
  seed/        sample data
test/          API tests
```
