import type { AccountResponse, DayResponse, NewVideo, PublicPlan, VideoResponse } from '../shared/api.ts';
import { gameAllowed, LOOK_LABELS, soundAllowed, SOUND_LABELS, type Features, type Game, type Sound } from '../shared/features.ts';
import { api, ApiError } from './api.ts';
import { AudioEngine } from './audio/engine.ts';
import { Music } from './audio/music.ts';
import { VOICES, VoiceCache, introLine, outroLine, plannedLines, previewLine, voiceOf } from './audio/narration.ts';
import { Sonifier } from './audio/sonify.ts';
import { COUNTRIES, DICE_REGIONS, flagName, type DiceRegion } from './battle/countries.ts';
import { flagSrc, lineColors, loadFlags } from './battle/flags.ts';
import { DEFAULT_CONFIG, PRESETS, SKINS, asksToFollow, mergeConfig, savedConfig, switchGame, type Battle, type Config, type Contestant, type Skin, type Special } from './config.ts';
import { addToLibrary, APP_VERSION, postPrompt, retryPending, type Saved } from './library.ts';
import { download, describeType, pickType, Recorder } from './record/recorder.ts';
import { BattleRenderer, battleFollowAt, type BattleOverlay } from './render/battle.ts';
import type { Overlay } from './render/draw.ts';
import { Renderer, followAt, type RaceOverlay } from './render/renderer.ts';
import { AFTER_OUTRO, END_PAD, SLOWMO, SLOWMO_LEAD, SLOWMO_TAIL, cardHold, narrated, openingShown, spokenSeconds, videoSeconds } from './pacing.ts';
import { BattleWorld, MAX_FLAGS, MIN_FLAGS, STRIDE, predictBattle, type BattleOutcome } from './sim/battle.ts';
import { balanceBattle, randomBattle, searchBattle, slowExtra } from './sim/battle-balance.ts';
import { KEEP_ALL, balance, balanceProblem, diceName, keptWhole, plainName, randomMatchup, relayer, sizeFor, type Keep } from './sim/balance.ts';
import { SEQUENCES, formatBig } from './sim/sequences.ts';
import { STEP } from './sim/types.ts';
import { createWorld, finishTimes, predict, type Outcome, type World } from './sim/world.ts';
import type { Field } from './ui/fields.ts';
import { Panel } from './ui/panel.ts';
import { bindAccountChrome, dayLine, nextVideoAt, paidTag, planChips, planHoldsBack, planInvite, upgradeLink } from './ui/plan.ts';
import { bindThemeToggle } from './ui/theme.ts';

// The page: one run at a time, driven by requestAnimationFrame. A run is a ball race or a Flag
// Battle (`cfg.game`): each has its world, prediction and renderer, and everything around them
// (phases, narration, recording, the library, the plan) is the same for both.
//
//   intro ─▶ race ─▶ slowmo ─▶ winner ─▶ done
//
// The simulation advances in fixed steps whatever the frame rate (the race's STEP of time, the
// battle's of distance, `BattleWorld.nextStep` seconds each); a phase only changes how much simulated
// time a frame gets (slow motion is fewer steps per frame, never a different step), so slowing
// down cannot change the outcome.
// The same determinism lets the page know the whole run in advance: when the
// deciding moment comes (for slow motion) and both lines the narrator will say
// (so a recording can generate them before it starts).

type Phase = 'intro' | 'race' | 'slowmo' | 'winner' | 'done';

/** Per account (`bouncereel:config:v1:<id>`), so two accounts on one computer never share a matchup. */
const STORAGE_KEY = 'bouncereel:config:v1';
const DICE_KEY = 'bouncereel:dice';
/** Per account (`bouncereel:hints:v1:<id>`): the first visit's hint was seen and acted on (showHint). */
const HINTS_KEY = 'bouncereel:hints:v1';
/** The part of the frame a look's thumbnail shows: the top name, its box and the VS, where the looks differ most. */
const THUMB = { x: 60, y: 168, w: 960, h: 832 };

/** A power as the matchup card names it. */
/** The lock's icon, open or closed by its checkbox (style.css): beside each ball in the matchup card, and under its Balls and Hit strength. */
const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path class="open" d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2" /><path class="closed" d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></svg>';

const POWER_WORDS: Record<Special, (amount: number) => string> = {
  none: () => '',
  faster: (n) => `Speeds up ${n} %`,
  slower: (n) => `Slows down ${n} %`,
  grow: (n) => `Grows ${n} px`,
  split: (n) => (n > 1 ? `Splits in ${n + 1}` : 'Splits'),
};

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'simulation'
  );
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

/** `timing.gap` as the panel shows it. */
function gapLabel(gap: number): string {
  return gap > 0 ? `${gap} s` : 'photo finish';
}

/** Runs every frame, so only touch the DOM when the text actually changes. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** The same for a two-state button's `data-state`, which picks its icon (style.css). */
function setState(el: HTMLElement, state: string): void {
  if (el.dataset.state !== state) el.dataset.state = state;
}

export class App {
  private readonly account: AccountResponse;
  /** What the account's plan includes; anything else stays visible but disabled (applyPlan). */
  private readonly features: Features;
  private cfg: Config;
  private world: World | BattleWorld;
  private outcome: Outcome | BattleOutcome;
  private readonly canvas = $<HTMLCanvasElement>('#canvas');
  private readonly renderer: Renderer;
  /** Draws an Arena Clash, on the same canvas: one game at a time has it. */
  private readonly arena: BattleRenderer;
  /** Draws first frames off screen: the look thumbnails, and the frame a looping video fades into. */
  private readonly still = new Renderer(document.createElement('canvas'));
  /** The same for an Arena Clash, on the same canvas, so `still.canvas` is the first frame either way. */
  private readonly stillArena = new BattleRenderer(this.still.canvas);
  /** Where the dice picks flags from: the dice's own setting, kept with `powers` (loadDice). */
  private region: DiceRegion = 'world';
  /**
   * An Arena Clash being balanced between frames (searchBattle), and its number: an edit made
   * meanwhile starts a new one and the old one stops. The battle card shows `pending` until it is done.
   */
  private searchJob = 0;
  private pending: Config | null = null;
  private readonly panel: Panel;
  /**
   * Whether the dice may give a ball a power. The dice's own setting, kept apart from the config
   * (see loadDice). Off until someone turns it on: sequence against sequence is the format.
   */
  private powers = false;
  /**
   * What the dice keeps of each ball: the ball (the lock beside it in the matchup card), how many
   * it is and how hard it hits (the locks under its Balls and Hit strength). Off on every visit.
   */
  private locks: Record<'a' | 'b', Keep> = { a: { ball: false, count: false, strength: false }, b: { ball: false, count: false, strength: false } };
  /** Each ball as it was before its last change: whether its name was one the dice gave is a question about that ball. */
  private before: Record<'a' | 'b', Contestant> | null = null;
  private balanceTimer = 0;
  private audio: AudioEngine | null = null;
  private sonifier: Sonifier | null = null;
  private recorder: Recorder | null = null;

  private phase: Phase = 'intro';
  private phaseAge = 0;
  /** Seconds the winner card has been up; runs on through 'done' so the card does not animate in twice. */
  private winnerAge = 0;
  /** Real seconds of playback since the run started: the video's own clock. */
  private elapsed = 0;
  /** `elapsed` when the race started, null in the hold: the opening title fades from there (openingShown). */
  private raceAt: number | null = null;
  /** Seconds between the winner and the loser touching the line. */
  private margin = 0;
  /** When in the race or the battle the follow button pops up (planFollow), from the prediction; null for no room. */
  private followTime: number | null = null;
  private acc = 0;
  private paused = true;
  private starting = false;
  /**
   * From the press of Record until its recorder exists: the preview marks are already off, so the
   * canvas the recorder starts from never has them (record, drawFrame).
   */
  private takePending = false;
  /**
   * The "Play with the narrator" switch: off, Play and Restart run with every sound but the
   * narrator, so nothing is generated and the race starts at once. Record ignores it.
   */
  private voiceOn = true;
  /** This run has no narrator: set when a run starts, from the switch (or by Record), and kept while it plays. */
  private voiceless = false;
  /** The next note of Hear the music (hearMusic). */
  private musicTimer = 0;
  private introPlayed = false;
  /** The winner line is due but waits for the narrator to finish the line in progress. */
  private outroPending = false;
  /** When the winner line ends, in seconds of the winner card. */
  private outroEnds = 0;
  private last = 0;

  private voices = new VoiceCache();
  private voiceStatus = '';

  /** The predicted race no longer ends as asked (showPrediction): Record is not the one action then. */
  private uneven = false;
  /** The plans the pricing page lists (GET /api/plans), to say what the paid ones add; null when they did not load. */
  private readonly plans: PublicPlan[] | null;
  /** This account had no saved config: a first visit, which gets the one hint (showHint). */
  private fresh = false;
  /** When the tab was hidden during a take (performance.now()), 0 otherwise: the file has a pause there. */
  private hiddenAt = 0;
  /** The wall clock and the audio clock as the take began (startTake), to see the sound stall (watchSound). */
  private soundFrom = { wall: 0, audio: 0 };
  /** Seconds of sound this take has lost, and how far into the take it first stalled; 0 when it has lost none. */
  private soundLost = 0;
  private soundLostAt = 0;

  /** The timeline under the preview (buildTimeline): its playhead and clock, written by syncTimeline. */
  private readonly head = $('#timeline-head');
  private readonly clock = $('#timeline-time');
  /** Where the timeline ends, in seconds: the video's length, or later when the race runs past it. */
  private timelineEnd = 1;
  /** When this run's end is due (`done` plus END_PAD): the timeline's clock stops there. */
  private endsAt = Infinity;
  /** The playhead's last `translate`, so a frame writes it only when it has moved. */
  private headX = '';

  private restartTimer = 0;
  private stillsTimer = 0;
  /** Gives Record back when the plan's day ends with the page open (syncDay). */
  private dayTimer = 0;

