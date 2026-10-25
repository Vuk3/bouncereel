import type { PostTexts } from './api.ts';

// The texts for posting a video on YouTube, TikTok and Instagram, as the bouncereel-post skill
// writes them: a JSON object the admin pastes on the Videos page (docs/video-library.md §6). One
// parser for both sides, as links have (shared/links.ts): the page says what is wrong with a
// paste before sending it, and the Worker checks the same before storing it.

/** Each platform's own limits: YouTube's title 100 and description 5,000, its tags 500 in all; TikTok's caption 4,000; Instagram's caption and a comment 2,200. */
const LIMITS = { title: 100, description: 5000, tags: 500, tiktok: 4000, instagram: 2200, comment: 2200 };

/**
 * The skill's JSON, given whole or in a ```json block, parsed; or why it is not JSON. The skill's
 * answer goes on after the JSON with the thumbnail's path, and copied as the chat shows it the
 * fence is gone: without one, the JSON is the first brace to the last.
 */
export function readPasted(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const source = (fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).trim();
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('That is not the JSON the bouncereel-post skill writes: copy its whole answer.');
  }
}

/** Which video pasted texts say they are for: the library id, else the file name. */
export function textsTarget(value: unknown): { id: number | null; file: string | null } {
  const o = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    id: typeof o.video === 'number' && Number.isInteger(o.video) ? o.video : null,
    file: typeof o.file === 'string' && o.file.trim() ? o.file.trim() : null,
  };
}

/** The three platforms' texts in `value`, trimmed; throws with what is missing or too long. */
export function parseTexts(value: unknown): PostTexts {
  const o = record(value, 'The texts');
  const youtube = record(o.youtube, 'youtube');
  const tiktok = record(o.tiktok, 'tiktok');
  const instagram = record(o.instagram, 'instagram');
  const tags = youtube.tags;
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')) throw new Error('youtube.tags must be a list of words.');
  const cleanTags = tags.map((t: string) => t.trim()).filter(Boolean);
  if (cleanTags.join(',').length > LIMITS.tags) throw new Error(`youtube.tags come to more than YouTube's ${LIMITS.tags} characters.`);
  return {
    youtube: {
      title: line(youtube.title, 'youtube.title', LIMITS.title, true),
      description: line(youtube.description, 'youtube.description', LIMITS.description, true),
      tags: cleanTags,
      pinnedComment: line(youtube.pinnedComment, 'youtube.pinnedComment', LIMITS.comment, false),
    },
    tiktok: {
      caption: line(tiktok.caption, 'tiktok.caption', LIMITS.tiktok, true),
      pinnedComment: line(tiktok.pinnedComment, 'tiktok.pinnedComment', LIMITS.comment, false),
    },
    instagram: {
      caption: line(instagram.caption, 'instagram.caption', LIMITS.instagram, true),
      pinnedComment: line(instagram.pinnedComment, 'instagram.pinnedComment', LIMITS.comment, false),
    },
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} is missing.`);
  return value as Record<string, unknown>;
}

function line(value: unknown, name: string, max: number, required: boolean): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${name} is missing.`);
  if (value.trim().length > max) throw new Error(`${name} is longer than the platform's ${max} characters.`);
  return value.trim();
}
