import type { MailResult, ResetInfo, SignedInResponse, VerifiedResponse } from '../../shared/api.ts';
import { GOOGLE_LOGIN, SIGNUPS_OPEN, safeNext } from '../../shared/site.ts';
import { DUMMY_PASSWORD_HASH, hashPassword, randomToken, sha256Hex, verifyPassword } from '../auth/crypto.ts';
import { authorizeUrl, exchangeCode, pkceChallenge, type GoogleProfile } from '../auth/google.ts';
import { clearSessionCookies, sessionTokenHash, startSession, type AuthUser } from '../auth/session.ts';
import {
  claimOrphans,
  claimToken,
  clearThrottle,
  deleteSession,
  deleteUserSessions,
  findOpenToken,
  findUserByEmail,
  findUserByGoogleSub,
  findUserById,
  insertGoogleUser,
  insertToken,
  insertUser,
  linkGoogle,
  markVerified,
  purgeThrottle,
  setAvatarKey,
  setPassword,
  throttleCount,
  throttleHit,
  toAccount,
  upsertSuperadmin,
  type TokenPurpose,
  type UserRow,
} from '../auth/store.ts';
import { importGoogleAvatar } from '../files.ts';
import { HttpError, json, readJsonObject } from '../lib/http.ts';
import { errorFields, log } from '../lib/log.ts';
import { deliver } from '../mail/resend.ts';
import { resetMail, verifyMail } from '../mail/templates.ts';
import { defaultPlan, insertSubscription, logChange } from '../plans.ts';
import { isLocal, siteOrigin } from '../site.ts';
import { emailValue, linkInvalid, passwordValue, tokenValue } from '../validate.ts';
import type { RouteContext } from './context.ts';

// Everything that happens before there is a session: signing up, in and out, a forgotten
// password, and the links in mails. The public part of the API (router.ts PUBLIC).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Failed logins, as Hoops counts them: per address and per IP, over a sliding 15 minutes. */
const LOGIN_WINDOW = 15 * MINUTE;
const LOGIN_PER_EMAIL = 5;
const LOGIN_PER_IP = 20;
/** Sign-ups per IP an hour: enough for a family behind one router, too few for a script. */
const SIGNUP_WINDOW = HOUR;
const SIGNUP_PER_IP = 5;
/** Google sign-ins coming back, per IP: each costs a call to Google; a person needs a few. */
const GOOGLE_WINDOW = 15 * MINUTE;
const GOOGLE_PER_IP = 20;
/** Long enough to choose a Google account and say yes, short enough that a stale one is no use. */
const GOOGLE_COOKIE_SECONDS = 600;
/** Password mails: three an hour to one address, so the button cannot fill an inbox. */
const FORGOT_WINDOW = HOUR;
const FORGOT_PER_EMAIL = 3;
const FORGOT_PER_IP = 10;

const VERIFY_DAYS = 7;
const RESET_MS = HOUR;

/**
 * Counters older than a day count nothing, and they hold IP addresses: every write clears them
 * (there is no cron to do it on a schedule), so none outlives the next attempt by much.
 */
