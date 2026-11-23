import { MATCH_QUESTIONS } from '../audio/opening.ts';
import { MATCH_LAST_LINES, MATCH_WINNER_LINES, mergeConfig, type Config } from '../config.ts';
import { derbies, poolSides, sideName, type Mode } from '../football/teams.ts';
import { raceSeconds } from '../pacing.ts';
import { predictMatch, type MatchOutcome } from './match.ts';
import { createRng, type Rng } from './rng.ts';

// Makes a Goal Rush fit its video and play as a match worth watching.
//
// A match's length is its clock's: ninety minutes are `match.seconds`, the video length less the
// frame around it (pacing.ts raceSeconds), so it ends on its second whatever happens in it. That
// frame holds the winner line, said with the winner's name ("Borussia Mönchengladbach wins 3 to 2!"
// is longer than "Lens wins 3 to 2!"), so each side has a length of its own, and a seed is run once
// for each: a seed lands for a side when, at that side's length, that side wins. What is left to
// choose is which match, the seed: seeds are tried until one is not a draw, has enough goals and
// not too many for its length, none in the first seconds and no long stretch without one, and
// is the story its seed asks for (below).

/** Seeds tried before the best is taken; more with a chosen winner, who must win. */
const TRIES = 160;
const WANTED_TRIES = 320;
/** After this many seeds a match that is only fair (FAIR) is taken. */
const FAIR_AFTER = 50;
const FAIR = 0.6;
/**
 * No goal in a video's first seconds: a goal before a viewer has picked a side is wasted, and
 * the opening is still being said over it. Nor a first goal later than a quarter of the match
 * (the 22nd minute, nine seconds into a 40 s video): a stretch with nothing on the scoreboard is
 * where viewers leave.
 */
const FIRST_GOAL_SECONDS = 2.5;
const FIRST_GOAL_SHARE = 0.25;
/** The longest stretch without a goal, as a share of the match, before it counts against it. */
const QUIET = 0.4;
/**
 * The story a seed asks for. Four matches in ten are comebacks (the winner was behind at some
 * point), four are decided late (the winning goal in the last 30 %), two are whatever comes, so a
 * viewer never learns that the side behind always wins or that the end is always in the last
 * seconds. Which comes from the seed balancing starts from (`story:<seed>`), not each one tried.
 */
const COMEBACK = 0.4;
const LATE = 0.8;
const LATE_FROM = 0.7;

/**
 * Goals a match of `seconds` should have: one every 11 s at least, one every 5 s at most, ten at
 * the most: 2 to 5 in a 30 s video, 5 to 10 in a minute. Every goal stops the match for its
 * moment (CELEBRATE), and ten of those are an eighth of a minute's match.
 */
export function goalsWanted(seconds: number): [number, number] {
  const lo = Math.max(2, Math.round(seconds / 11));
  return [lo, Math.max(lo + 2, Math.min(10, Math.round(seconds / 5)))];
}

/** The winner was behind at some point. */
export function isMatchComeback(o: MatchOutcome): boolean {
  return o.trailed > 0;
}

/** The longest stretch of the match without a goal (from the kick-off, between goals, to the whistle), as a share of it. */
export function quietest(o: MatchOutcome): number {
  if (o.time <= 0) return 0;
  const points = [0, ...o.goals.map((g) => g.time), o.time];
  let gap = 0;
  for (let i = 1; i < points.length; i++) gap = Math.max(gap, points[i] - points[i - 1]);
  return gap / o.time;
}

