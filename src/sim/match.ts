import type { Config } from '../config.ts';
import { sideName } from '../football/teams.ts';
import { PITCH } from '../layout.ts';
import { dcos, dsin } from './detmath.ts';
import { createRng, type Rng } from './rng.ts';

// Goal Rush: a football match of ninety minutes in one round pitch, on the black stage. Two balls,
// each a club or a player in its kit, fly straight at one speed, bounce off the ring and off each
// other; the goal is a gap in the ring that turns round it all match. A ball that reaches the ring
// inside the goal's mouth has scored: GOAL, a moment of the scorer in the net, and both kick off
// again from the middle. One that reaches it at a post bounces off the post. At ninety minutes the
// side with more goals wins; level, the next goal wins (golden goal).
//
// The ninety minutes are the video's: the match runs `match.seconds` (balancing sets it, the video
// length less the frame around it), and the clock on screen is those seconds as minutes. The goal
// turns the other way from half time, as the sides change ends.
//
// The world steps by time (STEP), not by distance as an Arena Clash does: a match is fitted to its
// video by its length alone, which is the clock's, never by its speed. Balancing chooses only the
// seed (match-balance.ts).

/** Seconds a step lasts: 240 a second, as the race's, about 3 px of a ball's travel. */
export const MATCH_STEP = 1 / 240;
/** The clock's whole match. */
export const MINUTES = 90;
/**
 * px of radius: each ball a fifth of the pitch across, so a face or a crest in it reads on a phone
 * (84 px was a sixth, and a face in it a thumbnail). Goals barely change with the size (6.7 a 40 s
 * match at 84, 6.6 at 104, 200 matches each): the mouth is two balls wide either way.
 */
export const BALL_R = 100;
/**
 * px/s every ball flies at: the pitch crossed in about 1.1 s, a bounce off the ring every 0.8 s or
 * so a ball. 640 read as slow to the owner, who asked for a livelier match; the goals it would add
 * are taken back by MOUTH.
 */
export const SPEED = 780;
/**
 * The goal's mouth, half its angle round the ring from its middle: 0.32 rad, a mouth 305 px wide,
 * a ball and a half. A ball scores when the point where it meets the ring is inside the mouth by a
 * little over half its own width on the ring (SCORE_IN), and hits a post within as much of it
 * either side of a post. With SPEED, SPIN and CELEBRATE as they are, a goal every 5.7 s of match
 * (0.174 a second over 300 matches, about six in a 40 s video); at 0.36 it was 0.20, ten and more
 * in a minute's video, over goalsWanted's ten.
 */
export const MOUTH = 0.32;
const HALF_BALL = BALL_R / PITCH.r;
const SCORE_IN = 0.6 * HALF_BALL;
/** Radians a second the goal turns: once round in about four and a half seconds. */
export const SPIN = 1.35;
/**
 * Seconds of the match a goal stops it for: the scorer in the net and GOAL over the pitch (the
 * renderer), then the kick-off. The clock runs on, as a referee's does. 1.2 s felt like a stall
 * to the owner, more so with six goals in a video; GOAL! stays a moment into the play after it.
 */
export const CELEBRATE = 0.7;
/** Where the two kick off, px either side of the centre spot: home on the left, away on the right. */
const KICKOFF = 170;
/** The most a bounce off the ring turns a ball from its mirrored path, in radians either way: a round table is too regular, and two balls settle into paths that never meet the goal. */
const SCATTER = 0.12;
/** The most two balls meeting turn each other, in radians either way: without it they bounce straight back and forth. */
const CLASH = 0.25;
/** The least of a ball's heading that points into the pitch after a bounce: about 17° off the ring, so none skims it. */
const GRAZE = 0.3;
/** The cosines of SCORE_IN and of the post's reach from the goal's middle, worked out once. */
const SCORE_COS = dcos(MOUTH - SCORE_IN);
const POST_COS = dcos(MOUTH + SCORE_IN);

export interface Ball {
  side: 0 | 1;
  x: number;
  y: number;
  /** Its heading, a unit vector. */
  ux: number;
  uy: number;
  r: number;
}

