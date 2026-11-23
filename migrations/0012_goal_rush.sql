-- Goal Rush, the third game: what one came to goes in `match_result`, as JSON (shared/api.ts
-- MatchSummary: clubs or players, the two sides, the score, the winner, every goal and its
-- minute), as an Arena Clash's goes in `battle`. Not `match`: MATCH is an operator in SQLite.
-- Additive: the old Worker never reads it, and a match's race columns and `battle` stay NULL, which
-- their CHECKs allow. Every existing row is a race or a battle, so NULL is already right for them.
ALTER TABLE videos ADD COLUMN match_result TEXT;
