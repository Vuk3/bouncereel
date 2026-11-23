import { mergeConfig, PRESETS, switchGame, type Config, type Mode } from '../config.ts';
import { sideColors } from '../football/kits.ts';
import { derby, groupLabel, side, sideName } from '../football/teams.ts';
import { H, W } from '../layout.ts';
import { END_PAD, SLOWMO, SLOWMO_TAIL } from '../pacing.ts';
import { MatchRenderer } from '../render/match.ts';
import { searchMatch } from '../sim/match-balance.ts';
import { MATCH_STEP, MatchWorld, predictMatch } from '../sim/match.ts';

// The site's Goal Rush: real matches, muted, in a phone, drawn by the studio's own simulation and
// renderer, played the way a recorded video goes: the match, the whistle, the winner card, then the
// fade into the next match's first frame. The race's phones are hero.ts, the Arena Clash's arena.ts;
// this is their match for the third game.
//
// The balls are the kits everyone's videos have, drawn from colours: the real crests and photos are
// the owner's alone (docs/goal-rush.md §3), and this file never asks for them.
//
// A match is balanced as the studio balances it (searchMatch), a seed at a time between frames, so
// a slow phone never stalls on it. Like the other phones, it runs only while it is on screen, the
// tab is visible and the page lets it, and never under prefers-reduced-motion.

/**
 * The matches a phone plays, in turn, and the only ones its dice deal: the rivalries everyone
 * knows, never two names from deep in the list (the owner's call: a visitor should see El Clásico,
 * not a squad player). El Clásico first: the site's still frame, public/games/goal-rush.webp, is
 * made from the same match (scripts/stills.ts).
 */
export const SHOWCASES: { mode: Mode; home: string; away: string; seed: string }[] = [
  { mode: 'clubs', home: 'real-madrid', away: 'barcelona', seed: '11' },
  { mode: 'clubs', home: 'crvena-zvezda', away: 'partizan', seed: '5' },
  { mode: 'players', home: 'messi', away: 'cristiano-ronaldo', seed: '3' },
  { mode: 'clubs', home: 'bayern', away: 'dortmund', seed: '4' },
  { mode: 'clubs', home: 'celtic', away: 'rangers', seed: '6' },
  { mode: 'clubs', home: 'man-city', away: 'man-united', seed: '8' },
  { mode: 'clubs', home: 'boca', away: 'river', seed: '2' },
  { mode: 'players', home: 'mbappe', away: 'haaland', seed: '7' },
  { mode: 'clubs', home: 'inter', away: 'milan', seed: '9' },
  { mode: 'clubs', home: 'liverpool', away: 'man-united', seed: '10' },
  { mode: 'players', home: 'pele', away: 'maradona', seed: '12' },
  { mode: 'clubs', home: 'arsenal', away: 'tottenham', seed: '13' },
  { mode: 'clubs', home: 'psg', away: 'marseille', seed: '14' },
];

/** Drawn at half the video's size, as the other phones are. */
const SCALE = 0.5;
/** The free plan's longest video, as the other phones play. */
const SECONDS = 30;
/** Milliseconds of balancing a frame may spend: half a 60 fps frame. */
const BUDGET = 8;

type Phase = 'race' | 'slowmo' | 'winner' | 'done';

/** A match as the site plays it: silent, no follow button, the free plan's length unless a step sets another, either side to win unless it sets one. */
export function matchConfig(mode: Mode, home: string, away: string, seed: string, winner = '', video = SECONDS): Config {
  const base = switchGame(PRESETS[0].config, 'goal-rush');
  return mergeConfig(base, {
    seed,
    match: { mode, home, away, winner },
    sound: { track: 'silent' },
    timing: { video },
    look: { follow: false, question: '' },
  });
}

