import { DICE_REGIONS, flagName, sharedRegion } from '../battle/countries.ts';
import { loadFlags } from '../battle/flags.ts';
import { mergeConfig, PRESETS, switchGame, type Config } from '../config.ts';
import { H, W } from '../layout.ts';
import { END_PAD, SLOWMO, SLOWMO_LEAD, SLOWMO_TAIL } from '../pacing.ts';
import { BattleRenderer } from '../render/battle.ts';
import { randomBattle, searchBattle } from '../sim/battle-balance.ts';
import { BattleWorld, STRIDE, predictBattle, type BattleOutcome } from '../sim/battle.ts';

// The site's Arena Clashes: real battles, muted, in a phone, drawn by the studio's own simulation
// and renderer (nothing here changes what they produce), played the way a recorded video goes: the
// battle with its last outs in slow motion, the win slowed, the winner card, then the fade into the
// next battle's first frame. The race's phones are hero.ts; this is their match for the second game.
//
// A battle is balanced as the studio balances it (searchBattle), a seed at a time between frames,
// so a slow phone never stalls on it: the next one is balanced while the one on screen plays. Like
// the race's phones, it runs only while it is on screen, the tab is visible and the page lets it,
// and never under prefers-reduced-motion (the page does not start it then).

/**
 * The battles a phone plays, in turn: the four biggest countries first (the owner's pick, and the
 * site's still frame, public/games/arena-clash.webp, made from the same battle), then three or four
 * flags of one region each, so the title over them names it.
 */
const SHOWCASES: { flags: string[]; question?: string; seed?: string }[] = [
  { flags: ['cn', 'in', 'us', 'ru'], question: 'Which flag survives?', seed: '7' },
  { flags: ['rs', 'hr', 'si'] },
  { flags: ['br', 'ar', 'mx'] },
  { flags: ['se', 'no', 'dk'] },
];

/** Drawn at half the video's size, as the race's phones are (hero.ts SCALE): the phone shows it at most 250 px wide. */
const SCALE = 0.5;
/** The free plan's longest video, as the race's phones play (hero.ts HERO_SECONDS). */
const SECONDS = 30;
/** Milliseconds of balancing a frame may spend: half a 60 fps frame, so the battle on screen keeps its pace. */
const BUDGET = 8;

type Phase = 'race' | 'slowmo' | 'winner' | 'done';

/** A battle as the site plays it: silent, no follow button, the free plan's length. */
function battleConfig(flags: string[], seed: string, question = ''): Config {
  const base = switchGame(PRESETS[0].config, 'arena-clash');
  return mergeConfig(base, {
    seed,
    battle: { flags, winner: '' },
    sound: { track: 'silent' },
    timing: { video: SECONDS },
    look: { follow: false, question },
  });
}

