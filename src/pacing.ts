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
 * The opening title over the first frame (the names, what each does, the VS, the question;
 * src/render): whole through the hold and the race's first OPENING_LINGER seconds, then gone over
 * OPENING_FADE, about 1.5 s with no hold: the time its words take to read. The race does not wait
 * for it: the balls move under it from the first frame, since the second a viewer decides in is
 * no time for a still picture.
 */
const OPENING_LINGER = 0.9;
const OPENING_FADE = 0.6;

/**
 * 0..1, how much of the opening title shows `sinceRace` seconds after the race started; null
 * while it has not (the hold). Counted from the race's own start, so a hold changed mid-run
 * does not bring the title back.
 */
export function openingShown(sinceRace: number | null): number {
  return sinceRace === null ? 1 : Math.max(0, Math.min(1, 1 - (sinceRace - OPENING_LINGER) / OPENING_FADE));
}

/**
 * How fast Kokoro speaks, measured on the winner lines of 80 rolled videos, with and without
 * "Follow for more!", each clip cut to the voice (narration.ts `synthesize`): about 17 characters
 * a second, a time read out as words, and SENTENCE_PAUSE between two sentences. Heart, the default,
 * and Fenrir come within 0.4 s of it nine lines in ten and within 0.6 s always; Nicole speaks slower,
 * up to 2 s over. A line the guess makes short ends the video that much past its length, one it
 * makes long that much before it: the card waits for the line, never for the length.
 */
const SPOKEN_CHARS_PER_SECOND = 17;
/** Kokoro's own silence after one sentence and before the next, with the breath between them. */
const SENTENCE_PAUSE = 0.85;
/** How a time ("{time} seconds") is said: "32.4" takes as long as these words. */
const TIME_SAID = 'thirty-two point four';
/**
 * The card stays this long after the narrator's last word: a beat, then the fade into the first
 * frame (END_PAD), 0.8 s from the last word to the loop. Once the race is called, a silent card
 * is where viewers scroll away.
 */
export const AFTER_OUTRO = 0.3;
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

/** The guess at how long Kokoro takes to say `line`, in seconds, split into sentences as narration.ts splits it. */
export function spokenSeconds(line: string): number {
  const pauses = line.trim().split(/(?<=[.!?])\s+/).length - 1;
  return line.replace(/\d+\.\d/g, TIME_SAID).length / SPOKEN_CHARS_PER_SECOND + pauses * SENTENCE_PAUSE;
}

/** The shortest the winner card stays: the hold, or FOLLOW_CARD with the follow button. */
export function cardHold(cfg: Config): number {
  return cfg.look.follow ? Math.max(cfg.timing.hold, FOLLOW_CARD) : cfg.timing.hold;
}

/**
 * How long the winner card is planned to stay up: the hold (cardHold), or long enough to say the
 * winner line, whichever is more. The line said for `winner` when it is known (balancing picks the
 * winner before it sets the speeds), else the longer of the two: a crowd wins as "the crowd of 100
 * Millionaire Balls", and a card planned for that line when the other ball wins ends the video a
 * second or more short. The page ends the card a beat after the line it says, so a guess off by a
 * few tenths moves the video's end, never holds a silent card.
 */
export function cardSeconds(cfg: Config, winner?: string): number {
  const hold = cardHold(cfg);
  if (!narrated(cfg)) return hold;
  const names = winner === undefined ? [cfg.a.name, cfg.b.name] : [winner];
  const longest = Math.max(...names.map((name) => spokenSeconds(spokenOutro(cfg, { winner: name, time: '00.0' }))));
  return Math.max(hold, longest + AFTER_OUTRO);
}

/** Seconds of video that are not race: everything above except the race itself. */
export function overhead(cfg: Config, winner?: string): number {
  return cfg.timing.startDelay + SLOWMO_LEAD * (1 / SLOWMO - 1) + SLOWMO_TAIL + cardSeconds(cfg, winner) + END_PAD;
}

/** How long the race should take for the video to come out at the requested length, `winner` winning. */
export function raceSeconds(cfg: Config, winner?: string): number {
  return Math.max(8, cfg.timing.video - overhead(cfg, winner));
}

export function videoSeconds(cfg: Config, race: number, winner?: string): number {
  return race + overhead(cfg, winner);
}
