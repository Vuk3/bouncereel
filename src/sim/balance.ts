import { QUESTIONS } from '../audio/opening.ts';
import { LAST_LINES, WINNER_LINES, mergeConfig, type Config, type Contestant, type MelodyId, type Special } from '../config.ts';
import { raceSeconds } from '../pacing.ts';
import { createRng, type Rng } from './rng.ts';
import { SEQUENCES, STRENGTH_NOUNS, STRENGTHS, strengthNoun, type SequenceId } from './sequences.ts';
import { finishTimes, predict, type Outcome } from './world.ts';

// Makes any matchup a race of the requested length that ends as close as asked,
// and invents new matchups.
//
// It rests on one property of the simulation: with no gravity, a ball that
// moves k times faster follows exactly the same path, hits the same floor at
// the same spots and breaks the same layers, just k times sooner. So a ball's
// finish time is (time at some speed) × (that speed / new speed), and setting
// each ball's speed so it reaches the line at the target makes both arrive
// together. One ball is given the target, the other a fraction of a second
// more (a photo finish) or the gap asked for in `timing.gap`: the same scaling
// puts a ball 5 s behind as easily as 0.3 s. Which one wins is chosen for the
// story: most races end on a comeback (COMEBACK).
//
// Speeds that change per hit (and the speed limit) bend that rule a little, so
// it repeats the correction a few times and checks the result.

/** Slower than this looks stuck; faster is a blur on a phone (3200 px/s crosses the box in a quarter second). */
const MIN_SPEED = 140;
const MAX_SPEED = 3200;
/** How far behind the winner the loser reaches the line in a photo finish (`timing.gap` 0), seconds. */
const PHOTO_FINISH = [0.15, 1.1] as const;
/**
 * Four seeds in five ask for a comeback (`isComeback`): the winner spends more of the race behind
 * than ahead and takes the lead for good in its last 30 % or at the line, so who wins is open
 * until the end, and viewers stay to see it. Both balls are scaled to arrive together, so
 * whichever trails most of the way is still close at the end; making it the winner is a
 * comeback. Not every race: a viewer who learnt that the ball behind always wins would know the
 * end from the first second, so the fifth asks for the leader to hold on, by a hair. A matchup
 * whose other winner does not fit keeps the seed's.
 */
const COMEBACK = 0.8;
const COMEBACK_FROM = 0.7;

/** Behind for longer than ahead, and ahead for good only in the race's last 30 %, or at the line. */
export function isComeback(o: Outcome): boolean {
  return o.trailed > o.led && o.decided >= COMEBACK_FROM * o.time;
}

/** Whether a seed's race asks for a comeback (COMEBACK), from a stream of its own. */
function wantsComeback(seed: string): boolean {
  return createRng(`comeback:${seed}`).next() < COMEBACK;
}

export function balance(cfg: Config): Config | null {
  const seeded = solve(cfg);
  if (!fits(seeded)) return null;
  const comeback = wantsComeback(cfg.seed);
  const was = predict(seeded.out);
  if (isComeback(was) === comeback) return seeded.out;
  const swapped = solve(cfg, (1 - seeded.first) as 0 | 1);
  if (!fits(swapped)) return seeded.out;
  // Whichever comes nearer what the seed asks for: longer behind than ahead for a comeback, the
  // other way round for a hold.
  const now = predict(swapped.out);
  const behind = (o: Outcome) => o.trailed - o.led;
  return (comeback ? behind(now) > behind(was) : behind(now) < behind(was)) ? swapped.out : seeded.out;
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

/** Both balls on their targets, at speeds that look right, the winner first. */
const fits = (s: Solution) => onTime(s.times, s.target) && s.sides.every(sane) && s.times[s.first] < s.times[1 - s.first];

// A box of split balls is chaotic (a newborn's path depends on the exact step it was born in),
// so allow it a little slack around the target.
const onTime = (times: number[], target: number[]) => [0, 1].every((k) => Math.abs(times[k] - target[k]) < 0.6);

interface Solution {
  out: Config;
  times: [number, number];
  target: number[];
  first: 0 | 1;
  sides: Contestant[];
}

/**
 * The speeds that put both balls on their targets, found by scaling and checked by running the
 * race: the seed's pick of a winner (`first`), or `winner`.
 */
function solve(cfg: Config, winner?: 0 | 1): Solution {
  const out = structuredClone(cfg);
  const rng = createRng(`balance:${cfg.seed}`);
  const drawn: 0 | 1 = rng.next() < 0.5 ? 0 : 1;
  const first = winner ?? drawn;
  // The time for the winner card is planned for this winner's own line (pacing.ts cardSeconds).
  const race = raceSeconds(cfg, [cfg.a, cfg.b][first].name);
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
 * The same for each ball of a crowd: its numbers come from all of them together, so each can
 * make fewer, and a swarm of small balls at a ball's usual 2,500 px/s is a blur (at 36 hits each
 * a 30 s crowd moves at about 1,800 px/s).
 */
const CROWD_HITS = [8, 36] as const;
/**
 * The biggest layer is at most 10^18 (19 digits): the damage that breaks it,
 * and the one after, still fit a card written out in full.
 */
const MAX_POWER = 18;

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)];
}

