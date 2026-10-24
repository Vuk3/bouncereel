import {
  PLAN_TONES,
  PRICE_INTERVALS,
  SUBSCRIPTION_STATUSES,
  USER_SORTS,
  type AdminPlansResponse,
  type AdminUserResponse,
  type AdminUsersResponse,
  type LogResponse,
  type MailResult,
  type PlanBody,
  type Price,
  type Subscription,
  type SubscriptionStatus,
  type UserStatus,
} from '../../shared/api.ts';
import { featuresProblem, readFeatures } from '../../shared/features.ts';
import { countActiveSuperadmins, deleteUser, deleteUserSessions, findUserById, setSuspended } from '../auth/store.ts';
import { selectAdminUser, selectOverview, selectUsers } from '../admin.ts';
import { HttpError, json, noContent, readJsonObject } from '../lib/http.ts';
import {
  deletePlan,
  insertPlan,
  logChange,
  planSnapshot,
  selectLog,
  selectPlan,
  selectPlans,
  selectSubscription,
  setPlanArchived,
  setPlanOrder,
  updatePlan,
  updateSubscription,
} from '../plans.ts';
import { idParam } from '../validate.ts';
import { selectVideos } from '../videos.ts';
import { sendReset } from './auth.ts';
import { signedIn, type RouteContext } from './context.ts';

// The admin area's API, /api/admin/*. The router has checked the superadmin role before any of
// these is even matched. Every change to a subscription, a plan or an account's standing is
// written to the change log in the same batch as the change itself.

const PAGE_SIZE = 50;
const STATUSES: UserStatus[] = [...SUBSCRIPTION_STATUSES, 'expired', 'suspended'];

