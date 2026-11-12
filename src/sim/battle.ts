import { flagName } from '../battle/countries.ts';
import type { Config } from '../config.ts';
import { ARENA } from '../layout.ts';
import { dcos, dsin } from './detmath.ts';
import { createRng, type Rng } from './rng.ts';

// Arena Clash: 2 to 12 balls in one round arena, each a country's flag, each tied to the ring by a
// fan of strings. A ball that touches a rival's strings cuts every one it touches, at once, so a
// ball flying through a fan takes all of it; its own it passes through. Every bounce off the ring
// ties a bundle of new ones where it hit, however many the ball holds: there is no most, and
// strings only ever go by being cut. A ball with no strings left is out, and the last one in wins.
// The format is the "string circle" of the short-video channels; what is this game's own is how a
// battle is made to end on a chosen second (battle-balance.ts).
//
// Balls fly straight, all at one speed, bounce off the ring (turned a little each time, scatter)
// and off each other, and grow as rivals go out, so the last ones fill the frame.
//
// Strings come from one place only, a bounce off the ring, and every bounce ties some, as in
// every video of the format: a viewer who sees a string appear looks for the bounce that tied it,
// and one who sees a ball hit the ring looks for its new strings.
//
// What ends a battle is the cuts: a rival passing near a ball hides a stretch of the ring from it
// and cuts every string tied there, so strings spread round the ring are cut a stretch at a time,
// and a ball down to its last bundle, where it last hit the ring, is out the next time a rival
// passes behind it. A ball rarely holds more than 150 (250 at the most, in sixty battles). And
// every ball speeds up as the battle goes on (pace), so a long duel plays faster.
//
// The world steps by distance, not by time: every step moves every ball STRIDE px, whatever the
// battle's speed, which only says how long a step lasts (`dt` at the start, shorter as the balls
// speed up). So a battle twice as fast is the same battle in half the time, to the last string,
// and balancing can put its end on any second by choosing the starting speed.

export const MIN_FLAGS = 2;
export const MAX_FLAGS = 12;
/** Strings a flag starts with: the number under its ball starts at a hundred. */
export const STRINGS = 100;
/** Strings every bounce off the ring ties: ten bounces to a whole new fan. */
export const BUNDLE = 10;
/**
 * A flag down to its last bundle or fewer is in danger, one rival's pass from out: the renderer
 * turns its count red and beats it, and the sonifier beats a heart, both every HEARTBEAT seconds of
 * battle, so picture and sound keep time and slow down with the slow motion. Only shown and heard:
 * nothing in the battle depends on either.
 */
export const DANGER = BUNDLE;
/** 80 beats a minute, a resting heart's quicker end: tense without hurrying a battle that is already loud. */
export const HEARTBEAT = 0.75;

/** Whether a flag is in danger (DANGER). */
export function inDanger(f: Flag): boolean {
  return f.alive && f.strings.length <= DANGER;
}

/** px every ball moves in a step: a fifth of a frame's travel at the usual speeds, so the motion is even frame to frame. */
export const STRIDE = 1;
/**
 * Every ball speeds up as the battle goes on, as in the format's videos: by its starting speed
 * again every RAMP_PX px it has travelled, to TOP times it. A long duel plays faster and ends
 * sooner in seconds: with every bounce tying strings, the last two can hold out for a long while
 * (half of sixty duels took more than 6,000 px), and flying the same paths faster is what ended
 * them where growing the balls only wedged them (more than half never ended). The paths are the
 * same at any pace, since a step is a distance; only its time is shorter.
 */
const RAMP_PX = 8000;
const TOP = 2;

/** How many times its starting speed every ball flies at, after `step` steps. */
export function pace(step: number): number {
  return Math.min(TOP, 1 + (step * STRIDE) / RAMP_PX);
}

/**
 * The sum of 1 / pace over the first `steps` steps, kept as it grows (every battle shares it): a
 * battle's seconds at a second a step from the start. Sums and divisions, the same everywhere.
 */