/**
 * Running totals of each sequence's terms, grown only as far as a question needs: to the layer
 * asked about, or `most` hits. A crowd makes thousands of hits, and adding them up term by term
 * for every candidate layer of every roll would take seconds; a sequence that grows passes the
 * biggest layer within a few dozen terms and stops there.
 */
const totals = new Map<SequenceId, bigint[]>();

/**
 * Floor hits a ball needs to deal `hp` in total, every hit `strength` times its sequence's term,
 * ignoring damage lost at layer breaks; Infinity past `most`.
 */
function hitsFor(sequence: SequenceId, hp: bigint, most = 400, strength = 1): number {
  // Hits of `strength` times the terms reach hp when the terms themselves reach hp / strength.
  const s = BigInt(Math.max(1, Math.round(strength)));
  const target = (hp + s - 1n) / s;
  let sums = totals.get(sequence);
  if (!sums) totals.set(sequence, (sums = []));
  const term = SEQUENCES[sequence].term;
  while (sums.length < most && (sums[sums.length - 1] ?? 0n) < target) sums.push((sums[sums.length - 1] ?? 0n) + term(sums.length));
  // The first total that reaches the target.
  let lo = 0;
  let hi = sums.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sums[mid] >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo < Math.min(sums.length, most) ? lo + 1 : Infinity;
}

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** What a ball brings to the layers: its numbers, how hard it hits, and how many balls share its hits. */
type Hitter = Pick<Contestant, 'sequence' | 'count' | 'strength'>;

/**
 * Layer health for two balls: round numbers both can break in a watchable number of hits. A
 * crowd shares its hits among its balls, so what has to be watchable is the hits each ball makes
 * (CROWD_HITS); and a crowd of balls that always hit the same lands between the powers of ten, so
 * with one in the race the top layer may be 2 or 5 times one too (a hundred balls hitting for one
 * need 2,000 or 5,000 where 1,000 is too few and 10,000 too many).
 */
function pickLayers(rng: Rng, a: Hitter, b: Hitter): string | null {
  const crowd = a.count > 1 || b.count > 1;
  const fits: [power: number, mantissa: number][] = [];
  for (let e = 2; e <= MAX_POWER; e++) {
    for (const m of crowd && e < MAX_POWER ? [1, 2, 5] : [1]) {
      const hp = BigInt(m) * 10n ** BigInt(e);
      const each = [a, b].map((s) => hitsFor(s.sequence, hp, (s.count > 1 ? CROWD_HITS : HITS)[1] * s.count + 1, s.strength) / s.count);
      const watchable = [a, b].every((s, k) => {
        const [low, high] = s.count > 1 ? CROWD_HITS : HITS;
        return each[k] >= low && each[k] <= high;
      });
      if (watchable && Math.max(...each) / Math.min(...each) <= 8) fits.push([e, m]);
    }
  }
  if (!fits.length) return null;
  // Bigger numbers are half the fun: favour the upper half of what fits.
  const [top, last] = pick(rng, fits.slice(Math.floor(fits.length / 2)));
  const count = Math.min(top - 1, pick(rng, [2, 3, 3, 3, 4]));
  const powers: number[] = [];
  for (let i = 1; i <= count; i++) powers.push(Math.max(2 + i - 1, Math.round((top * i) / count)));
  const values = powers.map((p, i) => [i === count - 1 ? last : pick(rng, [1, 1, 1, 2, 5]), p] as const);
  // A small layer first, when there are three or fewer, so four at most share the stack.
  const starter = count <= 3 ? starterLayer(a, b) : null;
  const [m0, p0] = values[0];
  const head = starter !== null && starter * 5n <= BigInt(m0) * 10n ** BigInt(p0) ? [String(starter)] : [];
  return [...head, ...values.map(([m, p]) => (p <= 5 ? String(m * 10 ** p) : `${m}e${p}`))].join(', ');
}