/** Balanced a seed at a time, BUDGET ms a frame; null when no seed lands. */
async function balanceSoon(cfg: Config): Promise<Config | null> {
  const search = searchMatch(cfg);
  for (;;) {
    const until = performance.now() + BUDGET;
    let step = search.next();
    while (!step.done && performance.now() < until) step = search.next();
    if (step.done) return step.value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** "El Clásico: Real Madrid vs Barcelona", or the two names when they make no derby. */
export function describeMatch(cfg: Config): string {
  const names = `${sideName(cfg.match.home)} vs ${sideName(cfg.match.away)}`;
  const named = derby(cfg.match.home, cfg.match.away);
  return named ? `${named.charAt(0).toUpperCase()}${named.slice(1)}: ${names}` : names;
}

export class PitchDemo {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: MatchRenderer;
  /** The next match's first frame, at full size: what the end of this one fades into. */
  private readonly still = new MatchRenderer(document.createElement('canvas'));
  private readonly onMatch: (cfg: Config) => void;
  private cfg: Config | null = null;
  private next: Config | null = null;
  private showcase = 0;
  /** Set by show(): the match it was given plays on a loop. */
  private replay = false;
  /** Bumped by a roll: a match still being balanced for an older one is dropped. */
  private rolls = 0;
  private world!: MatchWorld;
  private phase: Phase = 'race';
  private phaseAge = 0;
  private winnerAge = 0;
  private acc = 0;
  private last = 0;
  private playing = false;
  private visible = false;
  private allowed = true;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /** `first`: the showcase it opens on, so phones side by side on a page each play their own. */
  constructor(canvas: HTMLCanvasElement, onMatch: (cfg: Config) => void, first = 0) {
    this.showcase = first;
    this.canvas = canvas;
    this.onMatch = onMatch;
    this.renderer = new MatchRenderer(canvas);
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    this.renderer.ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.update();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => this.update());
    this.reducedMotion.addEventListener('change', () => this.update());
    // A show() that came first wins: the opening showcase is dropped if one has taken its place.
    const token = this.rolls;
    void this.prepare().then((cfg) => cfg && token === this.rolls && this.load(cfg));
  }

  /** Whether the page lets this phone play. */
  setActive(on: boolean): void {
    this.allowed = on;
    this.update();
  }

  /** Another of the showcases from the dice, never the one playing, on a new seed: balanced like the studio's. */
  roll(): void {
    const token = ++this.rolls;
    const seed = String(1 + Math.floor(Math.random() * 999_999));
    const others = SHOWCASES.filter((s) => s.home !== this.cfg?.match.home || s.away !== this.cfg?.match.away);
    const show = others[Math.floor(Math.random() * others.length)];
    void balanceSoon(matchConfig(show.mode, show.home, show.away, seed)).then((cfg) => {
      if (cfg && token === this.rolls) this.load(cfg);
    });
  }

  /**
   * This match from now on, balanced as the studio balances it, played again and again rather than
   * moving on to the showcases (the home page's steps set it); resolves to it, or to null when no
   * seed lands or a newer one took its place.
   */
  async show(cfg: Config): Promise<Config | null> {
    const token = ++this.rolls;
    this.replay = true;
    const balanced = await balanceSoon(cfg);
    if (!balanced || token !== this.rolls) return null;
    this.load(balanced);
    return balanced;
  }

  private prepare(): Promise<Config | null> {
    if (this.replay && this.cfg) return Promise.resolve(this.cfg);
    const show = SHOWCASES[this.showcase++ % SHOWCASES.length];
    return balanceSoon(matchConfig(show.mode, show.home, show.away, show.seed));
  }

  private load(cfg: Config): void {
    this.cfg = cfg;
    this.next = null;
    this.world = new MatchWorld(cfg);
    this.renderer.reset(cfg);
    this.phase = 'race';
    this.phaseAge = 0;
    this.winnerAge = 0;
    this.acc = 0;
    this.draw(0);
    this.canvas.classList.add('live');
    this.onMatch(cfg);
    this.update();
    const token = this.rolls;
    void this.prepare().then((next) => {
      if (!next || token !== this.rolls || this.cfg !== cfg) return;
      this.next = next;
      this.still.reset(next);
      this.still.draw(new MatchWorld(next), next, 0, { winner: 0, age: 0 });
    });
  }

  private update(): void {
    const run = this.cfg !== null && this.visible && this.allowed && !document.hidden && !this.reducedMotion.matches;
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
    if (!this.cfg) return;
    const showing = this.phase === 'winner' || this.phase === 'done';
    this.renderer.draw(this.world, this.cfg, dt, {
      winner: showing ? Math.min(1, this.winnerAge / 0.35) : 0,
      age: showing ? this.winnerAge : 0,
      loop: this.phase === 'done' ? this.phaseAge / (END_PAD * 0.8) : 0,
      start: this.still.canvas,
      ahead: this.acc,
    });
  }

  /** The studio's phases for a match (src/app.ts), without narration or recording: no slow motion before the whistle. */
  private advance(dt: number): void {
    this.phaseAge += dt;
    this.winnerAge += dt;
    switch (this.phase) {
      case 'race':
        this.simulate(dt);
        if (this.world.winner !== null) this.setPhase(this.world.timedOut ? 'winner' : 'slowmo');
        break;
      case 'slowmo':
        this.simulate(dt * SLOWMO);
        if (this.phaseAge >= SLOWMO_TAIL) this.setPhase('winner');
        break;
      case 'winner':
        this.simulate(dt * SLOWMO);
        if (this.winnerAge >= this.cfg!.timing.hold && this.next) this.setPhase('done');
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
    if (phase === 'winner') {
      this.winnerAge = 0;
      this.renderer.celebrate(this.world, this.cfg!);
    }
  }

  private simulate(simDt: number): void {
    this.acc += simDt;
    const world = this.world;
    let steps = 0;
    while (this.acc >= MATCH_STEP && steps < 480) {
      this.acc -= MATCH_STEP;
      world.step();
      steps++;
    }
    if (steps === 480) this.acc = 0;
    const events = world.drain();
    if (events.length) this.renderer.handle(events, world, this.cfg!);
  }
}

/** The steps' words for a match: each side's name, colour and where it is from, and how it ends ("Real Madrid win 3–2"). */
export function matchFacts(cfg: Config): { sides: { name: string; color: string; from: string }[]; verdict: string; derby: string | null } {
  const sides = [side(cfg.match.home), side(cfg.match.away)] as const;
  const colors = sideColors(sides[0], sides[1]);
  const outcome = predictMatch(cfg);
  const named = derby(cfg.match.home, cfg.match.away);
  const w = outcome.winner ?? 0;
  return {
    sides: sides.map((s, i) => ({ name: s?.name ?? '', color: colors[i], from: s ? groupLabel(s) : '' })),
    verdict: `${outcome.winnerName} wins ${outcome.score[w]}–${outcome.score[w ? 0 : 1]}`,
    derby: named ? `${named.charAt(0).toUpperCase()}${named.slice(1)}` : null,
  };
}