function pageParam(url: URL): number {
  const page = Number(url.searchParams.get('page') ?? '1');
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function invalid(field: string, message: string): HttpError {
  return new HttpError(400, `invalid_${field}`, message);
}

function noUser(id: number): HttpError {
  return new HttpError(404, 'user_not_found', `There is no account ${id}.`);
}

function noPlan(id: number): HttpError {
  return new HttpError(404, 'plan_not_found', `There is no plan ${id}.`);
}

/** GET /api/admin/overview */
export async function overview({ env, now }: RouteContext): Promise<Response> {
  return json(await selectOverview(env.DB, now));
}

// ── Accounts ──────────────────────────────────────────────────────────────

/** GET /api/admin/users?q=&plan=&status=&sort=&dir=&page= */
export async function listUsers({ env, url, now }: RouteContext): Promise<Response> {
  const p = url.searchParams;
  const plan = Number(p.get('plan'));
  const status = STATUSES.find((s) => s === p.get('status')) ?? null;
  const sort = USER_SORTS.find((s) => s === p.get('sort')) ?? 'joined';
  const page = pageParam(url);
  const { users, total } = await selectUsers(
    env.DB,
    {
      q: (p.get('q') ?? '').trim().slice(0, 200),
      planId: Number.isSafeInteger(plan) && plan > 0 ? plan : null,
      status,
      sort,
      dir: p.get('dir') === 'asc' ? 'asc' : 'desc',
      page,
      pageSize: PAGE_SIZE,
    },
    now.toISOString(),
  );
  const body: AdminUsersResponse = { users, total, page, pageSize: PAGE_SIZE };
  return json(body);
}

/** GET /api/admin/users/:id: the account, its subscription and history, its videos (read-only). */
export async function getUser({ env, params, now }: RouteContext): Promise<Response> {
  const id = idParam(params);
  const [user, subscription, history, videos] = await Promise.all([
    selectAdminUser(env.DB, id, now.toISOString()),
    selectSubscription(env.DB, id),
    selectLog(env.DB, 1, 100, id),
    selectVideos(env.DB, id),
  ]);
  if (!user) throw noUser(id);
  const body: AdminUserResponse = { user, subscription, history: history.entries, videos };
  return json(body);
}

function snapshot(s: Subscription): Record<string, unknown> {
  return { planId: s.planId, plan: s.planName, status: s.status, endsAt: s.endsAt };
}

/**
 * PUT /api/admin/users/:id/subscription { planId?, endsAt?, status? }: change the plan, set or
 * clear the end date, cancel or reactivate. What is not sent stays as it is.
 */
export async function putSubscription(context: RouteContext): Promise<Response> {
  const admin = signedIn(context);
  const { env, request, params, now } = context;
  const id = idParam(params);
  const body = await readJsonObject(request);
  const current = await selectSubscription(env.DB, id);
  if (!current) throw noUser(id);

  let planId = current.planId;
  let planName = current.planName;
  if (body.planId !== undefined) {
    const plan = typeof body.planId === 'number' ? await selectPlan(env.DB, body.planId) : null;
    if (!plan) throw invalid('plan', 'planId must name a plan.');
    // An archived plan is kept by those who have it, and given to nobody new.
    if (plan.archivedAt && plan.id !== current.planId) throw new HttpError(409, 'plan_archived', `${plan.name} is archived: restore it first.`);
    planId = plan.id;
    planName = plan.name;
  }
  let endsAt = current.endsAt;
  if (body.endsAt !== undefined) {
    if (body.endsAt === null) endsAt = null;
    else if (typeof body.endsAt === 'string' && !Number.isNaN(Date.parse(body.endsAt))) endsAt = new Date(body.endsAt).toISOString();
    else throw invalid('ends_at', 'endsAt must be an ISO 8601 time, or null for no end.');
  }
  let status: SubscriptionStatus = current.status;
  if (body.status !== undefined) {
    const next = SUBSCRIPTION_STATUSES.find((s) => s === body.status);
    if (!next) throw invalid('status', `status must be one of ${SUBSCRIPTION_STATUSES.join(', ')}.`);
    status = next;
  }

  const nowIso = now.toISOString();
  await env.DB.batch([
    updateSubscription(env.DB, id, { planId, status, endsAt }, nowIso, admin.id),
    logChange(env.DB, {
      at: nowIso,
      actorId: admin.id,
      subject: 'subscription',
      userId: id,
      planId,
      action: 'changed',
      before: snapshot(current),
      after: { planId, plan: planName, status, endsAt },
    }),
  ]);
  return json({ subscription: await selectSubscription(env.DB, id) });
}

/** The account a superadmin acts on, refusing what would leave the site without a superadmin. */
async function target(context: RouteContext, what: string) {
  const id = idParam(context.params);
  const user = await findUserById(context.env.DB, id);
  if (!user) throw noUser(id);
  if (user.id === signedIn(context).id) throw new HttpError(409, 'cannot_change_self', `You cannot ${what} your own account here.`);
  if (user.role === 'superadmin' && !user.suspended_at && (await countActiveSuperadmins(context.env.DB)) <= 1) {
    throw new HttpError(409, 'last_superadmin', `The last superadmin cannot be ${what === 'delete' ? 'deleted' : 'suspended'}.`);
  }
  return user;
}

/** POST /api/admin/users/:id/suspend: it cannot sign in, and every session of it ends now. */
export async function suspendUser(context: RouteContext): Promise<Response> {
  const user = await target(context, 'suspend');
  const { env, now } = context;
  if (user.suspended_at) return noContent();
  const nowIso = now.toISOString();
  await env.DB.batch([
    setSuspended(env.DB, user.id, nowIso),
    deleteUserSessions(env.DB, user.id),
    logChange(env.DB, { at: nowIso, actorId: signedIn(context).id, subject: 'account', userId: user.id, action: 'suspended' }),
  ]);
  return noContent();
}

/** POST /api/admin/users/:id/unsuspend */
export async function unsuspendUser(context: RouteContext): Promise<Response> {
  const id = idParam(context.params);
  const user = await findUserById(context.env.DB, id);
  if (!user) throw noUser(id);
  if (!user.suspended_at) return noContent();
  const nowIso = context.now.toISOString();
  await context.env.DB.batch([
    setSuspended(context.env.DB, id, null),
    logChange(context.env.DB, { at: nowIso, actorId: signedIn(context).id, subject: 'account', userId: id, action: 'unsuspended' }),
  ]);
  return noContent();
}

/** POST /api/admin/users/:id/reset: mails the account a password link. The link itself is never shown here. */
export async function sendUserReset(context: RouteContext): Promise<Response> {
  const id = idParam(context.params);
  const user = await findUserById(context.env.DB, id);
  if (!user) throw noUser(id);
  if (user.suspended_at) throw new HttpError(409, 'account_suspended', 'Unsuspend the account first: a suspended account cannot sign in.');
  const mail: MailResult = await sendReset(context, user, true);
  return json({ mail });
}

/**
 * DELETE /api/admin/users/:id { confirm }: deletes the account and everything it made.
 * `confirm` must be the account's address, typed by hand in the admin area.
 */
export async function removeUser(context: RouteContext): Promise<Response> {
  const user = await target(context, 'delete');
  const { confirm } = await readJsonObject(context.request);
  if (typeof confirm !== 'string' || confirm.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw invalid('confirm', 'Type the account’s email address to delete it.');
  }
  const nowIso = context.now.toISOString();
  await context.env.DB.batch([
    logChange(context.env.DB, { at: nowIso, actorId: signedIn(context).id, subject: 'account', userId: user.id, action: 'deleted by a superadmin' }),
    deleteUser(context.env.DB, user.id),
  ]);
  return noContent();
}

// ── Plans ─────────────────────────────────────────────────────────────────

/** GET /api/admin/plans: every plan, archived ones last, with its subscriber count. */
export async function listAdminPlans({ env }: RouteContext): Promise<Response> {
  const body: AdminPlansResponse = { plans: await selectPlans(env.DB) };
  return json(body);
}

function priceValue(value: unknown): Price | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('price', 'price must be an object or null.');
  const p = value as Record<string, unknown>;
  if (typeof p.amount !== 'number' || !Number.isInteger(p.amount) || p.amount < 0 || p.amount > 10_000_000) {
    throw invalid('price', 'price.amount must be a whole number of cents.');
  }
  if (typeof p.currency !== 'string' || !/^[A-Za-z]{3}$/.test(p.currency)) throw invalid('price', 'price.currency must be a three-letter code: EUR, USD.');
  const interval = p.interval ?? null;
  if (interval !== null && !PRICE_INTERVALS.some((i) => i === interval)) throw invalid('price', 'price.interval must be month, year or null.');
  return { amount: p.amount, currency: p.currency.toUpperCase(), interval: interval as Price['interval'] };
}