export interface Goal {
  side: 0 | 1;
  /** Seconds into the match. */
  time: number;
  /** The clock's minute, as the scoreboard writes it ("67'"); past ninety, golden goal's. */
  minute: number;
  /** The score after it, home first. */
  score: [number, number];
}

export type MatchEvent =
  /** A bounce off the ring at x, y. */
  | { type: 'bounce'; side: 0 | 1; x: number; y: number }
  /** Off a post, the post at x, y. */
  | { type: 'post'; side: 0 | 1; x: number; y: number }
  | { type: 'clash'; x: number; y: number }
  /** The ball crossed the line at x, y; `nx`, `ny` the way out of the pitch there. */
  | { type: 'goal'; side: 0 | 1; x: number; y: number; nx: number; ny: number; goal: Goal }
  /** Both balls on their spots and away: the match's start (`first`), or after a goal. */
  | { type: 'kickoff'; first: boolean }
  | { type: 'half' }
  /** Ninety minutes, the scores level: the next goal wins. */
  | { type: 'golden' }
  | { type: 'whistle' }
  | { type: 'win'; side: 0 | 1 };

/** The clock's minute `t` seconds into a match of `length`: 1' in its first ninetieth, 90' in its last; 91' and on after it. */
export function minuteAt(t: number, length: number): number {
  return Math.floor((t / Math.max(1e-9, length)) * MINUTES) + 1;
}

export class MatchWorld {
  /** Whole steps run. */
  steps = 0;
  balls: [Ball, Ball];
  score: [number, number] = [0, 0];
  goals: Goal[] = [];
  /** The goal's middle round the ring, in radians, and which way it turns (1 or -1). */
  angle: number;
  spin: 1 | -1;
  /** Until when the match is stopped for a goal (CELEBRATE); -1 when it is not. */
  stopped = -1;
  /** The ball in the net while it is, else null. */
  scorer: 0 | 1 | null = null;
  /** Ninety minutes are up with the scores level: the next goal wins. */
  golden = false;
  winner: 0 | 1 | null = null;
  winTime = 0;
  /** Not a goal in golden goal before `timing.maxSeconds`: the home side is given it. A balanced match never gets there. */
  timedOut = false;
  /** The match's length in seconds: its ninety minutes. */
  readonly length: number;
  private readonly limit: number;
  private half = false;
  private events: MatchEvent[] = [];
  private readonly rng: Rng;

  constructor(cfg: Config) {
    this.length = Math.max(4, cfg.match.seconds);
    this.limit = Math.max(this.length + 1, cfg.timing.maxSeconds);
    const rng = (this.rng = createRng(`match:${cfg.seed}`));
    this.angle = rng.next() * 2 * Math.PI;
    this.spin = rng.next() < 0.5 ? 1 : -1;
    this.balls = [this.place(0), this.place(1)];
  }

  /** Seconds of match so far. */
  get time(): number {
    return this.steps * MATCH_STEP;
  }

  /** The clock's minute now. */
  get minute(): number {
    return minuteAt(this.time, this.length);
  }

  /** The way out of the pitch through the goal's middle. */
  get mouth(): { x: number; y: number } {
    return { x: dcos(this.angle), y: dsin(this.angle) };
  }

  drain(): MatchEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** A ball on its kick-off spot, heading anywhere but straight at the other. */
  private place(side: 0 | 1): Ball {
    // Within 0.6 rad of straight up or down, a little to the other's side or away from it: never at the other ball, never at the goal by design.
    const up = this.rng.next() < 0.5 ? -1 : 1;
    const a = up * (Math.PI / 2) + (this.rng.next() - 0.5) * 1.2;
    return { side, x: PITCH.x + (side === 0 ? -KICKOFF : KICKOFF), y: PITCH.y, ux: dcos(a), uy: dsin(a), r: BALL_R };
  }

