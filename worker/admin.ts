import type { AdminOverview, AdminUser, Role, UserSort, UserStatus } from '../shared/api.ts';
import { IN_FORCE } from './plans.ts';

// The admin area's reads over every account. All counting and filtering happens in SQL: a
// request has 10 ms of CPU, and a loop over every account in JS would not stay inside it for
// long.

interface AdminUserRow {
  id: number;
  email: string;
  role: Role;
  created_at: string;
  last_login_at: string | null;
  email_verified_at: string | null;
  suspended_at: string | null;
  plan_id: number | null;
  plan_name: string | null;
  ends_at: string | null;
  status: UserStatus;
  videos: number;
}

export type AdminUserDetail = AdminUser & { suspendedAt: string | null };

function toAdminUser(row: AdminUserRow): AdminUserDetail {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    planId: row.plan_id,
    planName: row.plan_name,
    status: row.status,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    videos: row.videos,
    verified: row.email_verified_at !== null,
    suspendedAt: row.suspended_at,
  };
}

/**
 * Every account with its subscription and standing at ?1 (the request's time): suspended wins,
 * then a subscription whose end date has passed is `expired`, else its own status. A superadmin
 * has every feature whatever its subscription names, so it is on no plan here and always active:
 * listed as on the default plan, the owner would read as a Rookie and turn up under its filter.
 */
const ACCOUNTS = `SELECT u.id, u.email, u.role, u.created_at, u.last_login_at, u.email_verified_at, u.suspended_at,
    CASE WHEN u.role = 'superadmin' THEN NULL ELSE s.plan_id END AS plan_id,
    CASE WHEN u.role = 'superadmin' THEN NULL ELSE p.name END AS plan_name,
    CASE WHEN u.role = 'superadmin' THEN NULL ELSE s.ends_at END AS ends_at,
    CASE WHEN u.suspended_at IS NOT NULL THEN 'suspended'
         WHEN u.role = 'superadmin' THEN 'active'
         WHEN s.user_id IS NULL OR (s.ends_at IS NOT NULL AND s.ends_at <= ?1) THEN 'expired'
         ELSE s.status END AS status
  FROM users u
  LEFT JOIN subscriptions s ON s.user_id = u.id
  LEFT JOIN plans p ON p.id = s.plan_id`;

const SORTS: Record<UserSort, string> = {
  email: 'email COLLATE NOCASE',
  joined: 'created_at',
  // Never signed in sorts as the oldest.
  lastLogin: "COALESCE(last_login_at, '')",
  videos: 'videos',
  plan: "COALESCE(plan_name, '') COLLATE NOCASE",
  endsAt: "COALESCE(ends_at, '9999')",
};

export interface UserQuery {
  q: string;
  planId: number | null;
  status: UserStatus | null;
  sort: UserSort;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

/** One page of accounts matching the filters, and how many match in all. Two statements, one round trip. */
export async function selectUsers(db: D1Database, query: UserQuery, now: string): Promise<{ users: AdminUser[]; total: number }> {
  // The search is a substring of the address; %, _ and \ in it are taken literally.
  const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const where = `WHERE (?2 = '' OR email LIKE ?3 ESCAPE '\\') AND (?4 IS NULL OR plan_id = ?4) AND (?5 IS NULL OR status = ?5)`;
  const filters = [now, query.q, like, query.planId, query.status];
  const order = `${SORTS[query.sort]} ${query.dir === 'asc' ? 'ASC' : 'DESC'}, id DESC`;
  const [rows, count] = await db.batch<AdminUserRow | { n: number }>([
    db
      .prepare(
        `WITH accounts AS (${ACCOUNTS}), listed AS (SELECT * FROM accounts ${where})
         SELECT listed.*, (SELECT COUNT(*) FROM videos v WHERE v.user_id = listed.id) AS videos
           FROM listed ORDER BY ${order} LIMIT ?6 OFFSET ?7`,
      )
      .bind(...filters, query.pageSize, (query.page - 1) * query.pageSize),
    db.prepare(`WITH accounts AS (${ACCOUNTS}) SELECT COUNT(*) AS n FROM accounts ${where}`).bind(...filters),
  ]);
  return { users: (rows.results as AdminUserRow[]).map(toAdminUser), total: (count.results[0] as { n: number }).n };
}

export async function selectAdminUser(db: D1Database, id: number, now: string): Promise<AdminUserDetail | null> {
  const row = await db
    .prepare(`WITH accounts AS (${ACCOUNTS}) SELECT accounts.*, (SELECT COUNT(*) FROM videos v WHERE v.user_id = accounts.id) AS videos FROM accounts WHERE id = ?2`)
    .bind(now, id)
    .first<AdminUserRow>();
  return row ? toAdminUser(row) : null;
}

/** The overview's numbers: accounts (new in 7 and 30 days), subscriptions per plan (a superadmin's in none), videos. */
export async function selectOverview(db: D1Database, now: Date): Promise<AdminOverview> {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const [users, plans, videos] = await db.batch<Record<string, number | string | null>>([
    db
      .prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(created_at > ?1), 0) AS last7, COALESCE(SUM(created_at > ?2), 0) AS last30,
                COALESCE(SUM(suspended_at IS NOT NULL), 0) AS suspended
           FROM users`,
      )
      .bind(days(7), days(30)),
    db
      .prepare(
        `SELECT p.id, p.name, p.archived_at, COUNT(s.user_id) AS subscribers, COALESCE(SUM(${IN_FORCE}), 0) AS in_force
           FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.user_id IN (SELECT id FROM users WHERE role <> 'superadmin')
          GROUP BY p.id ORDER BY p.archived_at IS NOT NULL, p.sort_order, p.id`,
      )
      .bind(now.toISOString()),
    db.prepare('SELECT COUNT(*) AS n FROM videos'),
  ]);
  const u = users.results[0];
  return {
    users: { total: Number(u.total), last7: Number(u.last7), last30: Number(u.last30), suspended: Number(u.suspended) },
    plans: plans.results.map((p) => ({
      id: Number(p.id),
      name: String(p.name),
      archived: p.archived_at !== null,
      subscribers: Number(p.subscribers),
      inForce: Number(p.in_force),
    })),
    videos: Number(videos.results[0].n),
  };
}

