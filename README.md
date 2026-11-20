# Ruhan's Notes — API

REST API for a secure note-taking app with role-based access, note sharing, change history and MongoDB aggregations.

- **Live API:** https://ruhan.lol/careguide/api (Swagger UI: https://ruhan.lol/careguide/api/docs/)
- **Live app:** https://ruhan.lol/careguide
- **Stack:** Node.js 24 · Express 5 · MongoDB 8 · Mongoose 9 · JWT · bcrypt · zod

| Demo account | Password | Role |
|---|---|---|
| `admin@ruhan.lol` | `Admin1234` | admin |
| `demo@ruhan.lol` | `User1234` | user |
| `karim@ruhan.lol` / `sara@ruhan.lol` / `mim@ruhan.lol` | `Karim1234` / `Sara1234` / `Mim12345` | user |

---

## 1. What it does

| Role | Can do |
|---|---|
| **User** | Create, update, delete and list **own** notes · share a note with another user as **read** or **write** · see notes shared with them · write posts · edit profile and interests |
| **Admin** | Everything a user can do · add, update, remove (soft delete) and list users · view **everyone's** notes (read-only) · see the history of any note or user · DB Insights (index list + live `explain()`) |

Extras beyond the brief: note sharing, per-document change history with old values, server-side search/filter/sort on every list, DB Insights endpoints.

---

## 2. Data model — 3 collections only

Design rules followed on purpose:

- **No constraints inside the database.** No `required`, `unique`, `enum`, `min/max` in the schemas. All validation lives in the service layer (`src/utils/validation.js`, zod). The database only stores.
- **Every field has a default**, so documents never contain `null`.
- **Audit fields on every document:** `createdAt/By/ByName`, `updatedAt/By/ByName`, `status` (`active` / `deleted`, soft delete).
- **History inside the document:** `history[]` keeps every change with the **old value and the new value**, who did it and when. No separate log collection.
- **Extra fields instead of extra collections.** Small, intentional redundancy (`ownerName`, `authorName`, `sharedWith[].name`) so list endpoints never need joins.

| Collection | Main fields |
|---|---|
| `users` | `name` (nickname), `email` (`nickname@ruhan.lol`), `passwordHash`, `role`, `bio`, `interests[]`, `isDemo` + audit + `history[]` |
| `notes` | `title`, `content`, `owner`, `ownerName`, `ownerEmail`, `sharedWith[{ userId, name, email, access, sharedAt }]` + audit + `history[]` |
| `posts` | `author`, `authorName`, `authorRole`, `title`, `body`, `tags[]` + audit + `history[]` |

`sharedWith` is embedded in the note: a note is shared with a handful of people, it is always read together with the note, and it avoids a 4th collection.

Strings everywhere except where a different type is technically required: reference ids are `ObjectId` (so `$lookup` and index equality match) and timestamps are `Date` (correct ordering).

---

## 3. Indexing strategy

All indexes are declared in code with `schema.index(...)` (`src/models/*.js`) and applied with `syncIndexes()`, which also **drops any index that is not declared**.

**5 custom indexes + the 3 default `_id` indexes. Nothing else.**

| # | Collection | Index | Query it exists for |
|---|---|---|---|
| 1 | users | `{ email: 1 }` | Login, duplicate-email check on register, share by email, nickname prefix search (`^karim`) |
| 2 | users | `{ interests: 1 }` *(multikey)* | Scenario 1 `$match` on interests |
| 3 | notes | `{ owner: 1, status: 1, _id: -1 }` | "My notes" list + its count + search inside my notes, sorted newest first |
| 4 | notes | `{ 'sharedWith.userId': 1, status: 1, _id: -1 }` *(multikey)* | "Shared with me" list + its count |
| 5 | posts | `{ author: 1, status: 1, _id: -1 }` | Scenario 2 `$lookup` (posts of a user) + profile post counts |
| – | all | `_id_` (default) | Get by id, admin users list, admin all-notes list, posts feed — all sorted by `_id` |

Why these and only these:

- **Compound keys follow Equality → Sort.** `owner` and `status` are equality filters, `_id: -1` gives newest-first order straight from the index, so there is **no in-memory sort** and `skip/limit` pagination walks the index. `countDocuments` on the same filter becomes a `COUNT_SCAN`.
- **`_id` is time-ordered**, so sorting by `_id` replaces a `createdAt` index. That removes the need for any `createdAt` index on every collection.
- **No separate `{ owner: 1 }` index:** it is a prefix of index #3, which already covers it.
- **No index on `role`, `status`, `title`, `name`, `createdAt`, `updatedAt`, `tags`.** None of the required list/read queries filter or sort by them on their own.
- **Email is not `unique` in the database** (rule: no DB constraints). Uniqueness is checked in the service before insert.

Deliberate trade-offs (admin-only, small data, documented instead of adding indexes):

- Admin All Notes sorted by *title* or *owner name* is sorted in memory after the filter.
- The "deleted notes" counter on Admin All Notes scans `notes` (no `status`-only index).
- Free-text search on posts and admin notes uses a case-insensitive regex over the indexed result set, not a text index.

### Proof (`explain("executionStats")` on the seeded data)

Run it yourself: `npm run explain`, or open **Admin › DB Insights** in the app (`GET /admin/db/explain`). The test suite also fails if any main query does a `COLLSCAN` or if an unexpected index exists.

| Query | Winning plan | Index |
|---|---|---|
| Login (find by email) | `EXPRESS_IXSCAN` | `email_1` |
| Get user by id | `EXPRESS_IXSCAN` | `_id_` |
| My notes list | `LIMIT → FETCH → IXSCAN` | `owner_1_status_1__id_-1` |
| My notes count | `COUNT → COUNT_SCAN` | `owner_1_status_1__id_-1` |
| Shared with me | `LIMIT → FETCH → IXSCAN` | `sharedWith.userId_1_status_1__id_-1` |
| Admin users / all notes / posts feed | `LIMIT → FETCH → IXSCAN` | `_id_` |
| Scenario 1 – group by interests | `FETCH → IXSCAN` | `interests_1` |
| Scenario 2 – user posts `$lookup` | `IXSCAN` + `$lookup` | `_id_` + `author_1_status_1__id_-1` |

---

## 4. Aggregations

### Scenario 1 — users grouped by interests (exactly one `aggregate()` call)

`GET /users/grouped-by-interests?interest=chess,reading&q=ch&minMembers=3&sort=count|name&page=1&limit=6`

```js
User.aggregate([
  { $match: { interests: { $gte: '' }, status: 'active' } },   // or { $in: [...] } when filtered
  { $project: { name: 1, role: 1, interests: 1 } },
  { $unwind: '$interests' },
  { $match: { interests: { $in: [...] } } },                    // only when filtered
  { $group: { _id: '$interests', count: { $sum: 1 }, members: { $push: { id: '$_id', name: '$name', role: '$role' } } } },
  { $match: { _id: /ch/i } },                                  // optional interest-name search
  { $match: { count: { $gte: 3 } } },                          // optional min members
  { $sort: { count: -1, _id: 1 } },
  { $facet: { data: [{ $skip }, { $limit }, { $project }], total: [{ $count: 'n' }] } },
])
```

- `$match` comes first so the planner can use the multikey index `interests_1`. Without a filter it uses `{ interests: { $gte: '' } }`, which keeps only users that have at least one interest **and** turns the match into an index range scan instead of a collection scan.
- `$project` before `$unwind` keeps the documents small.
- `$facet` returns the page **and** the total in the same single call, so pagination needs no second query.

### Scenario 2 — all posts of a user (single pipeline with `$lookup`)

`GET /users/:id/posts?page=1&limit=10&sort=newest|oldest`

