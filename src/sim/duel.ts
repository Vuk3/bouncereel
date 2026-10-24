import type { Config, Contestant } from '../config.ts';
import { BOX, PANELS, STACK, finishTop, type Panel } from '../layout.ts';
import { dcos, dsin } from './detmath.ts';
import { createRng } from './rng.ts';
import { SEQUENCES, parseLayers } from './sequences.ts';
import type { Body, SimEvent } from './types.ts';

// Two teams, each in its own box, top and bottom. A ball flies in a straight
// line and bounces off the walls and ceiling for nothing; only a hit on the
// floor counts. The floor is the top layer, and each floor hit takes the next
// term of the team's sequence off it: Fibonacci 1, 1, 2, 3, 5…, factorial
// 1, 2, 6, 24… Damage left over when a layer breaks is lost. When a layer
// breaks, the box grows down to the next one; with every layer gone the floor
// is the finish line, and the first ball to touch it wins for its team.
//
// A special can change the hitting ball on every floor hit: faster, slower,
// bigger, or a new ball split off it. A splitting team shares one sequence,
// so more balls means more hits, not bigger ones.
//
// The box is convex and every ball is put back inside it each step, so no
// speed can carry a ball through a wall. Sub-steps only keep the moment of
// each hit precise.
//
// The race is over at the win: every ball of both teams stops where it is, so the loser
// does not race on under the winner card. Only measuring finish times runs on (`runOn`).

export interface Layer {
  hp: bigint;
  max: bigint;
}

export interface Team {
  id: number;
  name: string;
  color: string;
  rule: Contestant;
  panel: Panel;
  bodies: Body[];
  layers: Layer[];
  /** Layers broken so far; the next floor hit lands on layers[broken]. */
  broken: number;
  /** Floor hits so far, by any of the team's balls. */
  hits: number;
  /** What the next floor hit takes off: term(hits). */
  damage: bigint;
  finished: boolean;
}

/** More than this many balls in a box is a blur, and the hit rate stops meaning much. */
export const MAX_BALLS = 64;
const MIN_SPEED = 40;

export class DuelWorld {
  time = 0;
  /** Id of the winning team, null while the race is on. */
  winner: number | null = null;
  winTime = 0;
  timedOut = false;
  teams: Team[];
  private finishers = 0;
  private events: SimEvent[] = [];
  private readonly cfg: Config;
  /** Keep the other team racing after the win (finishTimes in world.ts). */
  private readonly runOn: boolean;
  /** The race has a winner and nothing moves any more (unless `runOn`). */
  private over = false;

  constructor(cfg: Config, runOn = false) {
    this.cfg = cfg;
    this.runOn = runOn;
    const rng = createRng(cfg.seed);
    const health = parseLayers(cfg.layers);

    this.teams = [cfg.a, cfg.b].map((rule, id) => {
      const panel = PANELS[id];
      const r = Math.min(rule.radius, this.maxRadius(panel));
      // 30–60° off horizontal, any diagonal: flatter takes forever to reach
      // the floor, steeper looks like it is only bouncing up and down.
      const angle = rng.range(0.52, 1.05);
      const sx = rng.next() < 0.5 ? -1 : 1;
      const sy = rng.next() < 0.5 ? -1 : 1;
      const speed = Math.min(cfg.physics.maxSpeed, rule.speed);
      const body: Body = {
        x: rng.range(BOX.left + r, BOX.right - r),
        y: rng.range(panel.top + r, panel.floor - r),
        vx: sx * dcos(angle) * speed,
        vy: sy * dsin(angle) * speed,
        r,
      };
      return {
        id,
        name: rule.name,
        color: rule.color,
        rule,
        panel,
        bodies: [body],
        layers: health.map((hp) => ({ hp, max: hp })),
        broken: 0,
        hits: 0,
        damage: SEQUENCES[rule.sequence].term(0),
        finished: false,
      };
    });
  }

  /** A grown ball stays a ball in a box: at most a third of the starting box height across. */
  private maxRadius(panel: Panel): number {
    return (panel.floor - panel.top) / 3;
  }

  /** Where balls bounce off the bottom right now: the top of the first standing layer, or the finish line. */
  floorY(t: Team): number {
    if (t.broken >= t.layers.length) return finishTop(t.panel);
    return t.panel.floor + (t.broken * STACK) / t.layers.length;
  }

  /**
   * 0..1: layers broken plus how worn the current one is, scaled to 0.95; a
   * team through every layer is at 0.95 (racing to the line), finished is 1.
   * So a loser at 0.95 when the winner finishes was a photo finish.
   */
  progress(t: Team): number {
    if (t.finished) return 1;
    if (!t.layers.length) return 0.95;
    let partial = 0;
    const layer = t.layers[t.broken];
    // Through BigInt so huge layers still divide exactly (and identically everywhere).
    if (layer) partial = Number(((layer.max - layer.hp) * 10000n) / layer.max) / 10000;
    return (0.95 * (t.broken + partial)) / t.layers.length;
  }