/** How far a match is from the one wanted: 0 for spot on. */
function fault(o: MatchOutcome, story: 'comeback' | 'late' | 'any'): number {
  if (o.golden || o.winner === null) return 9;
  const [lo, hi] = goalsWanted(o.time);
  const n = o.goals.length;
  let score = n < lo ? (lo - n) * 0.5 : n > hi ? (n - hi) * 0.35 : 0;
  const margin = Math.abs(o.score[0] - o.score[1]);
  if (margin > 2) score += (margin - 2) * 0.4;
  const first = o.goals[0]?.time ?? o.time;
  if (first < FIRST_GOAL_SECONDS) score += 1;
  if (first > FIRST_GOAL_SHARE * o.time) score += 0.5;
  score += Math.max(0, quietest(o) - QUIET) * 2;
  if (story === 'comeback' && !isMatchComeback(o)) score += 1;
  if (story === 'late' && o.decided < LATE_FROM * o.time) score += 1;
  return score;
}

/**
 * Balances `cfg` a seed at a time, yielding after each, so the studio can run it between frames;
 * returns the match (seed, length and time limit set) or null when no seed landed.
 */
export function* searchMatch(cfg: Config): Generator<number, Config | null, void> {
  const ids = [cfg.match.home, cfg.match.away];
  const lengths = ids.map((id) => raceSeconds(cfg, sideName(id)));
  const wanted = cfg.match.winner ? ids.indexOf(cfg.match.winner) : -1;
  const draw = createRng(`story:${cfg.seed}`).next();
  const story = draw < COMEBACK ? 'comeback' : draw < LATE ? 'late' : 'any';
  let best = null as { cfg: Config; score: number } | null;
  const tries = wanted >= 0 ? WANTED_TRIES : TRIES;
  for (let i = 0; i < tries; i++) {
    const seed = i ? `${cfg.seed}.${i}` : cfg.seed;
    for (const side of [0, 1] as const) {
      if (wanted >= 0 && side !== wanted) continue;
      const seconds = lengths[side];
      const trial = mergeConfig(cfg, { seed, match: { seconds }, timing: { maxSeconds: Math.ceil(seconds) + 30 } });
      const run = predictMatch(trial);
      if (run.winner !== side) continue;
      const score = fault(run, story);
      if (!best || score < best.score) best = { cfg: trial, score };
    }
    yield i;
    if (best && (best.score === 0 || (i >= FAIR_AFTER && best.score <= FAIR))) return best.cfg;
  }
  return best && best.score < 9 ? best.cfg : null;
}

/** searchMatch run to the end at once: for `npm run tune`, and a config fitted to a plan. */
export function balanceMatch(cfg: Config): Config | null {
  const search = searchMatch(cfg);
  for (;;) {
    const next = search.next();
    if (next.done) return next.value;
  }
}

/**
 * A new match from a seed, not yet balanced: two sides of `mode` from `pool` (a derby whole, from
 * Derbies), home and away in the order drawn, and the dice's words. Everything else, the chosen
 * winner too when still one of the two, comes from `base`.
 */
export function randomMatch(seed: string, base: Config, mode: Mode, pool: string): Config {
  const rng = createRng(`sides:${seed}`);
  let pair: [string, string];
  const pairs = derbies(mode);
  if (pool === 'derbies' && pairs.length) {
    const [a, b] = pick(rng, pairs);
    pair = rng.next() < 0.5 ? [a, b] : [b, a];
  } else {
    const list = poolSides(mode, pool).map((s) => s.id);
    const home = pick(rng, list);
    pair = [home, pick(rng, list.filter((id) => id !== home))];
  }
  const words = createRng(`words:${seed}`);
  const deal = (line: string, lines: readonly string[]) => (lines.includes(line) ? pick(words, lines.filter((l) => l !== line)) : line);
  return mergeConfig(base, {
    seed,
    match: { mode, home: pair[0], away: pair[1], winner: pair.includes(base.match.winner) ? base.match.winner : '' },
    look: { question: MATCH_QUESTIONS.includes(base.look.question) ? '' : base.look.question, cta: deal(base.look.cta, MATCH_LAST_LINES) },
    voice: { outro: deal(base.voice.outro, MATCH_WINNER_LINES), script: '' },
  });
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng.next() * list.length)];
}