const SPANS = [0];
function span(steps: number): number {
  for (let i = SPANS.length; i <= steps; i++) SPANS.push(SPANS[i - 1] + 1 / pace(i));
  return SPANS[steps];
}

/** The widest a flag's first fan is on the ring, in radians (two flags would each hold half the ring: a comb, not a fan). */
const FAN = 1.9;
/** A bundle's width on the ring, in radians: about 55 px of it, a narrow fan beside the first one. */
const BUNDLE_ARC = 0.115;
/** Where a ball starts, from the centre, in arena radii: near the ring, its fan already a wedge. */
const START = 0.66;
/** A ball's first heading is at the centre, off by up to this many radians: they meet in the middle, never on one point, and bounce back out to their own fans. */
const AIM = 0.1;
/** The most a bounce off the ring turns a ball from its mirrored path, in radians either way (scatter). */
const SCATTER = 0.3;
/**
 * The most two balls meeting turn each other from their paths, in radians either way. Without
 * it two balls that meet head on bounce straight back, meet again in the middle, and go on so:
 * a duel of 4,000 px with nobody ever behind the other, where its strings are.
 */
const CLASH = 0.3;
/** The least of a ball's heading that points into the arena after a bounce: about 17° off the ring. */
const GRAZE = 0.3;
/** px of radius a ball gains per px it travels once a rival is out: the next size in about a fifth of a second. */
const GROW = 0.08;
/**
 * Ball radius by the number of flags still in: a tenth of the ring's width at twelve, a fifth for
 * the last two, as the format's biggest channel sizes them. A flag is read on a phone at twelve,
 * and the last two are faces, not dots.
 */
const RADII = [0, 0, 100, 90, 82, 75, 69, 64, 60, 56, 53, 50, 48];

/** A ball's radius while `alive` flags are in. */
export function flagRadius(alive: number): number {
  return RADII[Math.max(MIN_FLAGS, Math.min(MAX_FLAGS, alive))];
}

/** A string, by where it is tied on the ring; it runs from there to its ball. */
export interface Str {
  x: number;
  y: number;
  /** Its place round the ring (ringKey): a flag's strings are kept in this order. */
  k: number;
}

export interface Flag {
  id: number;
  code: string;
  x: number;
  y: number;
  /** Its heading, a unit vector: every ball moves STRIDE px along it each step. */
  ux: number;
  uy: number;
  r: number;
  /** In the order they sit round the ring. */
  strings: Str[];
  alive: boolean;
  /** Rival strings this ball has cut. */
  cuts: number;
  /** 1 for the winner, then 2 for the last one out, and so on; null while in. */
  place: number | null;
}

/** `flag` is the index into `flags`, which is the order the flags were given in. */
export type BattleEvent =
  /** A bounce off the ring that tied `n` strings there. */
  | { type: 'tie'; flag: number; x: number; y: number; n: number }
  | { type: 'clash'; x: number; y: number }
  /** `by`, at x, y, cut `n` of `flag`'s strings in this step (`strings`, where each was tied), leaving it `left`. */
  | { type: 'cut'; flag: number; by: number; n: number; left: number; x: number; y: number; strings: Str[] }
  | { type: 'out'; flag: number; by: number; x: number; y: number; place: number }
  | { type: 'win'; flag: number }
  /** Nobody won by maxSeconds: the flag with the most strings wins. */
  | { type: 'timeout'; flag: number };

/**
 * Where a point of the ring is round it, as a number that grows with its angle from 0 to 4: sums
 * and one division, where the angle itself would take an arctangent, which engines round their
 * own ways. `dx`, `dy` from the arena's centre.
 */
function ringKey(dx: number, dy: number): number {
  const p = dy / (Math.abs(dx) + Math.abs(dy));
  return dx < 0 ? 2 - p : dy < 0 ? 4 + p : p;
}

