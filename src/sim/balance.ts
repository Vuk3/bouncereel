import { mergeConfig, type Config, type Contestant, type MelodyId, type Special } from '../config.ts';
import { raceSeconds } from '../pacing.ts';
import { createRng, type Rng } from './rng.ts';
import { SEQUENCES, type SequenceId } from './sequences.ts';
import { finishTimes } from './world.ts';

// Makes any matchup a race of the requested length that ends as close as asked,
// and invents new matchups.
//
// It rests on one property of the simulation: with no gravity, a ball that
// moves k times faster follows exactly the same path, hits the same floor at
// the same spots and breaks the same layers, just k times sooner. So a ball's
// finish time is (time at some speed) × (that speed / new speed), and setting
// each ball's speed so it reaches the line at the target makes both arrive
// together. One ball is given the target, the other a fraction of a second
// more (a photo finish, with a winner the seed decides) or the gap asked for in
// `timing.gap`: the same scaling puts a ball 5 s behind as easily as 0.3 s.
//
// Speeds that change per hit (and the speed limit) bend that rule a little, so
// it repeats the correction a few times and checks the result.

/** Slower than this looks stuck; faster is a blur on a phone (3200 px/s crosses the box in a quarter second). */
const MIN_SPEED = 140;
const MAX_SPEED = 3200;
/** How far behind the winner the loser reaches the line in a photo finish (`timing.gap` 0), seconds. */
const PHOTO_FINISH = [0.15, 1.1] as const;

export function balance(cfg: Config): Config | null {
  const { out, times, target, first, sides } = solve(cfg);
  return onTime(times, target) && sides.every(sane) && times[first] < times[1 - first] ? out : null;
}

/** Why `balance` cannot fit a matchup: which ball would have to be too fast or too slow, or whether the finish will not land; null when it can. */
export interface BalanceProblem {
  side: 0 | 1;
  why: 'fast' | 'slow' | 'uneven';
}

/** What stands in the way of balancing `cfg`, so the page can say which ball and what to change. */
export function balanceProblem(cfg: Config): BalanceProblem | null {
  const { times, target, first, sides } = solve(cfg);
  for (const side of [0, 1] as const) {
    if (!Number.isFinite(times[side]) || sides[side].speed > MAX_SPEED) return { side, why: 'fast' };
    if (sides[side].speed < MIN_SPEED) return { side, why: 'slow' };
  }
  return onTime(times, target) && times[first] < times[1 - first] ? null : { side: first, why: 'uneven' };
}

const sane = (c: Contestant) => c.speed >= MIN_SPEED && c.speed <= MAX_SPEED;

// A box of split balls is chaotic (a newborn's path depends on the exact step it was born in),
// so allow it a little slack around the target.
const onTime = (times: number[], target: number[]) => [0, 1].every((k) => Math.abs(times[k] - target[k]) < 0.6);

/** The speeds that put both balls on their targets, found by scaling and checked by running the race. */
function solve(cfg: Config): { out: Config; times: [number, number]; target: number[]; first: 0 | 1; sides: Contestant[] } {
  const out = structuredClone(cfg);
  const race = raceSeconds(cfg);
  const rng = createRng(`balance:${cfg.seed}`);
  const first: 0 | 1 = rng.next() < 0.5 ? 0 : 1;
  // Drawn only for a photo finish, after the winner: a seed balances to the same race it always did.
  const gap = cfg.timing.gap > 0 ? cfg.timing.gap : rng.range(PHOTO_FINISH[0], PHOTO_FINISH[1]);
  const target = [first === 0 ? race : race + gap, first === 1 ? race : race + gap];
  const sides = [out.a, out.b];
  out.timing.maxSeconds = Math.ceil(race + 30);
  out.physics.gravity = 0;

  for (let round = 0; round < 10; round++) {
    const times = finishTimes(out, race * 6 + 30);
    let settled = true;
    for (const k of [0, 1]) {
      const side = sides[k];
      // Never got there: much faster, then measure again.
      const factor = Number.isFinite(times[k]) ? times[k] / target[k] : 4;
      if (Math.abs(factor - 1) > 0.0005) settled = false;
      side.speed = Math.min(cfg.physics.maxSpeed, Math.max(20, Math.round(side.speed * factor * 10) / 10));
    }
    if (settled) break;
  }
  return { out, times: finishTimes(out, race * 2 + 30), target, first, sides };
}

// ── Random matchups ────────────────────────────────────────────────────────