function dayAgo(now: Date): string {
  return new Date(now.getTime() - 86_400_000).toISOString();
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

function tooMany(windowMs: number, what: string): HttpError {
  return new HttpError(429, 'too_many_attempts', `Too many ${what}. Try again in ${Math.round(windowMs / MINUTE)} minutes.`, {
    'Retry-After': String(windowMs / 1000),
  });
}

async function checkThrottle(db: D1Database, limits: [key: string, max: number][], windowStart: string, windowMs: number, what: string): Promise<void> {
  const counts = await Promise.all(limits.map(([key]) => throttleCount(db, [key], windowStart)));
  if (counts.some((n, i) => n >= limits[i][1])) throw tooMany(windowMs, what);
}

function suspended(): HttpError {
  return new HttpError(403, 'account_suspended', `This account is suspended. Write to us if you think that is a mistake.`);
}

/** A one-time link to `path` on the site, and its hash for the database. */
async function oneTimeLink(env: Env, url: URL, path: string): Promise<{ link: string; hash: string }> {
  const token = randomToken();
  return { link: `${siteOrigin(env, url)}${path}?token=${token}`, hash: await sha256Hex(token) };
}

/**
 * Stores a one-time link for the account and mails it. By default the mail goes out after the
 * answer (ctx.waitUntil), so neither sign-up nor the forgot form waits on Resend, and the form's
 * answer takes as long whether the address has an account or not; `wait` is for the admin area,
 * which reports whether the mail went.
 */
async function sendLink(
  context: RouteContext,
  user: { id: number; email: string },
  purpose: 'verify' | 'reset',
  wait: boolean,
): Promise<MailResult | null> {
  const { env, url, ctx, now } = context;
  const { link, hash } = await oneTimeLink(env, url, `/${purpose}`);
  const expiresAt = new Date(now.getTime() + (purpose === 'verify' ? VERIFY_DAYS * 86_400_000 : RESET_MS)).toISOString();
  await env.DB.batch(insertToken(env.DB, { hash, purpose, email: user.email, userId: user.id, now: now.toISOString(), expiresAt }));
  const mail = purpose === 'verify' ? verifyMail(user.email, link) : resetMail(user.email, link);
  const sending = deliver(env, url, { to: user.email, ref: `${purpose}-${hash.slice(0, 16)}`, link, ...mail });
  if (wait) return sending;
  ctx.waitUntil(sending);
  return null;
}

/** The confirmation link (7 days), after sign-up or from the banner. */
export async function sendVerification(context: RouteContext, user: { id: number; email: string }): Promise<void> {
  await sendLink(context, user, 'verify', false);
}

/** A one-hour password link: the forgot form, or the admin's button (`wait`, to say whether it went). */
export async function sendReset(context: RouteContext, user: { id: number; email: string }, wait: true): Promise<MailResult>;
export async function sendReset(context: RouteContext, user: { id: number; email: string }): Promise<void>;
export async function sendReset(context: RouteContext, user: { id: number; email: string }, wait = false): Promise<MailResult | void> {
  const result = await sendLink(context, user, 'reset', wait);
  return result ?? undefined;
}

function signedIn(row: UserRow, cookies: [string, string][]): Response {
  const body: SignedInResponse = { account: toAccount(row) };
  return json(body, 200, cookies);
}

/** POST /api/auth/signup { email, password }: a new account on the default plan, signed in at once. */
export async function signup(context: RouteContext): Promise<Response> {
  // Closed before anything is read or counted: the pages offer no form then, so a request here
  // came from outside them.
  if (!SIGNUPS_OPEN) throw new HttpError(403, 'signups_closed', 'Sign-ups are closed for now: BounceReel opens soon.');
  const { request, env, url, now } = context;
  const body = await readJsonObject(request);
  const email = emailValue(body.email);
  const password = passwordValue(body.password);
  const nowIso = now.toISOString();
  const windowStart = new Date(now.getTime() - SIGNUP_WINDOW).toISOString();
  const ipKey = `signup:ip:${clientIp(request)}`;
  await checkThrottle(env.DB, [[ipKey, SIGNUP_PER_IP]], windowStart, SIGNUP_WINDOW, 'sign-ups from this network');
  // Every attempt counts, taken addresses too: that is what slows a script testing addresses.
  await env.DB.batch([throttleHit(env.DB, ipKey, nowIso, windowStart), purgeThrottle(env.DB, dayAgo(now))]);

  if (await findUserByEmail(env.DB, email)) {
    throw new HttpError(409, 'email_taken', 'There is already an account with this email. Sign in, or reset the password.');
  }
  const passwordHash = await hashPassword(password);
  const user = await insertUser(env.DB, email, passwordHash, nowIso).first<UserRow>();
  if (!user) throw new Error('INSERT … RETURNING returned no account');
  await startOnDefaultPlan(env.DB, user, nowIso);
  await sendVerification(context, user);
  return signedIn(user, await startSession(env.DB, user.id, url, now));
}

/** A new account's subscription, on the default plan, and its line in the change log. */
async function startOnDefaultPlan(db: D1Database, user: UserRow, nowIso: string): Promise<void> {
  const plan = await defaultPlan(db);
  await db.batch([
    insertSubscription(db, user.id, plan.id, nowIso, user.id),
    logChange(db, { at: nowIso, actorId: user.id, subject: 'subscription', userId: user.id, planId: plan.id, action: 'created', after: { planId: plan.id, plan: plan.name, status: 'active' } }),
  ]);
}

// ── Google sign-in ────────────────────────────────────────────────────────

// Two addresses: /api/auth/google sends the browser to Google, and Google sends it back to
// /api/auth/google/callback with a code. Both are page navigations, so both answer with a redirect,
// and a problem lands on the login page as ?google=<what>, which src/site/auth.ts puts in words.
// Between the two, a short cookie holds the state (which the callback must bring back, so nobody
// can make a browser finish a sign-in it did not start), the PKCE verifier (so a stolen code is
// no use alone) and where to go afterwards. SameSite=Lax, since Google's return is a top-level
// navigation from another site, which Lax lets through and Strict would not.

const GOOGLE_COOKIE = '__Host-br_google';
/** Plain http (local dev and preview) cannot use the __Host- prefix. */
const GOOGLE_DEV_COOKIE = 'br_google';

interface GoogleFlow {
  state: string;
  verifier: string;
  next: string | null;
}

function googleCookie(url: URL, value: string, maxAge: number): [string, string] {
  const https = url.protocol === 'https:';
  const parts = [`${https ? GOOGLE_COOKIE : GOOGLE_DEV_COOKIE}=${value}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`, 'HttpOnly'];
  if (https) parts.push('Secure');
  return ['Set-Cookie', parts.join('; ')];
}

function readGoogleFlow(request: Request): GoogleFlow | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== GOOGLE_COOKIE && name !== GOOGLE_DEV_COOKIE) continue;
    try {
      const flow = JSON.parse(atob(decodeURIComponent(rest.join('=')))) as GoogleFlow;
      if (typeof flow.state === 'string' && typeof flow.verifier === 'string') return flow;
    } catch {
      return null;
    }
  }
  return null;
}