function planBody(body: Record<string, unknown>): PlanBody {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 60) throw invalid('name', 'A plan needs a name of 1 to 60 characters.');
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > 300) throw invalid('description', 'The description is 300 characters at most.');
  if (typeof body.visible !== 'boolean') throw invalid('visible', 'visible must be true or false.');
  const tone = PLAN_TONES.find((t) => t === body.tone);
  if (!tone) throw invalid('tone', `tone must be one of ${PLAN_TONES.join(', ')}.`);
  const badge = typeof body.badge === 'string' ? body.badge.trim() : '';
  if (badge.length > 24) throw invalid('badge', 'The badge is 24 characters at most: a word or two.');
  const problem = featuresProblem(body.features);
  if (problem) throw invalid('features', `features: ${problem}.`);
  return { name, description, price: priceValue(body.price), visible: body.visible, tone, badge: badge || null, features: readFeatures(body.features) };
}

/** POST /api/admin/plans: a new plan, last in the order. */
export async function createPlan(context: RouteContext): Promise<Response> {
  const { env, request, now } = context;
  const plan = planBody(await readJsonObject(request));
  const nowIso = now.toISOString();
  const id = await insertPlan(env.DB, plan, nowIso);
  await logChange(env.DB, { at: nowIso, actorId: signedIn(context).id, subject: 'plan', planId: id, action: 'created', after: planSnapshot({ ...plan, id, isDefault: false }) }).run();
  return json({ plan: await selectPlan(env.DB, id) }, 201);
}

