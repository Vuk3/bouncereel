import type { Config } from '../config.ts';
import { createRng } from '../sim/rng.ts';

// The opening's question, in a file of its own: the narrator ends the opening on it
// (narration.ts) and the video shows it over its first frame (src/render, `drawOpening`), a
// Arena Clash as its title all through.
// The renderer is on the home page too, which must not load narration.ts: it would bring the
// Kokoro loader, and the build would tie the home page's scripts to the 2 MB voice chunk.

/**
 * The last line of the opening: a question that sends people to the comments. Twenty, so a run
 * of videos does not keep asking the same thing; none leans to a ball, and none is longer than
 * "Which one are you betting on?", which already fills the first frame's pill on one line.
 */
export const QUESTIONS = [
  "Who's your pick?",
  'Who do you think wins?',
  'Pick your winner now.',
  'Which one are you betting on?',
  'Who gets there first?',
  'Which ball takes this one?',
  'Who are you rooting for?',
  'Top or bottom?',
  'Which one would you back?',
  'Who wins this one?',
  'Lock in your pick.',
  'Which one has your vote?',
  'Who would you bet on?',
  'Call it before they drop.',
  'Who takes it, top or bottom?',
  'Which one is your winner?',
  'Pick a side.',
  'Who are you backing?',
  'Make your call.',
  'So, who wins?',
];

/**
 * Arena Clash's questions: the same idea, in its words (no ball, no top or bottom, nobody gets
 * anywhere first: a flag survives). A battle's question is also its title, over the arena for the
 * whole video (src/render/battle.ts), so each is short enough for one line of big type there:
 * "WHICH FLAG SURVIVES?" is the longest. None tells viewers to comment: Instagram says it may
 * not recommend a video that asks for a comment in so many words.
 */
export const BATTLE_QUESTIONS = [
  'Which flag survives?',
  'Who survives?',
  'Pick one.',
  "Who's your pick?",
  'Last flag standing?',
  'Who wins this one?',
  'Pick your country.',
  'Who takes the arena?',
  'Who are you rooting for?',
  'Who would you bet on?',
  'Which flag wins?',
  'So, who wins?',
];

/**
 * How many questions there were before a config kept its own (`look.question`): a config saved
 * then asked its seed's pick among these, and keeps it (`firstQuestion`, savedConfig).
 */
const FIRST = 4;

/**
 * The seed's picks for the opening, drawn in this order: which ball's fact, the question, which of
 * that ball's facts, how the opening starts. New picks go after the old ones, so a seed still draws
 * the question it always did.
 */
export function openingDraws(seed: string): { ball: number; question: number; fact: number; start: number } {
  const rng = createRng(`opening:${seed}`);
  return { ball: rng.next(), question: rng.next(), fact: rng.next(), start: rng.next() };
}

/** The question a config saved before `look.question` showed: its seed's pick among the first four. */
export function firstQuestion(seed: string): string {
  return QUESTIONS[Math.floor(openingDraws(seed).question * FIRST)];
}

/** The config's question: the creator's (`look.question`), else the seed's pick from its game's questions. */
export function configQuestion(cfg: Config): string {
  const pool = cfg.game === 'arena-clash' ? BATTLE_QUESTIONS : QUESTIONS;
  return cfg.look.question.trim() || pool[Math.floor(openingDraws(cfg.seed).question * pool.length)];
}

/**
 * The line on screen in the video's first second, with every sound: the question the narrator
 * ends the opening on, so a narrated video asks it twice, in the picture and then in words. A
 * creator's own opening gives its last sentence when that is a short question (two lines on
 * screen at most); anything else, the config's question.
 */
export function openingQuestion(cfg: Config): string {
  const own = cfg.voice.script.trim().split(/(?<=[.!?])\s+/).pop() ?? '';
  return own.endsWith('?') && own.length <= 48 ? own : configQuestion(cfg);
}
