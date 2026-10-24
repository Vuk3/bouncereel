#!/usr/bin/env node
/**
 * Makes a superadmin, from the terminal: the only way one is ever made. Sign-up and the API
 * only make `user` accounts. Modelled on Hoops' scripts/invite.mjs.
 *
 *   npm run admin -- you@example.com              # the local database (npm run dev, preview)
 *   npm run admin -- you@example.com --remote     # production
 *
 * Prints a one-time link to set the password, valid 24 hours. Opening it and setting a password
 * creates the account as a superadmin, or promotes the existing one. An address that already
 * has an account is promoted now as well (it lowers nothing: a suspended account is let back
 * in), so the link is only needed for a new password. Either way the superadmin gets every
 * video recorded before accounts existed (they have no owner yet).
 *
 * Only the SHA-256 of the token is written to D1; the link is printed once.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const PRODUCTION_URL = 'https://bouncereel.vukcvetkovic.com';
const LOCAL_URL = 'http://localhost:5173';
const VALID_HOURS = 24;

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const [email] = args.filter((arg) => !arg.startsWith('--'));

if (!email || !/^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/.test(email)) {
  console.error('Usage: npm run admin -- <email> [--remote]');
  process.exit(1);
}

const where = remote ? '--remote' : '--local';
function d1(sql, json = false) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'bouncereel', where, ...(json ? ['--json'] : []), '--command', sql], {
    stdio: ['inherit', json ? 'pipe' : 'ignore', 'inherit'],
    encoding: 'utf8',
  });
  return json ? JSON.parse(out) : null;
}

const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
const now = new Date().toISOString();
const expiresAt = new Date(Date.now() + VALID_HOURS * 3_600_000).toISOString();

// The address is checked above (no quotes or backslashes), the rest is generated: plain
// interpolation is safe here.
const existing = d1(`SELECT id, role, suspended_at FROM users WHERE email = '${email}'`, true)[0].results[0] ?? null;
const statements = [
  `INSERT INTO tokens (token_hash, purpose, email, user_id, created_at, expires_at)
   VALUES ('${tokenHash}', 'superadmin', '${email}', (SELECT id FROM users WHERE email = '${email}'), '${now}', '${expiresAt}')`,
];
if (existing) {
  statements.push(
    // Logged before the change, so `before` is what it was.
    `INSERT INTO change_log (at, actor_id, subject, user_id, action, before, after)
     SELECT '${now}', NULL, 'account', id, 'promoted to superadmin', json_object('role', role, 'suspended', suspended_at IS NOT NULL), json_object('role', 'superadmin')
       FROM users WHERE email = '${email}' AND (role <> 'superadmin' OR suspended_at IS NOT NULL)`,
    `UPDATE users SET role = 'superadmin', suspended_at = NULL, email_verified_at = COALESCE(email_verified_at, '${now}') WHERE email = '${email}'`,
    `UPDATE videos SET user_id = ${existing.id} WHERE user_id IS NULL`,
    `UPDATE posts SET user_id = ${existing.id} WHERE user_id IS NULL`,
  );
}
d1(statements.join(';\n'));

const base = remote ? PRODUCTION_URL : LOCAL_URL;
const what = existing ? `${email} is a superadmin now. To set a new password` : `To create the superadmin ${email}, set its password`;
console.log(`\n${what} (valid ${VALID_HOURS} hours, once):\n\n  ${base}/reset?token=${token}\n`);
if (!remote) console.log('  (Running the preview on another port? Keep the path and change the port.)\n');