function redirect(to: string, cookies: [string, string][] = []): Response {
  return new Response(null, { status: 302, headers: [['Location', to], ['Cache-Control', 'no-store'], ...cookies] });
}

/** Back to the login page with what went wrong, the flow's cookie gone. */
function googleProblem(url: URL, what: string): Response {
  return redirect(`${url.origin}/login?google=${what}`, [googleCookie(url, '', 0)]);
}

function googleOff(): HttpError {
  return new HttpError(404, 'not_found', 'No API route for this path.');
}

/** GET /api/auth/google?next=/path: off, a 404 like any missing route (GOOGLE_LOGIN). */
export async function googleStart({ env, url }: RouteContext): Promise<Response> {
  if (!GOOGLE_LOGIN) throw googleOff();
  if (!env.GOOGLE_CLIENT_SECRET?.trim()) return googleProblem(url, 'unavailable');
  const flow: GoogleFlow = { state: randomToken(), verifier: randomToken(), next: safeNext(url.searchParams.get('next'), url.origin) };
  const redirectUri = `${siteOrigin(env, url)}/api/auth/google/callback`;
  const cookie = googleCookie(url, encodeURIComponent(btoa(JSON.stringify(flow))), GOOGLE_COOKIE_SECONDS);
  return redirect(authorizeUrl(env, redirectUri, flow.state, await pkceChallenge(flow.verifier)), [cookie]);
}

/**
 * GET /api/auth/google/callback?code=&state=: finds the account by its Google id, else by the
 * address Google has confirmed (and ties the two), else makes one while sign-ups are open; then
 * signs it in. A new account, or one without a picture, takes the Google account's picture.
 */
