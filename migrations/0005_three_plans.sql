-- Three plans: Rookie (the free one), Pro and Champion, how each looks on the pricing page, the
-- watermark on the free plan's videos, and Champion's every game (docs/accounts-and-billing.md).
--
-- * tone: the card on the pricing page: `plain` (white), `bold` (violet, the plan the page
--   points at) or `dark` (the ink stage, the top plan). No CHECK: the set grows with the
--   stylesheet, and a CHECK in SQLite can only be widened by rebuilding the table; the Worker
--   validates it (PLAN_TONES in shared/api.ts) and reads an unknown one as plain.
-- * badge: a word or two on the card's corner, NULL for none.
ALTER TABLE plans ADD COLUMN tone TEXT NOT NULL DEFAULT 'plain';
ALTER TABLE plans ADD COLUMN badge TEXT;

-- Every plan gets the two new features as it was: no watermark on its videos, and the ball races
-- as its game. A plan stored without them would read as the least (a watermark, no every game).
UPDATE plans
   SET features   = json_set(features, '$.watermark', json('false'), '$.allGames', json('false')),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- TODO(vuk): names, words and badges are placeholders to change in the admin area. A description
-- Vuk has written himself stays; only the seeded ones are replaced.
UPDATE plans
   SET name        = 'Rookie',
       description = CASE WHEN description = 'One video a day: music or silent races up to 30 seconds, in the paper look.'
                          THEN 'Try the format: one video a day, music or silent, up to 30 seconds, in the paper look.'
                          ELSE description END,
       features    = json_set(features, '$.watermark', json('true')),
       tone        = 'plain'
 WHERE name = 'Free' AND is_default = 1;

UPDATE plans
   SET description = CASE WHEN description = 'Everything: the narrator, every look and length, powers, and a library without a limit.'
                          THEN 'For posting every day: every look and length up to 90 seconds, the narrator, powers, no watermark.'
                          ELSE description END,
       tone        = 'bold',
       badge       = 'Recommended'
 WHERE name = 'Pro';

-- Champion: everything Pro has, and every game BounceReel makes. No price yet ("Coming soon"), as
-- Pro has none: both wait for a payment provider (worker/routes/billing.ts).
INSERT INTO plans (name, description, price_amount, price_currency, sort_order, visible, is_default, features, tone, badge, created_at, updated_at)
VALUES ('Champion', 'Everything in Pro, and every game BounceReel makes: each new one included as it comes out.', NULL, NULL,
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM plans), 1, 0,
        '{"sounds":["narrator","music","silent"],"narrator":true,"maxSeconds":90,"looks":["paper","cards","night"],"powers":true,"perDay":null,"library":null,"watermark":false,"allGames":true}',
        'dark', 'Every game',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