/** The first of `strings` at or past `k` round the ring. */
function firstFrom(strings: Str[], k: number): number {
  let lo = 0;
  let hi = strings.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strings[mid].k < k) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A bundle's strings, as turns from the point the ball hit: the cosine and sine of each. */
const BUNDLE_TURNS = Array.from({ length: BUNDLE }, (_, j) => {
  const a = ((j - (BUNDLE - 1) / 2) * BUNDLE_ARC) / BUNDLE;
  return { cos: dcos(a), sin: dsin(a) };
});

export class BattleWorld {
  /** Whole steps run. */
  steps = 0;
  winner: number | null = null;
  winTime = 0;
  timedOut = false;
  flags: Flag[];
  alive: number;
  /** Seconds a step lasts at the battle's starting speed (`battle.speed`); later ones are shorter (pace). */
  readonly dt: number;
  private readonly limit: number;
  /** The step the win came on. */
  winStep = 0;
  private events: BattleEvent[] = [];
  private readonly rng: Rng;

  constructor(cfg: Config) {
    const codes = cfg.battle.flags;
    const n = codes.length;
    const rng = (this.rng = createRng(`battle:${cfg.seed}:${n}`));
    this.dt = STRIDE / Math.max(1, cfg.battle.speed);
    this.limit = cfg.timing.maxSeconds;
    const r = flagRadius(n);
    const turn = rng.next() * 2 * Math.PI;
    const fan = Math.min((2 * Math.PI) / n, FAN);
    this.flags = codes.map((code, id) => {
      // Each flag has its slice of the ring: its fan across it, its ball in front of the middle.
      const a = turn + (id * 2 * Math.PI) / n;
      const heading = a + Math.PI + (rng.next() - 0.5) * 2 * AIM;
      const strings: Str[] = [];
      for (let k = 0; k < STRINGS; k++) {
        const la = a + ((k + 0.5) / STRINGS - 0.5) * fan;
        const dx = dcos(la);
        const dy = dsin(la);
        strings.push({ x: ARENA.x + dx * ARENA.r, y: ARENA.y + dy * ARENA.r, k: ringKey(dx, dy) });
      }
      strings.sort((p, q) => p.k - q.k);
      // No further out than the ring allows a ball of this size.
      const d = Math.min(ARENA.r * START, ARENA.r - r - 4);
      return { id, code, x: ARENA.x + dcos(a) * d, y: ARENA.y + dsin(a) * d, ux: dcos(heading), uy: dsin(heading), r, strings, alive: true, cuts: 0, place: null };
    });
    this.alive = n;
  }

  /** Seconds of battle so far. */
  get time(): number {
    return this.timeAt(this.steps);
  }

  /** Seconds of battle at the end of step `step`. */
  timeAt(step: number): number {
    return span(step) * this.dt;
  }

  /** Seconds the next step lasts: the page runs as many as a frame's time holds. */
  get nextStep(): number {
    return this.dt / pace(this.steps + 1);
  }

  drain(): BattleEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** One step: every ball STRIDE px on. After the win only the winner flies on, tying nothing. */
  step(): void {
    this.steps++;
    this.move();
    if (this.winner !== null) return;
    this.collide();
    if (this.cut()) return;
    if (this.time >= this.limit) this.timeout();
  }

  private move(): void {
    const target = flagRadius(this.alive);
    const won = this.winner !== null;
    for (const f of this.flags) {
      if (!f.alive) continue;
      if (f.r < target) f.r = Math.min(target, f.r + GROW * STRIDE);
      f.x += f.ux * STRIDE;
      f.y += f.uy * STRIDE;
      const dx = f.x - ARENA.x;
      const dy = f.y - ARENA.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const room = ARENA.r - f.r;
      if (d <= room) continue;
      const nx = dx / d;
      const ny = dy / d;
      // Mirrored back by the overshoot, never clamped: the path is the same at any speed.
      const back = room - (d - room);
      f.x = ARENA.x + nx * back;
      f.y = ARENA.y + ny * back;
      const dot = f.ux * nx + f.uy * ny;
      // Pushed out by another ball, or grown past the ring, while already heading in: back inside, but no bounce.
      if (dot <= 0) continue;
      f.ux -= 2 * dot * nx;
      f.uy -= 2 * dot * ny;
      this.scatter(f, nx, ny);
      if (won) continue;
      this.tie(f, nx, ny);
    }
  }

