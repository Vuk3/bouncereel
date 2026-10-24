-- Pro makes five videos a day, so the three plans climb in clear steps: Rookie one a day, Pro
-- five, Champion as many as you like and every game (docs/accounts-and-billing.md).
--
-- TODO(vuk): the words are placeholders, like the names and badges; change them in the admin
-- area. A plan changes here only while it is as 0005_three_plans.sql left it: a daily limit Vuk
-- has set on Pro stays, and so does a description he has written.
UPDATE plans
   SET features   = json_set(features, '$.perDay', 5),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE name = 'Pro' AND json_extract(features, '$.perDay') IS NULL;

-- One line each on who the plan is for. What it includes is the list under it, written from its
-- features, so the line no longer repeats that list.
UPDATE plans
   SET description = 'Try the format and post your first races.',
       updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE name = 'Rookie' AND description = 'Try the format: one video a day, music or silent, up to 30 seconds, in the paper look.';

UPDATE plans
   SET description = 'For creators who post every day.',
       updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE name = 'Pro' AND description = 'For posting every day: every look and length up to 90 seconds, the narrator, powers, no watermark.';

UPDATE plans
   SET description = 'No daily limit, and every game BounceReel makes.',
       updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE name = 'Champion' AND description = 'Everything in Pro, and every game BounceReel makes: each new one included as it comes out.';
