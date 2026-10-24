import type { Role } from '../../shared/api.ts';
import { HttpError } from '../lib/http.ts';
import { randomToken, sha256Hex } from './crypto.ts';
import { deleteExpiredSessions, findSessionUser, insertSession, touchLogin, type UserRow } from './store.ts';

// Cookie sessions (ported from Hoops). The browser holds a random token in an HttpOnly cookie;
// the database holds only its SHA-256. On https the cookie has the `__Host-` prefix (Secure,
// Path=/, no Domain), so no other subdomain can set or override it. SameSite=Lax and the
// Origin check below keep other sites from acting with it.
//
// Next to it, `br_hint` is a plain cookie with no secret in it, readable by the pages: the
// home page shows "Open studio" instead of "Sign in" from it without asking the Worker. It is
// a hint only; nothing on the server ever trusts it.

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  verified: boolean;
  createdAt: string;
}

const SESSION_DAYS = 30;
const SECURE_COOKIE = '__Host-br_session';
/** Plain http (local dev and preview) cannot use the __Host- prefix. */
const DEV_COOKIE = 'br_session';
export const HINT_COOKIE = 'br_hint';

function readToken(request: Request): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if ((name === SECURE_COOKIE || name === DEV_COOKIE) && value.length > 0 && value.join('=')) return value.join('=');
  }
  return null;
}

export function hasHint(request: Request): boolean {
  return (request.headers.get('Cookie') ?? '').split(';').some((part) => part.trim().startsWith(`${HINT_COOKIE}=`));
}

function cookie(url: URL, name: string, value: string, maxAgeSeconds: number, httpOnly: boolean): string {
  const parts = [`${name}=${value}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (httpOnly) parts.push('HttpOnly');
  if (url.protocol === 'https:') parts.push('Secure');
  return parts.join('; ');
}

/** Set-Cookie headers for a new session and its hint. */
function sessionCookies(url: URL, token: string, maxAge: number): [string, string][] {
  return [
    ['Set-Cookie', cookie(url, url.protocol === 'https:' ? SECURE_COOKIE : DEV_COOKIE, token, maxAge, true)],
    ['Set-Cookie', cookie(url, HINT_COOKIE, token ? '1' : '', maxAge, false)],
  ];
}

/** Starts a session for the account; returns the Set-Cookie headers to send with the answer. */
export async function startSession(db: D1Database, userId: number, url: URL, now: Date): Promise<[string, string][]> {
  const token = randomToken();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  await db.batch([deleteExpiredSessions(db, nowIso), insertSession(db, await sha256Hex(token), userId, nowIso, expiresAt), touchLogin(db, userId, nowIso)]);
  return sessionCookies(url, token, SESSION_DAYS * 86_400);
}

/** Set-Cookie headers that remove the session cookie and the hint. */
export function clearSessionCookies(url: URL): [string, string][] {
  return sessionCookies(url, '', 0);
}

/** The hash of the request's session token, if it carries one. */
export async function sessionTokenHash(request: Request): Promise<string | null> {
  const token = readToken(request);
  return token ? sha256Hex(token) : null;
}

export function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, role: row.role, verified: row.email_verified_at !== null, createdAt: row.created_at };
}

/** The signed-in account, or null: no cookie, an expired or deleted session, or a suspended account. */
export async function currentUser(request: Request, db: D1Database, now: Date): Promise<AuthUser | null> {
  const hash = await sessionTokenHash(request);
  if (!hash) return null;
  const row = await findSessionUser(db, hash, now.toISOString());
  return row ? toAuthUser(row) : null;
}

export async function requireUser(request: Request, db: D1Database, now: Date): Promise<AuthUser> {
  const user = await currentUser(request, db, now);
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in first.');
  return user;
}

export function requireSuperadmin(user: AuthUser): AuthUser {
  if (user.role !== 'superadmin') throw new HttpError(403, 'forbidden', 'Only a superadmin can do this.');
  return user;
}

/** Only the site's own pages may change anything: browsers always send Origin on a cross-origin write. */
export function assertSameOrigin(request: Request, url: URL): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if ((origin !== null && origin !== url.origin) || site === 'cross-site') {
    throw new HttpError(403, 'cross_origin', 'Cross-origin requests are not allowed.');
  }
}
