import type { AccountResponse, DayResponse } from '../../shared/api.ts';
import { hashPassword, verifyPassword } from '../auth/crypto.ts';
import { clearSessionCookies, sessionTokenHash } from '../auth/session.ts';
import { countActiveSuperadmins, deleteUser, deleteUserSessions, setPassword, throttleCount, throttleHit } from '../auth/store.ts';
import { BILLING } from './billing.ts';
import { HttpError, json, noContent, readJsonObject } from '../lib/http.ts';
import { claimDay, entitlements, logChange, selectDay } from '../plans.ts';
import { countVideos } from '../videos.ts';
import { passwordValue } from '../validate.ts';
import { accountRow, sendVerification } from './auth.ts';
import { signedIn, type RouteContext } from './context.ts';

// The signed-in account's own page (/account) and what the studio needs to know about it.

/** Confirmation mails from the banner: three an hour, so the button cannot fill an inbox. */
const VERIFY_WINDOW = 60 * 60_000;
const VERIFY_PER_HOUR = 3;

/** GET /api/account: the account, its plan, what it may do now, how full its library and its day are. */
export async function getAccount(context: RouteContext): Promise<Response> {
  const user = signedIn(context);
  const { env, now } = context;
  const [plan, count] = await Promise.all([entitlements(env.DB, user, now), countVideos(env.DB, user.id)]);
  const day = await selectDay(env.DB, user.id, plan.features.perDay, now);
  const body: AccountResponse = {
    account: { id: user.id, email: user.email, role: user.role, verified: user.verified, createdAt: user.createdAt },
    plan: plan.plan,
    subscription: plan.subscription,
    features: plan.features,
    library: { count, limit: plan.features.library },
    day,
    billing: BILLING,
  };
  return json(body);
}

/**
 * POST /api/account/day: takes one of today's videos as a recording starts, before its first frame
 * (src/app.ts record). The day is counted here and nowhere else, so a second tab, or a page whose
 * save never arrives, cannot make one more; what goes into the library afterwards is the library's
 * own count. Answers the day as it now stands.
 */
export async function takeVideo(context: RouteContext): Promise<Response> {
  const user = signedIn(context);
  const { env, now } = context;
  const { features } = await entitlements(env.DB, user, now);
  if (!(await claimDay(env.DB, user.id, features.perDay, now))) {
    const limit = features.perDay ?? 0;
    throw new HttpError(403, 'day_used', `Your plan makes ${limit} video${limit === 1 ? '' : 's'} a day, and you have made today's.`);
  }
  const body: DayResponse = { day: await selectDay(env.DB, user.id, features.perDay, now) };
  return json(body);
}

async function checkPassword(context: RouteContext, password: unknown): Promise<void> {
  const row = await accountRow(context.env, signedIn(context));
  if (typeof password !== 'string' || !(await verifyPassword(password, row.password_hash))) {
    throw new HttpError(403, 'wrong_password', 'That is not your current password.');
  }
}

/**
 * POST /api/account/password { current, password }: checks the current password, sets the new
 * one and signs out every other browser. Two hashes in one request: the reason for crypto.ts's
 * iteration count.
 */
export async function changePassword(context: RouteContext): Promise<Response> {
  const user = signedIn(context);
  const body = await readJsonObject(context.request);
  const password = passwordValue(body.password);
  await checkPassword(context, body.current);
  const keep = await sessionTokenHash(context.request);
  await context.env.DB.batch([setPassword(context.env.DB, user.id, await hashPassword(password)), deleteUserSessions(context.env.DB, user.id, keep)]);
  return json({ ok: true });
}

/** POST /api/account/verify: the confirmation mail again, from the banner. */
export async function resendVerification(context: RouteContext): Promise<Response> {
  const user = signedIn(context);
  if (user.verified) return json({ ok: true, verified: true });
  const { env, now } = context;
  const key = `verify:user:${user.id}`;
  const windowStart = new Date(now.getTime() - VERIFY_WINDOW).toISOString();
  if ((await throttleCount(env.DB, [key], windowStart)) >= VERIFY_PER_HOUR) {
    throw new HttpError(429, 'too_many_attempts', 'Three mails an hour at most. Check your spam folder, or try again later.', { 'Retry-After': '3600' });
  }
  await throttleHit(env.DB, key, now.toISOString(), windowStart).run();
  await sendVerification(context, user);
  return json({ ok: true, verified: false });
}

/** POST /api/account/logout-everywhere: ends every session of the account, this one too. */
export async function logoutEverywhere(context: RouteContext): Promise<Response> {
  const user = signedIn(context);
  await deleteUserSessions(context.env.DB, user.id).run();
  return json({ ok: true }, 200, clearSessionCookies(context.url));
}

/**
 * DELETE /api/account { password }: the account and everything it made (videos, links,
 * subscription, sessions) go at once. The last superadmin cannot leave.
 */
export async function deleteAccount(context: RouteContext): Promise<Response> {
  const user = signedIn(context);
  const body = await readJsonObject(context.request);
  await checkPassword(context, body.password);
  const { env, now } = context;
  if (user.role === 'superadmin' && (await countActiveSuperadmins(env.DB)) <= 1) {
    throw new HttpError(409, 'last_superadmin', 'The last superadmin cannot delete their account.');
  }
  await env.DB.batch([
    logChange(env.DB, { at: now.toISOString(), actorId: user.id, subject: 'account', userId: user.id, action: 'deleted by its owner' }),
    deleteUser(env.DB, user.id),
  ]);
  const response = noContent();
  for (const [name, value] of clearSessionCookies(context.url)) response.headers.append(name, value);
  return response;
}

