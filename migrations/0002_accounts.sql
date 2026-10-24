-- Accounts: BounceReel becomes a public site where anyone can sign up, so every video gets an
-- owner, and the API checks a session instead of Cloudflare Access (docs/accounts-and-billing.md).
--
-- Ported from Hoops' 0004_users.sql: email and password, PBKDF2 hashes that carry their own
-- iteration count, sessions and one-time links stored only as SHA-256 hashes (a leaked database
-- holds no usable session or link), and failed attempts counted for throttling.
--
-- Two roles: `user` (everyone who signs up) and `superadmin` (made only from the terminal by
-- scripts/admin.mjs; nothing reachable over HTTP writes that role).

-- * email is unique case-insensitively (COLLATE NOCASE), as people type it.
-- * AUTOINCREMENT, so a deleted account's id is never given to a new one: the change log
--   (0003) keeps ids, not addresses, and an old line must never name the wrong person.
-- * suspended_at: a suspended account cannot sign in, and its sessions are deleted.
CREATE TABLE users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  -- "pbkdf2_sha256$<iterations>$<salt>$<hash>" (worker/auth/crypto.ts)
  password_hash     TEXT    NOT NULL,
  role              TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'superadmin')),
  created_at        TEXT    NOT NULL,
  last_login_at     TEXT,
  -- Set by the link in the sign-up mail (or a password reset, which proves the same).
  email_verified_at TEXT,
  suspended_at      TEXT
);

-- The admin's "new in the last 7 / 30 days".
CREATE INDEX users_created_at ON users (created_at);

-- One row per signed-in browser, looked up by the cookie's hash on every request behind the
-- sign-in. Expired rows are purged whenever someone signs in.
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);

-- One-time links: confirming an address (`verify`), setting a new password (`reset`), and the
-- terminal's link that creates or promotes a superadmin (`superadmin`, whose account may not
-- exist yet, hence user_id NULL and the email). used_at marks one spent.
CREATE TABLE tokens (
  token_hash TEXT    PRIMARY KEY,
  purpose    TEXT    NOT NULL CHECK (purpose IN ('verify', 'reset', 'superadmin')),
  email      TEXT    NOT NULL COLLATE NOCASE,
  user_id    INTEGER REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  used_at    TEXT
);

CREATE INDEX tokens_user ON tokens (user_id);

-- Counters for throttling, one per key in a sliding window: failed logins per email and per
-- IP ("login:email:…", "login:ip:…"), sign-ups per IP, password mails per address and IP.
CREATE TABLE throttle (
  key          TEXT    PRIMARY KEY,
  hits         INTEGER NOT NULL,
  window_start TEXT    NOT NULL
);

-- Every video and every link belongs to one account; deleting the account deletes both.
--
-- The column has to be nullable: ALTER TABLE cannot add a NOT NULL column with a reference, and
-- rebuilding `videos` would cascade-delete every post (D1 always enforces foreign keys, and
-- DROP TABLE deletes its rows first). The rows recorded before accounts existed (Vuk's) cannot
-- be filled here either: no account exists yet. They stay NULL, which every query scoped to an
-- account simply never returns, until the first superadmin is made: setting that account's
-- password (worker/routes/auth.ts) or promoting it (scripts/admin.mjs) gives it every video and
-- link without an owner. From then on no row is without one: every insert names its account.
ALTER TABLE videos ADD COLUMN user_id INTEGER REFERENCES users (id) ON DELETE CASCADE;
CREATE INDEX videos_user_recorded_at ON videos (user_id, recorded_at);

-- posts copies its video's owner, so "one published video belongs to one recording" can be a
-- unique index per account: two people may link the same public post, one person not twice.
ALTER TABLE posts ADD COLUMN user_id INTEGER REFERENCES users (id) ON DELETE CASCADE;
UPDATE posts SET user_id = (SELECT user_id FROM videos WHERE videos.id = posts.video_id);
DROP INDEX posts_platform_external_id;
CREATE UNIQUE INDEX posts_user_platform_external_id ON posts (user_id, platform, external_id) WHERE external_id IS NOT NULL;