```js
User.aggregate([
  { $match: { _id: userId, status: 'active' } },               // _id index
  { $lookup: {
      from: 'posts', localField: '_id', foreignField: 'author', // author_1_status_1__id_-1
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

The `localField/foreignField` form plus the sub-pipeline lets MongoDB use `author_1_status_1__id_-1` for the join (`indexesUsed` in explain), and the posts come back paginated and sorted by the index.

---

## 5. API

Base: `/careguide/api` in production (`/` locally). All list endpoints are paginated: `?page=1&limit=10` (max 50) → `{ data, page, limit, total, totalPages }`. Errors: `{ error: { code, message, fields } }`.

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | `{ name, password, interests? }` → email becomes `name@ruhan.lol`, role `user` |
| POST | `/auth/login` | public | `{ email, password }` — full `nickname@ruhan.lol` required, rate-limited |
| GET | `/auth/me` | user | |
| PATCH | `/users/me` · `/users/me/password` | user | bio, interests · password change |
| GET | `/users/me/stats` | user | counts for the profile page |
| GET | `/users?q=` | user | nickname prefix search (email index) |
| GET | `/users/:id` · `/users/:id/posts` | user | profile · **Scenario 2** |
| GET | `/users/grouped-by-interests` | user | **Scenario 1** |
| GET/POST | `/notes?scope=mine\|shared&q&sort` | user | |
| GET/PATCH/DELETE | `/notes/:id` | owner / shared / admin | write access can edit, only owner deletes |
| GET | `/notes/:id/history` | owner, admin | old → new values |
| PUT · DELETE | `/notes/:id/shares` · `/notes/:id/shares/:userId` | owner | `{ email, access: read\|write }` |
| GET/POST · DELETE | `/posts?q` · `/posts/:id` | user · author/admin | |
| GET/POST | `/admin/users?q&status&role` | admin | |
| PATCH/DELETE | `/admin/users/:id` | admin | soft delete also hides the user's notes and posts; restore with `status: active` |
| GET | `/admin/users/:id/history` | admin | |
| GET | `/admin/notes?q&status&sharing&sort` | admin | everyone's notes + counts |
| GET | `/admin/db/indexes` · `/admin/db/explain` | admin | index list, sizes, usage · live explain of every main query |
| GET | `/health` · `/docs` | public | |

---

## 6. Security

- Passwords hashed with **bcrypt (12 rounds)**; the hash is never returned.
- **JWT** (HS256, 1 day). Every request re-loads the user, so a deleted account is locked out immediately even with a valid token.
- Login and register rate-limited per client IP (Cloudflare `CF-Connecting-IP` aware).
- `helmet`, 100 kb JSON limit, consistent error format, no stack traces in responses.
- Access to a note you cannot see returns **404**, not 403, so note ids cannot be probed.
- Demo accounts cannot be deleted, demoted or have their password changed.

---

## 7. Run locally

```bash
npm ci
npm run dev:memory     # in-memory MongoDB + demo data + API on :4000
# or with your own MongoDB
cp .env.example .env && npm run seed && npm start
```

| Script | |
|---|---|
| `npm test` | 12 API tests on an in-memory MongoDB, including "only these indexes exist" and "no main query does a COLLSCAN" |
| `npm run lint` | ESLint |
| `npm run explain` | prints the explain summary table |
| `npm run seed` | inserts demo users, notes, shares and posts |

Environment: see `.env.example` (`MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS`, `SEED_ON_EMPTY`, `LOGIN_RATE_LIMIT`, `EMAIL_DOMAIN`).

## 8. Deployment

Runs as a Docker container on a self-hosted VM, behind nginx, at `ruhan.lol/careguide/api`. MongoDB runs in its own container on an internal Docker network with authentication and no published port.

## 9. Project layout

```
src/
  app.js, server.js, config.js, db.js
  models/      User, Note, Post (+ audit fields, schema.index)
  routes/      auth, notes, posts, users, admin, serializers
  middleware/  auth (JWT, admin guard), error
  utils/       validation (zod), history, http (paging, errors, search)
  queries.js   the two aggregation pipelines
  insights.js  index report + explain summaries
  seed/        demo data
test/          API tests
scripts/       explain report, in-memory dev server
```
