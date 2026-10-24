import { LOOK_LABELS, type Sound } from '../../shared/features.ts';
import { mergeConfig, PRESETS, type Config, type Skin } from '../config.ts';
import { H, W } from '../layout.ts';
import { END_PAD, SLOWMO, SLOWMO_LEAD, SLOWMO_TAIL, openingShown } from '../pacing.ts';
import { Renderer } from '../render/renderer.ts';
import { balance, randomMatchup } from '../sim/balance.ts';
import { SEQUENCES } from '../sim/sequences.ts';
import { STEP } from '../sim/types.ts';
import { createWorld, finishTimes, predict, type Outcome, type World } from '../sim/world.ts';

// The home page's races: real ones, muted, in phone frames, drawn by the studio's own simulation
// and renderer (nothing here changes what they produce). A phone plays the way a recorded video
// does (the hold, the race, slow motion into the win, the winner card, the fade into the first
// frame). The hero's then fades into the next built-in matchup, in the next look; the one beside
// How it works replays the matchup its steps have set.
//
// It never loads audio, let alone Kokoro: of src/audio only the opening's question reaches it, in
// the renderer's title over the first frame (src/audio/opening.ts, kept apart for this). A phone runs only
// while it is on screen, the tab is visible and the page lets it (one at a time, home.ts), and
// under prefers-reduced-motion it never moves: a roll draws the new matchup's first frame and
// stops there.

/** The free plan's longest video: the hero shows what a free account makes. */
export const HERO_SECONDS = 30;

/**
 * The canvas is drawn at half the video's size: the phone shows it at most 340 px wide, and a
 * quarter of the pixels is a quarter of the fill work on a phone's CPU. The renderer draws in
 * the video's own units under the scale, so the picture is the same, only smaller.
 */
const SCALE = 0.5;

type Phase = 'intro' | 'race' | 'slowmo' | 'winner' | 'done';

/**
 * The looks in the order the hero shows them, one race each. Night first: it is the one that
 * reads best on the dark stage, and the still frame in the page is its first frame.
 */
export const HERO_LOOKS: Skin[] = ['night', 'paper', 'cards'];

/** A matchup as the hero plays it: no narrator, no sound, the free plan's length, in `skin`, balanced again. */
export function heroConfig(config: Config, skin: Skin = HERO_LOOKS[0]): Config | null {
  return balance(
    mergeConfig(config, { sound: { track: 'silent' }, timing: { video: HERO_SECONDS, gap: 0 }, look: { skin } }),
  );
}

/**
 * The built-in matchups the hero plays, in order: the still frame in the page is the first
 * one's. Only those without powers: the hero shows the format itself, sequence against
 * sequence, and a power would need the opening to explain it.
 */
const CLASSICS = PRESETS.map((p) => p.config).filter((c) => [c.a, c.b].every((ball) => ball.special === 'none' || !ball.amount));

