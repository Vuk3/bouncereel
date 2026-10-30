import type { AccountResponse, CreatedResponse, NewVideo, RaceSide, VideoSummary } from '../shared/api.ts';
import { LOOK_LABELS, SOUND_LABELS } from '../shared/features.ts';
import { api, ApiError } from './api.ts';
import { openingQuestion } from './audio/opening.ts';
import { FOLLOW_LINE, type Config, type Contestant } from './config.ts';
import { SEQUENCES, type SequenceId } from './sim/sequences.ts';

// Every finished recording goes into the account's video library (the Worker's D1). A save that
// cannot reach it (offline, a session that ended, the API down) waits in this browser and is
// sent again the next time a page of the studio loads, so no recording goes unlisted.
//
// A waiting save remembers whose recording it is, and goes only into that account: two people
// signing in on one computer never post into each other's library.

/** package.json's version, written in by vite.config.ts. */
declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;

const PENDING_KEY = 'bouncereel:pending-videos';

const POWERS: Record<string, string> = { faster: 'speeds up', slower: 'slows down', grow: 'grows', split: 'splits' };

/**
 * A video's facts as plain text, for a superadmin to write its posts from with the
 * bouncereel-post skill (`.claude/skills/`): the two balls and what each does, who won and by how
 * much, the lead changes, the length, the look and the sound, the question on its first frame.
 * Built from what the library keeps, so the Videos page gives the same text for a video at any
 * time; `cfg` (the video's config) adds the colours, the look, the sound and the question, and
 * the library id lets the skill's answer find its way back to the video. The winner is in it for
 * the writer, who keeps it out of what viewers see first.
 */
export function postPrompt(video: Pick<VideoSummary, 'title' | 'fileName' | 'videoLength' | 'seed' | 'race'> & { id?: number | null }, cfg?: Config): string {
  const lines = [`BounceReel ball race: ${video.title}`];
  const race = video.race;
  if (race) {
    const ball = (place: string, side: RaceSide, c: Contestant | undefined) => {
      const seq = SEQUENCES[side.sequence as SequenceId];
      const does = seq ? `${seq.label} numbers, ${seq.brief} (${seq.hint})` : side.sequence;
      const power = POWERS[side.special] && (!c || c.amount) ? `; power: it ${POWERS[side.special]}` : '';
      return `${place} ball: ${side.name}${c ? ` (${c.color})` : ''}. ${does}${power}`;
    };
    lines.push(ball('Top', race.a, cfg?.a), ball('Bottom', race.b, cfg?.b));
    const winner = race.winner === 'a' ? race.a.name : race.winner === 'b' ? race.b.name : null;
    const by = race.margin === null ? 'far ahead' : `by ${race.margin.toFixed(race.margin < 0.095 ? 2 : 1)} s`;
    const close = cfg && cfg.timing.gap === 0 && race.margin !== null ? ', a photo finish' : '';
    lines.push(winner ? `Winner: ${winner}, ${by}${close}` : 'Winner: nobody reached the line in time, so the leader won');
    lines.push(`Lead changes: ${race.leadChanges}`);
  }
  if (cfg) {
    lines.push(`Video: ${video.videoLength} s, ${LOOK_LABELS[cfg.look.skin].toLowerCase()} look, ${SOUND_LABELS[cfg.sound.track].toLowerCase()}`);
    lines.push(`First frame: the two names, VS and "${openingQuestion(cfg)}"`);
    if (cfg.look.cta.trim()) lines.push(`Last line on the winner card: "${cfg.look.cta.trim()}"`);
    if (cfg.look.follow) lines.push(`Asks viewers to follow: a follow button in the race and under the winner card, and the narrator's "${FOLLOW_LINE}"`);
  } else lines.push(`Video: ${video.videoLength} s`);
  lines.push(`Seed: ${video.seed}`, `File: ${video.fileName}`);
  if (video.id) lines.push(`Library id: ${video.id}`);
  return lines.join('\n');
}

interface Pending {
  /** The account that recorded it; null for one saved before accounts existed (the owner's). */
  userId: number | null;
  video: NewVideo;
}

function readPending(): Pending[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    // Before accounts, the queue held the videos themselves.
    return list.map((item) => (item && typeof item === 'object' && 'video' in item ? (item as Pending) : { userId: null, video: item as NewVideo }));
  } catch {
    return [];
  }
}

function writePending(list: Pending[]): void {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage unavailable: the save is lost, and the caller has already said it failed.
  }
}

/**
 * Whether trying again could work: no connection, a session that ended (it goes in once the
 * same account signs in again), throttling or a server error. Anything else is the API refusing
 * the video itself (invalid, not in the plan, the library full), which would fail again.
 */
function transient(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status === 0 || err.status === 401 || err.status === 408 || err.status === 429 || err.status >= 500;
}

export interface Saved {
  added: boolean;
  /** The video's id in the library, once added. */
  id: number | null;
  /** What the library did with it, in a sentence or two, for the sheet after a recording. */
  message: string;
  /** The plan stood in the way: the sheet offers the pricing page. */
  upgrade: boolean;
}

/** Adds a recording to the account's library. */
export async function addToLibrary(video: NewVideo, userId: number): Promise<Saved> {
  try {
    const { id } = await api<CreatedResponse>('POST', '/api/videos', video);
    return { added: true, id, message: 'Added to Videos, where you paste its links once it is posted.', upgrade: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (!transient(err)) {
      const code = err instanceof ApiError ? err.code : '';
      // The server's reason is a sentence ("Your library is full: …"), its full stop taken off by api.ts.
      return { added: false, id: null, message: `Not added to Videos. ${reason}.`, upgrade: code === 'library_full' || code === 'not_in_plan' };
    }
    writePending([...readPending(), { userId, video }]);
    return { added: false, id: null, message: `Not in Videos yet (${reason}): it goes in the next time the studio or the Videos page opens.`, upgrade: false };
  }
}

/**
 * Sends this account's saves that failed before, oldest first; returns how many went in. One
 * saved before accounts existed goes only to a superadmin: they were the owner's, as are the videos
 * from then that the first superadmin receives.
 */
export async function retryPending(account: AccountResponse): Promise<number> {
  const mine = (p: Pending) => p.userId === account.account.id || (p.userId === null && account.account.role === 'superadmin');
  const pending = readPending();
  if (!pending.some(mine)) return 0;
  const left: Pending[] = [];
  let added = 0;
  for (const item of pending) {
    if (!mine(item)) {
      left.push(item);
      continue;
    }
    try {
      await api<CreatedResponse>('POST', '/api/videos', item.video);
      added++;
    } catch (err) {
      if (transient(err)) left.push(item);
      else console.warn('BounceReel: the library refused a saved recording, dropping it', err instanceof Error ? err.message : err, item.video);
    }
  }
  writePending(left);
  return added;
}
