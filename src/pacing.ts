import { spokenOutro, type Config } from './config.ts';

// How a video is paced around the race, in one place: the page plays it this
// way, and the balancer subtracts it from the requested video length to know
// how long the race itself may take.
//
//   hold ─ race ─ slow motion (into and out of the win) ─ winner card ─ end

/** Speed of slow motion. */
export const SLOWMO = 0.3;
/** Simulated seconds before the known win that slow motion starts: 0.6 s plays as 2 s. */
export const SLOWMO_LEAD = 0.6;
/** Real seconds of slow motion after the win before the winner card. */
export const SLOWMO_TAIL = 1.2;
/**
 * The end after the winner card: the cross-fade into the first frame when the video
 * loops (`look.loop`), else a held moment so it does not end on a cut. Thirty frames:
 * long enough to read as a fade, short enough that the card is still the last thing seen.
 */
export const END_PAD = 0.5;
/**
 * The opening title over the first frame (the names, the VS, the question; src/render): whole
 * through the hold and the race's first OPENING_LINGER seconds, then gone over OPENING_FADE. With
 * the default 0.5 s hold it is up for about 1.2 s: the time its words take to read. A hold that
 * long would take a second from every race; the first second of a race is the balls dropping to
 * their first layer, which the title can fade over.
 */
const OPENING_LINGER = 0.4;
const OPENING_FADE = 0.6;

/**
 * 0..1, how much of the opening title shows `sinceRace` seconds after the race started; null
 * while it has not (the hold). Counted from the race's own start, so a hold changed mid-run
 * does not bring the title back.
 */
export function openingShown(sinceRace: number | null): number {
  return sinceRace === null ? 1 : Math.max(0, Math.min(1, 1 - (sinceRace - OPENING_LINGER) / OPENING_FADE));
}

/** Kokoro says about 12 characters a second; slightly slow, so the guess errs long. */
const SPOKEN_CHARS_PER_SECOND = 11;
/** The card stays at least this long after the winner line ends. */
export const AFTER_OUTRO = 0.4;
/**
 * The card stays at least this long when the video asks viewers to follow (`look.follow`): the
 * follow button under it is tapped 1.5 s in (src/render/renderer.ts, FOLLOW_TAP), and the
 * FOLLOWING it turns into stays a second to be read.
 */
const FOLLOW_CARD = 2.5;

/** Whether the video has a narrator: the sound is Narrator and music. */
export function narrated(cfg: Config): boolean {
  return cfg.sound.track === 'narrator';
}

/**
 * How long the winner card is planned to stay up: the hold (with the follow button, at
 * least FOLLOW_CARD), or long enough to say the winner line for the longer of the two
 * names, whichever is more. The page then stretches the card to land the video on its
 * exact length.
 */
export function cardSeconds(cfg: Config): number {
  const hold = cfg.look.follow ? Math.max(cfg.timing.hold, FOLLOW_CARD) : cfg.timing.hold;
  if (!narrated(cfg)) return hold;
  const longest = cfg.a.name.length >= cfg.b.name.length ? cfg.a.name : cfg.b.name;
  const line = spokenOutro(cfg, { winner: longest, time: '00.0' });
  return Math.max(hold, line.length / SPOKEN_CHARS_PER_SECOND + AFTER_OUTRO);
}

/** Seconds of video that are not race: everything above except the race itself. */
export function overhead(cfg: Config): number {
  return cfg.timing.startDelay + SLOWMO_LEAD * (1 / SLOWMO - 1) + SLOWMO_TAIL + cardSeconds(cfg) + END_PAD;
}

/** How long the race should take for the video to come out at the requested length. */
export function raceSeconds(cfg: Config): number {
  return Math.max(8, cfg.timing.video - overhead(cfg));
}

export function videoSeconds(cfg: Config, race: number): number {
  return race + overhead(cfg);
}
