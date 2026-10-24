import type { AccountResponse, CreatedResponse, NewVideo } from '../shared/api.ts';
import { api, ApiError } from './api.ts';

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

interface Pending {
  /** The account that recorded it; null for one saved before accounts existed (Vuk's). */
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
  /** What the library did with it, in a sentence or two, for the sheet after a recording. */
  message: string;
  /** The plan stood in the way: the sheet offers the pricing page. */
  upgrade: boolean;
}

/** Adds a recording to the account's library. */
export async function addToLibrary(video: NewVideo, userId: number): Promise<Saved> {
  try {
    await api<CreatedResponse>('POST', '/api/videos', video);
    return { added: true, message: 'Added to Videos, where you paste its links once it is posted.', upgrade: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (!transient(err)) {
      const code = err instanceof ApiError ? err.code : '';
      // The server's reason is a sentence ("Your library is full: …"), its full stop taken off by api.ts.
      return { added: false, message: `Not added to Videos. ${reason}.`, upgrade: code === 'library_full' || code === 'not_in_plan' };
    }
    writePending([...readPending(), { userId, video }]);
    return { added: false, message: `Not in Videos yet (${reason}): it goes in the next time the studio or the Videos page opens.`, upgrade: false };
  }
}

/**
 * Sends this account's saves that failed before, oldest first; returns how many went in. One
 * saved before accounts existed goes only to a superadmin: they were Vuk's, as are the videos
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
