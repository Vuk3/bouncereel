import { BATTLE_QUESTIONS } from '../audio/opening.ts';
import { COUNTRIES, DICE_REGIONS, flagName, type DiceRegion } from '../battle/countries.ts';
import { BATTLE_LAST_LINES, BATTLE_WINNER_LINES, mergeConfig, type Config } from '../config.ts';
import { SLOWMO, raceSeconds } from '../pacing.ts';
import { predictBattle, type BattleOutcome } from './battle.ts';
import { createRng, type Rng } from './rng.ts';

// Makes an Arena Clash end when the video needs it to, with its flags going out when a video
// wants them to.
//
// A battle is the same at any speed, only sooner over (battle.ts steps by distance). So a battle
// is run once at a starting speed of 1 px/s: if it is won after 9,000 of its seconds and the video
// has 26 s for it, starting at 346 px/s puts its last string on the 26th second, exactly (the
// balls speed up the same way at any starting speed, so every second scales alike). What is left
// to choose is which battle, the seed: seeds are tried until one is won at a distance a watchable
// speed covers in the time, by the flag asked for if one is, and with its outs where they should
// be (`uneven`: three or four flags on a schedule, the duel its last third; more, spread, with few
// in a rush).
//
// Each flag has an end of its own: the winner card is planned for the winner line said with that
// flag's name (pacing.ts raceSeconds), and the page ends the card a beat after the line, so a
// battle fitted to "Saint Vincent and the Grenadines wins!" that Chad wins would end a second and
// a half short. The outs among the last flags play in slow motion (BattleOutcome.slow), which is
// video the battle's seconds must leave room for.

/**
 * The starting speed, px/s: the balls speed up from it, to twice it at the most (battle.ts pace).
 * The format's channels fly at 200 to 320 in an arena this size; one at 100 reads as slow motion
 * all through. Past 460 at the start a fan is cut before the eye has found it.
 */
const MIN_SPEED = 260;
const MAX_SPEED = 460;
/**
 * Up to this many flags a battle is held to a schedule: the game is made for three or four
 * flags, where every out is an event of its own. With more, the first ones go in a burst no
 * seed avoids (battle.ts), and a battle is only asked to be spread.
 */
const FEW = 5;
/**
 * The schedule: every stage as long as the others but the duel, which is DUEL_SHARE of one. So
 * of three flags the first is due out at 59 % of the battle, and the last 41 % is the duel; of
 * four, at 37 % and 74 %. A flag out early leaves a long duel of thinning strings; one out late
 * leaves most of a video with nothing decided.
 */
const DUEL_SHARE = 0.7;
function due(flags: number, k: number): number {
  return k / (flags - 2 + DUEL_SHARE);
}
/** How far from its due moment an out may come, as a share of the battle; after FAIR_AFTER tries, FAIR_OFF. */
const OFF = 0.12;
const FAIR_OFF = 0.18;
/**
 * With more than FEW flags: the longest stretch without a flag going out, as a share of the
 * battle, that counts as spread (0.43 for six, 0.35 for twelve), and FAIR more after FAIR_AFTER.
 */
function spreadLimit(flags: number): number {
  return 0.28 + 0.75 / (flags - 1);
}
const FAIR_AFTER = 40;
const FAIR = 0.14;
/**
 * No flag goes out in a video's first seconds, however many there are: a flag gone before a
 * viewer has picked one is the complaint under the format's videos.
 */
const FIRST_OUT_SECONDS = 2.5;
/**
 * Two flags out within this many seconds of each other are a rush: the second OUT replaces the
 * first in the title before it is read. Half the share of a battle's outs that come this close
 * counts against it.
 */
const RUSH = 1;
const TRIES = 120;
/** One flag of up to twelve has to win: more seeds before giving up. */
const WANTED_TRIES = 400;

/** The longest stretch of the battle without a flag going out, as a share of it: 0 for two flags, who have only the end. */
export function spread(outcome: BattleOutcome, flags: number): number {
  if (flags <= 2 || outcome.time <= 0) return 0;
  const points = [0, ...outcome.outs.map((o) => o.time), outcome.time];
  let gap = 0;
  for (let i = 1; i < points.length; i++) gap = Math.max(gap, points[i] - points[i - 1]);
  return gap / outcome.time;
}

/**
 * How far a battle is from the one wanted, 0 for spot on, and what counts as good and as fair.
 * `speed` is the px/s it will be played at when `run` was run at another (1 px/s, in balancing).
 * Two flags have only the end. Up to FEW: the furthest any out is from its due moment. More: the
 * longest quiet stretch, plus half the share of outs that come in a rush. A first flag out in
 * the video's first seconds counts as worse than any of that.
 */
