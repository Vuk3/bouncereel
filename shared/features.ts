// What a plan can unlock. The set of features is defined here, in code; each plan's values
// for them live in D1 (`plans.features`, JSON), so the owner changes what a plan gives in the admin
// area without a deploy. The pricing page, the studio's gates and the Worker's checks on a
// save all read these same shapes. Nothing here may use the DOM or the Workers runtime.

/** What Record may put in the file's sound: the narrator over the music, the music alone, nothing. */
export const SOUNDS = ['narrator', 'music', 'silent'] as const;
export type Sound = (typeof SOUNDS)[number];

/**
 * The video's looks, `look.skin` in the config (src/config.ts takes its `Skin` from here). Night is
 * the cards look after dark. This is the order every list shows them in, night between the two
 * light ones: the admin's plan form, a plan's words, the home page's look dialog. The tiles written
 * out in app.html and index.html keep it by hand.
 */
export const LOOKS = ['paper', 'night', 'cards'] as const;
export type Look = (typeof LOOKS)[number];

/** The studio's Length slider runs 20–90 s in steps of 5 (app.html). */
export const MIN_VIDEO_SECONDS = 20;
export const MAX_VIDEO_SECONDS = 90;

export interface Features {
  /** Which sounds Record may write. `narrator` also needs `narrator: true`. */
  sounds: Sound[];
  /** The narrator at all: the Voice tab, Play with voice, "Hear the opening". */
  narrator: boolean;
  /** The longest video the Length slider and a save allow, seconds. */
  maxSeconds: number;
  looks: Look[];
  /** A ball with a power: the dice's Powers switch, the Power field, the classics that have one. */
  powers: boolean;
  /**
   * Videos a day; null is no limit. A video is counted as Record starts (worker/routes/account.ts
   * takeVideo); previews are free. The day is the UTC calendar day, so the allowance comes back
   * at midnight UTC (worker/plans.ts claimDay), and a video deleted from the library still
   * counts: its MP4 was made.
   */
  perDay: number | null;
  /** Videos kept in the library; null is no limit. */
  library: number | null;
  /**
   * A small BounceReel watermark on every video (the mark and the site's host), between the two cards (`drawWatermark` in
   * src/render/renderer.ts). The video is drawn in the browser, so the studio is what applies it.
   */
  watermark: boolean;
  /**
   * The studio's Ask viewers to follow switch (`look.follow`): a follow button once in the race
   * and under the winner card, and "Follow for more!" after the winner line.
   */
  follow: boolean;
  /**
   * Every game BounceReel makes, each new one included as it comes out. Ball races are the one
   * game today, which every plan makes; nothing checks this until there is a second.
   */
  allGames: boolean;
}

/** A superadmin's features, whatever plan their subscription names: the owner's account has everything. */
export const EVERYTHING: Features = {
  sounds: [...SOUNDS],
  narrator: true,
  maxSeconds: MAX_VIDEO_SECONDS,
  looks: [...LOOKS],
  powers: true,
  perDay: null,
  library: null,
  watermark: false,
  follow: true,
  allGames: true,
};

/**
 * What a stored plan gets for a feature it has no value for (one added to the code after the
 * plan was saved), or for a value that no longer reads: the least. A plan unlocks nothing by
 * accident; the owner turns the new feature on in the admin area.
 */
const LEAST: Features = {
  sounds: ['silent'],
  narrator: false,
  maxSeconds: MIN_VIDEO_SECONDS,
  looks: ['paper'],
  powers: false,
  perDay: 0,
  library: 0,
  watermark: true,
  follow: false,
  allGames: false,
};

/** The admin's form takes up to this many videos a day, and as many kept in the library: a typo, not a plan, beyond. */
const MOST_PER_DAY = 1000;
const MOST_KEPT = 100_000;

/** A limit as stored: a whole number from `min` up to `max`, or null for none. */
function isLimit(value: unknown, min: number, max: number): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max);
}

function pickList<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(value)) return null;
  // In the code's order, each once, so two plans that allow the same things compare equal.
  return allowed.filter((item) => value.includes(item));
}