/**
 * A first layer small enough that both balls break it within their first four hits: a crack, a
 * shake and the box growing down in the first second or two, before a viewer has decided whether to
 * stay. The round number (1, 2 or 5 times a power of ten) at or under the smaller of the two balls'
 * first four hits together, counted for the team, so a crowd's come in a fraction of a second; at
 * least 2. pickLayers keeps it only when it is well under the layer after it.
 */
function starterLayer(a: Hitter, b: Hitter): bigint | null {
  const firstFour = (s: Hitter) => [0, 1, 2, 3].reduce((sum, n) => sum + SEQUENCES[s.sequence].term(n), 0n) * BigInt(Math.max(1, Math.round(s.strength)));
  const most = [a, b].map(firstFour).reduce((x, y) => (x < y ? x : y));
  if (most < 2n) return null;
  // The biggest 1, 2 or 5 times a power of ten that is not more than `most`.
  let power = 1n;
  while (power * 10n <= most) power *= 10n;
  return [5n, 2n, 1n].map((m) => m * power).find((v) => v <= most) ?? null;
}

/** A crowd's balls, smaller the more there are: two hundred at 9 px are a swarm with room to move. */
export function crowdRadius(count: number): number {
  return count >= 200 ? 9 : count >= 100 ? 11 : 13;
}

/**
 * A ball's size for how many there are: a crowd's own size as its count changes (a hundred balls at
 * 26 px would fill the box), one set smaller by hand kept; back to one ball, the usual 26 px from a
 * crowd's size.
 */
export function sizeFor(radius: number, count: number): number {
  const crowdSize = [2, 100, 200].map(crowdRadius).includes(radius);
  if (count > 1) return crowdSize || radius > crowdRadius(count) ? crowdRadius(count) : radius;
  return crowdSize ? 26 : radius;
}

/** A ball: its power (`none` for none), for one without, a size that shows (null for the usual 22–28 px), its balls and its strength. */
function side(rng: Rng, sequence: SequenceId, color: string, special: Special, size: 'big' | 'tiny' | null, count: number, strength: number): Contestant {
  // Mild amounts: over ~40 hits a 4 % gain is 5× the speed, and a 2.5 % loss leaves a third.
  const amount = special === 'faster' ? Math.round(rng.range(1.5, 4) * 2) / 2 : special === 'slower' ? Math.round(rng.range(1, 2.5) * 2) / 2 : special === 'grow' ? Math.round(rng.range(3, 9)) : special === 'split' ? 1 : 0;
  const [low, high] = size === 'big' ? BIG : size === 'tiny' ? TINY : [22, 28];
  const radius = special === 'split' ? 16 : special === 'grow' ? 18 : Math.round(rng.range(low, high));
  return { name: '', color, sequence, speed: 600, special, amount, radius: count > 1 ? crowdRadius(count) : radius, count, strength };
}

/** What a ball is called after: its sequence's noun, or for Always the same its strength's ("Thousand", "Millionaire"). */
function nounOf(c: Contestant): string {
  return c.sequence === 'ones' ? strengthNoun(c.strength) : SEQUENCES[c.sequence].noun;
}

/**
 * "Fibonacci Ball", "Big Prime Ball", "Slow Factorial Ball"… from its numbers, with one word in
 * front: Big or Tiny for a size that shows, else Slow or Fast when its speed is half or double
 * the other's and `pace` says that word. A power stays out of the name: "Tiring Triangle Ball"
 * is a word puzzle, while the picture and the opening already say what the ball does. A ball
 * that speeds up or slows down gets neither Slow nor Fast, since its starting speed is wrong
 * within seconds. A crowd is its number and its numbers, the format's "100× Millionaire Balls".
 */