function uneven(run: BattleOutcome, flags: number, speed: number): { score: number; good: number; fair: number } {
  if (flags <= 2) return { score: 0, good: 0, fair: 0 };
  const early = run.outs[0].time / speed < FIRST_OUT_SECONDS ? 1 : 0;
  if (flags <= FEW) {
    let off = 0;
    for (let k = 1; k <= flags - 2; k++) off = Math.max(off, Math.abs(run.outs[k - 1].time / run.time - due(flags, k)));
    return { score: off + early, good: OFF, fair: FAIR_OFF };
  }
  let rushed = 0;
  for (let k = 1; k < run.outs.length - 1; k++) if ((run.outs[k].time - run.outs[k - 1].time) / speed < RUSH) rushed++;
  const limit = spreadLimit(flags);
  return { score: spread(run, flags) + early + (0.5 * rushed) / (flags - 2), good: limit, fair: limit + FAIR };
}

/** Seconds of video a battle's slow stretches add to its own seconds (pacing.ts SLOWMO). */
export function slowExtra(outcome: BattleOutcome): number {
  return outcome.slow.reduce((sum, [from, to]) => sum + (to - from), 0) * (1 / SLOWMO - 1);
}

/**
 * Balances `cfg` a seed at a time, yielding after each, so the studio can run it between frames;
 * returns the battle (seed, speed and time limit set) or null when no seed landed.
 */
export function* searchBattle(cfg: Config): Generator<number, Config | null, void> {
  const flags = cfg.battle.flags.length;
  const targets = cfg.battle.flags.map((code) => raceSeconds(cfg, flagName(code)));
  // The longest a flag's winner line allows: what the time limit is set for.
  const race = raceSeconds(cfg);
  const wanted = cfg.battle.winner ? cfg.battle.flags.indexOf(cfg.battle.winner) : -1;
  let best: { cfg: Config; score: number } | null = null;
  const tries = wanted >= 0 ? WANTED_TRIES : TRIES;
  for (let i = 0; i < tries; i++) {
    // At a starting speed of 1 px/s. Given up on once no speed could fit it in.
    const trial = mergeConfig(cfg, { seed: i ? `${cfg.seed}.${i}` : cfg.seed, battle: { speed: 1 }, timing: { maxSeconds: Math.ceil(MAX_SPEED * race) } });
    const run = predictBattle(trial);
    yield i;
    if (run.timedOut || run.winner === null) continue;
    // The battle's seconds and its slow stretches' extra, in the seconds its winner leaves it.
    const speed = (run.time + slowExtra(run)) / targets[run.winner];
    if (speed < MIN_SPEED || speed > MAX_SPEED || (wanted >= 0 && run.winner !== wanted)) continue;
    const landed = mergeConfig(trial, { battle: { speed }, timing: { maxSeconds: Math.ceil(race) + 30 } });
    const { score, good, fair } = uneven(run, flags, speed);
    if (!best || score < best.score) best = { cfg: landed, score };
    if (score <= good || (i >= FAIR_AFTER && score <= fair)) return best.cfg;
  }
  return best?.cfg ?? null;
}

/** searchBattle run to the end at once: for `npm run tune`, and a config fitted to a plan. */
export function balanceBattle(cfg: Config): Config | null {
  const search = searchBattle(cfg);
  for (;;) {
    const next = search.next();
    if (next.done) return next.value;
  }
}

/**
 * A new battle from a seed, not yet balanced: `count` flags from `region` (in the order drawn), and
 * the dice's words. Everything else, the chosen winner too when still among them, comes from `base`.
 */
export function randomBattle(seed: string, base: Config, count: number, region: DiceRegion): Config {
  const rng = createRng(`flags:${seed}`);
  const test = DICE_REGIONS.find((r) => r.id === region)?.test ?? (() => true);
  const pool = COUNTRIES.filter(test).map((c) => c.code);
  const flags: string[] = [];
  while (flags.length < count) {
    // A region smaller than the count fills up from everywhere.
    const from = pool.filter((c) => !flags.includes(c));
    const rest = COUNTRIES.map((c) => c.code).filter((c) => !flags.includes(c));
    flags.push(pick(rng, from.length ? from : rest));
  }
  // The words from a stream of their own, as the race's dice deals them (balance.ts randomMatchup).
  const words = createRng(`words:${seed}`);
  const deal = (line: string, lines: readonly string[]) => (lines.includes(line) ? pick(words, lines.filter((l) => l !== line)) : line);
  return mergeConfig(base, {
    seed,
    battle: { flags, winner: flags.includes(base.battle.winner) ? base.battle.winner : '' },
    look: { question: BATTLE_QUESTIONS.includes(base.look.question) ? '' : base.look.question, cta: deal(base.look.cta, BATTLE_LAST_LINES) },
    voice: { outro: deal(base.voice.outro, BATTLE_WINNER_LINES), script: '' },
  });
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng.next() * list.length)];
}
