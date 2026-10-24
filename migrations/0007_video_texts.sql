-- The texts for posting a video (YouTube's title, description, tags and pinned comment; the
-- TikTok and Instagram captions and pinned comments), kept with it so they are there when it goes
-- up. A superadmin's tool: the bouncereel-post skill writes them as JSON, pasted on the Videos
-- page (docs/video-library.md §6). One JSON column rather than a table: it is read and replaced
-- whole, never queried by field. NULL until pasted, so existing rows need no filling.
ALTER TABLE videos ADD COLUMN texts TEXT;
