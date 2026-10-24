-- The video library: every finished recording, and where each one was published.
--
-- A video's whole Config is stored as JSON. The simulation is deterministic, so that
-- config replays the same race, narration and sound: the MP4 itself is never stored.
-- The ball-race columns copy what the dashboard sorts and groups by out of the config,
-- so a query never has to parse JSON; another game leaves them NULL and adds its own.

CREATE TABLE videos (
  id            INTEGER PRIMARY KEY,
  -- Which game made it. Every video so far is a number ball race.
  game          TEXT    NOT NULL DEFAULT 'ball-race',
  -- When the recording finished, ISO 8601 UTC, as the browser saw it (a save retried
  -- later keeps its own time).
  recorded_at   TEXT    NOT NULL,
  -- "Fibonacci Ball vs Doubling Ball"
  title         TEXT    NOT NULL,
  file_name     TEXT    NOT NULL,
  -- What the browser wrote: "MP4 · H.264 · AAC"
  format        TEXT    NOT NULL,
  -- The file's measured length; video_length is the length it was balanced for.
  seconds       REAL    NOT NULL,
  -- 1 when Stop & save ended it before the winner card had its time.
  stopped_early INTEGER NOT NULL DEFAULT 0 CHECK (stopped_early IN (0, 1)),
  video_length  INTEGER NOT NULL,
  seed          TEXT    NOT NULL,
  config        TEXT    NOT NULL,
  -- package.json's version when it was recorded: a later change to the simulation can
  -- make the same config play differently, and this says which code made the file.
  app_version   TEXT    NOT NULL,

  -- Ball race (NULL for other games). 'a' is the top card, 'b' the bottom one.
  a_name        TEXT,
  a_sequence    TEXT,
  a_special     TEXT,
  b_name        TEXT,
  b_sequence    TEXT,
  b_special     TEXT,
  -- NULL only for a race nobody finished (timed out).
  winner        TEXT CHECK (winner IN ('a', 'b')),
  -- Seconds between the winner and the loser touching the line.
  margin        REAL,
  lead_changes  INTEGER
);

CREATE INDEX videos_recorded_at ON videos (recorded_at);

-- Where a video went up: at most one post per platform. Statistics, when they come,
-- hang off posts.id in a table of their own (docs/video-library.md says how).
CREATE TABLE posts (
  id          INTEGER PRIMARY KEY,
  video_id    INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  platform    TEXT    NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram')),
  -- The link as given, made absolute ("youtu.be/…" gets its https://).
  url         TEXT    NOT NULL,
  -- YouTube's 11-character id, TikTok's numeric video id or Instagram's shortcode,
  -- read from the link (shared/links.ts); NULL when the link does not carry it (a
  -- vm.tiktok.com short link).
  external_id TEXT,
  added_at    TEXT    NOT NULL,
  UNIQUE (video_id, platform)
);

-- One published video belongs to one recording.
CREATE UNIQUE INDEX posts_platform_external_id ON posts (platform, external_id) WHERE external_id IS NOT NULL;