/** PUT /api/admin/plans/:id: name, words, price, visibility and features. */
export async function editPlan(context: RouteContext): Promise<Response> {
  const { env, request, params, now } = context;
  const id = idParam(params);
  const before = await selectPlan(env.DB, id);
  if (!before) throw noPlan(id);
  const plan = planBody(await readJsonObject(request));
  if (before.isDefault && !plan.visible) throw new HttpError(409, 'default_plan', 'The plan every new account gets stays on the pricing page.');
  const nowIso = now.toISOString();
  await env.DB.batch([
    updatePlan(env.DB, id, plan, nowIso),
    logChange(env.DB, { at: nowIso, actorId: signedIn(context).id, subject: 'plan', planId: id, action: 'edited', before: planSnapshot(before), after: planSnapshot({ ...before, ...plan }) }),
  ]);
  return json({ plan: await selectPlan(env.DB, id) });
}

async function archive(context: RouteContext, archived: boolean): Promise<Response> {
  const { env, params, now } = context;
  const id = idParam(params);
  const plan = await selectPlan(env.DB, id);
  if (!plan) throw noPlan(id);
  if (plan.isDefault && archived) throw new HttpError(409, 'default_plan', 'The plan every new account gets cannot be archived.');
  const nowIso = now.toISOString();
  await env.DB.batch([
    setPlanArchived(env.DB, id, archived ? nowIso : null, nowIso),
    logChange(env.DB, { at: nowIso, actorId: signedIn(context).id, subject: 'plan', planId: id, action: archived ? 'archived' : 'restored' }),
  ]);
  return json({ plan: await selectPlan(env.DB, id) });
}

/** POST /api/admin/plans/:id/archive: off the pricing page and out of reach for new subscriptions; kept by its subscribers. */
export const archivePlan = (context: RouteContext) => archive(context, true);
/** POST /api/admin/plans/:id/restore */
export const restorePlan = (context: RouteContext) => archive(context, false);

/** DELETE /api/admin/plans/:id: only a plan nobody has; one with subscribers is archived instead. */
export async function removePlan(context: RouteContext): Promise<Response> {
  const { env, params, now } = context;
  const id = idParam(params);
  const plan = await selectPlan(env.DB, id);
  if (!plan) throw noPlan(id);
  if (plan.isDefault) throw new HttpError(409, 'default_plan', 'The plan every new account gets cannot be deleted.');
  if (plan.subscribers > 0) {
    throw new HttpError(409, 'plan_has_subscribers', `${plan.subscribers} account${plan.subscribers === 1 ? ' has' : 's have'} this plan: archive it instead.`);
  }
  const nowIso = now.toISOString();
  await env.DB.batch([
    logChange(env.DB, { at: nowIso, actorId: signedIn(context).id, subject: 'plan', planId: id, action: 'deleted', before: planSnapshot(plan) }),
    deletePlan(env.DB, id),
  ]);
  return noContent();
}

/** POST /api/admin/plans/order { ids }: every plan's id, each once, in the new order. */
export async function reorderPlans(context: RouteContext): Promise<Response> {
  const { env, request, now } = context;
  const { ids } = await readJsonObject(request);
  const plans = await selectPlans(env.DB);
  const known = new Set(plans.map((p) => p.id));
  if (!Array.isArray(ids) || ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((id) => known.has(id as number))) {
    throw invalid('order', 'ids must list every plan exactly once.');
  }
  const nowIso = now.toISOString();
  await env.DB.batch([
    ...setPlanOrder(env.DB, ids as number[]),
    logChange(env.DB, { at: nowIso, actorId: signedIn(context).id, subject: 'plan', action: 'reordered', before: plans.map((p) => p.id), after: ids }),
  ]);
  const body: AdminPlansResponse = { plans: await selectPlans(env.DB) };
  return json(body);
}

// ── The log ───────────────────────────────────────────────────────────────

/** GET /api/admin/log?page=: every change, newest first. */
export async function getLog({ env, url }: RouteContext): Promise<Response> {
  const page = pageParam(url);
  const { entries, total } = await selectLog(env.DB, page, PAGE_SIZE);
  const body: LogResponse = { entries, total, page, pageSize: PAGE_SIZE };
  return json(body);
}