function nameFor(c: Contestant, other: Contestant, pace: PaceWords): string {
  const noun = nounOf(c);
  if (c.count > 1) return `${c.count}× ${noun} Balls`;
  const changing = (c.special === 'faster' || c.special === 'slower') && c.amount > 0;
  const size = c.radius >= BIG_FROM ? 'Big' : c.special === 'none' && c.radius <= TINY_UP_TO ? 'Tiny' : '';
  const slow = c.speed * 2 <= other.speed && (pace === 'both' || pace === 'slow');
  const fast = c.speed >= other.speed * 2 && (pace === 'both' || pace === 'fast');
  const word = size || (changing ? '' : slow ? 'Slow' : fast ? 'Fast' : '');
  return [word, noun, 'Ball'].filter(Boolean).join(' ');
}

/** The name the dice would give a ball on its own, without Slow or Fast: for a ball changed by hand. */
export function plainName(c: Contestant): string {
  return nameFor(c, c, 'none');
}

/**
 * Whether a ball's name is one the dice gives (nameFor, maybe with Other in front) rather than one
 * its creator wrote, so it can be given again when the ball changes. For any of the nouns its
 * numbers could have had: an Always the same ball renamed after a new strength is still the dice's.
 */
export function diceName(c: Pick<Contestant, 'name'>): boolean {
  return DICE_NAME.test(c.name);
}

/**
 * Every name the dice gives, for any numbers: a ball changed from Fibonacci to Always the same
 * still has a name the dice gave ("Fibonacci Ball"), and gets its new one. Before strengths, an
 * Always 1 ball with a word in front was "Big Ball", "Slow Ball".
 */
const DICE_NAME = (() => {
  const nouns = [...new Set([...Object.values(SEQUENCES).map((s) => s.noun), ...STRENGTH_NOUNS])].filter(Boolean);
  const any = `(?:${nouns.join('|')})`;
  return new RegExp(`^(?:Other )?(?:(?:(?:Big|Tiny|Slow|Fast) )?${any} Ball|\\d+× ${any} Balls|(?:Big|Tiny|Slow|Fast) Ball)$`);
})();

/**
 * What the dice keeps of a ball: the ball itself (its numbers, power, colour, size, and a name its
 * creator wrote), how many balls it is, how hard it hits. Keeping its count or its strength keeps
 * the ball too: those are the ball's.
 */
export interface Keep {
  ball: boolean;
  count: boolean;
  strength: boolean;
}

/**
 * What the dice may do: give a ball a power (`powers`) or make one a crowd (`crowds`), and what
 * it keeps of each ball (`keep`). A kept ball's speed is always balanced again, and a name the
 * dice gave it is given again, since Slow or Fast, its count or its strength may have changed.
 */
export interface Dice {
  powers: boolean;
  crowds: boolean;
  keep: { a: Keep; b: Keep };
}

/**
 * The same two balls on new layers, when the ones they have cannot make the race: round layers
 * both can break in a watchable number of hits (pickLayers), on a new race, balanced. Nothing else
 * changes, not the balls and not the words. Null when no round layers suit the two, or none of a
 * dozen races on them lands.
 */
export function relayer(cfg: Config, seed: string): Config | null {
  const rng = createRng(`layers:${seed}`);
  for (let attempt = 0; attempt < 12; attempt++) {
    const layers = pickLayers(rng, cfg.a, cfg.b);
    if (!layers) return null;
    const balanced = balance({ ...cfg, layers, seed: String(1 + Math.floor(rng.next() * 999_999)) });
    if (balanced) return balanced;
  }
  return null;
}

/**
 * Matchups a roll whose seed asks for a comeback passes over when theirs cannot make one (balance
 * keeps such a matchup's own winner): two fail in ten, so a few more tries find one nearly always.
 */
const COMEBACK_TRIES = 4;