/** Bright enough for the white boxes, distinct enough to tell apart at a glance. The panel offers them as swatches. */
export const COLORS = ['#7c4dff', '#0ea5e9', '#ef4444', '#10b981', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#2563eb', '#e11d48', '#a855f7', '#65a30d'];
const MELODIES: MelodyId[] = ['ode', 'elise', 'twinkle', 'scale'];
/**
 * When the dice may add powers, about every other matchup gets one, on one ball or, one time
 * in three, a different one on each: sequence against sequence on most rolls makes a run of
 * videos look like the same one over and over.
 */
const POWER_CHANCE = 0.5;
const BOTH_POWERED = 0.35;
const POWERS = ['faster', 'slower', 'grow', 'split'] as const;
/**
 * About one matchup in three gives a ball without a power a size that shows, with the word in
 * its name: big or tiny, or one of each. It needs no power (a plan without powers gets it too),
 * and a different size is a real difference, not a costume: a bigger ball has less far to fall.
 */
const SIZED = 0.35;
const BIG = [34, 40] as const;
const TINY = [14, 16] as const;
/** The radius from which a ball is Big, and up to which one without a power is Tiny (nameFor). */
const BIG_FROM = 32;
const TINY_UP_TO = 16;
/**
 * Which of Slow and Fast the names say when one ball starts at least twice as fast as the other:
 * both, one of them, or neither (the narrator then says the slower one is slower). Both every
 * time would make nearly every fast-growing sequence against a slow one "Slow X vs Fast Y".
 */
type PaceWords = 'both' | 'fast' | 'slow' | 'none';
const PACE_WORDS: PaceWords[] = ['both', 'fast', 'slow', 'none'];
/** A race needs enough floor hits to have a story, and not so many that it is a blur of numbers. */
const HITS = [14, 80] as const;
/**
 * The biggest layer is at most 10^18 (19 digits): the damage that breaks it,
 * and the one after, still fit a card written out in full.
 */
const MAX_POWER = 18;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)];
}

/** Floor hits a sequence needs to deal `hp` in total, ignoring damage lost at layer breaks. */
function hitsFor(sequence: SequenceId, hp: bigint): number {
  let sum = 0n;
  for (let n = 0; n < 400; n++) {
    sum += SEQUENCES[sequence].term(n);
    if (sum >= hp) return n + 1;
  }
  return Infinity;
}

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Layer health for two sequences: round powers of ten that both can break in a watchable number of hits. */
function pickLayers(rng: Rng, a: SequenceId, b: SequenceId): string | null {
  const fits: number[] = [];
  for (let e = 2; e <= MAX_POWER; e++) {
    const ha = hitsFor(a, 10n ** BigInt(e));
    const hb = hitsFor(b, 10n ** BigInt(e));
    if ([ha, hb].every((h) => h >= HITS[0] && h <= HITS[1]) && Math.max(ha, hb) / Math.min(ha, hb) <= 8) fits.push(e);
  }
  if (!fits.length) return null;
  // Bigger numbers are half the fun: favour the upper half of what fits.
  const top = pick(rng, fits.slice(Math.floor(fits.length / 2)));
  const count = Math.min(top - 1, pick(rng, [2, 3, 3, 3, 4]));
  const powers: number[] = [];
  for (let i = 1; i <= count; i++) powers.push(Math.max(2 + i - 1, Math.round((top * i) / count)));
  return powers
    .map((p, i) => {
      const mantissa = i === count - 1 ? 1 : pick(rng, [1, 1, 1, 2, 5]);
      return p <= 5 ? String(mantissa * 10 ** p) : `${mantissa}e${p}`;
    })
    .join(', ');
}

/** A ball: its power (`none` for none) and, for one without, a size that shows (null for the usual 22–28 px). */
function side(rng: Rng, sequence: SequenceId, color: string, special: Special, size: 'big' | 'tiny' | null): Contestant {
  // Mild amounts: over ~40 hits a 4 % gain is 5× the speed, and a 2.5 % loss leaves a third.
  const amount = special === 'faster' ? Math.round(rng.range(1.5, 4) * 2) / 2 : special === 'slower' ? Math.round(rng.range(1, 2.5) * 2) / 2 : special === 'grow' ? Math.round(rng.range(3, 9)) : special === 'split' ? 1 : 0;
  const [low, high] = size === 'big' ? BIG : size === 'tiny' ? TINY : [22, 28];
  const radius = special === 'split' ? 16 : special === 'grow' ? 18 : Math.round(rng.range(low, high));
  return { name: '', color, sequence, speed: 600, special, amount, radius };
}

