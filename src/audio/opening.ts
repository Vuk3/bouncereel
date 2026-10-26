import type { Config } from '../config.ts';
import { createRng } from '../sim/rng.ts';

// The opening's question, in a file of its own: the narrator ends the opening on it
// (narration.ts) and the video shows it over its first frame (src/render, `drawOpening`).
// The renderer is on the home page too, which must not load narration.ts: it would bring the
// Kokoro loader, and the build would tie the home page's scripts to the 2 MB voice chunk.

/**
 * The last line of the opening: a question that sends people to the comments. Twenty, so a run
 * of videos does not keep asking the same thing; none leans to a ball, and none is longer than
 * "Which one are you betting on?", which already takes the first frame's two lines.
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

/** The config's question: the creator's (`look.question`), else the seed's pick. */
export function configQuestion(cfg: Config): string {
  return cfg.look.question.trim() || QUESTIONS[Math.floor(openingDraws(cfg.seed).question * QUESTIONS.length)];
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
