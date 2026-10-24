import { PLAN_TONES, type AdminPlan, type Day, type LogEntry, type PlanBody, type PlanTone, type Price, type PublicPlan, type Subscription, type SubscriptionStatus } from '../shared/api.ts';
import { EVERYTHING, readFeatures, type Features } from '../shared/features.ts';
import type { AuthUser } from './auth/session.ts';

// Plans, subscriptions and the change log (migrations/0003_plans.sql), and the day of a plan's
// daily allowance (0004_daily_videos.sql): every query, the mappers to the API's shapes, and
// `entitlements`, which works out what an account may do now.

interface PlanRow {
  id: number;
  name: string;
  description: string;
  price_amount: number | null;
  price_currency: string | null;
  price_interval: 'month' | 'year' | null;
  sort_order: number;
  visible: number;
  is_default: number;
  archived_at: string | null;
  features: string;
  tone: string;
  badge: string | null;
  updated_at: string;
}

interface SubscriptionRow {
  user_id: number;
  plan_id: number;
  plan_name: string;
  status: SubscriptionStatus;
  source: string;
  ends_at: string | null;
  updated_at: string;
}

const PLAN_COLUMNS = 'id, name, description, price_amount, price_currency, price_interval, sort_order, visible, is_default, archived_at, features, tone, badge, updated_at';

/**
 * A subscription in force at ?1, over `subscriptions s`: active until its end date if it has one;
 * canceled keeps the plan until its end date, and loses it at once without one.
 */
export const IN_FORCE = `((s.status = 'active' AND (s.ends_at IS NULL OR s.ends_at > ?1)) OR (s.status = 'canceled' AND s.ends_at > ?1))`;

function parseFeatures(json: string): Features {
  try {
    return readFeatures(JSON.parse(json));
  } catch {
    return readFeatures(null);
  }
}

function toPrice(row: PlanRow): Price | null {
  return row.price_amount === null || !row.price_currency ? null : { amount: row.price_amount, currency: row.price_currency, interval: row.price_interval };
}

function toPublicPlan(row: PlanRow): PublicPlan {
  // A tone the code no longer draws reads as plain, as a feature it no longer knows reads as the least.
  const tone = PLAN_TONES.find((t) => t === row.tone) ?? ('plain' satisfies PlanTone);
  return { id: row.id, name: row.name, description: row.description, price: toPrice(row), features: parseFeatures(row.features), isDefault: row.is_default === 1, tone, badge: row.badge };
}

function toAdminPlan(row: PlanRow & { subscribers: number }): AdminPlan {
  return {
    ...toPublicPlan(row),
    sortOrder: row.sort_order,
    visible: row.visible === 1,
    archivedAt: row.archived_at,
    subscribers: row.subscribers,
    updatedAt: row.updated_at,
  };
}

function toSubscription(row: SubscriptionRow): Subscription {
  return { planId: row.plan_id, planName: row.plan_name, status: row.status, source: row.source, endsAt: row.ends_at, updatedAt: row.updated_at };
}

// ── Plans ─────────────────────────────────────────────────────────────────

/** The pricing page: visible plans that are not archived, in their order. */
export async function selectPublicPlans(db: D1Database): Promise<PublicPlan[]> {
  const { results } = await db
    .prepare(`SELECT ${PLAN_COLUMNS} FROM plans WHERE visible = 1 AND archived_at IS NULL ORDER BY sort_order, id`)
    .all<PlanRow>();
  return results.map(toPublicPlan);
}

/** Every plan, archived ones last, with how many subscriptions name it. */
export async function selectPlans(db: D1Database): Promise<AdminPlan[]> {
  const { results } = await db
    .prepare(
      `SELECT ${PLAN_COLUMNS}, (SELECT COUNT(*) FROM subscriptions WHERE plan_id = plans.id) AS subscribers
         FROM plans ORDER BY archived_at IS NOT NULL, sort_order, id`,
    )
    .all<PlanRow & { subscribers: number }>();
  return results.map(toAdminPlan);
}

export async function selectPlan(db: D1Database, id: number): Promise<AdminPlan | null> {
  const row = await db
    .prepare(`SELECT ${PLAN_COLUMNS}, (SELECT COUNT(*) FROM subscriptions WHERE plan_id = plans.id) AS subscribers FROM plans WHERE id = ?1`)
    .bind(id)
    .first<PlanRow & { subscribers: number }>();
  return row ? toAdminPlan(row) : null;
}

/** The plan every new account gets. */
export async function defaultPlan(db: D1Database): Promise<{ id: number; name: string }> {
  const plan = await db.prepare('SELECT id, name FROM plans WHERE is_default = 1').first<{ id: number; name: string }>();
  if (!plan) throw new Error('There is no default plan (plans.is_default): every sign-up needs one');
  return plan;
}

