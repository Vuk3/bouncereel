-- A plan's daily allowance of videos (`perDay` in shared/features.ts), and Free set to one a day
-- in the paper look (docs/accounts-and-billing.md).
--
-- What a day has used is kept on the account, not counted from `videos`: deleting a video from
-- the library must not give the day's video back, since its MP4 is already on the computer. A
-- day is the calendar day in UTC, so the allowance comes back at midnight UTC for everyone
-- (worker/plans.ts `claimDay`).
-- * day_started_at: when the account's last day of videos started, that is its first video of
--   that day, ISO 8601 UTC; NULL until the account's first video.
-- * day_videos: videos saved in that day.
-- Both are filled for every existing account by their defaults: no day has started yet.
ALTER TABLE users ADD COLUMN day_started_at TEXT;
ALTER TABLE users ADD COLUMN day_videos INTEGER NOT NULL DEFAULT 0;

-- Free: one video a day, the paper look only, and its line on the pricing page says so (unless
-- the owner has written their own). Every other plan keeps what it gave: no daily limit. A plan stored
-- without the key would read as the least (none a day), so none is left without it.
UPDATE plans
   SET features    = json_set(features, '$.perDay', 1, '$.looks', json('["paper"]')),
       description = CASE WHEN description = 'Music or silent races up to 30 seconds, in the paper look.'
                          THEN 'One video a day: music or silent races up to 30 seconds, in the paper look.'
                          ELSE description END,
       updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE name = 'Free';

UPDATE plans
   SET features   = json_set(features, '$.perDay', NULL),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE name <> 'Free';