/** Balanced a seed at a time, BUDGET ms a frame; null when no seed lands. */
async function balanceSoon(cfg: Config): Promise<Config | null> {
  const search = searchBattle(cfg);
  for (;;) {
    const until = performance.now() + BUDGET;
    let step = search.next();
    while (!step.done && performance.now() < until) step = search.next();
    if (step.done) return step.value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** "Serbia vs Croatia vs Slovenia"; with the region first when they share one. */
export function describeBattle(cfg: Config): string {
  const names = cfg.battle.flags.map(flagName).join(' vs ');
  const region = sharedRegion(cfg.battle.flags);
  return region ? `${region.label}: ${names}` : names;
}

export class ArenaDemo {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: BattleRenderer;
  /** The next battle's first frame, at full size: what the end of this one fades into. */
  private readonly still = new BattleRenderer(document.createElement('canvas'));
  private readonly onBattle: (cfg: Config) => void;
  private cfg: Config | null = null;
  private next: Config | null = null;
  /** The showcase the next battle comes from (SHOWCASES). */
  private showcase = 0;
  /** Bumped by a roll: a battle still being balanced for an older one is dropped. */
  private rolls = 0;
  private world!: BattleWorld;
  private outcome!: BattleOutcome;
  private phase: Phase = 'race';
  private phaseAge = 0;
  private winnerAge = 0;
  private acc = 0;
  private last = 0;
  private playing = false;
  private visible = false;
  /** The page's say: of the phones on screen, only the most visible ones play (home.ts). */
  private allowed = true;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(canvas: HTMLCanvasElement, onBattle: (cfg: Config) => void) {
    this.canvas = canvas;
    this.onBattle = onBattle;
    this.renderer = new BattleRenderer(canvas);
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    this.renderer.ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.update();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => this.update());
    this.reducedMotion.addEventListener('change', () => this.update());
    void this.prepare().then((cfg) => cfg && this.load(cfg));
  }

  /** Whether the page lets this phone play. */
  setActive(on: boolean): void {
    this.allowed = on;
    this.update();
  }

  /** New flags from the dice, three or four from one of its regions (or everywhere), balanced like the studio's. */
  roll(): void {
    const token = ++this.rolls;
    const seed = String(1 + Math.floor(Math.random() * 999_999));
    const region = DICE_REGIONS[Math.floor(Math.random() * DICE_REGIONS.length)].id;
    // A base with flags: a config's list takes only items of its default's type, and an empty one has none to go by.
    const flags = randomBattle(seed, battleConfig(SHOWCASES[0].flags, seed), 3 + Math.floor(Math.random() * 2), region).battle.flags;
    void this.ready(battleConfig(flags, seed)).then((cfg) => {
      if (cfg && token === this.rolls) this.load(cfg);
    });
  }

  /** The next showcase, balanced, its flags loaded. */
  private prepare(): Promise<Config | null> {
    const show = SHOWCASES[this.showcase++ % SHOWCASES.length];
    return this.ready(battleConfig(show.flags, show.seed ?? String(1 + Math.floor(Math.random() * 999_999)), show.question));
  }

  private async ready(cfg: Config): Promise<Config | null> {
    const [balanced] = await Promise.all([balanceSoon(cfg), loadFlags(cfg.battle.flags)]);
    return balanced;
  }

  private load(cfg: Config): void {
    this.cfg = cfg;
    this.next = null;
    this.world = new BattleWorld(cfg);
    this.outcome = predictBattle(cfg);
    this.renderer.reset(cfg);
    this.phase = 'race';
    this.phaseAge = 0;
    this.winnerAge = 0;
    this.acc = 0;
    this.draw(0);
    this.canvas.classList.add('live');
    this.onBattle(cfg);
    this.update();
    // The battle after this one, balanced while this one plays.
    const token = this.rolls;
    void this.prepare().then((next) => {
      if (!next || token !== this.rolls || this.cfg !== cfg) return;
      this.next = next;
      this.still.reset(next);
      this.still.draw(new BattleWorld(next), next, 0, { winner: 0, age: 0 });
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
      slow: this.phase === 'race' && this.slowed(),
      lead: (this.acc / this.world.nextStep) * STRIDE,
    });
  }

  /** The studio's phases for a battle (src/app.ts), without narration or recording. */
  private advance(dt: number): void {
    this.phaseAge += dt;
    this.winnerAge += dt;
    switch (this.phase) {
      case 'race':
        this.simulate(dt * (this.slowed() ? SLOWMO : 1));
        if (this.world.winner !== null) this.setPhase(this.world.timedOut ? 'winner' : 'slowmo');
        break;
      case 'slowmo':
        this.simulate(dt * SLOWMO);
        if (this.phaseAge >= SLOWMO_TAIL) this.setPhase('winner');
        break;
      case 'winner':
        this.simulate(dt * SLOWMO);
        // The card's hold, and longer while the next battle is still being balanced.
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

  /** The last SLOWMO_LEAD before the win, and the outs among the last flags (BattleOutcome.slow), as the studio slows them. */
  private slowed(): boolean {
    const o = this.outcome;
    const t = this.world.time;
    if (!o.timedOut && t > o.time - SLOWMO_LEAD) return true;
    return o.slow.some(([from, to]) => t >= from && t < to);
  }

  private simulate(simDt: number): void {
    this.acc += simDt;
    const world = this.world;
    let steps = 0;
    while (this.acc >= world.nextStep && steps < 900) {
      this.acc -= world.nextStep;
      world.step();
      steps++;
    }
    if (steps === 900) this.acc = 0;
    const events = world.drain();
    if (events.length) this.renderer.handle(events, world, this.cfg!);
  }
}