export async function googleCallback(context: RouteContext): Promise<Response> {
  const { request, env, url, now } = context;
  if (!GOOGLE_LOGIN) throw googleOff();
  const flow = readGoogleFlow(request);
  if (url.searchParams.get('error')) return googleProblem(url, 'cancelled');
  if (!flow || url.searchParams.get('state') !== flow.state) return googleProblem(url, 'expired');
  const code = url.searchParams.get('code');
  if (!code) return googleProblem(url, 'expired');

  const ipKey = `google:ip:${clientIp(request)}`;
  const windowStart = new Date(now.getTime() - GOOGLE_WINDOW).toISOString();
  if ((await throttleCount(env.DB, [ipKey], windowStart)) >= GOOGLE_PER_IP) return googleProblem(url, 'busy');
  await env.DB.batch([throttleHit(env.DB, ipKey, now.toISOString(), windowStart), purgeThrottle(env.DB, dayAgo(now))]);

  let google: GoogleProfile;
  try {
    google = await exchangeCode(env, code, flow.verifier, `${siteOrigin(env, url)}/api/auth/google/callback`, now);
  } catch (err) {
    log('warn', 'Google sign-in failed', errorFields(err));
    return googleProblem(url, err instanceof HttpError && err.code === 'google_unavailable' ? 'unavailable' : 'failed');
  }
  // An address Google has not confirmed proves nothing about who owns it here.
  if (!google.emailVerified) return googleProblem(url, 'unverified');

  const nowIso = now.toISOString();
  let user = (await findUserByGoogleSub(env.DB, google.sub)) ?? (await findUserByEmail(env.DB, google.email));
  if (user) {
    if (user.suspended_at) return googleProblem(url, 'suspended');
    // The address's account is tied to another Google account already: this one may not take it over.
    if (user.google_sub && user.google_sub !== google.sub) return googleProblem(url, 'other');
    if (!user.google_sub) await linkGoogle(env.DB, user.id, google, nowIso).run();
  } else {
    if (!SIGNUPS_OPEN) return googleProblem(url, 'closed');
    user = await insertGoogleUser(env.DB, google, nowIso).first<UserRow>();
    if (!user) throw new Error('INSERT … RETURNING returned no account');
    await startOnDefaultPlan(env.DB, user, nowIso);
  }
  if (!user.avatar_key && google.picture) {
    const key = await importGoogleAvatar(env, user.id, google.picture);
    if (key) await setAvatarKey(env.DB, user.id, key).run();
  }
  const cookies = await startSession(env.DB, user.id, url, now);
  return redirect(`${url.origin}${flow.next ?? '/app'}`, [...cookies, googleCookie(url, '', 0)]);
}

/** POST /api/auth/login { email, password } */
export async function login({ request, env, url, now }: RouteContext): Promise<Response> {
  const body = await readJsonObject(request);
  const email = emailValue(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const emailKey = `login:email:${email.toLowerCase()}`;
  const ipKey = `login:ip:${clientIp(request)}`;
  const windowStart = new Date(now.getTime() - LOGIN_WINDOW).toISOString();
  await checkThrottle(
    env.DB,
    [
      [emailKey, LOGIN_PER_EMAIL],
      [ipKey, LOGIN_PER_IP],
    ],
    windowStart,
    LOGIN_WINDOW,
    'failed sign-in attempts',
  );

  const user = await findUserByEmail(env.DB, email);
  // One hash check whether or not the address has an account, so the time taken tells nothing.
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!user || !valid) {
    const nowIso = now.toISOString();
    await env.DB.batch([throttleHit(env.DB, emailKey, nowIso, windowStart), throttleHit(env.DB, ipKey, nowIso, windowStart), purgeThrottle(env.DB, dayAgo(now))]);
    throw new HttpError(401, 'invalid_credentials', 'Wrong email or password.');
  }
  // Said only to someone who knows the password.
  if (user.suspended_at) throw suspended();
  await clearThrottle(env.DB, emailKey).run();
  return signedIn(user, await startSession(env.DB, user.id, url, now));
}

/** POST /api/auth/logout: ends this browser's session. */
export async function logout({ request, env, url }: RouteContext): Promise<Response> {
  const hash = await sessionTokenHash(request);
  if (hash) await deleteSession(env.DB, hash).run();
  return json({ ok: true }, 200, clearSessionCookies(url));
}

/**
 * POST /api/auth/forgot { email }: mails a password link if the address has an account. The
 * answer is the same either way, so the form cannot be used to learn who has one.
 */
export async function forgot(context: RouteContext): Promise<Response> {
  const { request, env, url, now } = context;
  const email = emailValue((await readJsonObject(request)).email);
  // Production without the key could only pretend: say so to everyone alike.
  if (!env.RESEND_API_KEY?.trim() && !isLocal(url)) {
    throw new HttpError(503, 'mail_unavailable', 'Password mails cannot be sent right now. Write to us and we will help.');
  }
  const nowIso = now.toISOString();
  const windowStart = new Date(now.getTime() - FORGOT_WINDOW).toISOString();
  const emailKey = `forgot:email:${email.toLowerCase()}`;
  const ipKey = `forgot:ip:${clientIp(request)}`;
  await checkThrottle(
    env.DB,
    [
      [emailKey, FORGOT_PER_EMAIL],
      [ipKey, FORGOT_PER_IP],
    ],
    windowStart,
    FORGOT_WINDOW,
    'password mails',
  );
  await env.DB.batch([throttleHit(env.DB, emailKey, nowIso, windowStart), throttleHit(env.DB, ipKey, nowIso, windowStart), purgeThrottle(env.DB, dayAgo(now))]);
  const user = await findUserByEmail(env.DB, email);
  if (user && !user.suspended_at) await sendReset(context, user);
  return json({ ok: true });
}

