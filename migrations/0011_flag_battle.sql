-- Arena Clash, the second game: what one came to goes in `battle`, as JSON (shared/api.ts
-- BattleSummary: the flags in the board's order, the winner, the order they went out), the way
-- a race's goes in its own columns. Additive: the old Worker never reads it, and a battle's race
-- columns (a_*, b_*, winner, margin, lead_changes) stay NULL, which `winner`'s CHECK allows. The
-- race's columns stay as they are: widening their CHECK would mean rebuilding `videos`
-- (migrations/CLAUDE.md). Every existing row is a race, so NULL is already right for them.
ALTER TABLE videos ADD COLUMN battle TEXT;
