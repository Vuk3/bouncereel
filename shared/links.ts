import type { Platform } from './api.ts';

// Reads a link to a published video: checks that it points at a post on that platform and
// takes the post's id out of it. The page runs it before sending a link and the Worker
// again before storing one; the id is what makes a post unique (and what statistics will
// be fetched by, once they are).

export interface PostLink {
  /** Absolute: a link pasted without "https://" gets it. */
  url: string;
  externalId: string | null;
}

/** YouTube video ids are always 11 characters of the base64url alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TIKTOK_ID = /^\d{8,25}$/;
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,40}$/;

/** Returns null for anything that is not a link to a post on `platform`. */
export function parsePostLink(platform: Platform, input: string): PostLink | null {
  const text = input.trim();
  if (!text || text.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  // Exact host names only, so "youtube.com.example.net" is not YouTube.
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  const id = postId(platform, host, parts, url.searchParams);
  return id === undefined ? null : { url: url.href, externalId: id };
}

/** The post's id, null for a valid link that does not carry one, undefined for not a post link. */
function postId(platform: Platform, host: string, parts: string[], query: URLSearchParams): string | null | undefined {
  switch (platform) {
    case 'youtube': {
      // youtu.be/ID · youtube.com/shorts/ID · /watch?v=ID · /embed/ID · /live/ID
      let id: string | null | undefined;
      if (host === 'youtu.be') id = parts[0];
      else if (host === 'youtube.com' || host === 'music.youtube.com') {
        id = parts[0] === 'watch' ? query.get('v') : ['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : undefined;
      }
      return id && YOUTUBE_ID.test(id) ? id : undefined;
    }
    case 'tiktok': {
      // tiktok.com/@user/video/ID (or /photo/ID). The short links (vm., vt., tiktok.com/t/)
      // only redirect to that, and following them would need a request: kept without an id.
      if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return parts.length ? null : undefined;
      if (host !== 'tiktok.com') return undefined;
      if (parts[0] === 't') return parts[1] ? null : undefined;
      const at = parts.findIndex((p) => p === 'video' || p === 'photo');
      const id = at > 0 && parts[0].startsWith('@') ? parts[at + 1] : undefined;
      return id && TIKTOK_ID.test(id) ? id : undefined;
    }
    case 'instagram': {
      // instagram.com/reel/CODE · /reels/CODE · /p/CODE · /tv/CODE, with or without the
      // account's name in front.
      if (host !== 'instagram.com') return undefined;
      const at = parts.findIndex((p) => p === 'reel' || p === 'reels' || p === 'p' || p === 'tv');
      const code = at >= 0 ? parts[at + 1] : undefined;
      return code && INSTAGRAM_CODE.test(code) ? code : undefined;
    }
  }
}