const PASSWORD_LINKS: TokenPurpose[] = ['reset', 'superadmin'];

/** GET /api/auth/reset?token=: who a password link is for, before the form asks for the password. */
export async function resetInfo({ env, url, now }: RouteContext): Promise<Response> {
  const hash = await sha256Hex(tokenValue(url.searchParams.get('token')));
  const token = await findOpenToken(env.DB, hash, PASSWORD_LINKS, now.toISOString());
  if (!token) throw linkInvalid();
  const existing = token.user_id !== null || (await findUserByEmail(env.DB, token.email)) !== null;
  const body: ResetInfo = { email: token.email, purpose: token.purpose === 'superadmin' ? 'superadmin' : 'reset', existing };
  return json(body);
}

/**
 * POST /api/auth/reset { token, password }: sets the password and signs in, ending every other
 * session of the account. The terminal's superadmin link goes through here too: it creates the
 * account or promotes it, and gives it the videos that have no owner yet.
 */
export async function reset({ request, env, url, now }: RouteContext): Promise<Response> {
  const body = await readJsonObject(request);
  const hash = await sha256Hex(tokenValue(body.token));
  const password = passwordValue(body.password);
  const nowIso = now.toISOString();

  const open = await findOpenToken(env.DB, hash, PASSWORD_LINKS, nowIso);
  if (!open) throw linkInvalid();
  const before = open.user_id === null ? null : await findUserById(env.DB, open.user_id);
  if (open.purpose === 'reset' && (!before || before.suspended_at)) throw before ? suspended() : linkInvalid();

  // Hash before the link is spent: spending it is the point of no return.
  const passwordHash = await hashPassword(password);
  const token = await claimToken(env.DB, hash, PASSWORD_LINKS, nowIso);
  if (!token) throw linkInvalid();

  let user: UserRow | null;
  if (token.purpose === 'superadmin') {
    const existing = await findUserByEmail(env.DB, token.email);
    const plan = await defaultPlan(env.DB);
    user = await upsertSuperadmin(env.DB, token.email, passwordHash, nowIso).first<UserRow>();
    if (!user) throw new Error('Superadmin upsert returned no account');
    await env.DB.batch([
      ...claimOrphans(env.DB, user.id),
      deleteUserSessions(env.DB, user.id),
      insertSubscription(env.DB, user.id, plan.id, nowIso, null),
      logChange(env.DB, {
        at: nowIso,
        actorId: null,
        subject: 'account',
        userId: user.id,
        action: existing ? 'promoted to superadmin' : 'superadmin created',
        before: existing ? { role: existing.role, suspended: existing.suspended_at !== null } : undefined,
        after: { role: 'superadmin' },
      }),
    ]);
  } else {
    const id = token.user_id!;
    await env.DB.batch([setPassword(env.DB, id, passwordHash), markVerified(env.DB, id, nowIso), deleteUserSessions(env.DB, id)]);
    user = await findUserById(env.DB, id);
    if (!user) throw linkInvalid();
  }
  return signedIn(user, await startSession(env.DB, user.id, url, now));
}

/** POST /api/auth/verify { token }: confirms the address. Works signed out too (a phone's mail app). */
export async function verify({ request, env, now }: RouteContext): Promise<Response> {
  const hash = await sha256Hex(tokenValue((await readJsonObject(request)).token));
  const nowIso = now.toISOString();
  const token = await claimToken(env.DB, hash, ['verify'], nowIso);
  if (!token || token.user_id === null) throw linkInvalid();
  await markVerified(env.DB, token.user_id, nowIso).run();
  const body: VerifiedResponse = { email: token.email };
  return json(body);
}

/** The account a route behind the sign-in acts for, re-read with its password hash. */
export async function accountRow(env: Env, user: AuthUser): Promise<UserRow> {
  const row = await findUserById(env.DB, user.id);
  if (!row) throw new HttpError(401, 'unauthenticated', 'Sign in first.');
  return row;
}