export class Hero {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  /** The next race's first frame, at full size: what the end of this one fades into. */
  private readonly still = new Renderer(document.createElement('canvas'));
  private readonly onMatchup: (cfg: Config) => void;
  /** Plays its matchup again and again (the steps' phone) instead of moving on to the next classic. */
  private readonly replay: boolean;
  private cfg: Config;
  private next: Config | null = null;
  private classic = 0;
  /** Races played: which look comes next (HERO_LOOKS). */
  private races = 0;
  private world!: World;
  private outcome!: Outcome;
  private phase: Phase = 'intro';
  private phaseAge = 0;
  private winnerAge = 0;
  private elapsed = 0;
  /** Seconds between the winner and the loser touching the line, for the card: worked out as it comes up. */
  private margin: number | undefined;
  /** `elapsed` when the race started, null in the hold: the opening title fades from there (openingShown). */
  private raceAt: number | null = null;
  private acc = 0;
  private last = 0;
  private playing = false;
  private visible = false;
  /** The page's say: of the phones on screen, only the most visible one plays (home.ts). */
  private allowed = true;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /** With `replay`, the phone plays that matchup until it is shown another; without, the hero's classics and rolls. */
  constructor(canvas: HTMLCanvasElement, onMatchup: (cfg: Config) => void, replay: Config | null = null) {
    this.canvas = canvas;
    this.onMatchup = onMatchup;
    this.replay = replay !== null;
    this.renderer = new Renderer(canvas);
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    this.renderer.ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    this.cfg = replay ?? heroConfig(CLASSICS[0]) ?? CLASSICS[0];
    this.load(this.cfg);

    // Only while it can be seen: off screen or in a hidden tab, nothing runs.
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.update();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => this.update());
    this.reducedMotion.addEventListener('change', () => this.update());
  }

  /** A matchup from the page's own controls, from its first frame (the steps' phone); how it will end, already worked out. */
  show(cfg: Config): Outcome {
    this.load(cfg);
    return this.outcome;
  }

  /** A look changes only the drawing: the race goes on, and the first frame its end fades into is drawn again. */
  setLook(skin: Skin): void {
    this.cfg = mergeConfig(this.cfg, { look: { skin } });
    if (this.next) {
      if (this.replay) this.next = this.cfg;
      this.drawNext();
    }
    if (!this.playing) this.draw(0);
  }

  /** Whether the page lets this phone play (only one engine runs at a time). */
  setActive(on: boolean): void {
    this.allowed = on;
    this.update();
  }

  /**
   * A new matchup from the dice, balanced like the studio's, never with a power. It is measured (a `hero roll` entry
   * in the Performance panel), since it runs on the main thread: see docs/website.md for what it
   * costs on a phone.
   */
  roll(): number {
    const t0 = performance.now();
    const cfg = this.pickNext(true);
    const ms = performance.now() - t0;
    performance.measure('hero roll', { start: t0, duration: ms });
    this.load(cfg);
    return ms;
  }

  private pickNext(dice: boolean): Config {
    this.races++;
    const skin = HERO_LOOKS[this.races % HERO_LOOKS.length];
    if (dice) {
      const base = mergeConfig(CLASSICS[0], { sound: { track: 'silent' }, timing: { video: HERO_SECONDS, gap: 0 }, look: { skin } });
      return randomMatchup(String(1 + Math.floor(Math.random() * 999_999)), base, false);
    }
    for (let i = 1; i <= CLASSICS.length; i++) {
      const cfg = heroConfig(CLASSICS[(this.classic + i) % CLASSICS.length], skin);
      if (cfg) {
        this.classic = (this.classic + i) % CLASSICS.length;
        return cfg;
      }
    }
    return this.cfg;
  }

  private load(cfg: Config): void {
    this.cfg = cfg;
    this.next = null;
    this.world = createWorld(cfg);
    this.outcome = predict(cfg);
    this.renderer.reset(cfg);
    this.phase = 'intro';
    this.phaseAge = 0;
    this.winnerAge = 0;
    this.elapsed = 0;
    this.margin = undefined;
    this.raceAt = null;
    this.acc = 0;
    this.draw(0);
    this.canvas.classList.add('live');
    this.onMatchup(cfg);
    this.update();
  }

  private update(): void {
    const run = this.visible && this.allowed && !document.hidden && !this.reducedMotion.matches;
    if (run === this.playing) return;
    this.playing = run;
    this.last = 0;
    if (run) requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    if (!this.playing) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.advance(dt);
    this.draw(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  private draw(dt: number): void {
    const showing = this.phase === 'winner' || this.phase === 'done';
    this.renderer.draw(this.world, this.cfg, dt, {
      winner: showing ? Math.min(1, this.winnerAge / 0.35) : 0,
      age: showing ? this.winnerAge : 0,
      loop: this.phase === 'done' ? this.phaseAge / (END_PAD * 0.8) : 0,
      start: this.still.canvas,
      opening: openingShown(this.raceAt === null ? null : this.elapsed - this.raceAt),
      leads: this.outcome.leads,
      margin: this.margin,
    });
  }

  /** The studio's phases (src/app.ts), without narration or recording. */
  private advance(dt: number): void {
    this.phaseAge += dt;
    this.winnerAge += dt;
    this.elapsed += dt;
    switch (this.phase) {
      case 'intro':
        if (this.phaseAge >= this.cfg.timing.startDelay) this.setPhase('race');
        break;
      case 'race': {
        const finish = this.outcome.timedOut ? null : this.outcome.time;
        this.simulate(dt * (finish !== null && this.world.time > finish - SLOWMO_LEAD ? SLOWMO : 1));
        if (this.world.winner !== null) this.setPhase(this.world.timedOut ? 'winner' : 'slowmo');
        break;
      }
      case 'slowmo':
        this.simulate(dt * SLOWMO);
        if (this.phaseAge >= SLOWMO_TAIL) this.setPhase('winner');
        break;
      case 'winner':
        this.simulate(dt * SLOWMO);
        if (this.winnerAge >= this.cfg.timing.hold && this.elapsed >= this.cfg.timing.video - END_PAD) this.setPhase('done');
        break;
      case 'done':
        this.simulate(dt * SLOWMO);
        if (this.phaseAge > END_PAD && this.next) this.load(this.next);
        break;
    }
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseAge = 0;
    if (phase === 'race') this.raceAt = this.elapsed;
    if (phase === 'winner') {
      this.winnerAge = 0;
      this.renderer.celebrate(this.world);
      // As the studio measures it (app.ts measureMargin), only now: a roll or a new classic need not pay for it.
      if (!this.outcome.timedOut) {
        const finish = finishTimes(this.cfg, this.outcome.time + 30);
        this.margin = Math.abs(finish[0] - finish[1]);
      }
      // While the card is up: the race that follows (this one again, on a phone that replays) and its first frame for the fade.
      this.next = this.replay ? this.cfg : this.pickNext(false);
      this.drawNext();
    }
  }

  private drawNext(): void {
    if (!this.next) return;
    this.still.reset(this.next);
    this.still.draw(createWorld(this.next), this.next, 0, { winner: 0, age: 0, opening: 1 });
  }

  private simulate(simDt: number): void {
    this.acc += simDt;
    let steps = 0;
    while (this.acc >= STEP && steps < 240) {
      this.world.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 240) this.acc = 0;
    const events = this.world.drain();
    if (events.length) this.renderer.handle(events, this.world, this.cfg);
  }
}

/** "Night look, Fibonacci against Factorial": under the phone, with the names above it. */
export function describeRace(cfg: Config): string {
  return `${LOOK_LABELS[cfg.look.skin]} look, ${SEQUENCES[cfg.a.sequence].label} against ${SEQUENCES[cfg.b.sequence].label}`;
}

// ── How it works: the steps' own matchup ─────────────────────────────────

/** What the steps on the home page set, apart from the matchup itself. */
export interface Settings {
  video: number;
  gap: number;
  skin: Skin;
  track: Sound;
}

function settingsPatch(s: Settings): object {
  return { sound: { track: s.track }, timing: { video: s.video, gap: s.gap }, look: { skin: s.skin } };
}

/** The steps' first matchup: the hero's first classic, balanced to the steps' settings. */
export function firstMatchup(s: Settings): Config {
  const cfg = mergeConfig(CLASSICS[0], settingsPatch(s));
  return balance(cfg) ?? cfg;
}

/** The same matchup in another look: only the drawing changes, so nothing is balanced again. */
export function withLook(cfg: Config, skin: Skin): Config {
  return mergeConfig(cfg, { look: { skin } });
}

/** The studio's dice, balanced to the steps' settings, never with a power (as the hero rolls). */
export function rollMatchup(s: Settings): Config {
  return randomMatchup(String(1 + Math.floor(Math.random() * 999_999)), mergeConfig(CLASSICS[0], settingsPatch(s)), false);
}

/**
 * The same matchup balanced to new settings: its own race on the first attempt, a new race of it
 * (new angles from a new seed) on the next ones, since a seed's angles can decide whether the
 * finish lands; null when this attempt does not fit. One attempt is one balance, so the page
 * can spread its attempts over frames.
 */
export function refit(cfg: Config, s: Settings, attempt: number): Config | null {
  const next = mergeConfig(cfg, settingsPatch(s));
  if (attempt) next.seed = String(1 + Math.floor(Math.random() * 999_999));
  return balance(next);
}

/** What the page shows of a matchup: each ball as the studio's matchup card names it, and how it ends. */
export interface Facts {
  balls: { name: string; color: string; terms: string }[];
  /** Empty when nobody finishes. */
  winner: string;
  /** Which ball wins, 0 the top one, 1 the bottom; -1 when nobody finishes. */
  first: number;
  /** Seconds between the winner and the loser touching the line, as the studio measures it (app.ts measureMargin). */
  margin: number;
  /** Seconds of race to the win, on the race's own clock (slow motion stretches the last of it in the video). */
  race: number;
  /** How far the loser had got when the winner touched the line, 0..1. */
  runnerUp: number;
  video: number;
}

/** `outcome`, when the phone has just worked it out (Hero.show), saves running the race once more. */
export function factsOf(cfg: Config, outcome: Outcome = predict(cfg)): Facts {
  const finish = finishTimes(cfg, outcome.time + 30);
  return {
    balls: [cfg.a, cfg.b].map((ball) => ({ name: ball.name, color: ball.color, terms: SEQUENCES[ball.sequence].hint })),
    winner: outcome.timedOut ? '' : outcome.winnerName,
    first: outcome.timedOut || outcome.winner === null ? -1 : outcome.winner,
    margin: Math.abs(finish[0] - finish[1]),
    race: outcome.time,
    runnerUp: outcome.runnerUp,
    video: cfg.timing.video,
  };
}

const firstFrames = new WeakMap<HTMLCanvasElement, Renderer>();

/** A matchup's first frame, the one its video opens on and loops back to, at a quarter of the video's size. */
export function drawFirstFrame(canvas: HTMLCanvasElement, cfg: Config): void {
  let renderer = firstFrames.get(canvas);
  if (!renderer) {
    renderer = new Renderer(canvas);
    canvas.width = W / 4;
    canvas.height = H / 4;
    renderer.ctx.setTransform(0.25, 0, 0, 0.25, 0, 0);
    firstFrames.set(canvas, renderer);
  }
  renderer.reset(cfg);
  renderer.draw(createWorld(cfg), cfg, 0, { winner: 0, age: 0, opening: 1 });
  canvas.classList.add('live');
}