export async function insertPlan(db: D1Database, plan: PlanBody, now: string): Promise<number> {
  const id = await db
    .prepare(
      `INSERT INTO plans (name, description, price_amount, price_currency, price_interval, sort_order, visible, features, tone, badge, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM plans), ?6, ?7, ?9, ?10, ?8, ?8) RETURNING id`,
    )
    .bind(plan.name, plan.description, plan.price?.amount ?? null, plan.price?.currency ?? null, plan.price?.interval ?? null, plan.visible ? 1 : 0, JSON.stringify(plan.features), now, plan.tone, plan.badge)
    .first<number>('id');
  if (id === null) throw new Error('INSERT … RETURNING id returned no plan');
  return id;
}

export function updatePlan(db: D1Database, id: number, plan: PlanBody, now: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE plans SET name = ?2, description = ?3, price_amount = ?4, price_currency = ?5, price_interval = ?6, visible = ?7, features = ?8, updated_at = ?9,
              tone = ?10, badge = ?11
        WHERE id = ?1`,
    )
    .bind(id, plan.name, plan.description, plan.price?.amount ?? null, plan.price?.currency ?? null, plan.price?.interval ?? null, plan.visible ? 1 : 0, JSON.stringify(plan.features), now, plan.tone, plan.badge);
}

export function setPlanArchived(db: D1Database, id: number, archivedAt: string | null, now: string): D1PreparedStatement {
  return db.prepare('UPDATE plans SET archived_at = ?2, updated_at = ?3 WHERE id = ?1').bind(id, archivedAt, now);
}

export function deletePlan(db: D1Database, id: number): D1PreparedStatement {
  return db.prepare('DELETE FROM plans WHERE id = ?1').bind(id);
}

export function setPlanOrder(db: D1Database, ids: number[]): D1PreparedStatement[] {
  return ids.map((id, i) => db.prepare('UPDATE plans SET sort_order = ?2 WHERE id = ?1').bind(id, i + 1));
}

/** The plan as the log keeps it: everything an admin can edit. */
export function planSnapshot(plan: PublicPlan & { visible?: boolean; archivedAt?: string | null }): Record<string, unknown> {
  return { name: plan.name, description: plan.description, price: plan.price, visible: plan.visible, archivedAt: plan.archivedAt, tone: plan.tone, badge: plan.badge, features: plan.features };
}

// ── Subscriptions ─────────────────────────────────────────────────────────

const SUBSCRIPTION_SELECT = `SELECT s.user_id, s.plan_id, p.name AS plan_name, s.status, s.source, s.ends_at, s.updated_at
  FROM subscriptions s JOIN plans p ON p.id = s.plan_id`;

export async function selectSubscription(db: D1Database, userId: number): Promise<Subscription | null> {
  const row = await db.prepare(`${SUBSCRIPTION_SELECT} WHERE s.user_id = ?1`).bind(userId).first<SubscriptionRow>();
  return row ? toSubscription(row) : null;
}

/** A new account's subscription: active, with no end; one it already has stays as it is. */
export function insertSubscription(db: D1Database, userId: number, planId: number, now: string, actorId: number | null): D1PreparedStatement {
  return db
    .prepare('INSERT INTO subscriptions (user_id, plan_id, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id) DO NOTHING')
    .bind(userId, planId, now, actorId);
}

export function updateSubscription(
  db: D1Database,
  userId: number,
  next: { planId: number; status: SubscriptionStatus; endsAt: string | null },
  now: string,
  actorId: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE subscriptions SET plan_id = ?2, status = ?3, ends_at = ?4, source = 'manual', updated_at = ?5, updated_by = ?6 WHERE user_id = ?1`,
    )
    .bind(userId, next.planId, next.status, next.endsAt, now, actorId);
}

export interface Entitlements {
  plan: { id: number; name: string };
  subscription: Subscription | null;
  features: Features;
}

/**
 * What an account may do at `now`: its subscription's plan while that is in force (IN_FORCE),
 * the default plan once it is not, everything for a superadmin. Two reads in one round trip.
 */
export async function entitlements(db: D1Database, user: AuthUser, now: Date): Promise<Entitlements> {
  const at = now.toISOString();
  const [subscription, plan] = await db.batch<SubscriptionRow | (PlanRow & { id: number })>([
    db.prepare(`${SUBSCRIPTION_SELECT} WHERE s.user_id = ?1`).bind(user.id),
    db
      .prepare(
        `SELECT ${PLAN_COLUMNS} FROM plans WHERE id = COALESCE(
           (SELECT s.plan_id FROM subscriptions s WHERE s.user_id = ?2 AND ${IN_FORCE}),
           (SELECT id FROM plans WHERE is_default = 1))`,
      )
      .bind(at, user.id),
  ]);
  const sub = subscription.results[0] as SubscriptionRow | undefined;
  const row = plan.results[0] as PlanRow | undefined;
  if (!row) throw new Error('There is no default plan (plans.is_default)');
  return {
    plan: { id: row.id, name: row.name },
    subscription: sub ? toSubscription(sub) : null,
    features: user.role === 'superadmin' ? EVERYTHING : parseFeatures(row.features),
  };
}

// ── The daily allowance ───────────────────────────────────────────────────