  /** A bounce at nx, ny on the ring ties a bundle there: always, however many the ball holds. */
  private tie(f: Flag, nx: number, ny: number): void {
    for (const t of BUNDLE_TURNS) {
      const sx = nx * t.cos - ny * t.sin;
      const sy = ny * t.cos + nx * t.sin;
      const k = ringKey(sx, sy);
      f.strings.splice(firstFrom(f.strings, k), 0, { x: ARENA.x + sx * ARENA.r, y: ARENA.y + sy * ARENA.r, k });
    }
    this.events.push({ type: 'tie', flag: f.id, x: ARENA.x + nx * ARENA.r, y: ARENA.y + ny * ARENA.r, n: BUNDLE });
  }

  /**
   * A bounce off the ring turns the ball by up to SCATTER either way, and never leaves it skimming
   * the ring (GRAZE). A perfect circle is too regular a table: a ball keeps one angle to it for
   * ever, two balls settle into paths that never meet, and a battle of two then never ends (more
   * than half of them did not, in sixty tried); and a ball skimming the ring bounces every few px,
   * tying a bundle each time.
   */
  private scatter(f: Flag, nx: number, ny: number): void {
    const a = (this.rng.next() - 0.5) * 2 * SCATTER;
    const cos = dcos(a);
    const sin = dsin(a);
    const ux = f.ux * cos - f.uy * sin;
    const uy = f.uy * cos + f.ux * sin;
    // Along the ring (the tangent -ny, nx) and into the arena (against the normal).
    const along = -ux * ny + uy * nx;
    const inward = Math.max(GRAZE, -(ux * nx + uy * ny));
    const side = Math.sqrt(1 - inward * inward) * (along < 0 ? -1 : 1);
    f.ux = -inward * nx - side * ny;
    f.uy = -inward * ny + side * nx;
  }

  /** Turns a ball's heading by `a` radians. */
  private swerve(f: Flag, a: number): void {
    const cos = dcos(a);
    const sin = dsin(a);
    const ux = f.ux * cos - f.uy * sin;
    f.uy = f.uy * cos + f.ux * sin;
    f.ux = ux;
  }

  /**
   * Two balls that touch while closing swap the part of their heading along the line between them,
   * as equal masses do, and each is then a unit vector again: every ball keeps the one speed. A
   * ball that would be left standing turns back the way it came instead.
   */
  private collide(): void {
    const flags = this.flags;
    for (let i = 0; i < flags.length; i++) {
      const p = flags[i];
      if (!p.alive) continue;
      for (let j = i + 1; j < flags.length; j++) {
        const q = flags[j];
        if (!q.alive) continue;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const min = p.r + q.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const closing = (p.ux - q.ux) * nx + (p.uy - q.uy) * ny;
        if (closing > 0) {
          turn(p, p.ux - closing * nx, p.uy - closing * ny);
          turn(q, q.ux + closing * nx, q.uy + closing * ny);
          this.swerve(p, (this.rng.next() - 0.5) * 2 * CLASH);
          this.swerve(q, (this.rng.next() - 0.5) * 2 * CLASH);
          this.events.push({ type: 'clash', x: p.x + nx * p.r, y: p.y + ny * p.r });
        }
        const push = (min - d) / 2;
        p.x -= nx * push;
        p.y -= ny * push;
        q.x += nx * push;
        q.y += ny * push;
      }
    }
  }