/**
 * "Fibonacci Ball", "Big Prime Ball", "Slow Factorial Ball"… from its numbers, with one word in
 * front: Big or Tiny for a size that shows, else Slow or Fast when its speed is half or double
 * the other's and `pace` says that word. A power stays out of the name: "Tiring Triangle Ball"
 * is a word puzzle, while the picture and the opening already say what the ball does. A ball
 * that speeds up or slows down gets neither Slow nor Fast, since its starting speed is wrong
 * within seconds.
 */
function nameFor(c: Contestant, other: Contestant, pace: PaceWords): string {
  const noun = SEQUENCES[c.sequence].noun;
  const changing = (c.special === 'faster' || c.special === 'slower') && c.amount > 0;
  const size = c.radius >= BIG_FROM ? 'Big' : c.special === 'none' && c.radius <= TINY_UP_TO ? 'Tiny' : '';
  const slow = c.speed * 2 <= other.speed && (pace === 'both' || pace === 'slow');
  const fast = c.speed >= other.speed * 2 && (pace === 'both' || pace === 'fast');
  const word = size || (changing ? '' : slow ? 'Slow' : fast ? 'Fast' : '');
  return [word || (noun ? '' : 'Steady'), noun, 'Ball'].filter(Boolean).join(' ');
}

/**
 * A new matchup from a seed: two different sequences, often a power (never, when `powers` is
 * off), now and then a size, layers both can break, colours, a melody, which pace words the
 * names say, balanced to the requested length. Settings that are not about the matchup
 * (voice, volume, timing, look) come from `base`. Tries until a combination balances; nearly
 * every seed finds one within a handful of tries.
 */
export function randomMatchup(seed: string, base: Config, powers = true): Config {
  const rng = createRng(`matchup:${seed}`);
  // "Always 1" needs a hundred hits for even the smallest round layer, and the digits of pi (4.5 a
  // hit) pair with nothing but Counting, on one layer of 100: only by hand.
  const sequences = (Object.keys(SEQUENCES) as SequenceId[]).filter((s) => s !== 'ones' && s !== 'pi');
  for (let attempt = 0; attempt < 60; attempt++) {
    const sa = pick(rng, sequences);
    const sb = pick(rng, sequences);
    if (sa === sb) continue;
    const layers = pickLayers(rng, sa, sb);
    if (!layers) continue;
    const ca = pick(rng, COLORS);
    const cb = pick(rng, COLORS);
    const apart = Math.abs(hue(ca) - hue(cb));
    // Two greens or two blues read as one team at a glance.
    if (Math.min(apart, 360 - apart) < 75) continue;
    const powered = powers && rng.next() < POWER_CHANCE;
    const both = powered && rng.next() < BOTH_POWERED;
    const first = rng.next() < 0.5;
    // Two powers are always two different ones: "one splits, the other speeds up" is a duel.
    const pa = pick(rng, POWERS);
    const pb = both ? pick(rng, POWERS.filter((p) => p !== pa)) : pa;
    const specials: [Special, Special] = [powered && (both || first) ? pa : 'none', powered && (both || !first) ? pb : 'none'];
    // A size goes to a ball without a power: one big or tiny ball, or, one time in three, a big one against a tiny one.
    const sizes: ('big' | 'tiny' | null)[] = [null, null];
    if (rng.next() < SIZED) {
      const big = rng.next() < 0.5;
      if (rng.next() < 1 / 3) [sizes[0], sizes[1]] = big ? ['big', 'tiny'] : ['tiny', 'big'];
      else sizes[rng.next() < 0.5 ? 0 : 1] = big ? 'big' : 'tiny';
    }
    const a = side(rng, sa, ca, specials[0], specials[0] === 'none' ? sizes[0] : null);
    const b = side(rng, sb, cb, specials[1], specials[1] === 'none' ? sizes[1] : null);
    const pace = pick(rng, PACE_WORDS);
    // Names before balancing too: the winner line's length is part of the video's length.
    a.name = nameFor(a, a, pace);
    b.name = nameFor(b, b, pace);
    const cfg = mergeConfig(base, {
      seed,
      a,
      b,
      layers,
      sound: { melody: pick(rng, MELODIES) },
    });
    const balanced = balance(cfg);
    if (!balanced) continue;
    balanced.a.name = nameFor(balanced.a, balanced.b, pace);
    balanced.b.name = nameFor(balanced.b, balanced.a, pace);
    if (balanced.a.name === balanced.b.name) balanced.b.name = `Other ${balanced.b.name}`;
    return balanced;
  }
  // Practically unreachable; a known-good matchup rather than nothing.
  return balance(base) ?? base;
}
