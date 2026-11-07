// The number rules a ball deals damage by. term(n) is the damage of the ball's
// (n+1)-th floor hit, as an exact BigInt: Fibonacci passes 2^53 by its 79th
// term, and a maths video whose numbers are off in the last digits gets
// called out in the comments.

export type SequenceId =
  | 'fibonacci'
  | 'factorial'
  | 'doubling'
  | 'tripling'
  | 'squares'
  | 'cubes'
  | 'primes'
  | 'triangular'
  | 'tribonacci'
  | 'lucas'
  | 'golden'
  | 'catalan'
  | 'tenfold'
  | 'collatz'
  | 'counting'
  | 'pi'
  | 'ones';

export interface SequenceDef {
  id: SequenceId;
  label: string;
  /** First terms, for the panel. */
  hint: string;
  /** What a generated ball is called: "Fibonacci" → "Fibonacci Ball". Empty: the name comes from its special. */
  noun: string;
  /** The narration's one-clause version, completing "<name> …". Kept short on purpose: the numbers are on screen. */
  brief: string;
  /** True, quick facts the opening can add after the two balls are introduced; the seed picks one. */
  facts: string[];
  /** What the ball wears in the paper look: one to three characters Rubik has, or φ, which the renderer draws itself (Rubik has no Greek). */
  mark: string;
  /**
   * What it does, in a few capital words under its name on the first frame, as the format writes it
   * ("×1.618 EVERY HIT"): what a viewer weighs to pick a side in the second they decide whether to
   * stay. Only characters Rubik's Latin set has.
   */
  rule: string;
  term(n: number): bigint;
}

// Far past any race: 400 floor hits at one a second is a seven-minute video.
const LENGTH = 400;

function table(make: (out: bigint[], n: number) => bigint): (n: number) => bigint {
  const out: bigint[] = [];
  for (let n = 0; n < LENGTH; n++) out.push(make(out, n));
  return (n) => out[Math.min(Math.max(0, n), LENGTH - 1)];
}

function primes(count: number): bigint[] {
  const out: number[] = [];
  for (let k = 2; out.length < count; k++) {
    if (out.every((p) => p * p > k || k % p !== 0)) out.push(k);
  }
  return out.map(BigInt);
}

const PRIMES = primes(LENGTH);

/**
 * The first `count` digits of pi, 3, 1, 4, 1, 5…, worked out rather than typed in: Machin's
 * formula, pi = 16·atan(1/5) − 4·atan(1/239), in integers scaled by 10^(count + 10). Each series
 * term is cut to a whole number, and ten guard digits hold the few hundred units that loses.
 */
function piDigits(count: number): bigint[] {
  const scale = 10n ** BigInt(count + 10);
  const atanInverse = (x: bigint) => {
    let sum = 0n;
    let power = scale / x;
    for (let k = 0n; power > 0n; k++) {
      sum += (k % 2n ? -power : power) / (2n * k + 1n);
      power /= x * x;
    }
    return sum;
  };
  const pi = 4n * (4n * atanInverse(5n) - atanInverse(239n));
  return [...pi.toString().slice(0, count)].map(BigInt);
}

const PI = piDigits(LENGTH);

/** Fibonacci's rule from 2 and 1. From the second on, they are the golden ratio's powers rounded (`golden`). */
const LUCAS = table((o, n) => (n === 0 ? 2n : n === 1 ? 1n : o[n - 1] + o[n - 2]));