  /**
   * Every ball cuts the rival strings it touches. Seen from a flag's ball, a rival hides a stretch
   * of the ring: between the two lines from the ball that just graze the rival. Every string tied
   * in that stretch runs through the rival, and no other does, so the cut is one slice out of the
   * flag's strings, kept in the ring's order. True once the battle is won.
   */
  private cut(): boolean {
    for (const c of this.flags) {
      if (!c.alive) continue;
      for (const o of this.flags) {
        if (o === c || !o.alive) continue;
        const cut = this.sever(o, c);
        const n = cut.length;
        if (!n) continue;
        c.cuts += n;
        this.events.push({ type: 'cut', flag: o.id, by: c.id, n, left: o.strings.length, x: c.x, y: c.y, strings: cut });
        if (o.strings.length) continue;
        o.alive = false;
        o.place = this.alive;
        this.alive--;
        this.events.push({ type: 'out', flag: o.id, by: c.id, x: o.x, y: o.y, place: o.place });
        if (this.alive === 1) {
          this.win(this.flags.find((f) => f.alive)!);
          return true;
        }
      }
    }
    return false;
  }

  /** Removes the strings of `o` that run through `c`, and returns them. */
  private sever(o: Flag, c: Flag): Str[] {
    const strings = o.strings;
    const dx = c.x - o.x;
    const dy = c.y - o.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    // Two balls never overlap by more than a step's push, so the rival is never over this ball's middle.
    if (d <= c.r) return [];
    const sin = c.r / d;
    const cos = Math.sqrt(1 - sin * sin);
    const ux = dx / d;
    const uy = dy / d;
    // The grazing lines: the way to the rival, turned by the angle it fills, either way.
    const from = this.ringAt(o, ux * cos + uy * sin, uy * cos - ux * sin);
    const to = this.ringAt(o, ux * cos - uy * sin, uy * cos + ux * sin);
    const lo = firstFrom(strings, from);
    const hi = firstFrom(strings, to);
    // The hidden stretch runs on from `from` to `to` the way the keys grow, over the 4-to-0 seam if `to` is the smaller.
    if (from <= to) return hi > lo ? strings.splice(lo, hi - lo) : [];
    return [...strings.splice(lo), ...strings.splice(0, hi)];
  }

  /** Where the line from `o`'s ball along the unit vector tx, ty meets the ring, as a ringKey. */
  private ringAt(o: Flag, tx: number, ty: number): number {
    const px = o.x - ARENA.x;
    const py = o.y - ARENA.y;
    const along = px * tx + py * ty;
    // The ball is inside the ring, so the root is real and the far crossing is the one ahead.
    const s = -along + Math.sqrt(along * along + ARENA.r * ARENA.r - px * px - py * py);
    return ringKey(px + tx * s, py + ty * s);
  }

  private win(f: Flag): void {
    f.place = 1;
    this.winner = f.id;
    this.winTime = this.time;
    this.winStep = this.steps;
    this.events.push({ type: 'win', flag: f.id });
  }

  /** Time is up: the most strings wins, then the most cuts, then the order the flags were given in. */
  private timeout(): void {
    const left = this.flags.filter((f) => f.alive);
    left.sort((a, b) => b.strings.length - a.strings.length || b.cuts - a.cuts || a.id - b.id);
    this.timedOut = true;
    left.forEach((f, i) => (f.place = i + 1));
    this.win(left[0]);
    this.events.push({ type: 'timeout', flag: left[0].id });
  }
}

/** Sets a ball's heading to x, y made a unit vector; left as it was, turned round, when x, y is next to nothing. */
function turn(f: Flag, x: number, y: number): void {
  const length = Math.sqrt(x * x + y * y);
  if (length < 0.05) {
    f.ux = -f.ux;
    f.uy = -f.uy;
    return;
  }
  f.ux = x / length;
  f.uy = y / length;
}

