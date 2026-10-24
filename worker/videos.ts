import type { NewVideo, Platform, Post, VideoDetail, VideoSummary } from '../shared/api.ts';
import type { PostLink } from '../shared/links.ts';

// Every D1 query of the video library, and the mappers from rows (migrations/0001_initial.sql,
// 0002_accounts.sql) to the API's shapes (shared/api.ts). Handlers never write SQL themselves.
//
// Every query names the account (`user_id`): a video or link of another account is not found,
// exactly like one that does not exist, so no answer tells one from the other.

interface VideoRow {
  id: number;
  game: string;
  recorded_at: string;
  title: string;
  file_name: string;
  format: string;
  seconds: number;
  stopped_early: number;
  video_length: number;
  seed: string;
  app_version: string;
  a_name: string | null;
  a_sequence: string | null;
  a_special: string | null;
  b_name: string | null;
  b_sequence: string | null;
  b_special: string | null;
  winner: 'a' | 'b' | null;
  margin: number | null;
  lead_changes: number | null;
}

interface PostRow {
  video_id: number;
  platform: Platform;
  url: string;
  external_id: string | null;
  added_at: string;
}

/** Everything but `config`, which only the single-video read needs. */
const SUMMARY_COLUMNS = `id, game, recorded_at, title, file_name, format, seconds, stopped_early, video_length, seed,
  app_version, a_name, a_sequence, a_special, b_name, b_sequence, b_special, winner, margin, lead_changes`;
const POST_COLUMNS = 'video_id, platform, url, external_id, added_at';

function toPost(row: PostRow): Post {
  return { platform: row.platform, url: row.url, externalId: row.external_id, addedAt: row.added_at };
}

function toSummary(row: VideoRow, posts: Post[]): VideoSummary {
  return {
    id: row.id,
    game: row.game,
    recordedAt: row.recorded_at,
    title: row.title,
    fileName: row.file_name,
    format: row.format,
    seconds: row.seconds,
    stoppedEarly: row.stopped_early === 1,
    videoLength: row.video_length,
    seed: row.seed,
    appVersion: row.app_version,
    race:
      row.game === 'ball-race'
        ? {
            a: { name: row.a_name ?? '', sequence: row.a_sequence ?? '', special: row.a_special ?? '' },
            b: { name: row.b_name ?? '', sequence: row.b_sequence ?? '', special: row.b_special ?? '' },
            winner: row.winner,
            margin: row.margin,
            leadChanges: row.lead_changes ?? 0,
          }
        : null,
    posts,
  };
}

/** An account's videos, newest first, each with its posts. Two queries, whatever the count. */
export async function selectVideos(db: D1Database, userId: number): Promise<VideoSummary[]> {
  const [videos, posts] = await Promise.all([
    db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM videos WHERE user_id = ?1 ORDER BY recorded_at DESC, id DESC`).bind(userId).all<VideoRow>(),
    db.prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE user_id = ?1 ORDER BY platform`).bind(userId).all<PostRow>(),
  ]);
  const byVideo = new Map<number, Post[]>();
  for (const row of posts.results) {
    const list = byVideo.get(row.video_id) ?? [];
    list.push(toPost(row));
    byVideo.set(row.video_id, list);
  }
  return videos.results.map((row) => toSummary(row, byVideo.get(row.id) ?? []));
}

export async function selectVideo(db: D1Database, id: number, userId: number): Promise<VideoDetail | null> {
  const [video, posts] = await Promise.all([
    db.prepare(`SELECT ${SUMMARY_COLUMNS}, config FROM videos WHERE id = ?1 AND user_id = ?2`).bind(id, userId).first<VideoRow & { config: string }>(),
    db.prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE video_id = ?1 AND user_id = ?2 ORDER BY platform`).bind(id, userId).all<PostRow>(),
  ]);
  if (!video) return null;
  return { ...toSummary(video, posts.results.map(toPost)), config: JSON.parse(video.config) };
}

export async function videoExists(db: D1Database, id: number, userId: number): Promise<boolean> {
  return (await db.prepare('SELECT 1 FROM videos WHERE id = ?1 AND user_id = ?2').bind(id, userId).first()) !== null;
}

export async function countVideos(db: D1Database, userId: number): Promise<number> {
  return (await db.prepare('SELECT COUNT(*) AS n FROM videos WHERE user_id = ?1').bind(userId).first<number>('n')) ?? 0;
}

/**
 * Adds a video to the account's library; null when the library already holds `limit` videos.
 * The count is checked inside the INSERT, so two saves at once cannot both take the last place.
 */
export async function insertVideo(db: D1Database, video: NewVideo, userId: number, limit: number | null): Promise<number | null> {
  const { race } = video;
  const row = await db
    .prepare(
      `INSERT INTO videos (user_id, game, recorded_at, title, file_name, format, seconds, stopped_early, video_length, seed, config,
        app_version, a_name, a_sequence, a_special, b_name, b_sequence, b_special, winner, margin, lead_changes)
       SELECT ?21, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
        WHERE ?22 IS NULL OR (SELECT COUNT(*) FROM videos WHERE user_id = ?21) < ?22
       RETURNING id`,
    )
    .bind(
      video.game,
      video.recordedAt,
      video.title,
      video.fileName,
      video.format,
      video.seconds,
      video.stoppedEarly ? 1 : 0,
      video.videoLength,
      video.seed,
      JSON.stringify(video.config),
      video.appVersion,
      race.a.name,
      race.a.sequence,
      race.a.special,
      race.b.name,
      race.b.sequence,
      race.b.special,
      race.winner,
      race.margin,
      race.leadChanges,
      userId,
      limit,
    )
    .first<{ id: number }>();
  return row?.id ?? null;
}

/** Removes a video with its posts (ON DELETE CASCADE); false when the account has no such video. */
export async function deleteVideo(db: D1Database, id: number, userId: number): Promise<boolean> {
  const result = await db.prepare('DELETE FROM videos WHERE id = ?1 AND user_id = ?2').bind(id, userId).run();
  return result.meta.changes > 0;
}

/** The account's video that already has this post, if any: one published video belongs to one recording. */
export async function postOwner(db: D1Database, userId: number, platform: Platform, externalId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT video_id FROM posts WHERE user_id = ?1 AND platform = ?2 AND external_id = ?3')
    .bind(userId, platform, externalId)
    .first<{ video_id: number }>();
  return row?.video_id ?? null;
}

/** Sets a video's link on a platform, replacing the one it had; the caller has checked the video is the account's. */
export async function upsertPost(db: D1Database, videoId: number, userId: number, platform: Platform, link: PostLink, now: Date): Promise<Post> {
  const row = await db
    .prepare(
      `INSERT INTO posts (video_id, user_id, platform, url, external_id, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (video_id, platform) DO UPDATE SET url = excluded.url, external_id = excluded.external_id, added_at = excluded.added_at
       RETURNING ${POST_COLUMNS}`,
    )
    .bind(videoId, userId, platform, link.url, link.externalId, now.toISOString())
    .first<PostRow>();
  if (!row) throw new Error('INSERT … RETURNING returned no post');
  return toPost(row);
}

export async function deletePost(db: D1Database, videoId: number, userId: number, platform: Platform): Promise<boolean> {
  const result = await db.prepare('DELETE FROM posts WHERE video_id = ?1 AND user_id = ?2 AND platform = ?3').bind(videoId, userId, platform).run();
  return result.meta.changes > 0;
}