export const SEQUENCES: Record<SequenceId, SequenceDef> = {
  fibonacci: {
    id: 'fibonacci',
    label: 'Fibonacci',
    hint: '1, 1, 2, 3, 5, 8, 13…',
    noun: 'Fibonacci',
    brief: 'adds up its last two hits',
    facts: [
      'Fibonacci numbers hide in sunflowers and pine cones.',
      'Fibonacci first wrote them down to count rabbits.',
      'Fibonacci numbers lead straight to the golden ratio.',
    ],
    mark: 'F',
    rule: 'ADDS UP ITS LAST TWO HITS',
    term: table((o, n) => (n < 2 ? 1n : o[n - 1] + o[n - 2])),
  },
  factorial: {
    id: 'factorial',
    label: 'Factorial',
    hint: '1, 2, 6, 24, 120, 720…',
    noun: 'Factorial',
    brief: 'multiplies by the next number',
    facts: [
      'By its twentieth hit, Factorial deals over two quintillion.',
      'Ten factorial is already over three and a half million.',
      'A deck of cards can be shuffled in more ways than there are atoms on Earth.',
    ],
    mark: 'n!',
    rule: 'MULTIPLIES BY THE NEXT NUMBER',
    term: table((o, n) => (n === 0 ? 1n : o[n - 1] * BigInt(n + 1))),
  },
  doubling: {
    id: 'doubling',
    label: 'Doubling',
    hint: '1, 2, 4, 8, 16, 32…',
    noun: 'Doubling',
    brief: 'doubles every hit',
    facts: [
      'Doubling is the rice on a chessboard trick.',
      'Ten doublings turn one into over a thousand.',
      'Computers count in powers of two.',
    ],
    mark: '×2',
    rule: 'DOUBLES EVERY HIT',
    term: table((o, n) => (n === 0 ? 1n : o[n - 1] * 2n)),
  },
  tripling: {
    id: 'tripling',
    label: 'Tripling',
    hint: '1, 3, 9, 27, 81…',
    noun: 'Tripling',
    brief: 'triples every hit',
    facts: ['Twenty hits in, Tripling hits for over a billion.', 'Ten triplings turn one into almost sixty thousand.'],
    mark: '×3',
    rule: 'TRIPLES EVERY HIT',
    term: table((o, n) => (n === 0 ? 1n : o[n - 1] * 3n)),
  },
  squares: {
    id: 'squares',
    label: 'Squares',
    hint: '1, 4, 9, 16, 25…',
    noun: 'Square',
    brief: 'hits with square numbers',
    facts: ['A square number is just a number times itself.', 'Add up the odd numbers in order and you always land on a square.'],
    mark: 'n²',
    rule: 'HITS 1, 4, 9, 16, 25…',
    term: (n) => BigInt((n + 1) * (n + 1)),
  },
  cubes: {
    id: 'cubes',
    label: 'Cubes',
    hint: '1, 8, 27, 64, 125…',
    noun: 'Cube',
    brief: 'hits with cube numbers',
    facts: ['Ten hits in, a cube hits for a thousand.', 'Seventeen twenty-nine is the sum of two cubes in two different ways.'],
    mark: 'n³',
    rule: 'HITS 1, 8, 27, 64, 125…',
    term: (n) => BigInt((n + 1) * (n + 1) * (n + 1)),
  },
  primes: {
    id: 'primes',
    label: 'Primes',
    hint: '2, 3, 5, 7, 11, 13…',
    noun: 'Prime',
    brief: 'hits with prime numbers',
    facts: [
      'A prime can only be divided by one and itself.',
      'The primes never run out: there is always a bigger one.',
      'Every whole number above one is built from primes.',
    ],
    mark: 'P',
    rule: 'HITS WITH PRIME NUMBERS',
    term: (n) => PRIMES[Math.min(Math.max(0, n), LENGTH - 1)],
  },
  triangular: {
    id: 'triangular',
    label: 'Triangular',
    hint: '1, 3, 6, 10, 15…',
    noun: 'Triangle',
    brief: 'hits a little harder every time',
    facts: ['Triangular numbers stack like bowling pins.', 'Add up one to a hundred and you land on a triangular number.'],
    mark: 'T',
    rule: 'HITS 1, 3, 6, 10, 15…',
    term: (n) => BigInt(((n + 1) * (n + 2)) / 2),
  },
  tribonacci: {
    id: 'tribonacci',
    label: 'Tribonacci',
    hint: '1, 1, 2, 4, 7, 13, 24…',
    noun: 'Tribonacci',
    brief: 'adds up its last three hits',
    facts: [
      'Tribonacci is Fibonacci with one more number in every sum.',
      'Tribonacci counts the ways to climb stairs one, two or three steps at a time.',
    ],
    mark: 'Tr',
    rule: 'ADDS UP ITS LAST THREE HITS',
    term: table((o, n) => (n < 2 ? 1n : n === 2 ? 2n : o[n - 1] + o[n - 2] + o[n - 3])),
  },
  lucas: {
    id: 'lucas',
    label: 'Lucas',
    hint: '2, 1, 3, 4, 7, 11, 18…',
    noun: 'Lucas',
    brief: 'adds up its last two hits, from two and one',
    facts: [
      "Lucas numbers follow Fibonacci's rule, but start with two and one.",
      'The man behind Lucas numbers also invented the Tower of Hanoi.',
    ],
    mark: 'L',
    rule: 'ADDS UP ITS LAST TWO, FROM 2 AND 1',
    term: LUCAS,
  },
  golden: {
    id: 'golden',
    // The name alone, as every other label: the ×1.618 is the rule's and the brief's to say.
    label: 'Golden ratio',
    hint: '1, 2, 3, 4, 7, 11, 18, 29…',
    noun: 'Golden Ratio',
    brief: 'hits 1.618 times harder every time',
    facts: [
      'The golden ratio is about 1.618, and adding one to it gives its square.',
      'Divide a Fibonacci number by the one before it and you get closer and closer to the golden ratio.',
      "Round the golden ratio's powers and out come the Lucas numbers.",
    ],
    mark: 'φ',
    rule: '×1.618 EVERY HIT',
    // The golden ratio's powers, rounded, so each hit is 1.618 times the last: 1, 1.618 → 2, 2.618 → 3,
    // 4.236 → 4… From the second power on, that is exactly the Lucas numbers (φⁿ + ψⁿ is a whole
    // number and |ψⁿ| < 0.5), so the terms are exact however far they go.
    term: (n) => (n === 0 ? 1n : n === 1 ? 2n : LUCAS(n)),
  },
  catalan: {
    id: 'catalan',
    label: 'Catalan',
    hint: '1, 1, 2, 5, 14, 42, 132…',
    noun: 'Catalan',
    brief: 'starts slow, then nearly quadruples every hit',
    facts: [
      'Catalan numbers count the ways to match up pairs of brackets.',
      'Catalan numbers count the ways to cut a polygon into triangles.',
    ],
    mark: 'C',
    rule: 'HITS 1, 1, 2, 5, 14, 42…',
    // C(n) = C(n−1) · 2(2n−1) / (n+1), which always divides exactly.
    term: table((o, n) => (n === 0 ? 1n : (o[n - 1] * BigInt(2 * (2 * n - 1))) / BigInt(n + 1))),
  },
  tenfold: {
    id: 'tenfold',
    label: 'Tenfold',
    hint: '1, 10, 100, 1000…',
    noun: 'Tenfold',
    brief: 'adds a zero every hit',
    facts: ['By its tenth hit, Tenfold hits for a billion.', 'A googol is just a one with a hundred zeros after it.'],
    mark: '×10',
    rule: '×10 EVERY HIT',
    term: (n) => 10n ** BigInt(n),
  },
  collatz: {
    id: 'collatz',
    label: 'Collatz',
    hint: '27, 82, 41, 124, 62, 31…',
    noun: 'Collatz',
    brief: 'halves its hit or triples it, so it jumps up and down',
    facts: [
      'Nobody has ever proved that this halving and tripling always ends at one.',
      'From twenty-seven, it climbs past nine thousand before falling to one.',
    ],
    mark: '3n',
    rule: 'JUMPS UP AND DOWN: 27, 82, 41…',
    // From 27, the famous long one: 111 steps up to 9,232 and down to 1, far past any race's hits;
    // a ball still hitting after that goes round 4, 2, 1.
    term: table((o, n) => (n === 0 ? 27n : o[n - 1] === 1n ? 4n : o[n - 1] % 2n ? 3n * o[n - 1] + 1n : o[n - 1] / 2n)),
  },
  counting: {
    id: 'counting',
    label: 'Counting',
    hint: '1, 2, 3, 4, 5…',
    noun: 'Counting',
    brief: 'hits one harder every time',
    facts: ['Counting looks harmless, but it never stops climbing.', 'Counting is the first sequence anyone ever learns.'],
    mark: '+1',
    rule: '+1 EVERY HIT',
    term: (n) => BigInt(n + 1),
  },
  pi: {
    id: 'pi',
    label: 'Digits of pi',
    hint: '3, 1, 4, 1, 5, 9, 2…',
    noun: 'Pi',
    brief: 'hits with the digits of pi',
    facts: [
      "Pi's digits go on forever and never repeat.",
      'Pi has been worked out to trillions of digits.',
      'Nobody knows if every digit turns up equally often in pi.',
    ],
    // Rubik's Latin set has no π.
    mark: 'Pi',
    rule: 'HITS THE DIGITS OF PI',
    term: (n) => PI[Math.min(Math.max(0, n), LENGTH - 1)],
  },
  ones: {
    id: 'ones',
    label: 'Always the same',
    hint: 'the same hit every time, as strong as you set it',
    noun: '',
    brief: 'always hits for one',
    facts: ['The same hit every time: slow, steady, and never tired.', 'It never grows, and it never stops.'],
    mark: '1',
    rule: 'THE SAME HIT EVERY TIME',
    term: () => 1n,
  },
};