/** A plan's features as stored (or sent): every key present and valid, the least where not. */
export function readFeatures(value: unknown): Features {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const seconds = raw.maxSeconds;
  return {
    sounds: pickList(raw.sounds, SOUNDS) ?? LEAST.sounds,
    narrator: typeof raw.narrator === 'boolean' ? raw.narrator : LEAST.narrator,
    maxSeconds:
      typeof seconds === 'number' && Number.isInteger(seconds) && seconds >= MIN_VIDEO_SECONDS && seconds <= MAX_VIDEO_SECONDS ? seconds : LEAST.maxSeconds,
    looks: pickList(raw.looks, LOOKS) ?? LEAST.looks,
    powers: typeof raw.powers === 'boolean' ? raw.powers : LEAST.powers,
    perDay: isLimit(raw.perDay, 0, Infinity) ? raw.perDay : LEAST.perDay,
    library: isLimit(raw.library, 0, Infinity) ? raw.library : LEAST.library,
    watermark: typeof raw.watermark === 'boolean' ? raw.watermark : LEAST.watermark,
    follow: typeof raw.follow === 'boolean' ? raw.follow : LEAST.follow,
    allGames: typeof raw.allGames === 'boolean' ? raw.allGames : LEAST.allGames,
  };
}

/**
 * Why `value` is not a valid set of features for a plan, or null when it is. Stricter than
 * readFeatures: the admin's form must say what it means, not fall back silently.
 */
export function featuresProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be an object';
  const raw = value as Record<string, unknown>;
  const list = (key: string, allowed: readonly string[]) =>
    Array.isArray(raw[key]) && (raw[key] as unknown[]).every((v) => allowed.includes(v as string)) && (raw[key] as unknown[]).length > 0;
  if (!list('sounds', SOUNDS)) return `sounds must list at least one of ${SOUNDS.join(', ')}`;
  if (!list('looks', LOOKS)) return `looks must list at least one of ${LOOKS.join(', ')}`;
  for (const key of ['narrator', 'powers', 'watermark', 'follow', 'allGames']) if (typeof raw[key] !== 'boolean') return `${key} must be true or false`;
  const seconds = raw.maxSeconds;
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < MIN_VIDEO_SECONDS || seconds > MAX_VIDEO_SECONDS) {
    return `maxSeconds must be a whole number from ${MIN_VIDEO_SECONDS} to ${MAX_VIDEO_SECONDS}`;
  }
  // At least one a day: a plan that records nothing is not a plan.
  if (!isLimit(raw.perDay, 1, MOST_PER_DAY)) return `perDay must be a whole number from 1 to ${MOST_PER_DAY}, or null for no limit`;
  if (!isLimit(raw.library, 0, MOST_KEPT)) return `library must be a whole number from 0 to ${MOST_KEPT}, or null for no limit`;
  return null;
}

/** Whether Record may write this sound: the narrator needs both the sound and the narrator itself. */
export function soundAllowed(features: Features, sound: Sound): boolean {
  return features.sounds.includes(sound) && (sound !== 'narrator' || features.narrator);
}

export const SOUND_LABELS: Record<Sound, string> = {
  narrator: 'Narrator and music',
  music: 'Music only',
  silent: 'Silent',
};

export const LOOK_LABELS: Record<Look, string> = { paper: 'Paper', night: 'Night', cards: 'Cards' };

/** A plan's features in words, for the pricing page and the admin's plan list; `included` false reads as "not in it". */
export function describeFeatures(f: Features): { text: string; included: boolean }[] {
  const looks = f.looks.map((l) => LOOK_LABELS[l]);
  const sounds = f.sounds.filter((s) => soundAllowed(f, s));
  const narrator = f.narrator && sounds.includes('narrator');
  return [
    // Only the plan that has every game says so: the ball races are the whole of the others.
    ...(f.allGames ? [{ text: 'Every game, and each new one as it comes out', included: true }] : []),
    { text: f.perDay === null ? 'Unlimited videos' : `${f.perDay} video${f.perDay === 1 ? '' : 's'} a day`, included: f.perDay !== 0 },
    { text: `Videos up to ${f.maxSeconds} seconds`, included: true },
    { text: looks.length === LOOKS.length ? 'All three looks' : `The ${joinWords(looks.map((l) => l.toLowerCase()))} look${looks.length === 1 ? '' : 's'}`, included: true },
    {
      text: sounds.length === SOUNDS.length ? 'Narrator and music, music only, or silent' : sounds.map((s, i) => (i ? SOUND_LABELS[s].toLowerCase() : SOUND_LABELS[s])).join(' or '),
      included: true,
    },
    { text: narrator ? 'A narrator: the opening and the winner' : 'No narrator', included: narrator },
    { text: f.powers ? 'Powers: balls that speed up, grow or split' : 'No powers', included: f.powers },
    { text: f.watermark ? 'A small BounceReel watermark' : 'No watermark', included: !f.watermark },
    { text: f.follow ? 'A follow button that asks viewers to follow you' : 'No follow button', included: f.follow },
    { text: f.library === null ? 'Every video kept in your library' : `${f.library} video${f.library === 1 ? '' : 's'} kept in your library`, included: f.library !== 0 },
  ];
}

function joinWords(words: string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