  /**
   * One step. The whistle goes at ninety minutes whatever is happening, a goal's moment in the net
   * included: a winner in the last second is followed by the whistle, not by a kick-off. After it
   * the goal is shut and the balls fly on, bouncing, under the winner card; a match won while a
   * goal stopped it stays stopped.
   */
  step(): void {
    this.steps++;
    const t = this.time;
    if (!this.half && t >= this.length / 2) {
      // The sides change ends: the goal turns the other way for the second half.
      this.half = true;
      this.spin = this.spin === 1 ? -1 : 1;
      if (this.winner === null) this.events.push({ type: 'half' });
    }
    if (this.winner === null) {
      if (!this.golden && t >= this.length) {
        if (this.score[0] !== this.score[1]) this.win(this.score[0] > this.score[1] ? 0 : 1);
        else {
          this.golden = true;
          this.events.push({ type: 'golden' });
        }
      } else if (this.golden && t >= this.limit) {
        this.timedOut = true;
        this.win(0);
      }
    }
    if (this.stopped >= 0) {
      if (t < this.stopped || this.winner !== null) return;
      this.stopped = -1;
      this.scorer = null;
      this.balls = [this.place(0), this.place(1)];
      this.events.push({ type: 'kickoff', first: false });
    }
    if (this.steps === 1) this.events.push({ type: 'kickoff', first: true });
    this.angle += this.spin * SPIN * MATCH_STEP;
    if (this.angle > 2 * Math.PI) this.angle -= 2 * Math.PI;
    else if (this.angle < 0) this.angle += 2 * Math.PI;
    for (const b of this.balls) {
      b.x += b.ux * SPEED * MATCH_STEP;
      b.y += b.uy * SPEED * MATCH_STEP;
    }
    if (this.wall()) return;
    this.collide();
  }

  /**
   * Each ball against the ring: in the goal's mouth a goal (true, the match stopped), at a post a
   * bounce off the post, anywhere else a bounce off the ring, mirrored by the overshoot and turned a
   * little (SCATTER). Once the match is won the goal is shut: balls bounce off the ring alone.
   */
  private wall(): boolean {
    const g = this.mouth;
    for (const b of this.balls) {
      const dx = b.x - PITCH.x;
      const dy = b.y - PITCH.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const room = PITCH.r - b.r;
      if (d <= room) continue;
      const nx = dx / d;
      const ny = dy / d;
      const facing = nx * g.x + ny * g.y;
      if (this.winner === null && facing >= SCORE_COS) {
        this.score[b.side]++;
        const goal: Goal = { side: b.side, time: this.time, minute: this.minute, score: [this.score[0], this.score[1]] };
        this.goals.push(goal);
        this.events.push({ type: 'goal', side: b.side, x: PITCH.x + nx * PITCH.r, y: PITCH.y + ny * PITCH.r, nx, ny, goal });
        this.scorer = b.side;
        this.stopped = this.time + CELEBRATE;
        if (this.golden) this.win(b.side);
        return true;
      }
      const back = room - (d - room);
      b.x = PITCH.x + nx * back;
      b.y = PITCH.y + ny * back;
      if (this.winner === null && facing >= POST_COS) {
        // The post nearer the ball: the goal's middle turned by MOUTH toward the ball's side of it.
        const cross = g.x * ny - g.y * nx;
        const turn = cross >= 0 ? MOUTH : -MOUTH;
        const px = PITCH.x + PITCH.r * (g.x * dcos(turn) - g.y * dsin(turn));
        const py = PITCH.y + PITCH.r * (g.y * dcos(turn) + g.x * dsin(turn));
        const qx = b.x - px;
        const qy = b.y - py;
        const q = Math.sqrt(qx * qx + qy * qy) || 1;
        const mx = qx / q;
        const my = qy / q;
        const dot = b.ux * mx + b.uy * my;
        if (dot < 0) {
          b.ux -= 2 * dot * mx;
          b.uy -= 2 * dot * my;
        }
        this.inward(b, nx, ny);
        this.events.push({ type: 'post', side: b.side, x: px, y: py });
        continue;
      }
      const dot = b.ux * nx + b.uy * ny;
      if (dot <= 0) continue;
      b.ux -= 2 * dot * nx;
      b.uy -= 2 * dot * ny;
      this.scatter(b);
      this.inward(b, nx, ny);
      if (this.winner === null) this.events.push({ type: 'bounce', side: b.side, x: PITCH.x + nx * PITCH.r, y: PITCH.y + ny * PITCH.r });
    }
    return false;
  }

  /** Turns a ball's heading by up to SCATTER either way. */
  private scatter(b: Ball): void {
    this.turn(b, (this.rng.next() - 0.5) * 2 * SCATTER);
  }

