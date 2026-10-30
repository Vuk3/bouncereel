import { LOOKS, type Look, type Sound } from '../shared/features.ts';
import { firstQuestion } from './audio/opening.ts';
import type { SequenceId } from './sim/sequences.ts';

// Everything a video is made of. A Config fully determines the run, so a
// preset is a Config and sharing a matchup is sharing this JSON.

export type Timbre = 'marimba' | 'bell' | 'pluck' | 'chip';
export type MelodyId = 'ode' | 'elise' | 'twinkle' | 'scale';
/** What else happens on every floor hit. */
export type Special = 'none' | 'faster' | 'slower' | 'grow' | 'split';
/**
 * The video's look. `paper`: cream boxes in thin ink frames, glossy layers, glowing balls
 * with trails, as the format's biggest channels draw it. `cards`: white cards with hard
 * shadows and name pills on a pastel page. `night`: the cards after dark. The list lives in
 * shared/features.ts, since a plan says which looks it includes.
 */
export type Skin = Look;
export const SKINS: Skin[] = [...LOOKS];

export interface Contestant {
  /** As shown above the box and spoken: "Fibonacci Ball". */
  name: string;
  color: string;
  sequence: SequenceId;
  /** px/s, constant unless the special changes it. */
  speed: number;
  special: Special;
  /** faster / slower: % per hit · grow: px of radius per hit · split: balls added per hit. */
  amount: number;
  radius: number;
}

export interface Config {
  seed: string;
  /** Top box. */
  a: Contestant;
  /** Bottom box. */
  b: Contestant;
  /** Health of each layer, top first: "1000, 1e10, 1e15" (also 1k, 10b, 1q). */
  layers: string;
  physics: {
    /** px/s². 0 is the format: balls fly straight and keep their speed. */
    gravity: number;
    maxSpeed: number;
  };
  sound: {
    melody: MelodyId;
    timbre: Timbre;
    volume: number;
    /**
     * What Record puts in the file's sound: the narrator over the music, the music alone (notes,
     * cracks, fanfare), or nothing, for a creator who adds a sound in the app they post from.
     * Play follows it too, so the preview sounds like the file.
     */
    track: Sound;
  };
  /** The narrator, Kokoro: it speaks when the sound is Narrator and music (`sound.track`). */
  voice: {
    /** A Kokoro voice id (`VOICES` in src/audio/narration.ts). */
    voice: string;
    /** The opening narration; empty means the one written from the rules. */
    script: string;
    /** The winner line, with {winner} and {time} filled in; empty for none. The dice deals one of WINNER_LINES. */
    outro: string;
  };
  timing: {
    /** The length the whole video should come out at, in seconds; balancing sets the ball speeds for it. */
    video: number;
    /**
     * Seconds the loser reaches the line after the winner, which balancing aims for. 0 is a
     * photo finish: 0.15–1.1 s, picked by the seed.
     */
    gap: number;
    /** Seconds the scene holds still before the balls move. */
    startDelay: number;
    /** Seconds the winner card stays up before a recording stops. */
    hold: number;
    /** A run that has not finished by now ends and the leader wins. Balancing sets it to the race plus 30 s. */
    maxSeconds: number;
  };
  look: {
    skin: Skin;
    /**
     * The question over the first frame, which the automatic opening ends on too; empty for the
     * seed's pick of QUESTIONS (src/audio/opening.ts).
     */
    question: string;
    /** The last line on the winner card ("Did you call it? Comment below!"); empty for none. The dice deals one of LAST_LINES. */
    cta: string;
    /** The last half second cross-fades into the first frame, so the video loops without a visible cut. */
    loop: boolean;
    /**
     * Ask viewers to follow: a follow button once in the race and under the winner card
     * (src/render), and FOLLOW_LINE after the winner line. Only on a plan with `follow`
     * (shared/features.ts); the studio turns it off on one without.
     */
    follow: boolean;
    /** Thousands separator: "1.000.000" as in the format, or "1,000,000". */
    separator: '.' | ',';
    safeZones: boolean;
  };
}

/**
 * The last lines on the winner card, one dealt with every roll of the dice (randomMatchup), so a
 * run of videos does not end on the same words; the first is the default. Each answers any of
 * the opening's questions, whoever won and by however much.
 */
