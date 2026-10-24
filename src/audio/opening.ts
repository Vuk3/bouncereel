import type { Config } from '../config.ts';
import { createRng } from '../sim/rng.ts';

// The opening's question, in a file of its own: the narrator ends the opening on it
// (narration.ts) and the video shows it over its first frame (src/render, `drawOpening`).
// The renderer is on the home page too, which must not load narration.ts: it would bring the
// Kokoro loader, and the build would tie the home page's scripts to the 2 MB voice chunk.

/** The last line of the opening: a question that sends people to the comments. */
const QUESTIONS = ["Who's your pick?", 'Who do you think wins?', 'Pick your winner now.', 'Which one are you betting on?'];

/** The seed's two picks for the opening, drawn in this order: which ball's fact, then the question. */
export function openingDraws(seed: string): [number, string] {
  const rng = createRng(`opening:${seed}`);
  const fact = rng.next();
  return [fact, QUESTIONS[Math.floor(rng.next() * QUESTIONS.length)]];
}

/**
 * The line on screen in the video's first second, with every sound: the question the narrator
 * ends the opening on, so a narrated video asks it twice, in the picture and then in words. A
 * creator's own opening gives its last sentence when that is a short question (two lines on
 * screen at most); anything else, the seed's pick.
 */
export function openingQuestion(cfg: Config): string {
  const own = cfg.voice.script.trim().split(/(?<=[.!?])\s+/).pop() ?? '';
  return own.endsWith('?') && own.length <= 48 ? own : openingDraws(cfg.seed)[1];
}
