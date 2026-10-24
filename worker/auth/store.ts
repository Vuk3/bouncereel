import type { Account, Role } from '../../shared/api.ts';

// Queries for accounts, sessions, one-time links and throttling (migrations/0002_accounts.sql).
// Handlers never write SQL themselves.

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  created_at: string;
  last_login_at: string | null;
  email_verified_at: string | null;
  suspended_at: string | null;
}

const USER_COLUMNS = 'id, email, password_hash, role, created_at, last_login_at, email_verified_at, suspended_at';

export function toAccount(row: UserRow): Account {
  return { id: row.id, email: row.email, role: row.role, verified: row.email_verified_at !== null, createdAt: row.created_at };
}

// ── Users ─────────────────────────────────────────────────────────────────

export function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?1`).bind(email).first<UserRow>();
}

export function findUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?1`).bind(id).first<UserRow>();
}

/**
 * A new account from sign-up. The role is written here, not passed in: nothing that reaches
 * the API can create a superadmin.
 */
export function insertUser(db: D1Database, email: string, passwordHash: string, now: string): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO users (email, password_hash, role, created_at) VALUES (?1, ?2, 'user', ?3) RETURNING ${USER_COLUMNS}`)
    .bind(email, passwordHash, now);
}

/**
 * The terminal's superadmin link, used: creates the account, or gives an existing one the
 * password and the role. It never lowers anything: a suspended account is let back in, and an
 * address already confirmed stays so (the link came from whoever runs the terminal, so the
 * address counts as confirmed).
 */
export function upsertSuperadmin(db: D1Database, email: string, passwordHash: string, now: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO users (email, password_hash, role, created_at, email_verified_at) VALUES (?1, ?2, 'superadmin', ?3, ?3)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = excluded.password_hash,
         role = 'superadmin',
         email_verified_at = COALESCE(users.email_verified_at, excluded.email_verified_at),
         suspended_at = NULL
       RETURNING ${USER_COLUMNS}`,
    )
    .bind(email, passwordHash, now);
}

/**
 * Gives a superadmin every video and link that has no owner: the ones recorded before
 * accounts existed (0002_accounts.sql). Run whenever an account becomes a superadmin; after
 * the first, there is nothing left to give.
 */
export function claimOrphans(db: D1Database, userId: number): D1PreparedStatement[] {
  return [
    db.prepare('UPDATE videos SET user_id = ?1 WHERE user_id IS NULL').bind(userId),
    db.prepare('UPDATE posts SET user_id = ?1 WHERE user_id IS NULL').bind(userId),
  ];
}

export function setPassword(db: D1Database, id: number, passwordHash: string): D1PreparedStatement {
  return db.prepare('UPDATE users SET password_hash = ?2 WHERE id = ?1').bind(id, passwordHash);
}

/** Confirms the address; a second confirmation keeps the first time. */
export function markVerified(db: D1Database, id: number, now: string): D1PreparedStatement {
  return db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?2) WHERE id = ?1').bind(id, now);
}

export function touchLogin(db: D1Database, id: number, now: string): D1PreparedStatement {
  return db.prepare('UPDATE users SET last_login_at = ?2 WHERE id = ?1').bind(id, now);
}

export function setSuspended(db: D1Database, id: number, at: string | null): D1PreparedStatement {
  return db.prepare('UPDATE users SET suspended_at = ?2 WHERE id = ?1').bind(id, at);
}

/** Superadmins that can still sign in: the last one may not be deleted or suspended. */
export async function countActiveSuperadmins(db: D1Database): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin' AND suspended_at IS NULL`).first<number>('n')) ?? 0;
}

/** Removes the account; its sessions, links, subscription, videos and posts go with it (ON DELETE CASCADE). */
export function deleteUser(db: D1Database, id: number): D1PreparedStatement {
  return db.prepare('DELETE FROM users WHERE id = ?1').bind(id);
}

// ── Sessions ──────────────────────────────────────────────────────────────

export function insertSession(db: D1Database, tokenHash: string, userId: number, now: string, expiresAt: string): D1PreparedStatement {
  return db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(tokenHash, userId, now, expiresAt);
}