export const LAST_LINES = [
  'Did you call it? Comment below!',
  'Did you call it?',
  'Was that your pick?',
  'Did your pick win?',
  'Saw that coming?',
  'How did your pick do?',
  'Who should race next?',
  'Want a rematch?',
];

/**
 * The winner lines, dealt the same way; the first is the default. The others say who won and
 * stop: the card's last line is the question, and the narrator asking another over it doubles it.
 */
export const WINNER_LINES = [
  '{winner} wins! Did you guess right?',
  '{winner} wins!',
  '{winner} takes it!',
  'And the winner is {winner}!',
  '{winner} gets there first!',
  '{winner} wins it in {time} seconds!',
  'Victory for {winner}!',
  'It goes to {winner}!',
  '{winner} does it!',
  "That's the race: {winner} wins!",
];

/**
 * What the narrator adds after the winner line when the video asks viewers to follow
 * (`look.follow`), whichever line the dice dealt: each says who won, and this works after any.
 */
export const FOLLOW_LINE = 'Follow for more!';

/**
 * What the narrator says at the win: the winner line filled in, then FOLLOW_LINE when the video asks
 * viewers to follow, unless a line written by hand asks already. '' when there is neither.
 */
export function spokenOutro(cfg: Config, vars: { winner: string; time: string }): string {
  const line = fillTemplate(cfg.voice.outro, vars).trim();
  // The written line, not the filled one: a ball may be called "Follower Ball".
  return cfg.look.follow && !/\bfollow/i.test(cfg.voice.outro) ? `${line} ${FOLLOW_LINE}`.trim() : line;
}

const BASE: Config = {
  seed: '1',
  // Speeds here are only a starting point: loading a matchup balances them
  // (src/sim/balance.ts) so the race fits the video length and ends close.
  a: { name: 'Fibonacci Ball', color: '#7c4dff', sequence: 'fibonacci', speed: 1300, special: 'none', amount: 0, radius: 26 },
  b: { name: 'Slow Factorial Ball', color: '#0ea5e9', sequence: 'factorial', speed: 300, special: 'none', amount: 0, radius: 26 },
  layers: '1000, 1e10, 1e15',
  physics: { gravity: 0, maxSpeed: 5000 },
  sound: { melody: 'ode', timbre: 'marimba', volume: 0.8, track: 'narrator' },
  voice: { voice: 'af_heart', script: '', outro: WINNER_LINES[0] },
  timing: { video: 40, gap: 0, startDelay: 0.5, hold: 3.5, maxSeconds: 150 },
  // The last line answers the opening's question and sends viewers to the comments.
  look: { skin: 'paper', question: '', cta: LAST_LINES[0], loop: true, follow: false, separator: '.', safeZones: false },
};

/** The last line's earlier default, which savedConfig reads as today's. */
const OLD_CTA = 'Follow for more!';

export interface Preset {
  id: string;
  label: string;
  config: Config;
}

function preset(id: string, label: string, patch: DeepPartial<Config>): Preset {
  return { id, label, config: mergeConfig(BASE, patch) };
}