/**
 * An out is shown in slow motion while at most this many flags are in: the last ones, where a
 * viewer has a flag to fear for. Earlier ones come too thick to slow each down.
 */
const SLOW_FLAGS = 4;
/** px of travel before such an out that slow motion starts, and after it that it ends: the rival's pass through the last strings. */
const SLOW_LEAD = 120;
const SLOW_TAIL = 30;
/**
 * No slow motion of its own for an out this many px before the win: the win's own slow motion
 * (pacing.ts SLOWMO_LEAD, 0.6 s) starts by then, 550 px before it at the fastest a battle ends
 * (460 px/s, sped up to TOP).
 */
const SLOW_CLEAR = 600;

/** How a battle plays out, known before anything is drawn (as the race's `Outcome`). */
export interface BattleOutcome {
  seed: string;
  winner: number | null;
  winnerName: string;
  /** Seconds of battle until the win. */
  time: number;
  timedOut: boolean;
  /** Every flag out, in order, at the second it went, and who cut its last string. */
  outs: { flag: number; time: number; by: number }[];
  /** Strings each flag cut, in the order the flags were given in. */
  cuts: number[];
  /** The stretches of the battle played in slow motion, in its seconds: into and just past an out among the last flags. */
  slow: [number, number][];
  /**
   * Seconds the winner held more strings than every rival still in (`led`) and fewer than one of
   * them (`trailed`), as the counts under the balls show it, and the second from which it led to
   * the end (`decided`): whether the battle is a comeback (battle-balance.ts).
   */
  led: number;
  trailed: number;
  decided: number;
}

export function predictBattle(cfg: Config): BattleOutcome {
  const world = new BattleWorld(cfg);
  const outs: BattleOutcome['outs'] = [];
  const steps: number[] = [];
  // Every flag's seconds ahead and behind, and the last second it was not ahead: only the winner's are kept.
  const n = cfg.battle.flags.length;
  const led = new Array<number>(n).fill(0);
  const trailed = new Array<number>(n).fill(0);
  const notAhead = new Array<number>(n).fill(0);
  let before = 0;
  while (world.winner === null) {
    world.step();
    for (const e of world.drain()) {
      if (e.type !== 'out') continue;
      outs.push({ flag: e.flag, time: world.time, by: e.by });
      steps.push(world.steps);
    }
    const now = world.time;
    for (const f of world.flags) {
      if (!f.alive) continue;
      let most = 0;
      for (const o of world.flags) if (o !== f && o.alive) most = Math.max(most, o.strings.length);
      if (f.strings.length > most) led[f.id] += now - before;
      else {
        notAhead[f.id] = now;
        if (f.strings.length < most) trailed[f.id] += now - before;
      }
    }
    before = now;
  }
  const winner = world.winner;
  // In px, where a stretch is the same at any speed, then in this battle's seconds.
  const end = world.winStep * STRIDE;
  const slow: [number, number][] = [];
  steps.forEach((step, i) => {
    const at = step * STRIDE;
    if (world.timedOut || cfg.battle.flags.length - i > SLOW_FLAGS || at + SLOW_TAIL > end - SLOW_CLEAR) return;
    const from = Math.max(0, at - SLOW_LEAD);
    const last = slow[slow.length - 1];
    // Two outs close together are one stretch.
    if (last && from <= last[1]) last[1] = at + SLOW_TAIL;
    else slow.push([from, at + SLOW_TAIL]);
  });
  return {
    seed: cfg.seed,
    winner,
    winnerName: flagName(cfg.battle.flags[winner] ?? ''),
    time: world.winTime,
    timedOut: world.timedOut,
    outs,
    cuts: world.flags.map((f) => f.cuts),
    slow: slow.map(([from, to]) => [world.timeAt(Math.round(from / STRIDE)), world.timeAt(Math.round(to / STRIDE))]),
    led: led[winner],
    trailed: trailed[winner],
    decided: notAhead[winner],
  };
}
