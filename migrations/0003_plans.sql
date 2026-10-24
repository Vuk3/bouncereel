-- Plans, subscriptions and the change log (docs/accounts-and-billing.md).
--
-- What a plan can unlock is defined in code (shared/features.ts); each plan's values for it are
-- stored here as JSON, so Vuk changes what a plan gives in the admin area without a migration. A
-- feature added to the code later reads as "not included" on every plan until he turns it on
-- (readFeatures).
--
-- Each account has one subscription. What it may do is worked out on every request from that
-- row and the clock: there is no cron (the account's five cron triggers are all Hoops'), so an
-- end date takes effect the moment it passes, with nothing having to run.

-- * Prices are optional: a plan without one shows "Coming soon". price_amount is in the
--   currency's minor unit (900 = €9.00), price_interval NULL is a one-off price.
-- * is_default marks the plan every new account gets and every ended subscription falls back
--   to; the partial unique index allows at most one.
-- * A plan with subscribers is only ever archived (archived_at): hidden from the pricing page and
--   from new subscriptions, kept by those who have it. The admin deletes only an unused one.
CREATE TABLE plans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  price_amount   INTEGER,
  price_currency TEXT,
  price_interval TEXT CHECK (price_interval IN ('month', 'year')),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  visible        INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  is_default     INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  archived_at    TEXT,
  -- shared/features.ts Features, as JSON.
  features       TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

CREATE UNIQUE INDEX plans_one_default ON plans (is_default) WHERE is_default = 1;

-- TODO(vuk): both plans are placeholders: names, words, limits, Free's currency and Pro's price
-- (empty, so the pricing page says "Coming soon") are for Vuk to set in the admin area. No
-- watermark on either.
INSERT INTO plans (name, description, price_amount, price_currency, sort_order, is_default, features, created_at, updated_at) VALUES
  ('Free', 'Music or silent races up to 30 seconds, in the paper look.', 0, 'EUR', 1, 1,
   '{"sounds":["music","silent"],"narrator":false,"maxSeconds":30,"looks":["paper"],"powers":false,"library":5}',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('Pro', 'Everything: the narrator, every look and length, powers, and a library without a limit.', NULL, NULL, 2, 0,
   '{"sounds":["narrator","music","silent"],"narrator":true,"maxSeconds":90,"looks":["paper","night","cards"],"powers":true,"library":null}',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- One row per account, made at sign-up on the default plan.
-- * status: `active`, or `canceled` (keeps the plan until ends_at, or loses it at once without
--   one). No CHECK: a payment provider brings statuses of its own (past_due, trialing…), and a
--   CHECK in SQLite can only be widened by rebuilding the table. The Worker validates it.
-- * source: `manual` (the admin area) or the provider's name once one is connected; the
--   provider's own ids sit beside it, NULL until then.
-- * updated_by: the account that changed it last. No REFERENCES, so the record outlives its author.
CREATE TABLE subscriptions (
  user_id                  INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  plan_id                  INTEGER NOT NULL REFERENCES plans (id),
  status                   TEXT    NOT NULL DEFAULT 'active',
  source                   TEXT    NOT NULL DEFAULT 'manual',
  ends_at                  TEXT,
  provider_customer_id     TEXT,
  provider_subscription_id TEXT,
  updated_at               TEXT    NOT NULL,
  updated_by               INTEGER
);

CREATE INDEX subscriptions_plan ON subscriptions (plan_id);

-- Accounts made before this migration (test accounts on a local database) get the default plan.
INSERT INTO subscriptions (user_id, plan_id, updated_at)
  SELECT id, (SELECT id FROM plans WHERE is_default = 1), created_at FROM users;

-- Every change to a subscription, a plan or an account's standing, appended and never edited:
-- who, when, and the state before and after, as JSON. Ids without REFERENCES, so a line
-- survives the account or plan it names (users and plans use AUTOINCREMENT: an id never comes
-- back as someone else). No addresses are copied in: a deleted account leaves only its number.
CREATE TABLE change_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       TEXT    NOT NULL,
  -- Who: a superadmin, the account itself (sign-up, deleting itself), or NULL for the server.
  actor_id INTEGER,
  subject  TEXT    NOT NULL CHECK (subject IN ('subscription', 'plan', 'account')),
  user_id  INTEGER,
  plan_id  INTEGER,
  action   TEXT    NOT NULL,
  before   TEXT,
  after    TEXT
);

CREATE INDEX change_log_user ON change_log (user_id, id);