/** The account behind a session, if the session is current and the account not suspended. */
export function findSessionUser(db: D1Database, tokenHash: string, now: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users
        WHERE id = (SELECT user_id FROM sessions WHERE token_hash = ?1 AND expires_at > ?2) AND suspended_at IS NULL`,
    )
    .bind(tokenHash, now)
    .first<UserRow>();
}

export function deleteSession(db: D1Database, tokenHash: string): D1PreparedStatement {
  return db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash);
}

/** Signs the account out everywhere, or everywhere but the session `keep`. */
export function deleteUserSessions(db: D1Database, userId: number, keep: string | null = null): D1PreparedStatement {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?1 AND token_hash IS NOT ?2').bind(userId, keep);
}

export function deleteExpiredSessions(db: D1Database, now: string): D1PreparedStatement {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now);
}

// ── One-time links ────────────────────────────────────────────────────────

export type TokenPurpose = 'verify' | 'reset' | 'superadmin';

export interface TokenRow {
  token_hash: string;
  purpose: TokenPurpose;
  email: string;
  user_id: number | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

/**
 * Stores a new link, and drops the account's older open links of the same purpose (only the
 * newest reset mail works) and every expired link of anyone.
 */
export function insertToken(
  db: D1Database,
  token: { hash: string; purpose: TokenPurpose; email: string; userId: number; now: string; expiresAt: string },
): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM tokens WHERE expires_at <= ?1 OR (user_id = ?2 AND purpose = ?3)').bind(token.now, token.userId, token.purpose),
    db
      .prepare('INSERT INTO tokens (token_hash, purpose, email, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(token.hash, token.purpose, token.email, token.userId, token.now, token.expiresAt),
  ];
}

/** An unused, unexpired link of one of `purposes`. */
export function findOpenToken(db: D1Database, hash: string, purposes: TokenPurpose[], now: string): Promise<TokenRow | null> {
  return db
    .prepare(
      `SELECT * FROM tokens WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2 AND purpose IN (${purposes.map((_, i) => `?${i + 3}`).join(', ')})`,
    )
    .bind(hash, now, ...purposes)
    .first<TokenRow>();
}

/** Spends an open link; null when it was already spent or has expired (safe against two clicks at once). */
export function claimToken(db: D1Database, hash: string, purposes: TokenPurpose[], now: string): Promise<TokenRow | null> {
  return db
    .prepare(
      `UPDATE tokens SET used_at = ?2
        WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2 AND purpose IN (${purposes.map((_, i) => `?${i + 3}`).join(', ')})
        RETURNING *`,
    )
    .bind(hash, now, ...purposes)
    .first<TokenRow>();
}

// ── Throttling ────────────────────────────────────────────────────────────

/** The highest count among `keys` within the window that started at `windowStart`. */
export async function throttleCount(db: D1Database, keys: string[], windowStart: string): Promise<number> {
  const placeholders = keys.map((_, i) => `?${i + 2}`).join(', ');
  const max = await db
    .prepare(`SELECT MAX(hits) AS n FROM throttle WHERE window_start > ?1 AND key IN (${placeholders})`)
    .bind(windowStart, ...keys)
    .first<number | null>('n');
  return max ?? 0;
}

/** Counts one for a key; a window that started before `windowStart` starts again at 1. */
export function throttleHit(db: D1Database, key: string, now: string, windowStart: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO throttle (key, hits, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT (key) DO UPDATE SET
         hits         = CASE WHEN throttle.window_start <= ?3 THEN 1 ELSE throttle.hits + 1 END,
         window_start = CASE WHEN throttle.window_start <= ?3 THEN ?2 ELSE throttle.window_start END`,
    )
    .bind(key, now, windowStart);
}

export function clearThrottle(db: D1Database, key: string): D1PreparedStatement {
  return db.prepare('DELETE FROM throttle WHERE key = ?1').bind(key);
}

/** Counters whose window ended a day ago or more count nothing any more. */
export function purgeThrottle(db: D1Database, before: string): D1PreparedStatement {
  return db.prepare('DELETE FROM throttle WHERE window_start <= ?1').bind(before);
}
