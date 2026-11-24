-- The plans as the owner set them on 2026-11-24 (docs/accounts-and-billing.md §6): Free, Pro and
-- Champion, priced in dollars by the month and by the year, the year the pricing page's default.
--
-- * price_year_amount: a monthly plan's price for a year paid at once, in the same minor unit and
--   currency as price_amount; NULL when it is sold by the month alone. Additive: the old Worker
--   never reads it.
-- * Three new features on every plan (shared/features.ts): `games`, the games besides ball races a
--   plan makes when it has not every game; `chooseWinner`, picking the side that wins; `customText`,
--   words of your own. Every plan gets them as it was: no games listed (`allGames` still gives
--   Champion every game), no picking, no words; the three plans are then set as decided below.
ALTER TABLE plans ADD COLUMN price_year_amount INTEGER;

UPDATE plans
   SET features   = json_set(features, '$.games', json('[]'), '$.chooseWinner', json('false'), '$.customText', json('false')),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- Free (the default plan, Rookie until now): ball races to try the format. A dollar price of 0, so
-- the card reads $0 beside the others.
UPDATE plans
   SET name           = 'Free',
       description    = 'Try the format with ball races.',
       price_amount   = 0,
       price_currency = 'USD',
       price_interval = NULL,
       price_year_amount = NULL,
       features       = json('{"sounds":["music","silent"],"narrator":false,"maxSeconds":30,"looks":["paper"],"powers":false,"perDay":1,"library":5,"watermark":true,"follow":false,"allGames":false,"games":[],"chooseWinner":false,"customText":false}'),
       tone           = 'plain',
       badge          = NULL,
       updated_at     = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE is_default = 1;

-- Pro: the three games, no watermark, five a day up to a minute, music or silence. $9 a month, or
-- $84 a year: $7 a month, 22 % off. A whole number of dollars a month either way (the owner's ask:
-- $90 a year read as $7.50).
UPDATE plans
   SET description    = 'All three games, without the watermark.',
       price_amount   = 900,
       price_currency = 'USD',
       price_interval = 'month',
       price_year_amount = 8400,
       features       = json('{"sounds":["music","silent"],"narrator":false,"maxSeconds":60,"looks":["paper","night","cards"],"powers":true,"perDay":5,"library":100,"watermark":false,"follow":false,"allGames":false,"games":["arena-clash","goal-rush"],"chooseWinner":false,"customText":false}'),
       tone           = 'bold',
       badge          = NULL,
       updated_at     = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE name = 'Pro' AND is_default = 0;

-- Champion: everything, and every new game the day it ships. $19 a month, or $180 a year: $15 a
-- month, 21 % off.
UPDATE plans
   SET description    = 'Everything, and every new game first.',
       price_amount   = 1900,
       price_currency = 'USD',
       price_interval = 'month',
       price_year_amount = 18000,
       features       = json('{"sounds":["narrator","music","silent"],"narrator":true,"maxSeconds":90,"looks":["paper","night","cards"],"powers":true,"perDay":null,"library":null,"watermark":false,"follow":true,"allGames":true,"games":["arena-clash","goal-rush"],"chooseWinner":true,"customText":true}'),
       tone           = 'dark',
       badge          = 'Everything',
       updated_at     = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE name = 'Champion' AND is_default = 0;