export const PRESETS: Preset[] = [
  preset('fib-vs-factorial', 'Fibonacci vs Slow Factorial', {}),
  preset('doubling-vs-fibonacci', 'Doubling vs Fibonacci', {
    seed: '19',
    a: { name: 'Doubling Ball', color: '#ef4444', sequence: 'doubling', speed: 750 },
    b: { name: 'Fibonacci Ball', color: '#7c4dff', sequence: 'fibonacci', speed: 1050 },
    layers: '1000, 1e8, 1e12',
    sound: { melody: 'elise' },
  }),
  preset('primes-vs-squares', 'Primes vs Squares', {
    seed: '16',
    // Primes lead early (2, 3, 5, 7 beat 1, 4, 9 at first); squares overtake late.
    a: { name: 'Prime Ball', color: '#f59e0b', sequence: 'primes', speed: 1200 },
    b: { name: 'Square Ball', color: '#10b981', sequence: 'squares', speed: 550 },
    layers: '150, 1500, 8000',
    sound: { melody: 'twinkle' },
  }),
  preset('speeding-vs-doubling', 'Speeding Ball vs Doubling', {
    seed: '1',
    // Small hits that come faster and faster, against huge hits that come slowly.
    // Counting needs ~60 hits for 2000; at 3 % a hit that is 6× the starting speed, under the limit.
    a: { name: 'Speeding Ball', color: '#ec4899', sequence: 'counting', speed: 550, special: 'faster', amount: 3 },
    b: { name: 'Doubling Ball', color: '#ef4444', sequence: 'doubling', speed: 240 },
    layers: '100, 500, 2000',
    sound: { melody: 'scale' },
  }),
  preset('multiplying-vs-fibonacci', 'Multiplying Ball vs Fibonacci', {
    seed: '16',
    // Every hit adds a ball, so hits come exponentially faster until the box holds MAX_BALLS.
    a: { name: 'Multiplying Ball', color: '#14b8a6', sequence: 'counting', speed: 800, special: 'split', amount: 1, radius: 18 },
    b: { name: 'Fibonacci Ball', color: '#7c4dff', sequence: 'fibonacci', speed: 700 },
    layers: '1000, 1e5, 1e6',
    sound: { melody: 'scale', timbre: 'pluck' },
  }),
  preset('growing-vs-speeding', 'Growing vs Speeding', {
    seed: '1',
    // Same damage, different power-up: a bigger ball has less far to fall, a faster one gets there sooner.
    a: { name: 'Growing Ball', color: '#22c55e', sequence: 'fibonacci', speed: 600, special: 'grow', amount: 10, radius: 18 },
    b: { name: 'Speeding Ball', color: '#ec4899', sequence: 'fibonacci', speed: 600, special: 'faster', amount: 2, radius: 18 },
    layers: '1000, 1e8, 1e12',
    sound: { melody: 'elise', timbre: 'bell' },
  }),
  preset('tribonacci-vs-tripling', 'Tribonacci vs Tripling', {
    seed: '2',
    a: { name: 'Tribonacci Ball', color: '#8b5cf6', sequence: 'tribonacci', speed: 1200 },
    b: { name: 'Tripling Ball', color: '#f97316', sequence: 'tripling', speed: 650 },
    layers: '1000, 1e9, 1e14',
    sound: { melody: 'ode', timbre: 'pluck' },
  }),
];

export const DEFAULT_CONFIG = PRESETS[0].config;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/**
 * Overlays `patch` on `base` and returns a fresh deep copy, sharing nothing
 * with either. Also how a config saved by an older version loads: keys it
 * lacks fall back to `base`, unknown keys are dropped, and a value of the
 * wrong type is ignored.
 */
export function mergeConfig<T>(base: T, patch: unknown): T {
  if (typeof base !== 'object' || base === null) {
    return typeof patch === typeof base ? (patch as T) : base;
  }
  const from = typeof patch === 'object' && patch !== null ? (patch as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base)) out[key] = mergeConfig((base as Record<string, unknown>)[key], from[key]);
  return out as T;
}

/**
 * A config from the library, a file or this browser's storage, made as it was made. One saved
 * before the looks existed was made with the cards, no last line on the winner card and no
 * loop: those fill in before the defaults would, so a video opened again looks as it was
 * recorded. One that named no narrator, or the browser's own voice (which never reached the
 * file), was music only in effect, and opens so: the narrator is Kokoro, or none. Its last line,
 * if still the old default word for word, is today's: a default nobody chose, kept by every
 * config the studio saved, would leave the comment line to new accounts only. One saved before
 * configs kept a question keeps the one its seed picked then, so its first frame, and the text
 * its posts are written from, are the video's.
 */
export function savedConfig(saved: unknown): Config {
  const raw = typeof saved === 'object' && saved !== null ? (saved as { look?: unknown; voice?: unknown }) : {};
  const look = typeof raw.look === 'object' && raw.look !== null ? (raw.look as Record<string, unknown>) : {};
  const old = !('skin' in look);
  const cfg = mergeConfig(DEFAULT_CONFIG, old ? { ...raw, look: { skin: 'cards', cta: '', loop: false, ...look } } : raw);
  const provider = typeof raw.voice === 'object' && raw.voice !== null ? (raw.voice as { provider?: unknown }).provider : undefined;
  if ((provider === 'none' || provider === 'browser') && cfg.sound.track === 'narrator') cfg.sound.track = 'music';
  if (cfg.look.cta === OLD_CTA) cfg.look.cta = BASE.look.cta;
  if (!('question' in look)) cfg.look.question = firstQuestion(cfg.seed);
  return cfg;
}

/** Fills {winner}, {time}… in a line. */
export function fillTemplate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
