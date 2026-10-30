-- The follow button (`follow` in shared/features.ts): the studio's Ask viewers to follow switch, a
-- follow button once in the race and under the winner card, and "Follow for more!" from the
-- narrator. Every plan but the default one (Rookie, the free plan) gets it, and the owner changes
-- that per plan in the admin area. Every plan is given a value here: a plan stored without one
-- reads as the least (no follow button), which would take it from the paid plans too.
UPDATE plans
   SET features   = json_set(features, '$.follow', json(CASE WHEN is_default = 1 THEN 'false' ELSE 'true' END)),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
