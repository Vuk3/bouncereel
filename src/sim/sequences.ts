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
  /** What the ball wears in the paper look: one to three characters Rubik has. */
  mark: string;
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
    term: table((o, n) => (n === 0 ? 2n : n === 1 ? 1n : o[n - 1] + o[n - 2])),
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
    term: (n) => PI[Math.min(Math.max(0, n), LENGTH - 1)],
  },
  ones: {
    id: 'ones',
    label: 'Always 1',
    hint: '1, 1, 1, 1…',
    noun: '',
    brief: 'always hits for one',
    facts: ['Always one: slow, steady, and never tired.', 'One, every time: it never grows, and it never stops.'],
    mark: '1',
    term: () => 1n,
  },
};

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