/** About one roll in four makes one ball a crowd: spam against skill, the format's favourite twist. */
const CROWD_CHANCE = 0.25;
/**
 * A crowd is the same hit every time (Always the same, at one of STRENGTHS), and only that: a
 * hundred balls of numbers that grow would break every layer within seconds. The roll picks how
 * many balls and how hard, and layers that suit them: a crowd hitting for one gets small numbers,
 * one hitting for a million gets billions.
 */
const CROWD_COUNTS = [30, 50, 100, 100, 150, 200];

/** Whether a ball's numbers make a crowd: the same hit every time. */
function crowdable(sequence: SequenceId): boolean {
  return sequence === 'ones';
}

/** Nothing of a ball left to the dice: kept, with its count and its strength kept or nothing to roll. */
export function keptWhole(c: Contestant, keep: Keep): boolean {
  const held = keep.ball || keep.count || keep.strength;
  return held && (keep.count || !crowdable(c.sequence)) && (keep.strength || c.sequence !== 'ones');
}

/** All of a ball kept: what Rebalance keeps when it has to find new layers for the two balls as they are. */
export const KEEP_ALL: Keep = { ball: true, count: true, strength: true };
const KEEP_NONE: Keep = { ball: false, count: false, strength: false };

/**
 * A new matchup from a seed: two different sequences, often a power (never, when `powers` is
 * off), now and then a crowd or a size, layers both can break, colours, a melody, which pace
 * words the names say, the words around the race, balanced to the requested length. Settings
 * that are not about the matchup (voice, volume, timing, look) come from `base`, and so does what
 * `keep` keeps of its balls. Tries until a combination balances; nearly every seed finds one
 * within a handful of tries. Null only when what is kept leaves nothing that fits: two kept balls
 * no round layers suit, or a kept ball nothing races with (one Always the same ball on its own
 * needs a hundred hits for the smallest layer).
 */