  constructor(account: AccountResponse, plans: PublicPlan[] | null) {
    this.account = account;
    this.features = account.features;
    $('#preview-note').hidden = !this.features.watermark;
    this.plans = plans;
    this.cfg = this.fitPlan(this.load());
    this.before = { a: structuredClone(this.cfg.a), b: structuredClone(this.cfg.b) };
    ({ powers: this.powers, region: this.region } = this.loadDice());
    this.world = this.createWorld();
    this.outcome = this.predictRun();
    this.margin = this.measureMargin();
    this.followTime = this.planFollow();
    this.renderer = new Renderer(this.canvas);
    this.arena = new BattleRenderer(this.canvas);
    this.renderer.reset(this.cfg);
    this.arena.reset(this.cfg);
    this.panel = new Panel($('#sections'), () => this.cfg, (field) => this.changed(field));
    this.panel.body('files').append($('#files'));
    this.buildPresetBlock();
    this.buildBattleBlock();
    this.buildLookBlock();
    this.buildSoundBlock();
    this.buildFollowSwitch();
    this.buildMusicBlock();
    this.buildVoiceBlock();
    this.applyPlan();
    this.buildPlanCard();
    this.bindToolbar();
    this.syncDay();
    bindThemeToggle($('#theme'));
    bindAccountChrome(account);
    try {
      // The narrator is Kokoro alone, which needs no key: API keys kept here for other voices are not kept on.
      localStorage.removeItem('bouncereel:keys');
    } catch {
      // Storage unavailable: there is nothing kept to remove.
    }
    const type = pickType();
    $('#format').textContent = describeType(type);
    // Only Chrome and Edge write the MP4 the apps take as it is (docs/recording-and-export.md): say so before a recording, not after.
    if (!type?.startsWith('video/mp4')) {
      const warning = $('#format-warning');
      warning.textContent = type
        ? 'This browser records WebM, not MP4: TikTok and Instagram want it converted first. Chrome or Edge on a computer record the MP4 they take as it is.'
        : 'This browser cannot record video. Open the studio in Chrome or Edge on a computer.';
      warning.hidden = false;
    }
    this.syncSafeZones();
    this.syncMatchup();
    this.showPrediction();
    this.buildTimeline();
    this.showHint();
    this.drawStills();
    // A canvas never asks for a web font by itself; until this resolves it
    // draws in the fallback, which a recording started later never sees. The
    // thumbnails drawn before it are drawn again in Rubik.
    void Promise.all([600, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px Rubik`))).then(() => this.drawStills());
    if (this.cfg.game === 'arena-clash') this.loadBattleFlags();
    requestAnimationFrame((t) => this.frame(t));
    void this.openFromLibrary();
    void retryPending(account).then((added) => {
      if (added) this.flash(`${added} earlier recording${added === 1 ? '' : 's'} added to Videos`);
    });
  }

  // ── Loop ─────────────────────────────────────────────────────────────────

  private frame(now: number): void {
    // A long frame is clamped so the race does not leap; while recording it may run to 0.5 s, or the
    // encoder's first stalls (150–200 ms, measured) would be time lost and the file run long.
    const dt = this.last ? Math.min(this.recorder ? 0.5 : 0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.paused) {
      if (this.phase === 'intro' && !this.introPlayed) this.playIntro();
      this.advance(dt);
      this.sayOutroWhenFree();
    }
    this.drawFrame(this.paused ? 0 : dt);
    this.updateStatus();
    this.syncTimeline();
    this.syncRecBar();
    this.watchSound();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** One frame on the canvas: the preview, or the take Record captures from it. */
  private drawFrame(dt: number): void {
    const showing = this.phase === 'winner' || this.phase === 'done';
    const overlay: Overlay = {
      winner: showing ? Math.min(1, this.winnerAge / 0.35) : 0,
      age: showing ? this.winnerAge : 0,
      // The end of a looping video: the first frame fades in over most of END_PAD and holds for
      // the last few frames, so the file's last frame is the first one and the loop has no seam.
      loop: this.phase === 'done' && this.cfg.look.loop ? this.phaseAge / (END_PAD * 0.8) : 0,
      start: this.still.canvas,
      // On a plan with the watermark, the preview and the file both carry it; the preview alone
      // has the marks across it too (#preview-note says so), gone from the press of Record on.
      watermark: this.features.watermark,
      preview: this.features.watermark && !this.recorder && !this.takePending,
      follow: asksToFollow(this.cfg) ? { at: this.followTime } : undefined,
    };
    if (this.world instanceof BattleWorld) {
      const battle: BattleOverlay = { ...overlay, slow: this.phase === 'race' && this.slowed(), lead: (this.acc / this.world.nextStep) * STRIDE };
      this.arena.draw(this.world, this.cfg, dt, battle);
      return;
    }
    const race: RaceOverlay = {
      ...overlay,
      opening: openingShown(this.raceAt === null ? null : this.elapsed - this.raceAt),
      leads: 'leads' in this.outcome ? this.outcome.leads : [],
      margin: this.margin,
    };
    this.renderer.draw(this.world, this.cfg, dt, race);
  }

  private advance(dt: number): void {
    this.phaseAge += dt;
    this.winnerAge += dt;
    this.elapsed += dt;
    switch (this.phase) {
      case 'intro':
        if (this.phaseAge >= this.cfg.timing.startDelay) this.setPhase('race');
        break;
      case 'race': {
        // The prediction says when the deciding moment comes: slow down just before it.
        this.simulate(dt * (this.slowed() ? SLOWMO : 1));
        if (this.world.winner !== null) this.setPhase(this.world.timedOut ? 'winner' : 'slowmo');
        break;
      }
      case 'slowmo':
        this.simulate(dt * SLOWMO);
        if (this.phaseAge >= SLOWMO_TAIL) this.setPhase('winner');
        break;
      case 'winner': {
        this.simulate(dt * SLOWMO);
        // The card stays its hold and a beat past the winner line, and no longer: it does not wait
        // for the video's length, since a card held silent after the race is called is where
        // viewers scroll away.
        if (!this.outroPending && this.winnerAge >= Math.max(1.5, cardHold(this.cfg), this.outroEnds + AFTER_OUTRO)) this.setPhase('done');
        break;
      }
      case 'done':
        this.simulate(dt * SLOWMO);
        // The fade into the first frame (or a held moment), so the recording does not end on a cut.
        if (this.recorder && this.phaseAge > END_PAD) void this.finishRecording(false);
        break;
    }
  }

  /**
   * Whether the run is at a moment the prediction marked for slow motion: the last SLOWMO_LEAD
   * before the win, and in a battle the outs among its last flags (BattleOutcome.slow).
   */
  private slowed(): boolean {
    const o = this.outcome;
    const t = this.world.time;
    if (!o.timedOut && t > o.time - SLOWMO_LEAD) return true;
    return 'slow' in o && o.slow.some(([from, to]) => t >= from && t < to);
  }

  private simulate(simDt: number): void {
    this.acc += simDt;
    const world = this.world;
    if (world instanceof BattleWorld) {
      // A battle's step is a px of travel: about six a frame, and up to two seconds' worth after a stall.
      let steps = 0;
      while (this.acc >= world.nextStep && steps < 900) {
        this.acc -= world.nextStep;
        world.step();
        steps++;
      }
      if (steps === 900) this.acc = 0;
      const events = world.drain();
      if (events.length) this.arena.handle(events, world, this.cfg);
      if (this.cfg.sound.track !== 'silent') this.sonifier?.battle(events, this.cfg);
      return;
    }
    let steps = 0;
    while (this.acc >= STEP && steps < 240) {
      world.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    // Hopelessly behind (the tab was in the background): drop it rather than spiral.
    if (steps === 240) this.acc = 0;
    const events = world.drain();
    if (events.length) this.renderer.handle(events, world, this.cfg);
    // Every frame, events or not: a lead change can come between hits.
    if (this.cfg.sound.track !== 'silent') this.sonifier?.play(events, this.cfg, world);
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseAge = 0;
    if (phase === 'intro') this.raceAt = null;
    if (phase === 'race') this.raceAt = this.elapsed;
    if (phase === 'done') this.endsAt = this.elapsed + END_PAD;
    if (phase === 'winner') {
      this.winnerAge = 0;
      if (this.world instanceof BattleWorld) this.arena.celebrate(this.world, this.cfg);
      else this.renderer.celebrate(this.world);
      this.outroPending = this.narrating();
      // A narrated video played without the narrator holds the card as long as the line would
      // take, so the preview ends where the video will.
      this.outroEnds = this.outroPending ? 0 : this.lineSeconds();
    }
  }

  private restart(): void {
    window.clearTimeout(this.restartTimer);
    this.world = this.createWorld();
    this.outcome = this.predictRun();
    this.margin = this.measureMargin();
    this.followTime = this.planFollow();
    this.renderer.reset(this.cfg);
    this.arena.reset(this.cfg);
    this.sonifier?.reset(this.cfg, 'leads' in this.outcome ? this.outcome.leads : []);
    this.acc = 0;
    this.elapsed = 0;
    this.endsAt = Infinity;
    this.outroPending = false;
    this.outroEnds = 0;
    this.introPlayed = false;
    this.audio?.silence();
    this.setPhase('intro');
    this.showPrediction();
    this.buildTimeline();
    this.drawStills();
  }

  /**
   * The run's phases at their real lengths, from the prediction and pacing.ts: the hold, the race
   * up to the slow-down, slow motion into and out of the win, the winner card for its hold or a
   * beat past the winner line (lineSeconds), whichever is longer, at least 1.5 s (advance), and the
   * last END_PAD (the fade into the first frame, or a held end). A timed-out race has no slow
   * motion. The run ends where its line does, a few tenths either side of the video's length; a
   * race that ends late pushes it past, which the clock shows.
   */
  private buildTimeline(): void {
    const t = this.cfg.timing;
    const o = this.outcome;
    // A battle's outs in slow motion are part of the battle: only the win's own is the slow motion here.
    const race = (o.timedOut ? o.time : Math.max(0, o.time - SLOWMO_LEAD)) + ('slow' in o ? slowExtra(o) : 0);
    const slow = o.timedOut ? 0 : SLOWMO_LEAD / SLOWMO + SLOWMO_TAIL;
    const card = t.startDelay + race + slow;
    const shown = Math.max(1.5, cardHold(this.cfg), this.lineSeconds() + AFTER_OUTRO);
    this.timelineEnd = card + shown + END_PAD;
    const phases: [string, string, number][] = [
      ['hold', 'Hold', t.startDelay],
      ['race', this.cfg.game === 'arena-clash' ? 'Battle' : 'Race', race],
      ['slow', 'Slow motion', slow],
      ['card', 'Winner', shown],
      ['end', this.cfg.look.loop ? 'Loop' : 'End', END_PAD],
    ];
    const segments = phases
      .filter(([, , seconds]) => seconds > 0)
      .map(([kind, label, seconds]) => {
        const segment = document.createElement('span');
        segment.className = `phase phase-${kind}`;
        segment.style.flexGrow = String(seconds);
        segment.title = `${label}: ${seconds.toFixed(1)} s`;
        segment.append(Object.assign(document.createElement('b'), { textContent: label }));
        return segment;
      });
    $('#timeline-track').replaceChildren(...segments, this.head);
    this.headX = '';
    this.syncTimeline();
  }

  /**
   * The playhead and the clock under the preview, every frame: a `translate` (no layout) and a
   * text that changes ten times a second, each written only when it changes. The clock stops at
   * the run's end, and turns warn-coloured if that end came after the video's length.
   */
  private syncTimeline(): void {
    const shown = Math.min(this.elapsed, this.endsAt);
    // The lit layer's own width is the track's: -100% is nothing played yet, 0 all of it (style.css).
    const x = `${(Math.min(100, (shown / this.timelineEnd) * 100) - 100).toFixed(2)}% 0`;
    if (x !== this.headX) {
      this.headX = x;
      this.head.style.translate = x;
    }
    const video = this.cfg.timing.video;
    setText(this.clock, `${shown.toFixed(1)} / ${video.toFixed(1)} s`);
    this.clock.classList.toggle('over', shown > video + 0.05);
  }

  /** This config's world: the race's two boxes, or the battle's arena. */
  private createWorld(cfg = this.cfg): World | BattleWorld {
    return cfg.game === 'arena-clash' ? new BattleWorld(cfg) : createWorld(cfg);
  }

  private predictRun(): Outcome | BattleOutcome {
    return this.cfg.game === 'arena-clash' ? predictBattle(this.cfg) : predict(this.cfg);
  }

  /** When in the race or the battle the follow button pops up (followAt, battleFollowAt); null for no room. */
  private planFollow(): number | null {
    return 'leads' in this.outcome ? followAt(this.outcome.time, this.outcome.leads) : battleFollowAt(this.outcome);
  }

  /** Seconds between the winner and the loser touching the line, for the predicted race; a battle has no line. */
  private measureMargin(): number {
    if (this.cfg.game === 'arena-clash') return 0;
    const finish = finishTimes(this.cfg, this.outcome.time + 30);
    return Math.abs(finish[0] - finish[1]);
  }

  // ── Starting, recording ──────────────────────────────────────────────────

  /** Audio needs a click before it may start; everything that makes sound goes through here first. */
  private async unlock(): Promise<AudioEngine> {
    if (!this.audio) {
      this.audio = new AudioEngine();
      this.audio.volume = this.cfg.sound.volume;
      this.sonifier = new Sonifier(this.audio, this.cfg, 'leads' in this.outcome ? this.outcome.leads : []);
    }
    await this.audio.resume();
    return this.audio;
  }

  /**
   * Starts (or resumes) playback, generating any narration it needs first. A run
   * started without `voiced` has every sound but the narrator and generates nothing;
   * resuming keeps the mode the run was started in. A run from the start holds its
   * first frame until all of that is ready, and until `ready` says yes when given:
   * Record asks the server for the day's video there, so not a frame plays before
   * the answer.
   */
  private async play(fromStart: boolean, voiced = this.voiceOn, ready?: () => Promise<boolean>): Promise<boolean> {
    if (this.starting) return false;
    this.starting = true;
    $('#start').hidden = true;
    // Every Play and Record comes through here: the first one is what the hint asked for.
    this.hintDone();
    try {
      // A run still on its first frame (after a restart, or the page's first Play) is starting too.
      if (fromStart || this.elapsed === 0) this.voiceless = !voiced;
      if (fromStart) this.paused = true;
      await this.unlock();
      if (fromStart) this.restart();
      // A battle starts with every flag drawn: a recording must never open on a blank ball.
      if (this.cfg.game === 'arena-clash') await loadFlags(this.cfg.battle.flags);
      if (this.narrating()) await this.prepareVoice();
      if (ready && !(await ready())) return false;
      this.paused = false;
      return true;
    } finally {
      this.starting = false;
    }
  }

  private async record(): Promise<void> {
    if (this.recorder) {
      await this.finishRecording(true);
      return;
    }
    if (this.starting) return;
    if (this.pending) {
      this.flash('The battle is still being balanced: Record once it says who wins.');
      return;
    }
    const day = this.account.day;
    if (day.limit !== null && day.used >= day.limit) {
      this.flash(`Your plan makes ${day.limit} video${day.limit === 1 ? '' : 's'} a day: the next one is ${nextVideoAt(this.dayEnds())}. Play stays free until then.`, true);
      return;
    }
    const problem = this.planProblem();
    if (problem) {
      this.flash(problem, true);
      return;
    }
    // Said before a video of the day is taken, not after.
    if (!pickType(this.cfg.sound.track !== 'silent')) {
      this.flash('This browser cannot record video. Open the studio in Chrome or Edge on a computer.');
      return;
    }
    const { count, limit } = this.account.library;
    if (limit !== null && count >= limit) {
      this.flash(`Your library is full (${count} of ${limit}): this recording downloads, but is not added to Videos. Delete one there to make room.`, true);
    }
    // The day's last video is asked about first: it cannot be had back until tomorrow.
    if (day.limit !== null && day.limit - day.used === 1 && !(await this.confirmRecord(day.limit))) return;
    // The server takes the video once the narration is ready and the sound flows, before the
    // first frame (soundFlowing, takeVideo). The narrator switch is Play's: Record follows Sound alone.
    // The preview marks go now and the canvas is drawn without them at once: the recorder captures
    // the canvas from whatever it holds, and the take must not open on a marked frame.
    this.takePending = true;
    this.drawFrame(0);
    try {
      if (!(await this.play(true, true, async () => (await this.soundFlowing()) && this.takeVideo()))) return;
      // Silent: a file with no sound track at all (docs/recording-and-export.md says why).
      this.recorder = new Recorder(this.canvas, this.cfg.sound.track === 'silent' ? null : this.audio!.stream);
    } catch (err) {
      this.flash(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      this.takePending = false;
    }
    this.startTake();
  }

  /**
   * The page while a take runs: the panel off, Record as Stop & save, and over the preview the bar
   * with what is left and the two things that spoil a take, said from the first frame.
   */
  private startTake(): void {
    this.hiddenAt = 0;
    this.soundFrom = { wall: performance.now(), audio: this.audio?.ctx.currentTime ?? 0 };
    this.soundLost = 0;
    document.body.classList.add('recording');
    $<HTMLFieldSetElement>('#controls').disabled = true;
    $('#rec-note').textContent = 'Keep this tab in front, and do not connect or switch headphones: either spoils the take.';
    $('#rec-actions').hidden = true;
    $('#rec-bar').hidden = false;
    // Taking the day's last video turned Record off (syncDay); while recording it is Stop & save.
    this.syncDay();
  }

  /** Every end of a take: the page out of recording, Record back (or off until tomorrow). */
  private endTake(): void {
    this.recorder = null;
    this.hiddenAt = 0;
    document.body.classList.remove('recording');
    $<HTMLFieldSetElement>('#controls').disabled = false;
    $('#rec-bar').hidden = true;
    this.syncDay();
  }

  /**
   * A first visit (the account has no saved config) gets one hint by the preview, "Play to watch
   * this race, Record to make the MP4", until the first Play or Record; remembered per account, so
   * it shows once (`bouncereel:hints:v1:<id>`, forgotten with the config on signing out).
   */
  private showHint(): void {
    if (!this.fresh) return;
    try {
      if (localStorage.getItem(`${HINTS_KEY}:${this.account.account.id}`)) return;
    } catch {
      // Storage unavailable: the hint shows, and goes at the first Play as ever.
    }
    $('#first-hint').hidden = false;
  }

  /** The first Play or Record: the hint has done its work. */
  private hintDone(): void {
    const hint = $('#first-hint');
    if (hint.hidden) return;
    hint.hidden = true;
    try {
      localStorage.setItem(`${HINTS_KEY}:${this.account.account.id}`, 'seen');
    } catch {
      // Storage unavailable: it would show again on the next first visit, nothing worse.
    }
  }

  /** "Recording, 17.6 s left", every frame of a take; written when the tenth changes. */
  private syncRecBar(): void {
    if (!this.recorder) return;
    setText($('#rec-left'), `Recording, ${Math.max(0, this.cfg.timing.video - this.elapsed).toFixed(1)} s left`);
  }

  /**
   * The tab came back after being hidden during a take: nothing was drawn meanwhile, so the file
   * has a pause in it. Say how long, and offer Stop & save, or the take again when the day has a
   * video left for it; doing nothing keeps recording.
   */
  private takeInterrupted(seconds: number): void {
    const day = this.account.day;
    $('#rec-note').textContent = `This tab was hidden for ${seconds.toFixed(1)} s: the file has a pause there.`;
    $('#rec-again').hidden = day.limit !== null && day.used >= day.limit;
    $('#rec-actions').hidden = false;
  }

  /**
   * The sound stalling during a take, said as it happens. The picture runs on the wall clock and
   * the sound on the audio device's: when the device changes (AirPods connected mid-take, measured:
   * 1.9 s) the audio clock stops while the picture goes on, the recorder closes the gap, and every
   * sound after it plays that much early, the fanfare before the ball reaches the line. So each
   * frame compares the two clocks since the take began; the audio clock moves in steps of its
   * device's buffer (tens of ms), so only 0.15 s behind counts, and the note follows the loss
   * in 0.05 s steps while it grows. A silent take has no sound to lose.
   */
  private watchSound(): void {
    if (!this.recorder || !this.audio || this.cfg.sound.track === 'silent') return;
    const take = (performance.now() - this.soundFrom.wall) / 1000;
    const lost = take - (this.audio.ctx.currentTime - this.soundFrom.audio);
    if (lost < 0.15 || lost < this.soundLost + 0.05) return;
    if (!this.soundLost) this.soundLostAt = take - lost;
    this.soundLost = lost;
    const day = this.account.day;
    $('#rec-note').textContent = `${this.soundWarning()}.`;
    $('#rec-again').hidden = day.limit !== null && day.used >= day.limit;
    $('#rec-actions').hidden = false;
  }

  /** What a stalled sound did to the take, for the bar while recording and the sheet after it. */
  private soundWarning(): string {
    return `The sound stopped for ${this.soundLost.toFixed(1)} s, ${Math.round(this.soundLostAt)} s in: from there on it plays ahead of the picture`;
  }

  /** Drops the take in progress (no file, nothing saved) and starts Record again. */
  private async recordAgain(): Promise<void> {
    const rec = this.recorder;
    if (!rec) return;
    this.endTake();
    await rec.stop();
    void this.record();
  }

  /** Downloads the file and adds the video to the library; `stoppedEarly` when Stop & save ended it. */
  private async finishRecording(stoppedEarly: boolean): Promise<void> {
    const rec = this.recorder;
    if (!rec) return;
    this.endTake();
    const seconds = (performance.now() - rec.startedAt) / 1000;
    const blob = await rec.stop();
    const name = `${slug(this.title())}-seed-${slug(this.cfg.seed)}.${rec.extension}`;
    download(blob, name);
    const entry = this.libraryEntry(name, rec.type, seconds, stoppedEarly);
    const saved = await addToLibrary(entry, this.account.account.id);
    if (saved.added) this.account.library.count++;
    // What the video is about, to write its posts from: a superadmin's tool (docs/video-library.md §6).
    const admin = this.account.account.role === 'superadmin';
    $('.finished-prompt').hidden = !admin;
    if (admin) {
      const about = $('#finished-prompt');
      about.textContent = postPrompt({ ...entry, id: saved.id }, this.cfg);
      about.scrollTop = 0;
    }
    this.showFinished(name, seconds, blob.size, stoppedEarly, saved);
  }

  /**
   * The sheet after a take (#finished), once the file has downloaded and the library answered: the
   * file, what the library did with it, and the way on (the Videos page, the next roll, the studio).
   */
  private showFinished(name: string, seconds: number, bytes: number, stoppedEarly: boolean, saved: Saved): void {
    $('#finished-title').textContent = stoppedEarly ? 'Saved where you stopped' : 'Your video is ready';
    $('#finished-name').textContent = name;
    const length = stoppedEarly ? `${seconds.toFixed(1)} s of ${this.cfg.timing.video} s` : `${seconds.toFixed(1)} s`;
    $('#finished-facts').textContent = `${length}, ${(bytes / 1e6).toFixed(1)} MB, in your browser's downloads`;
    // A take may run unwatched to the end: the stall the bar said is said again here.
    const warning = $('#finished-warning');
    warning.hidden = !this.soundLost;
    if (this.soundLost) warning.textContent = `${this.soundWarning()}. Record it again for a clean take.`;
    $('#finished-library').replaceChildren(saved.message, ...(saved.upgrade ? [' ', upgradeLink()] : []));
    $<HTMLDialogElement>('#finished').showModal();
  }

  /**
   * Record against the plan's daily allowance: what is left of the day beside the button, and once
   * it is used, the button off until the next day starts, saying when. The count is the server's,
   * taken as each recording starts (takeVideo); this only shows it.
   */
  private syncDay(): void {
    const day = this.account.day;
    const used = day.limit !== null && day.used >= day.limit;
    const record = $<HTMLButtonElement>('#record');
    record.disabled = used && !this.recorder;
    record.title =
      day.limit === null
        ? 'Records this exact race as an MP4'
        : used
          ? `Today's video${day.limit === 1 ? ' is' : 's are'} made: the next one is ${nextVideoAt(this.dayEnds())}. Play stays free.`
          : `Records this exact race as an MP4, using ${day.limit === 1 ? 'your video for today' : `one of your ${day.limit} videos today`}`;
    const hint = $('#allowance');
    hint.hidden = day.limit === null;
    hint.classList.toggle('used', used);
    hint.replaceChildren(dayLine(day) ?? '', ...(used ? ['. ', upgradeLink()] : []));
    window.clearTimeout(this.dayTimer);
    if (day.endsAt) {
      this.dayTimer = window.setTimeout(
        () => {
          this.account.day = { ...day, used: 0, endsAt: null };
          this.syncDay();
        },
        Math.max(0, Date.parse(day.endsAt) - Date.now()) + 1000,
      );
    }
    this.syncPrimary();
  }

  /** When today ends for the plan's day: midnight UTC, as the server counts days (worker/plans.ts utcDay). */
  private dayEnds(): string {
    const now = new Date();
    return this.account.day.endsAt ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  }

  /**
   * Takes one of today's videos on the server as a recording starts (POST /api/account/day), so the
   * count is the server's before the first frame: a second tab, or a page left open since
   * yesterday's count, gets a no and says why. Without a daily limit there is nothing to hold a
   * recording back, and one starts even if the count cannot be sent.
   */
  private async takeVideo(): Promise<boolean> {
    const day = this.account.day;
    try {
      this.account.day = (await api<DayResponse>('POST', '/api/account/day')).day;
      this.syncDay();
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'day_used') {
        this.account.day = { used: day.limit ?? day.used, limit: day.limit, endsAt: this.dayEnds() };
        this.syncDay();
        this.flash(`${err.message}. Play stays free; the next video is ${nextVideoAt(this.dayEnds())}.`, true);
        return false;
      }
      if (day.limit === null) return true;
      this.flash(`The recording could not start: ${err instanceof Error ? err.message : String(err)}. Try again.`);
      return false;
    }
  }

  /**
   * For a file with sound, whether the audio clock moves (AudioEngine.flowing): a recorder started
   * before it does writes a file that begins late. Said when it does not, before a video is taken.
   */
  private async soundFlowing(): Promise<boolean> {
    if (this.cfg.sound.track === 'silent') return true;
    if (await this.audio!.flowing()) return true;
    this.flash('The sound did not start, so the video would begin late: check this computer’s sound output, then Record again.');
    return false;
  }

  /** Asks before the day's last video is recorded; true to record. */
  private confirmRecord(limit: number): Promise<boolean> {
    const dialog = $<HTMLDialogElement>('#record-confirm');
    $('#record-confirm-text').textContent =
      `This uses your ${limit === 1 ? '' : 'last '}video for today: your plan makes ${limit} a day, and the next one is ${nextVideoAt(this.dayEnds())}. ` +
      'You get exactly the race in the preview, as an MP4.';
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'record'), { once: true }));
  }

  /** The card at the top of the panel: what the account's plan makes, a few words each (planChips). */
  private buildPlanCard(): void {
    if (!planHoldsBack(this.features)) return;
    $('#plan-card-title').textContent = `Your plan: ${this.account.plan.name}`;
    $('#plan-chips').replaceChildren(
      ...planChips(this.features)
        // What the plan makes first, then what it leaves out.
        .sort((a, b) => Number(b.included) - Number(a.included))
        .map((chip) => Object.assign(document.createElement('li'), { className: chip.included ? '' : 'no', textContent: chip.text })),
    );
    $('#plan-card').hidden = false;
  }

  /** "Fibonacci Ball vs Doubling Ball", "Serbia vs Croatia vs Slovenia": the video's title and file name. */
  private title(): string {
    return this.cfg.game === 'arena-clash' ? this.cfg.battle.flags.map(flagName).join(' vs ') : `${this.cfg.a.name} vs ${this.cfg.b.name}`;
  }

  /** What the library keeps of this run: the config replays it; the rest is for sorting and grouping. */
  private libraryEntry(fileName: string, type: string, seconds: number, stoppedEarly: boolean): NewVideo {
    const common = {
      recordedAt: new Date().toISOString(),
      title: this.title(),
      fileName,
      format: describeType(type),
      seconds: Math.round(seconds * 100) / 100,
      stoppedEarly,
      videoLength: this.cfg.timing.video,
      seed: this.cfg.seed,
      appVersion: APP_VERSION,
      // A copy: the panel edits the live config in place, and a save that has to wait is sent later.
      config: structuredClone(this.cfg) as unknown as Record<string, unknown>,
    };
    const o = this.outcome;
    if ('outs' in o) {
      const flags = this.cfg.battle.flags;
      return {
        ...common,
        game: 'arena-clash',
        battle: { flags: [...flags], winner: o.winner === null ? null : flags[o.winner], out: o.outs.map((out) => flags[out.flag]) },
      };
    }
    const { a, b } = this.cfg;
    const winner = o.winner;
    return {
      game: 'ball-race',
      recordedAt: common.recordedAt,
      title: common.title,
      fileName,
      format: describeType(type),
      seconds: Math.round(seconds * 100) / 100,
      stoppedEarly,
      videoLength: this.cfg.timing.video,
      seed: this.cfg.seed,
      appVersion: APP_VERSION,
      // A copy: the panel edits the live config in place, and a save that has to wait is sent later.
      config: structuredClone(this.cfg) as unknown as Record<string, unknown>,
      race: {
        a: { name: a.name, sequence: a.sequence, special: a.special },
        b: { name: b.name, sequence: b.sequence, special: b.special },
        winner: winner === 0 ? 'a' : winner === 1 ? 'b' : null,
        margin: Number.isFinite(this.margin) ? Math.round(this.margin * 1000) / 1000 : null,
        leadChanges: o.leadChanges,
      },
    };
  }

  /** /?video=<id>, from the Videos page: that video's config exactly as it was recorded, not balanced again. */
  private async openFromLibrary(): Promise<void> {
    const id = new URLSearchParams(location.search).get('video');
    if (!id) return;
    history.replaceState(null, '', location.pathname);
    try {
      const { video } = await api<VideoResponse>('GET', `/api/videos/${encodeURIComponent(id)}`);
      this.setConfig(savedConfig(video.config));
      this.flash(`Loaded “${video.title}” from Videos`);
    } catch (err) {
      this.flash(`Could not load video ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Narration ────────────────────────────────────────────────────────────

  /**
   * Generates both lines this run will say, unless they are already cached; again while any is
   * missing, since a change made while they generate (a new matchup, another length) starts the
   * run over with lines of its own (startOver), which it needs before its first frame too.
   */
  private async prepareVoice(): Promise<void> {
    const audio = this.audio;
    if (!audio) return;
    const missing = () => (this.narrating() ? this.voices.missing(voiceOf(this.cfg), plannedLines(this.cfg, this.outcome)) : []);
    if (!missing().length) return;
    try {
      while (missing().length) await this.voices.prepare(audio.ctx, voiceOf(this.cfg), plannedLines(this.cfg, this.outcome), (s) => this.setVoiceStatus(s));
      this.setVoiceStatus('Voice ready');
      // The timeline's winner card was the guess at the line; it is the line's own clip now.
      this.buildTimeline();
    } catch (err) {
      this.setVoiceStatus('');
      this.flash(`Voice failed: ${err instanceof Error ? err.message : String(err)}. Playing without it.`);
    }
  }

  /** Speaks a generated line; returns how long it lasts. */
  private say(text: string): number {
    if (!this.narrating() || !text) return 0;
    const clip = this.audio && this.voices.get(voiceOf(this.cfg), text);
    return clip ? this.audio!.speak(clip) : 0;
  }

  private busy(): boolean {
    return this.audio?.speaking ?? false;
  }

  /** Says `text` in `voice` now, generating it first (and loading the model, the first time). */
  private async hear(voice: string, text: string): Promise<void> {
    const audio = await this.unlock();
    try {
      await this.voices.prepare(audio.ctx, voice, [text], (s) => this.setVoiceStatus(s));
      this.setVoiceStatus('');
      const clip = this.voices.get(voice, text);
      if (clip) audio.speak(clip);
    } catch (err) {
      this.setVoiceStatus('');
      this.flash(`Voice failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private playIntro(): void {
    this.introPlayed = true;
    this.say(introLine(this.cfg));
  }

  /**
   * Whether this run has a narrator: not started with the narrator switch off, the sound set to
   * Narrator and music, and the plan including it.
   */
  private narrating(): boolean {
    return !this.voiceless && narrated(this.cfg) && this.features.narrator;
  }

  /** The winner line, as soon as the narrator is free: it never talks over (or cuts) the line before it. */
  private sayOutroWhenFree(): void {
    if (!this.outroPending || this.busy()) return;
    this.outroPending = false;
    this.outroEnds = this.winnerAge + this.say(outroLine(this.cfg, this.outcome.winnerName, this.world.winTime));
  }

  /**
   * How long the predicted winner's line takes: its clip once generated, else pacing.ts's guess,
   * which a run without the narrator keeps too; 0 when the video has no narrator or no line.
   */
  private lineSeconds(): number {
    const o = this.outcome;
    const text = narrated(this.cfg) && o.winner !== null ? outroLine(this.cfg, o.winnerName, o.time) : '';
    if (!text) return 0;
    const clip = this.narrating() ? this.voices.get(voiceOf(this.cfg), text) : undefined;
    return clip?.duration ?? spokenSeconds(text);
  }

  private setVoiceStatus(text: string): void {
    this.voiceStatus = text;
    const el = document.querySelector<HTMLElement>('#voice-status');
    if (el) {
      el.textContent = text;
      el.hidden = !text;
    }
  }

  // ── Config ───────────────────────────────────────────────────────────────

  private changed(field: Field): void {
    // Whatever the note said was about the matchup before this change.
    $('#balance-note').hidden = true;
    this.save();
    this.syncMatchup();
    if (field.path === 'sound.volume' && this.audio) this.audio.volume = this.cfg.sound.volume;
    // A ball changed in what it is: its name and size follow, and the race is balanced again.
    const ball = /^([ab])\.(sequence|count|strength|special|amount)$/.exec(field.path);
    if (ball) this.reshape(ball[1] as 'a' | 'b', ball[2]);
    this.before = { a: structuredClone(this.cfg.a), b: structuredClone(this.cfg.b) };
    if (ball) this.syncMatchup();
    if (field.path === 'look.safeZones') this.syncSafeZones();
    if (field.live) {
      // A look change shows in the running video at once, and so does the opening's question in its
      // title (a typed opening's own); the first frames follow once typing stops.
      if (field.path.startsWith('look.') || field.path === 'voice.script') {
        window.clearTimeout(this.stillsTimer);
        this.stillsTimer = window.setTimeout(() => this.drawStills(), 150);
      }
      // The hold before the start and the loop's end are live too: the timeline follows.
      if (field.path.startsWith('timing.') || field.path === 'look.loop') this.buildTimeline();
      return;
    }
    // Dragging a slider fires dozens of changes: restart once it settles. A ball changed in what it
    // is gets balanced again instead, on new layers when its old ones cannot make the race: a ball
    // made a hundred balls hitting for a thousand would otherwise never fit its old layers.
    window.clearTimeout(this.restartTimer);
    window.clearTimeout(this.balanceTimer);
    if (ball) this.balanceTimer = window.setTimeout(() => this.rebalance(ball[1] as 'a' | 'b'), 300);
    else this.restartTimer = window.setTimeout(() => this.startOver(), 180);
  }

  /**
   * A ball changed in what it is (its numbers, balls, strength or power): a whole-number strength
   * (the panel's select gives text), a crowd's size for its count (sizeFor), Always the same made a
   * crowd of a hundred (one ball alone needs a hundred hits for the smallest layer) and any other
   * numbers one ball, and, when the dice gave the name it had, the name for what it is now
   * ("100× Thousand Balls"). The panel writes them back after the change.
   */
  private reshape(key: 'a' | 'b', part: string): void {
    const ball = this.cfg[key];
    const was = this.before?.[key] ?? ball;
    ball.strength = Math.max(1, Math.round(Number(ball.strength) || 1));
    // A crowd is Always the same's alone; numbers that grow are one ball.
    if (ball.sequence !== 'ones') ball.count = 1;
    else if (part === 'sequence' && ball.count <= 1) ball.count = 100;
    ball.radius = sizeFor(ball.radius, ball.count);
    if (!was.name.trim() || diceName(was)) ball.name = plainName(ball);
  }

  private setConfig(cfg: Config): void {
    // A video from the library or a file made on a plan with the follow button: off on one without,
    // where its switch cannot be turned off. The card comes out shorter, and so does the video.
    if (!this.features.follow) cfg.look.follow = false;
    this.cfg = cfg;
    this.before = { a: structuredClone(cfg.a), b: structuredClone(cfg.b) };
    this.pending = null;
    this.searchJob++;
    $('#balance-note').hidden = true;
    $('#battle-note').hidden = true;
    if (cfg.game === 'arena-clash') this.loadBattleFlags();
    this.save();
    this.panel.refresh();
    this.syncTopBlock();
    this.syncMatchup();
    this.syncSafeZones();
    this.startOver();
  }

  /**
   * Starts the run over after a change. While it plays, through play, so the new run's lines are
   * generated before its first frame: a new matchup, length or layers can bring a new winner or
   * time, and a winner line never generated is a narrator who says nothing at the end.
   */
  private startOver(): void {
    if (this.paused || this.starting || this.recorder) this.restart();
    else void this.play(true, !this.voiceless);
  }

  private syncTopBlock(): void {
    document.body.dataset.game = this.cfg.game;
    for (const input of document.querySelectorAll<HTMLInputElement>('.games input')) input.checked = input.value === this.cfg.game;
    // A race's dice says what a roll will do with its locks (syncDice, from syncMatchup).
    if (this.cfg.game === 'arena-clash') $('#dice').title = 'New flags from where the dice picks, balanced to the video length';
    $('#reroll').title = this.cfg.game === 'arena-clash' ? 'The same flags, a new battle' : 'Same matchup, a new race';
    $<HTMLInputElement>('#seed').value = this.cfg.seed;
    $<HTMLInputElement>('#video').value = String(this.cfg.timing.video);
    $('#video-out').textContent = `${this.cfg.timing.video} s`;
    $<HTMLInputElement>('#gap').value = String(this.cfg.timing.gap);
    $('#gap-out').textContent = gapLabel(this.cfg.timing.gap);
    $<HTMLInputElement>('#powers').checked = this.powers && this.features.powers;
    $<HTMLInputElement>('#follow').checked = this.cfg.look.follow;
    for (const input of document.querySelectorAll<HTMLInputElement>('.look input')) input.checked = input.value === this.cfg.look.skin;
    for (const input of document.querySelectorAll<HTMLInputElement>('.track input')) input.checked = input.value === this.cfg.sound.track;
    for (const input of document.querySelectorAll<HTMLInputElement>('.voices input')) input.checked = input.value === voiceOf(this.cfg);
    this.syncTrackHint();
  }

  // ── The plan ─────────────────────────────────────────────────────────────

  /**
   * A saved config fitted to the plan where that leaves the matchup as it is: a look or a sound
   * the plan lacks falls back to one it has, a video longer than it allows is balanced again to
   * its longest. A ball with a power stays; Record says why it cannot record it (planProblem).
   */
  private fitPlan(cfg: Config): Config {
    const f = this.features;
    let retime = false;
    // A battle saved on a plan that had Arena Clash opens as a race on one that has not.
    if (!gameAllowed(f, cfg.game)) {
      cfg = switchGame(cfg, 'ball-race');
      retime = true;
    }
    if (!f.looks.includes(cfg.look.skin)) cfg.look.skin = f.looks[0];
    if (!f.follow && cfg.look.follow) {
      cfg.look.follow = false;
      // The winner card was planned with the follow button's time, and its line (pacing.ts).
      retime = true;
    }
    if (!soundAllowed(f, cfg.sound.track)) {
      cfg.sound.track = (['music', 'silent', 'narrator'] as Sound[]).find((s) => soundAllowed(f, s)) ?? 'silent';
      // The winner card was planned for a winner line that no longer comes (pacing.ts).
      retime = true;
    }
    if (cfg.timing.video > f.maxSeconds) {
      cfg.timing.video = f.maxSeconds;
      retime = true;
    }
    return retime ? ((cfg.game === 'arena-clash' ? balanceBattle(cfg) : balance(cfg)) ?? cfg) : cfg;
  }

  /** Why the plan does not let this config be recorded, or null when it does. */
  private planProblem(): string | null {
    const f = this.features;
    const c = this.cfg;
    if (!gameAllowed(f, c.game)) return 'Arena Clash is not in your plan: switch back to Ball race at the top.';
    if (c.timing.video > f.maxSeconds) return `Your plan makes videos up to ${f.maxSeconds} s: set a shorter length under Video.`;
    if (!f.looks.includes(c.look.skin)) return 'That look is not in your plan: pick another under Video.';
    if (!soundAllowed(f, c.sound.track)) return `${SOUND_LABELS[c.sound.track]} is not in your plan: pick another sound under Video.`;
    if (c.game === 'ball-race' && !f.powers && [c.a, c.b].some((ball) => ball.special !== 'none' && ball.amount > 0)) {
      return 'A ball in this matchup has a power, which your plan does not include: roll a new matchup.';
    }
    return null;
  }

  /**
   * What the plan does not include stays in view and at full contrast, off, with a small tag on it
   * and under it what the paid plans add and a link to the pricing page: an invitation, not an
   * error. "On the paid plans" only where every paid plan has it (`this.plans`); otherwise, or when
   * the plans did not load, the plain "not in your plan". The server checks the length, the sound,
   * the look and powers again on save.
   */
  private applyPlan(): void {
    const f = this.features;
    const paid = (this.plans ?? []).filter((p) => !p.isDefault);
    const onPaid = (has: (plan: Features) => boolean) => paid.length > 0 && paid.every((p) => has(p.features));
    const gate = (after: Element, has: (plan: Features) => boolean, invite: string, plain: string) => after.after(planInvite(invite, onPaid(has), plain));

    if (!gameAllowed(f, 'arena-clash')) {
      const input = $<HTMLInputElement>('.games input[value="arena-clash"]');
      input.disabled = true;
      const label = input.closest('label');
      label?.classList.add('locked');
      label?.querySelector('span')?.append(paidTag(onPaid((plan) => plan.allGames)));
      // Which plans have it, by what they are called: only some of the paid ones do.
      const having = paid.filter((p) => p.features.allGames).map((p) => p.name);
      const which = having.length ? `Arena Clash comes with ${having.join(' and ')}.` : 'Arena Clash is not in your plan.';
      gate($('.games'), (plan) => plan.allGames, which, which);
    }
    if (f.maxSeconds < Number($<HTMLInputElement>('#video').max)) {
      const longest = Math.min(...paid.map((p) => p.features.maxSeconds));
      gate($('#video'), (plan) => plan.maxSeconds > f.maxSeconds, `Up to ${longest} s on the paid plans.`, `Your plan makes videos up to ${f.maxSeconds} s.`);
    }

    const looks = [...document.querySelectorAll<HTMLInputElement>('.look input')].filter((input) => !f.looks.includes(input.value as Skin));
    const looksOnPaid = (plan: Features) => looks.every((input) => plan.looks.includes(input.value as Skin));
    for (const input of looks) {
      input.disabled = true;
      const tile = input.closest('.look');
      tile?.classList.add('locked');
      tile?.append(paidTag(onPaid(looksOnPaid)));
    }
    if (looks.length) {
      const names = looks.map((i) => LOOK_LABELS[i.value as Skin]).join(' and ');
      gate($('.looks'), looksOnPaid, `${names} on the paid plans.`, `${names} ${looks.length === 1 ? 'is' : 'are'} not in your plan.`);
    }
    if (f.watermark) {
      gate(
        $('.looks'),
        (plan) => !plan.watermark,
        'Videos on your plan carry a small BounceReel watermark, as the preview shows; the paid plans have none.',
        'Videos on your plan carry a small BounceReel watermark, as the preview shows.',
      );
    }
    if (f.perDay !== null) {
      // The first thing to know on a plan with a daily limit: watching is free, only Record counts.
      const start = $('#start-note');
      start.textContent = `A free preview: play races as often as you like. Only Record uses ${f.perDay === 1 ? 'your video for today' : `one of your ${f.perDay} videos a day`}.`;
      start.hidden = false;
    }

    const sounds = [...document.querySelectorAll<HTMLInputElement>('.track input')].filter((input) => !soundAllowed(f, input.value as Sound));
    const soundsOnPaid = (plan: Features) => sounds.every((input) => soundAllowed(plan, input.value as Sound));
    for (const input of sounds) {
      input.disabled = true;
      const label = input.closest('label');
      label?.classList.add('locked');
      label?.querySelector('span')?.append(paidTag(onPaid(soundsOnPaid)));
    }
    if (sounds.length) {
      const names = sounds.map((i) => SOUND_LABELS[i.value as Sound]).join(' and ');
      gate($('#track-hint'), soundsOnPaid, `${names} on the paid plans.`, `${names}: not in your plan.`);
    }

    if (!f.powers) {
      const powers = $<HTMLInputElement>('#powers');
      powers.disabled = true;
      const powersOnPaid = (plan: Features) => plan.powers;
      const toggle = powers.closest('.switch');
      toggle?.classList.add('locked');
      // In the label's words, so it wraps with them beside Classics.
      toggle?.querySelector('span')?.append(' ', paidTag(onPaid(powersOnPaid)));
      // What the switch would do is beside the point when it cannot be turned on.
      $('#powers-hint').hidden = true;
      gate($('.deal-options'), powersOnPaid, 'Powers on the paid plans; the dice gives none on yours.', 'Powers are not in your plan: the dice gives none.');
      for (const option of $<HTMLSelectElement>('#preset').options) {
        const preset = PRESETS.find((p) => p.id === option.value);
        if (preset && [preset.config.a, preset.config.b].some((b) => b.special !== 'none')) {
          option.disabled = true;
          option.textContent = `${preset.label} (powers)`;
        }
      }
      for (const select of document.querySelectorAll<HTMLSelectElement>('select[name="a.special"], select[name="b.special"]')) {
        select.disabled = true;
        gate(select.closest('.field')!, powersOnPaid, 'Powers on the paid plans.', 'Powers are not in your plan.');
      }
    }

    if (!f.follow) {
      const follow = $<HTMLInputElement>('#follow');
      follow.disabled = true;
      const followOnPaid = (plan: Features) => plan.follow;
      const toggle = follow.closest('.switch')!;
      toggle.classList.add('locked');
      toggle.querySelector('span')?.append(' ', paidTag(onPaid(followOnPaid)));
      $('#follow-hint').hidden = true;
      gate(toggle, followOnPaid, 'The follow button on the paid plans.', 'The follow button is not in your plan.');
    }

    if (!f.narrator) {
      // The voices stay playable, so anyone can hear what the narrator would sound like; its words
      // cannot be set, and those fields, out of reach (inert), stay dimmed under the line that says so.
      const voice = $('#tabpanel-voice');
      for (const field of voice.querySelectorAll<HTMLElement>('.field')) {
        field.inert = true;
        field.classList.add('locked');
      }
      voice.prepend(
        planInvite(
          'The narrator comes with the paid plans; you can hear each voice here.',
          onPaid((plan) => plan.narrator),
          'The narrator is not in your plan: videos have music, or no sound. You can still hear each voice.',
        ),
      );
    }
  }

  private syncTrackHint(): void {
    const hints: Record<Sound, string> = {
      narrator: 'The narrator from the Voice tab, over the notes and cracks.',
      music: 'Notes, cracks and the fanfare; no narrator.',
      silent: 'No sound at all, for a sound you add in the app you post from.',
    };
    setText($('#track-hint'), hints[this.cfg.sound.track]);
    const off = document.querySelector<HTMLElement>('#voice-off');
    if (off) off.hidden = this.cfg.sound.track === 'narrator';
    // The narrator switch only matters when there is a narrator to switch: said rather than left to do nothing.
    const speaks = narrated(this.cfg) && this.features.narrator;
    $<HTMLInputElement>('#voice-on').disabled = !speaks;
    $('#voice-switch').title = speaks
      ? 'On: Play has the narrator. Off: Play starts at once without it. Record follows Sound either way.'
      : 'The narrator speaks when Sound is Narrator and music.';
  }

  /** The matchup card: each ball's name, colour, numbers and power, and its speed against the slower one. Or the battle's card. */
  private syncMatchup(): void {
    if (this.cfg.game === 'arena-clash' || this.pending) {
      this.syncBattle();
      return;
    }
    const slower = Math.max(1, Math.min(this.cfg.a.speed, this.cfg.b.speed));
    for (const key of ['a', 'b'] as const) {
      const ball = this.cfg[key];
      const sequence = SEQUENCES[ball.sequence];
      document.documentElement.style.setProperty(`--team-${key}`, ball.color);
      setText($(`#name-${key}`), ball.name || (key === 'a' ? 'Top ball' : 'Bottom ball'));
      // Always the same says how hard and how many in its chips, not in the hint.
      const rule: (string | HTMLElement)[] = [Object.assign(document.createElement('span'), { textContent: sequence.label }), ...(ball.sequence === 'ones' ? [] : [sequence.hint])];
      const power = ball.amount ? POWER_WORDS[ball.special](ball.amount) : '';
      if (ball.sequence === 'ones')
        rule.push(Object.assign(document.createElement('span'), { className: 'power', textContent: `${formatBig(BigInt(ball.strength), this.cfg.look.separator)} a hit` }));
      if (ball.count > 1) rule.push(Object.assign(document.createElement('span'), { className: 'power', textContent: `${ball.count} balls` }));
      if (power) rule.push(Object.assign(document.createElement('span'), { className: 'power', textContent: power }));
      $(`#rule-${key}`).replaceChildren(...rule);
      const speed = $(`#speed-${key}`);
      setText(speed, `${(ball.speed / slower).toFixed(1)}×`);
      speed.title = `Starts at ${Math.round(ball.speed)} px/s, against ${Math.round(slower)} for the slower ball`;
    }
    // What the dice will do depends on the balls too: Always the same has a strength to roll.
    this.syncDice();
  }

  /**
   * The first frame of this run in every look, for the thumbnails of the look picker (without the
   * opening title, which would hide the look under its words); then, drawn last so the still
   * canvas keeps it, the current look's as the video opens, title and all, which a looping video
   * fades into at the end. A battle has one look and its title all through: its first frame alone.
   */
  private drawStills(): void {
    if (this.cfg.game === 'arena-clash') {
      this.stillArena.reset(this.cfg);
      this.stillArena.draw(new BattleWorld(this.cfg), this.cfg, 0, { winner: 0, age: 0 });
      return;
    }
    const first = (cfg: Config, overlay: RaceOverlay) => {
      this.still.reset(cfg);
      this.still.draw(createWorld(cfg), cfg, 0, overlay);
    };
    for (const skin of SKINS) {
      const cfg = { ...this.cfg, look: { ...this.cfg.look, skin } };
      first(cfg, { winner: 0, age: 0 });
      const tile = document.querySelector<HTMLCanvasElement>(`.look input[value="${skin}"] ~ canvas`);
      tile?.getContext('2d')?.drawImage(this.still.canvas, THUMB.x, THUMB.y, THUMB.w, THUMB.h, 0, 0, tile.width, tile.height);
    }
    first(this.cfg, { winner: 0, age: 0, opening: 1 });
  }

  /**
   * The account's saved config. One saved before accounts (under the bare key) is taken over by
   * the first account that opens the studio in this browser: on the owner's computer, the owner's.
   */
  private load(): Config {
    const key = `${STORAGE_KEY}:${this.account.account.id}`;
    try {
      const legacy = localStorage.getItem(STORAGE_KEY);
      if (legacy !== null) {
        if (localStorage.getItem(key) === null) localStorage.setItem(key, legacy);
        localStorage.removeItem(STORAGE_KEY);
      }
      const saved = localStorage.getItem(key);
      if (saved) {
        const cfg = savedConfig(JSON.parse(saved));
        // The half-second hold before the start and the 3.5 s winner card were defaults nobody chose:
        // today's are none and 2 s, since a still first second and a long end are when viewers
        // scroll on. One set to anything else stays.
        if (cfg.timing.startDelay === 0.5) cfg.timing.startDelay = 0;
        if (cfg.timing.hold === 3.5) cfg.timing.hold = 2;
        return cfg;
      }
    } catch {
      // Private window or corrupt JSON: start from the default.
    }
    this.fresh = true;
    return balance(DEFAULT_CONFIG) ?? structuredClone(DEFAULT_CONFIG);
  }

  private save(): void {
    try {
      localStorage.setItem(`${STORAGE_KEY}:${this.account.account.id}`, JSON.stringify(this.cfg));
    } catch {
      // Storage unavailable: settings just will not survive a reload.
    }
  }

  /**
   * What the dice may do lives under its own key, not in the config: loading a classic, a
   * file or a video from the library replaces the config, and must not change the next roll.
   */
  private loadDice(): { powers: boolean; region: DiceRegion } {
    const none = { powers: false, region: 'world' as DiceRegion };
    try {
      const dice = mergeConfig<{ powers: boolean; region: string }>(none, JSON.parse(localStorage.getItem(DICE_KEY) ?? '{}'));
      const region = DICE_REGIONS.find((r) => r.id === dice.region)?.id ?? 'world';
      return { powers: dice.powers, region };
    } catch {
      return none;
    }
  }

  private saveDice(): void {
    try {
      localStorage.setItem(DICE_KEY, JSON.stringify({ powers: this.powers, region: this.region }));
    } catch {
      // Storage unavailable: the choice lasts until reload.
    }
  }

  // ── Matchups and prediction ──────────────────────────────────────────────

  /** Balances a matchup to the video length and shows it; says why when it cannot fit. A battle is balanced between frames. */
  private loadMatchup(cfg: Config): void {
    if (cfg.game === 'arena-clash') {
      this.searchBattle(cfg);
      return;
    }
    const balanced = balance(cfg);
    this.setConfig(balanced ?? cfg);
    if (!balanced) this.explainUnbalanced(cfg);
  }

  /**
   * Rebalance (or Make it close, or a ball changed in what it is): this race first, then new races
   * of the same matchup, since a seed's starting angles can decide whether the finish lands; then
   * new layers for the same two balls, when the ones they have cannot make the race at all; for a
   * ball just changed (`edited`), then a new opponent for it, unless the opponent is locked, when no
   * layers suit the two (a hundred balls hitting for a thousand against Factorial); then, if
   * nothing does, why not.
   */
  private rebalance(edited?: 'a' | 'b'): void {
    for (let i = 0; i < 9; i++) {
      const balanced = balance(i ? { ...this.cfg, seed: String(1 + Math.floor(Math.random() * 999_999)) } : this.cfg);
      if (balanced) {
        this.setConfig(balanced);
        if (i) this.flash('Balanced as a new race of the same matchup: this race could not land on time.');
        return;
      }
    }
    const relayered = relayer(this.cfg, String(1 + Math.floor(Math.random() * 999_999)));
    if (relayered) {
      this.setConfig(relayered);
      this.flash('New layers: these two balls could not race on the old ones.');
      return;
    }
    const other = edited === 'a' ? 'b' : 'a';
    const locked = this.locks[other].ball || this.locks[other].count || this.locks[other].strength;
    if (edited && !locked) {
      const keep = { [edited]: KEEP_ALL, [other]: this.locks[other] } as Record<'a' | 'b', Keep>;
      const next = randomMatchup(String(1 + Math.floor(Math.random() * 999_999)), this.cfg, { powers: this.powers && this.features.powers, keep });
      if (next) {
        const was = this.cfg[other].name || 'The other ball';
        next.voice.script = '';
        this.setConfig(next);
        this.flash(`A new opponent: ${was} could not race ${next[edited].name} on any layers.`);
        return;
      }
    }
    this.explainUnbalanced(this.cfg);
  }

  /**
   * Which ball keeps a matchup from balancing, and what would fix it, in the matchup card (where it
   * stays until the matchup changes) and in a message. A button that only flashed a line read as
   * one that did nothing.
   */
  private explainUnbalanced(cfg: Config): void {
    const problem = balanceProblem(cfg);
    const name = problem ? (problem.side === 0 ? cfg.a.name : cfg.b.name) || (problem.side === 0 ? 'The top ball' : 'The bottom ball') : '';
    const video = `${cfg.timing.video} s video`;
    const text = !problem
      ? 'This matchup cannot be balanced as it is. Try New race, or other layers.'
      : problem.why === 'fast'
        ? `${name} needs too many hits for these layers: it would have to move faster than a viewer can follow to finish a ${video}. Lower the layers, give it a faster-growing sequence, or make the video longer.`
        : problem.why === 'slow'
          ? `${name} gets through these layers too soon: it would crawl to fill a ${video}. Raise the layers, or make the video shorter.`
          : 'With these powers the finish will not land on time. Try New race, or another finish gap.';
    const note = $('#balance-note');
    note.textContent = text;
    note.hidden = false;
    this.flash(text);
  }

  /**
   * The locks as the dice will use them: the matchup card's beside a ball is closed while anything of
   * it is kept; the ones under its Balls and Hit strength as they are. Then what the dice button
   * will do: a new matchup, a new opponent for the locked ball, new layers for two balls kept whole,
   * or the rest of two kept balls rolled.
   */
  private syncDice(): void {
    const held = (key: 'a' | 'b') => this.locks[key].ball || this.locks[key].count || this.locks[key].strength;
    for (const key of ['a', 'b'] as const) {
      $<HTMLInputElement>(`#lock-${key}`).checked = held(key);
      for (const part of ['count', 'strength'] as const) {
        const box = document.querySelector<HTMLInputElement>(`#lock-${key}-${part}`);
        if (box) box.checked = this.locks[key][part];
      }
    }
    const whole = (key: 'a' | 'b') => keptWhole(this.cfg[key], this.locks[key]);
    const one = held('a') ? 'top' : 'bottom';
    const [label, title] =
      held('a') && held('b')
        ? whole('a') && whole('b')
          ? ['New layers', 'Keeps both balls as they are, and gives them new layers and a new race, balanced to the video length']
          : ['Roll the rest', 'Keeps what is locked of both balls, and rolls what is not (how many balls, how hard they hit) with new layers, balanced to the video length']
        : held('a') || held('b')
          ? ['New opponent', `Keeps the ${one} ball and what is locked of it, and finds it a new opponent and layers, balanced to the video length`]
          : ['Random matchup', 'A brand-new matchup, balanced to the video length'];
    setText($('#dice-label'), label);
    $('#dice').title = title;
  }

  /**
   * A lock under a ball's Balls or Hit strength in the Balls tab: the dice keeps that, and so the
   * ball too, whose it is. It hides with its field (Hit strength is Always the same's alone).
   */
  private addFieldLock(key: 'a' | 'b', part: 'count' | 'strength'): void {
    const row = document.querySelector(`[name="${key}.${part}"]`)?.closest('.field');
    if (!row) return;
    const toggle = document.createElement('label');
    toggle.className = 'field-lock';
    toggle.innerHTML = `<input type="checkbox" id="lock-${key}-${part}" autocomplete="off" />${LOCK_ICON}<span>${part === 'count' ? 'Keep how many balls on a roll' : 'Keep how hard it hits on a roll'}</span>`;
    row.append(toggle);
    const box = toggle.querySelector('input') as HTMLInputElement;
    box.addEventListener('change', () => {
      this.locks[key][part] = box.checked;
      this.syncDice();
    });
  }

  /**
   * The dice: a brand-new matchup, balanced to the video length, a power or a crowd now and then
   * if allowed. A locked ball stays as it is and gets a new opponent; with both locked, the two
   * get new layers and a new race. Says why when nothing fits the locked balls.
   */
  private randomize(): void {
    if (this.cfg.game === 'arena-clash') {
      const base = this.pending ?? this.cfg;
      this.loadMatchup(randomBattle(String(1 + Math.floor(Math.random() * 999_999)), base, base.battle.flags.length, this.region));
      return;
    }
    const keep = structuredClone(this.locks);
    const next = randomMatchup(String(1 + Math.floor(Math.random() * 999_999)), this.cfg, { powers: this.powers && this.features.powers, keep });
    if (!next) {
      const held = (k: Keep) => k.ball || k.count || k.strength;
      const one = held(keep.a) ? this.cfg.a : this.cfg.b;
      const note = $('#balance-note');
      note.textContent =
        held(keep.a) && held(keep.b)
          ? 'No round layers suit these two balls: their hits are too far apart. Unlock one, or let the dice roll how many balls or how hard they hit.'
          : `Nothing the dice makes races ${one.name || 'this ball'}: it needs too many hits, or too few, for any layers. Give it more balls, change its numbers, or unlock it.`;
      note.hidden = false;
      this.flash(note.textContent);
      return;
    }
    next.voice.script = '';
    this.setConfig(next);
  }

  /** Same matchup, a new race: new angles from a new seed, balanced again. */
  private reroll(): void {
    if (this.cfg.game === 'arena-clash') {
      this.loadMatchup({ ...(this.pending ?? this.cfg), seed: String(1 + Math.floor(Math.random() * 999_999)) });
      return;
    }
    for (let i = 0; i < 12; i++) {
      const balanced = balance({ ...this.cfg, seed: String(1 + Math.floor(Math.random() * 999_999)) });
      if (balanced) {
        this.setConfig(balanced);
        return;
      }
    }
    this.flash('No new race balanced for this matchup; try another video length.');
  }

  private showPrediction(): void {
    const o = this.outcome;
    if ('outs' in o) {
      this.showBattlePrediction(o);
      return;
    }
    const video = videoSeconds(this.cfg, o.time, o.winnerName);
    const gap = this.cfg.timing.gap;
    // As close as asked: a photo finish, or within 1.5 s of the chosen gap.
    const close = gap > 0 ? Math.abs(this.margin - gap) <= 1.5 : this.margin <= 1.5;
    const onLength = Math.abs(video - this.cfg.timing.video) <= 1.5;
    // After a hand edit the race may no longer be close (or as far apart as asked) or the right length.
    const uneven = o.timedOut || !close || !onLength;
    this.uneven = uneven;
    $('#prediction').classList.toggle('warn', uneven);
    if (o.timedOut) {
      $('#prediction-text').textContent = `Nobody finishes within ${this.cfg.timing.maxSeconds} s.`;
    } else {
      const winner = Object.assign(document.createElement('strong'), { textContent: o.winnerName });
      const length = Object.assign(document.createElement('span'), { textContent: `The video runs ${Math.round(video)} s` });
      $('#prediction-text').replaceChildren(winner, ` wins by ${Number.isFinite(this.margin) ? `${this.margin.toFixed(1)} s` : 'a mile'}`, length);
    }
    $('#balance').hidden = !uneven;
    $('#balance').textContent = gap > 0 ? 'Rebalance' : 'Make it close';
    // The lanes, as the home page's race board draws them: the winner's to the line, the loser's
    // as far as it had got when the winner finished. A race nobody finishes has none.
    for (const [key, team] of [['a', 0], ['b', 1]] as const) {
      const share = o.timedOut ? 0 : o.winner === team ? 1 : o.runnerUp;
      $(`#lane-${key}`).style.setProperty('--w', `${(share * 100).toFixed(1)}%`);
    }
    $('.matchup').classList.toggle('timed-out', o.timedOut);
    this.syncPrimary();
  }

  /**
   * One violet action on screen: Record when this race can be recorded as it is (it ends as
   * asked, the plan records it, a video is left today, the browser writes a file), the dice
   * otherwise. While recording, Record is red (style.css) and the dice is off with the panel.
   */
  private syncPrimary(): void {
    const day = this.account.day;
    const ready =
      !this.uneven && this.planProblem() === null && (day.limit === null || day.used < day.limit) && pickType(this.cfg.sound.track !== 'silent') !== null;
    $('#record').classList.toggle('ghost', !ready && !this.recorder);
    $('#dice').classList.toggle('ghost', ready || this.recorder !== null);
  }

  // ── Arena Clash ──────────────────────────────────────────────────────────

  /** The game switch, and the battle card's controls: how many flags, where the dice picks, the winner. */
  private buildBattleBlock(): void {
    for (const input of document.querySelectorAll<HTMLInputElement>('.games input')) {
      input.addEventListener('change', () => {
        if (input.checked) this.setGame(input.value as Game);
      });
    }
    const region = $<HTMLSelectElement>('#region');
    region.append(...DICE_REGIONS.map((r) => new Option(r.label, r.id)));
    region.value = this.region;
    region.addEventListener('change', () => {
      this.region = region.value as DiceRegion;
      this.saveDice();
    });
    $('#flags-more').addEventListener('click', () => this.editBattle((b) => b.flags.push(this.randomFlag(b.flags))));
    $('#flags-less').addEventListener('click', () => this.editBattle((b) => b.flags.pop()));
    const winner = $<HTMLSelectElement>('#battle-winner');
    // The same battle if it already ends that way: balancing tries the current seed first.
    winner.addEventListener('change', () => this.editBattle((b) => (b.winner = winner.value), false));
    const list = $('#flag-list');
    list.addEventListener('change', (e) => {
      const select = (e.target as HTMLElement).closest('select');
      if (!select) return;
      const i = Number(select.dataset.index);
      this.editBattle((b) => {
        // A flag already in the battle swaps places with the one it replaces.
        const other = b.flags.indexOf(select.value);
        if (other >= 0) b.flags[other] = b.flags[i];
        b.flags[i] = select.value;
      });
    });
    list.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-index]');
      if (button) this.editBattle((b) => (b.flags[Number(button.dataset.index)] = this.randomFlag(b.flags)));
    });
  }

  /** Ball race or Arena Clash: the settings both share stay (switchGame), and the other game is balanced to them. */
  private setGame(game: Game): void {
    const current = this.pending ?? this.cfg;
    if (game === current.game) return;
    this.loadMatchup(switchGame(current, game));
  }

  /** A change to the battle's flags or winner, balanced as a new battle (a new seed, unless `reseed` is off). */
  private editBattle(change: (b: Battle) => void, reseed = true): void {
    const next = structuredClone(this.pending ?? this.cfg);
    change(next.battle);
    if (!next.battle.flags.includes(next.battle.winner)) next.battle.winner = '';
    if (reseed) next.seed = String(1 + Math.floor(Math.random() * 999_999));
    this.loadMatchup(next);
  }

  /** A flag not yet in the battle from where the dice picks, or from everywhere when that has none left. */
  private randomFlag(taken: string[]): string {
    const free = COUNTRIES.filter((c) => !taken.includes(c.code));
    const test = DICE_REGIONS.find((r) => r.id === this.region)?.test ?? (() => true);
    const near = free.filter(test);
    const from = near.length ? near : free;
    return from[Math.floor(Math.random() * from.length)].code;
  }

  /**
   * Balances a battle a seed at a time between frames (searchBattle), the card showing its flags
   * and "Balancing" meanwhile; the run on screen goes on until the new one is ready. An edit made
   * meanwhile starts over from it.
   */
  private searchBattle(cfg: Config): void {
    const job = ++this.searchJob;
    this.pending = cfg;
    document.body.dataset.game = cfg.game;
    $('#battle-note').hidden = true;
    this.syncBattle();
    this.loadBattleFlags(cfg);
    const search = searchBattle(cfg);
    const slice = () => {
      if (job !== this.searchJob) return;
      // A dozen milliseconds a slice: the preview keeps its frames while a hard battle takes a second.
      const until = performance.now() + 12;
      let step = search.next();
      while (!step.done && performance.now() < until) step = search.next();
      if (!step.done) {
        window.setTimeout(slice, 0);
        return;
      }
      this.setConfig(step.value ?? cfg);
      if (!step.value) this.explainBattle(cfg);
    };
    window.setTimeout(slice, 0);
  }

  /** Why a battle did not balance, under its card until it changes, and in a message. */
  private explainBattle(cfg: Config): void {
    const winner = cfg.battle.winner ? flagName(cfg.battle.winner) : '';
    const text = winner
      ? `No battle of these flags ended with ${winner} winning in a ${cfg.timing.video} s video. Try another length, or Random as the winner.`
      : `These flags did not fit a ${cfg.timing.video} s video. Try another length, or fewer flags.`;
    const note = $('#battle-note');
    note.textContent = text;
    note.hidden = false;
    this.flash(text);
  }

  /** Loads the battle's flags, then shows them: in the card's rings, their strings' colours, and the first frames. */
  private loadBattleFlags(cfg = this.cfg): void {
    void loadFlags(cfg.battle.flags).then(() => {
      this.syncBattle();
      if (this.cfg.game === 'arena-clash') this.drawStills();
    });
  }

  /** The battle card: a row per flag (its flag in its strings' colour, its country, a die), how many, and the winner. */
  private syncBattle(): void {
    const { flags, winner } = (this.pending ?? this.cfg).battle;
    const colors = lineColors(flags);
    const list = $('#flag-list');
    while (list.children.length < flags.length) list.append(this.flagRow(list.children.length));
    while (list.children.length > flags.length) list.lastElementChild?.remove();
    flags.forEach((code, i) => {
      const row = list.children[i] as HTMLElement;
      row.style.setProperty('--line', colors[i]);
      const img = row.querySelector('img')!;
      if (img.getAttribute('src') !== flagSrc(code)) img.src = flagSrc(code);
      row.querySelector('select')!.value = code;
    });
    setText($('#flags-count'), String(flags.length));
    $<HTMLButtonElement>('#flags-less').disabled = flags.length <= MIN_FLAGS;
    $<HTMLButtonElement>('#flags-more').disabled = flags.length >= MAX_FLAGS;
    const select = $<HTMLSelectElement>('#battle-winner');
    select.replaceChildren(new Option('Random', ''), ...flags.map((c) => new Option(flagName(c), c)));
    select.value = winner;
    if (this.pending) {
      $('#battle-verdict').classList.remove('warn');
      $('#battle-prediction').textContent = 'Balancing the battle…';
    }
  }

  /** One flag's row in the card: its flag, every country to pick from, and a die for a random one. */
  private flagRow(i: number): HTMLLIElement {
    const row = document.createElement('li');
    const img = Object.assign(document.createElement('img'), { alt: '', width: 26, height: 26, decoding: 'async' });
    const select = document.createElement('select');
    select.dataset.index = String(i);
    select.setAttribute('aria-label', `Flag ${i + 1}`);
    select.append(...COUNTRIES.map((c) => new Option(c.name, c.code)));
    const dice = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-button small', title: 'A random flag here' });
    dice.dataset.index = String(i);
    dice.setAttribute('aria-label', `A random flag in place ${i + 1}`);
    dice.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" stroke="none" /></svg>';
    row.append(img, select, dice);
    return row;
  }

  /** Who wins, when, and how long the video runs; warned when it no longer lands on the length. */
  private showBattlePrediction(o: BattleOutcome): void {
    const video = videoSeconds(this.cfg, o.time + slowExtra(o), o.winnerName);
    this.uneven = o.timedOut || Math.abs(video - this.cfg.timing.video) > 1.5;
    $('#battle-verdict').classList.toggle('warn', this.uneven);
    const winner = Object.assign(document.createElement('strong'), { textContent: o.winnerName });
    const first = o.outs.length > 1 ? ` · first flag out at ${o.outs[0].time.toFixed(1)} s` : '';
    const detail = Object.assign(document.createElement('span'), {
      textContent: o.timedOut ? `Time runs out at ${o.time.toFixed(1)} s, so the most strings wins` : `The video runs ${Math.round(video)} s${first}`,
    });
    $('#battle-prediction').replaceChildren(winner, ` ${o.timedOut ? 'leads' : 'wins'} after ${o.time.toFixed(1)} s`, detail);
    this.syncPrimary();
  }

  // ── Panel extras ─────────────────────────────────────────────────────────

  private buildPresetBlock(): void {
    const presets = $<HTMLSelectElement>('#preset');
    presets.append(
      ...PRESETS.map((p) => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.label;
        return o;
      }),
    );
    presets.addEventListener('change', () => {
      const preset = PRESETS.find((p) => p.id === presets.value);
      presets.value = '';
      if (!preset) return;
      // A matchup brings its own balls, layers and sound, but keeps your narrator, video length, finish gap and look.
      const next = structuredClone(preset.config);
      next.voice = { ...next.voice, voice: this.cfg.voice.voice };
      next.timing = { ...next.timing, video: this.cfg.timing.video, gap: this.cfg.timing.gap };
      next.look = structuredClone(this.cfg.look);
      this.loadMatchup(next);
    });
    $('#dice').addEventListener('click', () => this.randomize());
    for (const key of ['a', 'b'] as const) {
      const lock = $<HTMLInputElement>(`#lock-${key}`);
      lock.addEventListener('change', () => {
        // Closed, the ball is kept; opened, nothing of it is: its count and strength are the ball's.
        this.locks[key] = { ball: lock.checked, count: false, strength: false };
        this.syncDice();
      });
      for (const part of ['count', 'strength'] as const) this.addFieldLock(key, part);
    }
    this.syncDice();
    const powers = $<HTMLInputElement>('#powers');
    powers.addEventListener('change', () => {
      this.powers = powers.checked;
      this.saveDice();
    });
    $('#reroll').addEventListener('click', () => this.reroll());
    $('#balance').addEventListener('click', () => this.rebalance());

    const video = $<HTMLInputElement>('#video');
    let videoTimer = 0;
    video.addEventListener('input', () => {
      // The slider keeps its whole range in view; past the plan's longest it stops there.
      if (Number(video.value) > this.features.maxSeconds) video.value = String(this.features.maxSeconds);
      this.cfg.timing.video = Number(video.value);
      $('#video-out').textContent = `${video.value} s`;
      window.clearTimeout(videoTimer);
      videoTimer = window.setTimeout(() => this.loadMatchup(this.cfg), 200);
    });

    const gap = $<HTMLInputElement>('#gap');
    let gapTimer = 0;
    gap.addEventListener('input', () => {
      this.cfg.timing.gap = Number(gap.value);
      $('#gap-out').textContent = gapLabel(this.cfg.timing.gap);
      window.clearTimeout(gapTimer);
      gapTimer = window.setTimeout(() => this.loadMatchup(this.cfg), 200);
    });

    const seed = $<HTMLInputElement>('#seed');
    seed.addEventListener('change', () => {
      this.loadMatchup({ ...this.cfg, seed: seed.value.trim() || '1' });
    });
    this.syncTopBlock();

    $('#export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(this.cfg, null, 2)], { type: 'application/json' });
      download(blob, `${slug(this.title())}.json`);
    });
    const importer = $<HTMLInputElement>('#import');
    importer.addEventListener('change', async () => {
      const file = importer.files?.[0];
      importer.value = '';
      if (!file) return;
      try {
        this.setConfig(savedConfig(JSON.parse(await file.text())));
        this.flash(`Loaded ${file.name}`);
      } catch {
        this.flash(`${file.name} is not a config file`);
      }
    });
  }

  /**
   * What Record puts in the sound: narrator and music, music only, silent. It changes how long
   * the winner card is planned for (a winner line or none, pacing.ts), so the race is balanced again.
   */
  private buildSoundBlock(): void {
    for (const input of document.querySelectorAll<HTMLInputElement>('.track input')) {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        this.cfg.sound.track = input.value as Sound;
        this.syncTrackHint();
        this.loadMatchup(this.cfg);
      });
    }
  }

  /**
   * Ask viewers to follow (look.follow): the follow button and "Follow for more!". It keeps the
   * winner card up longer (pacing.ts), so the race or the battle is balanced again, as for Sound.
   */
  private buildFollowSwitch(): void {
    const follow = $<HTMLInputElement>('#follow');
    follow.addEventListener('change', () => {
      // A battle still being balanced is the one to change, not the one on screen.
      const cfg = this.pending ?? this.cfg;
      cfg.look.follow = follow.checked;
      this.loadMatchup(cfg);
    });
  }

  /** Under the Music fields, a way to hear the picked melody on the picked instrument without playing a race. */
  private buildMusicBlock(): void {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<button type="button" class="button small ghost" id="music-test">
      <svg class="solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5Z" /></svg>
      Hear the music
    </button>`;
    this.panel.body('sound').append(row);
    $('#music-test').addEventListener('click', () => void this.hearMusic());
  }

  /**
   * The melody's first sixteen notes on the instrument, at the volume, as floor hits play them
   * (velocity as sonify.ts gives a hit), but evenly 0.22 s apart: a brisk race's pace, quick
   * enough to hear the tune. A second click starts it over rather than play two at once.
   */
  private async hearMusic(): Promise<void> {
    const audio = await this.unlock();
    window.clearTimeout(this.musicTimer);
    const music = new Music(this.cfg.sound);
    let left = 16;
    const next = () => {
      audio.note(music.next(), 0.85, this.cfg.sound.timbre, 0);
      if (--left) this.musicTimer = window.setTimeout(next, 220);
    };
    next();
  }

  /** The three looks, each a thumbnail of this matchup's first frame. A look only changes the drawing, so the run goes on. */
  private buildLookBlock(): void {
    for (const input of document.querySelectorAll<HTMLInputElement>('.look input')) {
      const tile = input.nextElementSibling as HTMLCanvasElement;
      tile.width = 240;
      tile.height = Math.round((240 * THUMB.h) / THUMB.w);
      input.addEventListener('change', () => {
        if (!input.checked) return;
        this.cfg.look.skin = input.value as Skin;
        this.save();
        this.drawStills();
      });
    }
  }

  /**
   * The narrator's voices above the Voice fields, each with ▶ to hear it say this matchup's
   * names (the first time also downloads the voice model, once), and under the fields the whole
   * opening to hear and the generation status.
   */
  private buildVoiceBlock(): void {
    const body = this.panel.body('voice');
    const picker = document.createElement('div');
    picker.className = 'voice-picker';
    picker.innerHTML = `
      <span class="field-label" id="voice-label">Voice</span>
      <div class="voices" role="radiogroup" aria-labelledby="voice-label">
        ${VOICES.map(
          (v) => `<div class="voice-row">
            <label><input type="radio" name="voice" value="${v.id}" autocomplete="off" /><strong>${v.name}</strong><span>${v.about}, grade ${v.grade}</span></label>
            <button type="button" class="icon-button small voice-play" data-voice="${v.id}" title="Hear ${v.name}" aria-label="Hear ${v.name}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5Z" /></svg></button>
          </div>`,
        ).join('')}
      </div>
      <p class="hint">Kokoro, a free voice that runs in your browser. The first listen downloads it once: about 90 MB, or 330 MB on a computer with a GPU.</p>
      <p id="voice-off" class="hint" hidden>The narrator speaks when Sound, under Video, is Narrator and music.</p>`;
    const extra = document.createElement('div');
    extra.className = 'voice-extra';
    extra.innerHTML = `
      <div class="row"><button type="button" class="button small ghost" id="voice-test">Hear the opening</button></div>
      <p id="voice-status" class="voice-status" hidden></p>`;
    body.prepend(picker);
    body.append(extra);
    for (const input of picker.querySelectorAll<HTMLInputElement>('input[name="voice"]')) {
      // syncTopBlock ran before these existed (buildPresetBlock), so the voice in use is marked here.
      input.checked = input.value === voiceOf(this.cfg);
      input.addEventListener('change', () => {
        if (!input.checked) return;
        this.cfg.voice.voice = input.value;
        this.save();
      });
    }
    for (const play of picker.querySelectorAll<HTMLButtonElement>('.voice-play')) {
      play.addEventListener('click', () => void this.hear(play.dataset.voice!, previewLine(this.cfg)));
    }
    $('#voice-test').addEventListener('click', () => void this.hear(voiceOf(this.cfg), introLine(this.cfg)));
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────

  private bindToolbar(): void {
    $('#start').addEventListener('click', () => void this.play(false));
    $('#play').addEventListener('click', () => {
      if (this.paused) void this.play(false);
      else this.paused = true;
    });
    $('#restart').addEventListener('click', () => {
      if (this.paused) this.restart();
      else void this.play(true);
    });
    const voiceOn = $<HTMLInputElement>('#voice-on');
    voiceOn.addEventListener('change', () => {
      this.voiceOn = voiceOn.checked;
      // The opening is said from the first frame, so the run starts over in the new mode rather
      // than go on in the old one. A start under way (generating, or Record) keeps its own.
      if (this.starting) return;
      if (!this.paused) void this.play(true);
      else if (this.elapsed > 0) this.restart();
    });
    $('#record').addEventListener('click', () => void this.record());

    window.addEventListener('keydown', (e) => {
      // The record question has the keys while it is open: Enter answers it, Escape closes it.
      if (document.querySelector('dialog[open]')) return;
      const target = e.target as HTMLElement;
      // A focused tab takes Space and the arrow keys itself.
      if (target.closest('input, select, textarea, [role="tab"]') || e.metaKey || e.ctrlKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        $('#play').click();
      } else if (e.key === 'r' && !this.recorder) $('#restart').click();
    });

    // A hidden tab stops drawing, so a take hidden for a while has a pause in it: said on return.
    document.addEventListener('visibilitychange', () => {
      if (!this.recorder) return;
      if (document.hidden) this.hiddenAt = performance.now();
      else if (this.hiddenAt) {
        this.takeInterrupted((performance.now() - this.hiddenAt) / 1000);
        this.hiddenAt = 0;
      }
    });
    $('#rec-save').addEventListener('click', () => void this.finishRecording(true));
    $('#rec-again').addEventListener('click', () => void this.recordAgain());

    const finished = $<HTMLDialogElement>('#finished');
    $('#finished-close').addEventListener('click', () => finished.close());
    $('#finished-copy').addEventListener('click', async () => {
      const button = $('#finished-copy');
      const text = $('#finished-prompt');
      try {
        await navigator.clipboard.writeText(text.textContent ?? '');
        button.textContent = 'Copied';
      } catch {
        // The clipboard refused (a permission): the text is selected for a copy by hand instead.
        getSelection()?.selectAllChildren(text);
        button.textContent = 'Selected';
      }
      window.setTimeout(() => (button.textContent = 'Copy'), 2000);
    });
    $('#finished-next').addEventListener('click', () => {
      finished.close();
      this.randomize();
    });
  }

  private updateStatus(): void {
    const play = $('#play');
    setState(play, this.paused ? 'paused' : 'playing');
    setText($('#play > span'), this.paused ? 'Play' : 'Pause');
    setState($('#record'), this.recorder ? 'recording' : 'idle');
    setText($('#record > span'), this.recorder ? 'Stop & save' : 'Record');
    const time = this.world.time.toFixed(1);
    // While recording the status's red dot is drawn by style.css (.recording .status).
    const status = this.starting
      ? this.voiceStatus || 'Starting…'
      : this.recorder
        ? `REC ${((performance.now() - this.recorder.startedAt) / 1000).toFixed(1)} s`
        : this.paused
          ? `Paused · ${time} s`
          : `${this.phase === 'race' ? (this.cfg.game === 'arena-clash' ? 'Fighting' : 'Racing') : this.phase === 'intro' ? 'Starting' : this.phase === 'slowmo' ? 'Slow motion' : 'Finished'}${this.cfg.sound.track === 'silent' ? ' · silent' : this.narrating() ? '' : ' · no voice'} · ${time} s`;
    setText($('#status'), status);
  }

  private syncSafeZones(): void {
    $('#safe-zones').hidden = !this.cfg.look.safeZones;
  }

  private flashTimer = 0;
  /** A message under the video; `upgrade` ends it with a link to the pricing page. */
  private flash(message: string, upgrade = false): void {
    const el = $('#toast');
    el.replaceChildren(message, ...(upgrade ? [' ', upgradeLink()] : []));
    el.hidden = false;
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (el.hidden = true), 7000);
  }
}