  drain(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  step(dt: number): void {
    let fastest = 0;
    let smallest = Infinity;
    for (const t of this.teams) {
      for (const b of t.bodies) {
        fastest = Math.max(fastest, Math.sqrt(b.vx * b.vx + b.vy * b.vy));
        smallest = Math.min(smallest, b.r);
      }
    }
    const n = Math.min(32, Math.max(1, Math.ceil((fastest * dt) / (0.5 * smallest))));
    for (let i = 0; i < n; i++) this.substep(dt / n);
    if (this.winner === null && this.time >= this.cfg.timing.maxSeconds) this.timeOut();
  }

  private substep(h: number): void {
    this.time += h;
    if (this.over) return;
    const g = this.cfg.physics.gravity;
    for (const t of this.teams) {
      if (t.finished) continue;
      // Indexed: a split appends to the array mid-loop, and the newborn waits a step.
      const count = t.bodies.length;
      for (let i = 0; i < count && !t.finished; i++) {
        const b = t.bodies[i];
        b.vy += g * h;
        b.x += b.vx * h;
        b.y += b.vy * h;
        // A ball that went past a wall during the step is mirrored back by the
        // same distance, as if it had bounced at the exact moment: no time is
        // lost per bounce, so a ball k times faster runs the same path k times
        // sooner. Balancing depends on that (see balance.ts). The clamp after
        // is only for absurd speeds that overshoot a whole box.
        const left = BOX.left + b.r;
        const right = BOX.right - b.r;
        const top = t.panel.top + b.r;
        const floor = this.floorY(t);
        const bottom = floor - b.r;
        if (b.x < left) {
          b.x = Math.min(right, 2 * left - b.x);
          b.vx = Math.abs(b.vx);
          this.events.push({ type: 'wall', team: t.id, x: BOX.left, y: b.y });
        } else if (b.x > right) {
          b.x = Math.max(left, 2 * right - b.x);
          b.vx = -Math.abs(b.vx);
          this.events.push({ type: 'wall', team: t.id, x: BOX.right, y: b.y });
        }
        if (b.y < top) {
          b.y = Math.min(bottom, 2 * top - b.y);
          b.vy = Math.abs(b.vy);
          this.events.push({ type: 'wall', team: t.id, x: b.x, y: t.panel.top });
        } else if (b.y > bottom) {
          b.y = Math.max(top, 2 * bottom - b.y);
          b.vy = -Math.abs(b.vy);
          this.floorHit(t, b, floor);
        }
      }
    }
  }

  private floorHit(t: Team, b: Body, y: number): void {
    if (t.broken >= t.layers.length) {
      this.finish(t, b, y);
      return;
    }
    const index = t.broken;
    const layer = t.layers[index];
    const damage = t.damage;
    layer.hp -= damage;
    const broken = layer.hp <= 0n;
    if (broken) {
      layer.hp = 0n;
      t.broken++;
    }
    this.events.push({ type: 'hit', team: t.id, x: b.x, y, damage, layer: index, broken, last: broken && t.broken === t.layers.length });
    t.hits++;
    t.damage = SEQUENCES[t.rule.sequence].term(t.hits);
    this.special(t, b);
  }

  private special(t: Team, b: Body): void {
    const { special, amount } = t.rule;
    if (!amount) return;
    if (special === 'faster' || special === 'slower') {
      const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      const factor = 1 + ((special === 'faster' ? 1 : -1) * amount) / 100;
      const next = Math.max(MIN_SPEED, Math.min(this.cfg.physics.maxSpeed, s * factor));
      b.vx *= next / s;
      b.vy *= next / s;
    } else if (special === 'grow') {
      b.r = Math.min(this.maxRadius(t.panel), b.r + amount);
      // Growing against the floor would push it into the layer; it rests on top.
      b.y = Math.min(b.y, this.floorY(t) - b.r);
    } else if (special === 'split') {
      for (let k = 0; k < Math.round(amount) && t.bodies.length < MAX_BALLS; k++) {
        // Turn each newborn a different amount (19–37°) so no two balls ever
        // share a path and visually merge into one. It leaves upward, as its parent does.
        const turn = 0.33 + 0.08 * (t.bodies.length % 5);
        const sign = t.bodies.length % 2 ? 1 : -1;
        const c = dcos(turn * sign);
        const s = dsin(turn * sign);
        const vx = b.vx * c - b.vy * s;
        const vy = b.vx * s + b.vy * c;
        t.bodies.push({ x: b.x, y: b.y, vx, vy: -Math.abs(vy), r: b.r });
      }
    }
  }

  /** The first ball of a team to touch the line finishes it; the whole team stops there. */
  private finish(t: Team, b: Body, y: number): void {
    t.finished = true;
    for (const other of t.bodies) {
      other.vx = 0;
      other.vy = 0;
    }
    b.y = y - b.r;
    const place = ++this.finishers;
    this.events.push({ type: 'finish', team: t.id, x: b.x, y, place });
    if (this.winner === null) {
      this.winner = t.id;
      this.winTime = this.time;
      this.end();
    }
  }

  /** The win: everything stops in place, the loser's balls too (unless `runOn`). */
  private end(): void {
    if (this.runOn) return;
    this.over = true;
    for (const team of this.teams) {
      for (const b of team.bodies) {
        b.vx = 0;
        b.vy = 0;
      }
    }
  }

  /** Out of time: whoever is further along wins; a dead heat goes to the top box. */
  private timeOut(): void {
    const [a, b] = this.teams;
    const leader = this.progress(b) > this.progress(a) ? b : a;
    this.winner = leader.id;
    this.winTime = this.time;
    this.timedOut = true;
    this.events.push({ type: 'timeout', team: leader.id });
    this.end();
  }
}