export function randomMatchup(seed: string, base: Config, dice: Partial<Dice> = {}): Config | null {
  const { powers = true, crowds = true } = dice;
  const keep = [dice.keep?.a ?? KEEP_NONE, dice.keep?.b ?? KEEP_NONE];
  const rng = createRng(`matchup:${seed}`);
  // A crowd, and a kept ball's count and strength, from a stream of their own: a roll without one
  // is what it always was.
  const crowdRng = createRng(`crowd:${seed}`);
  // The words, from a stream of their own so a seed's matchup stays what it was: the question
  // goes back to the new seed's pick, the last line and the winner line are new picks. Only the
  // dice's own words change: a line the creator wrote, or none, stays. Dealt before balancing,
  // since the winner line's length is part of the video's.
  const words = createRng(`words:${seed}`);
  const deal = (line: string, pool: readonly string[]) => (pool.includes(line) ? pick(words, pool.filter((l) => l !== line)) : line);
  const said = {
    look: { question: QUESTIONS.includes(base.look.question) ? '' : base.look.question, cta: deal(base.look.cta, LAST_LINES) },
    voice: { outro: deal(base.voice.outro, WINNER_LINES) },
  };
  const bases = [base.a, base.b];
  const held = keep.map((k) => k.ball || k.count || k.strength);
  const settled = [0, 1].map((k) => keptWhole(bases[k], keep[k]));
  const both = held[0] && held[1];
  // Always the same needs a hundred hits for even the smallest round layer as one ball, and the
  // digits of pi (4.5 a hit) pair with nothing but Counting, on one layer of 100: a crowd, or by hand.
  const sequences = (Object.keys(SEQUENCES) as SequenceId[]).filter((s) => s !== 'pi' && s !== 'ones');
  const comeback = wantsComeback(seed);
  let passed = 0;
  for (let attempt = 0; attempt < 60; attempt++) {
    const drawn = [pick(rng, sequences), pick(rng, sequences)];
    let crowd = crowds && crowdRng.next() < CROWD_CHANCE ? (crowdRng.next() < 0.5 ? 0 : 1) : -1;
    if (crowd >= 0 && held[crowd]) crowd = -1;
    const seq = [0, 1].map((k) => (held[k] ? bases[k].sequence : k === crowd ? 'ones' : drawn[k]));
    // How many balls: kept; rolled for Always the same, always a crowd, since one alone cannot
    // race; one for numbers that grow.
    const counts = [0, 1].map((k) => (held[k] && keep[k].count ? bases[k].count : crowdable(seq[k]) ? pick(crowdRng, CROWD_COUNTS) : 1));
    // How hard: kept, or rolled for the same hit every time; a kept ball whose numbers grow hits as it did.
    const strengths = [0, 1].map((k) =>
      held[k] && (keep[k].strength || seq[k] !== 'ones') ? bases[k].strength : seq[k] === 'ones' ? pick(crowdRng, STRENGTHS) : 1,
    );
    // Two different sequences, unless both balls are kept.
    if (seq[0] === seq[1] && !both) continue;
    const layers = pickLayers(rng, { sequence: seq[0], count: counts[0], strength: strengths[0] }, { sequence: seq[1], count: counts[1], strength: strengths[1] });
    // Two balls kept whole have nothing else to try: no layers suit them on any roll.
    if (!layers && settled[0] && settled[1]) return null;
    if (!layers) continue;
    const ca = held[0] ? bases[0].color : pick(rng, COLORS);
    const cb = held[1] ? bases[1].color : pick(rng, COLORS);
    const apart = Math.abs(hue(ca) - hue(cb));
    // Two greens or two blues read as one team at a glance; two kept balls keep the colours they have.
    if (!both && Math.min(apart, 360 - apart) < 75) continue;
    const powered = powers && rng.next() < POWER_CHANCE;
    const twice = powered && rng.next() < BOTH_POWERED;
    const first = rng.next() < 0.5;
    // Two powers are always two different ones: "one splits, the other speeds up" is a duel.
    const pa = pick(rng, POWERS);
    const pb = twice ? pick(rng, POWERS.filter((p) => p !== pa)) : pa;
    // A crowd has no power: a hundred balls is the twist.
    const specials: Special[] = [powered && (twice || first) && counts[0] <= 1 ? pa : 'none', powered && (twice || !first) && counts[1] <= 1 ? pb : 'none'];
    // A size goes to a ball without a power: one big or tiny ball, or, one time in three, a big one against a tiny one.
    const sizes: ('big' | 'tiny' | null)[] = [null, null];
    if (rng.next() < SIZED) {
      const big = rng.next() < 0.5;
      if (rng.next() < 1 / 3) [sizes[0], sizes[1]] = big ? ['big', 'tiny'] : ['tiny', 'big'];
      else sizes[rng.next() < 0.5 ? 0 : 1] = big ? 'big' : 'tiny';
    }
    const balls = [0, 1].map((k) => {
      if (!held[k]) return side(rng, seq[k], k ? cb : ca, specials[k], specials[k] === 'none' && counts[k] <= 1 ? sizes[k] : null, counts[k], strengths[k]);
      const ball = structuredClone(bases[k]);
      ball.radius = sizeFor(ball.radius, counts[k]);
      ball.count = counts[k];
      ball.strength = strengths[k];
      return ball;
    });
    const pace = pick(rng, PACE_WORDS);
    // Which names are the dice's to give: a new ball's, and a kept ball's when the dice gave it.
    const named = balls.map((c, k) => !held[k] || diceName({ ...c, name: bases[k].name }));
    // Names before balancing too: the winner line's length is part of the video's length.
    for (const [k, c] of balls.entries()) if (named[k]) c.name = nameFor(c, c, pace);
    const cfg = mergeConfig(base, {
      seed,
      a: balls[0],
      b: balls[1],
      layers,
      sound: { melody: pick(rng, MELODIES) },
      ...said,
    });
    const balanced = balance(cfg);
    if (!balanced) continue;
    if (comeback && passed < COMEBACK_TRIES && !isComeback(predict(balanced))) {
      passed++;
      continue;
    }
    if (named[0]) balanced.a.name = nameFor(balanced.a, balanced.b, pace);
    if (named[1]) balanced.b.name = nameFor(balanced.b, balanced.a, pace);
    if (balanced.a.name === balanced.b.name && named[1]) balanced.b.name = `Other ${balanced.b.name}`;
    return balanced;
  }
  // Practically unreachable with nothing kept: a known-good matchup rather than nothing.
  return held[0] || held[1] ? null : (balance(base) ?? base);
}