/**
 * The day of the daily allowance (`perDay`) at `now`: the calendar day in UTC, from midnight to
 * midnight. One clock for everyone, so the allowance comes back at the same moment worldwide
 * (01:00 or 02:00 in Serbia) and the pages can say exactly when.
 */
function utcDay(now: Date): { start: string; end: string } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: new Date(start).toISOString(), end: new Date(start + 24 * 60 * 60_000).toISOString() };
}

/** The account's day at `now`, against the plan's daily `limit`. */
export async function selectDay(db: D1Database, userId: number, limit: number | null, now: Date): Promise<Day> {
  const row = await db
    .prepare('SELECT day_started_at, day_videos FROM users WHERE id = ?1')
    .bind(userId)
    .first<{ day_started_at: string | null; day_videos: number }>();
  const day = utcDay(now);
  // The columns hold the day of the account's last video: today's, or one that has passed.
  const today = row?.day_started_at != null && row.day_started_at >= day.start;
  return { used: today ? row!.day_videos : 0, limit, endsAt: today ? day.end : null };
}

/**
 * Takes one of today's videos (the UTC day), or answers false when the plan's daily `limit` has
 * none left. One statement, so two tabs saving at once cannot both take the last one; the first
 * video of a new day starts its count at 1. Without a limit it counts all the same, so an
 * account that changes plan mid-day finds the day as it is.
 */
export async function claimDay(db: D1Database, userId: number, limit: number | null, now: Date): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE users SET
         day_videos     = CASE WHEN day_started_at IS NULL OR day_started_at < ?2 THEN 1 ELSE day_videos + 1 END,
         day_started_at = CASE WHEN day_started_at IS NULL OR day_started_at < ?2 THEN ?3 ELSE day_started_at END
       WHERE id = ?1 AND (?4 IS NULL OR day_started_at IS NULL OR day_started_at < ?2 OR day_videos < ?4)`,
    )
    .bind(userId, utcDay(now).start, now.toISOString(), limit)
    .run();
  return result.meta.changes === 1;
}

// ── The change log ────────────────────────────────────────────────────────

export interface Change {
  at: string;
  actorId: number | null;
  subject: LogEntry['subject'];
  userId?: number | null;
  planId?: number | null;
  action: string;
  before?: unknown;
  after?: unknown;
}

/** Appends one line. Batched with the change it records, so neither lands without the other. */
export function logChange(db: D1Database, change: Change): D1PreparedStatement {
  return db
    .prepare('INSERT INTO change_log (at, actor_id, subject, user_id, plan_id, action, before, after) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
    .bind(
      change.at,
      change.actorId,
      change.subject,
      change.userId ?? null,
      change.planId ?? null,
      change.action,
      change.before === undefined ? null : JSON.stringify(change.before),
      change.after === undefined ? null : JSON.stringify(change.after),
    );
}

interface LogRow {
  id: number;
  at: string;
  actor_id: number | null;
  actor_email: string | null;
  subject: LogEntry['subject'];
  user_id: number | null;
  user_email: string | null;
  plan_id: number | null;
  plan_name: string | null;
  action: string;
  before: string | null;
  after: string | null;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toLogEntry(row: LogRow): LogEntry {
  return {
    id: row.id,
    at: row.at,
    actor: row.actor_id === null ? null : { id: row.actor_id, email: row.actor_email },
    subject: row.subject,
    user: row.user_id === null ? null : { id: row.user_id, email: row.user_email },
    plan: row.plan_id === null ? null : { id: row.plan_id, name: row.plan_name },
    action: row.action,
    before: parseJson(row.before),
    after: parseJson(row.after),
  };
}

const LOG_SELECT = `SELECT l.id, l.at, l.actor_id, a.email AS actor_email, l.subject, l.user_id, u.email AS user_email,
    l.plan_id, p.name AS plan_name, l.action, l.before, l.after
  FROM change_log l
  LEFT JOIN users a ON a.id = l.actor_id
  LEFT JOIN users u ON u.id = l.user_id
  LEFT JOIN plans p ON p.id = l.plan_id`;

/** The log, newest first, a page at a time; with `userId`, only the lines about that account. */
export async function selectLog(db: D1Database, page: number, pageSize: number, userId: number | null = null): Promise<{ entries: LogEntry[]; total: number }> {
  const where = userId === null ? '' : 'WHERE l.user_id = ?3';
  const [rows, count] = await db.batch<LogRow | { n: number }>([
    db.prepare(`${LOG_SELECT} ${where} ORDER BY l.id DESC LIMIT ?1 OFFSET ?2`).bind(pageSize, (page - 1) * pageSize, ...(userId === null ? [] : [userId])),
    db.prepare(`SELECT COUNT(*) AS n FROM change_log l ${userId === null ? '' : 'WHERE l.user_id = ?1'}`).bind(...(userId === null ? [] : [userId])),
  ]);
  return { entries: (rows.results as LogRow[]).map(toLogEntry), total: (count.results[0] as { n: number }).n };
}