  private turn(b: Ball, a: number): void {
    const cos = dcos(a);
    const sin = dsin(a);
    const ux = b.ux * cos - b.uy * sin;
    b.uy = b.uy * cos + b.ux * sin;
    b.ux = ux;
  }

  /** Never leaves a ball skimming the ring at nx, ny: at least GRAZE of its heading points in. */
  private inward(b: Ball, nx: number, ny: number): void {
    const into = -(b.ux * nx + b.uy * ny);
    if (into >= GRAZE) return;
    const along = -b.ux * ny + b.uy * nx;
    const side = Math.sqrt(1 - GRAZE * GRAZE) * (along < 0 ? -1 : 1);
    b.ux = -GRAZE * nx - side * ny;
    b.uy = -GRAZE * ny + side * nx;
  }

  /** The two balls meeting: they swap the part of their headings along the line between them, as equal masses do, each turned a little (CLASH), and keep the one speed. */
  private collide(): void {
    const [p, q] = this.balls;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const min = p.r + q.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const closing = (p.ux - q.ux) * nx + (p.uy - q.uy) * ny;
    if (closing > 0) {
      unit(p, p.ux - closing * nx, p.uy - closing * ny);
      unit(q, q.ux + closing * nx, q.uy + closing * ny);
      this.turn(p, (this.rng.next() - 0.5) * 2 * CLASH);
      this.turn(q, (this.rng.next() - 0.5) * 2 * CLASH);
      if (this.winner === null) this.events.push({ type: 'clash', x: p.x + nx * p.r, y: p.y + ny * p.r });
    }
    const push = (min - d) / 2;
    p.x -= nx * push;
    p.y -= ny * push;
    q.x += nx * push;
    q.y += ny * push;
  }

  private win(side: 0 | 1): void {
    this.winner = side;
    this.winTime = this.time;
    this.events.push({ type: 'whistle' }, { type: 'win', side });
  }
}

/** Sets a ball's heading to x, y made a unit vector; turned round when x, y is next to nothing. */
function unit(b: Ball, x: number, y: number): void {
  const length = Math.sqrt(x * x + y * y);
  if (length < 0.05) {
    b.ux = -b.ux;
    b.uy = -b.uy;
    return;
  }
  b.ux = x / length;
  b.uy = y / length;
}

/** How a match plays out, known before anything is drawn (as the race's `Outcome`). */
export interface MatchOutcome {
  seed: string;
  winner: 0 | 1 | null;
  winnerName: string;
  /** Seconds of match until the final whistle (or golden goal's goal). */
  time: number;
  timedOut: boolean;
  score: [number, number];
  goals: Goal[];
  /** Level at ninety minutes, won by the next goal. */
  golden: boolean;
  /**
   * Seconds the winner was behind, and the second it went ahead for good (the goal after which it
   * never again was not ahead): whether the match is a comeback, or won late (match-balance.ts).
   */
  trailed: number;
  decided: number;
}

export function predictMatch(cfg: Config): MatchOutcome {
  const world = new MatchWorld(cfg);
  // Steps are cheap: a 60 s match is 14,400 of them.
  while (world.winner === null) world.step();
  const winner = world.winner;
  let trailed = 0;
  let decided = 0;
  let before = 0;
  let lead = 0;
  for (const g of world.goals) {
    if (lead < 0) trailed += g.time - before;
    before = g.time;
    lead = winner === 0 ? g.score[0] - g.score[1] : g.score[1] - g.score[0];
    if (lead <= 0) decided = -1;
    else if (decided < 0 || decided === 0) decided = g.time;
  }
  if (lead < 0) trailed += world.winTime - before;
  const names = [cfg.match.home, cfg.match.away];
  return {
    seed: cfg.seed,
    winner,
    winnerName: sideName(names[winner]),
    time: world.winTime,
    timedOut: world.timedOut,
    score: [world.score[0], world.score[1]],
    goals: world.goals.map((g) => ({ ...g, score: [g.score[0], g.score[1]] as [number, number] })),
    golden: world.golden,
    trailed,
    decided: Math.max(0, decided),
  };
}