// ── How hard a ball hits ────────────────────────────────────────────────────

/**
 * What every hit is multiplied by (Contestant.strength): 1, or for Always the same the one
 * number it hits with, from 1 to a million, in powers of ten so the layers the dice picks (1, 2
 * or 5 times a power of ten) suit it.
 */
export const STRENGTHS = [1, 10, 100, 1000, 10_000, 100_000, 1_000_000] as const;

const STRENGTH_WORDS: Record<number, [said: string, noun: string, mark: string]> = {
  1: ['one', 'One', '1'],
  10: ['ten', 'Ten', '10'],
  100: ['a hundred', 'Hundred', '100'],
  1000: ['a thousand', 'Thousand', '1K'],
  10_000: ['ten thousand', 'Ten Thousand', '10K'],
  100_000: ['a hundred thousand', 'Hundred Thousand', ''],
  // The format's own word for a crowd hitting for a million: "100× Millionaire Balls".
  1_000_000: ['a million', 'Millionaire', '1M'],
};

/** A strength as the narrator says it: "a thousand". */
export function strengthSaid(strength: number): string {
  return STRENGTH_WORDS[strength]?.[0] ?? formatBig(BigInt(Math.round(strength)), ',');
}

/** What an Always the same ball is called by its strength: "Thousand Ball", "100× Millionaire Balls". */
export function strengthNoun(strength: number): string {
  return STRENGTH_WORDS[strength]?.[1] ?? 'Steady';
}

