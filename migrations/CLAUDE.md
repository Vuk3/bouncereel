# migrations

D1 schema, applied in order by `wrangler d1 migrations apply` (locally by `npm run dev`'s
`predev` or `npm run db:migrate:local`, in production by `npm run deploy` before the new
code goes live). What each table holds: the video library in
[docs/video-library.md](../docs/video-library.md#2-the-schema); accounts, sessions, links,
throttling, plans, subscriptions and the change log in
[docs/accounts-and-billing.md](../docs/accounts-and-billing.md).

| File | Adds |
| --- | --- |
| [0001_initial.sql](./0001_initial.sql) | `videos`, `posts` |
| [0002_accounts.sql](./0002_accounts.sql) | `users`, `sessions`, `tokens`, `throttle`; an owner (`user_id`) on `videos` and `posts`; one post per account instead of one overall |
| [0003_plans.sql](./0003_plans.sql) | `plans` (Free and Pro seeded), `subscriptions`, `change_log` |
| [0004_daily_videos.sql](./0004_daily_videos.sql) | the day of a plan's daily allowance on `users` (`day_started_at`, `day_videos`); `perDay` on every plan, Free at one a day in the paper look |
| [0005_three_plans.sql](./0005_three_plans.sql) | `tone` and `badge` on `plans` (the card on the pricing page); `watermark` and `allGames` on every plan's features; Free renamed Rookie, with the watermark; Champion seeded |
| [0006_pro_five_a_day.sql](./0006_pro_five_a_day.sql) | Pro at five videos a day; each plan's seeded description replaced by one line on who it is for |

## Rules

- **Never edit a migration that has been applied anywhere.** Add the next number:
  `npx wrangler d1 migrations create bouncereel <snake_name>`.
- **Open every file with a comment block** saying what it changes and why: the reasoning
  is what a later reader cannot recover from the SQL.
- **Fill existing rows in the same migration** that adds a column they need, so no code
  has to cope with a half-migrated table. When they cannot be filled there, say so and say
  who fills them: `videos.user_id` is NULL for the rows from before accounts until the first
  superadmin is made, which claims them (`claimOrphans`); queries scoped to an account never
  see a NULL row meanwhile.
- **The old code runs for a few seconds after the migration**, while the deploy finishes.
  Prefer additive changes; a rename or a dropped column breaks the old Worker's queries
  until the new one is live.
- **Keep a CHECK only where the values are truly closed.** SQLite widens a CHECK only by
  rebuilding the table (and in D1 a rebuild cascades, below): `subscriptions.status` has none,
  since a payment provider brings statuses of its own, nor `plans.tone`, which grows with the
  stylesheet (the Worker checks it against `PLAN_TONES`).
- **Ids that outlive their rows** (`change_log.actor_id`, `user_id`, `plan_id`) have no
  `REFERENCES`, and the tables they point at use AUTOINCREMENT, so an id is never reused.
- After a schema change, update the row types and queries in the Worker
  ([worker/videos.ts](../worker/videos.ts), [worker/plans.ts](../worker/plans.ts),
  [worker/admin.ts](../worker/admin.ts), [worker/auth/store.ts](../worker/auth/store.ts)), the API
  types in [shared/api.ts](../shared/api.ts), and the doc that owns the table.

## ⚠️ D1 is not the `sqlite3` you test with

- **D1 always enforces foreign keys**, in queries and in migrations, and a script cannot
  turn them off (`PRAGMA defer_foreign_keys = on` only postpones the check to the end of
  the transaction). `ON DELETE CASCADE` on `posts`, and from `users` to everything an account
  owns, relies on it.
- So `ALTER TABLE a RENAME TO b` **rewrites the `REFERENCES a` of other tables** in D1,
  while the `sqlite3` CLI (foreign keys off by default) leaves them pointing at a table
  that no longer exists. And `DROP TABLE` deletes its rows first, **cascading**: rebuilding
  `videos` the textbook way would delete every post. Test a migration with
  `npx wrangler d1 migrations apply bouncereel --local`, which behaves like production.
- `ALTER TABLE … ADD COLUMN` with `REFERENCES` must allow NULL (no default): that is why the
  owner columns are nullable.
- Back up `.wrangler/state/v3/d1` before trying a risky migration on the local database. It
  holds Vuk's real videos: delete only rows you made.
