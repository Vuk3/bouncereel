-- A post may have no link: the creator ticks that a video went up on a platform on the Videos
-- page, and pastes its link later or never (docs/video-library.md §5). SQLite cannot drop a NOT
-- NULL, so `posts` is rebuilt. Safe here, unlike `videos` (migrations/CLAUDE.md): no table
-- references `posts`, so dropping it cascades to nothing, and the rename rewrites no foreign key.
-- Ids are copied, so anything that later hangs off posts.id starts from the same rows.
CREATE TABLE posts_new (
  id          INTEGER PRIMARY KEY,
  video_id    INTEGER NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  platform    TEXT    NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram')),
  -- The link as given, made absolute; NULL when only the tick was given.
  url         TEXT,
  -- Read from the link (shared/links.ts); NULL without one, or when the link does not carry it.
  external_id TEXT,
  added_at    TEXT    NOT NULL,
  user_id     INTEGER REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE (video_id, platform)
);

INSERT INTO posts_new (id, video_id, platform, url, external_id, added_at, user_id)
  SELECT id, video_id, platform, url, external_id, added_at, user_id FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

CREATE UNIQUE INDEX posts_user_platform_external_id ON posts (user_id, platform, external_id) WHERE external_id IS NOT NULL;