/** Its mark in the paper look: "1K"; none where that would not fit a ball. */
export function strengthMark(strength: number): string {
  return STRENGTH_WORDS[strength]?.[2] ?? '';
}

/** Every noun an Always the same ball may have had, the one before strengths (Steady) too: for telling a name the dice gave. */
export const STRENGTH_NOUNS = [...STRENGTHS.map(strengthNoun), 'Steady'];

// ── Numbers on screen and in speech ─────────────────────────────────────────

/**
 * Whole numbers, every digit, with a thousands separator: "1.000.000.000.000.000".
 * Never "1,2×10²⁵": the format is about exact numbers, so layers are kept
 * small enough (see balance.ts) that every value fits a card at full length.
 */
export function formatBig(v: bigint, separator: '.' | ','): string {
  const negative = v < 0n;
  const digits = (negative ? -v : v).toString();
  return (negative ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** "1000, 1e10, 1e15" or "1k 10b 1q" → bigints. Unreadable entries are skipped. */
export function parseLayers(text: string): bigint[] {
  const SUFFIX: Record<string, number> = { k: 3, m: 6, b: 9, t: 12, q: 15 };
  const out: bigint[] = [];
  for (const token of text.toLowerCase().split(/[\s,;]+/)) {
    const m = /^(\d+)(?:\.(\d+))?(?:e(\d+)|([kmbtq]))?$/.exec(token.replace(/_/g, ''));
    if (!m) continue;
    const [, whole, frac = '', exp, suffix] = m;
    const power = exp ? Number(exp) : suffix ? SUFFIX[suffix] : 0;
    const kept = frac.slice(0, power);
    const value = BigInt(whole + kept) * 10n ** BigInt(power - kept.length);
    if (value > 0n) out.push(value);
  }
  return out;
}
