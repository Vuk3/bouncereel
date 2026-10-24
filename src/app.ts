import type { AccountResponse, DayResponse, NewVideo, PublicPlan, VideoResponse } from '../shared/api.ts';
import { LOOK_LABELS, soundAllowed, SOUND_LABELS, type Features, type Sound } from '../shared/features.ts';
import { api, ApiError } from './api.ts';
import { AudioEngine } from './audio/engine.ts';
import { VOICES, VoiceCache, introLine, outroLine, plannedLines, previewLine, voiceOf } from './audio/narration.ts';
import { Sonifier } from './audio/sonify.ts';
import { DEFAULT_CONFIG, PRESETS, SKINS, mergeConfig, savedConfig, type Config, type Skin, type Special } from './config.ts';
import { addToLibrary, APP_VERSION, retryPending, type Saved } from './library.ts';
import { download, describeType, pickType, Recorder } from './record/recorder.ts';
import { Renderer } from './render/renderer.ts';
import { AFTER_OUTRO, END_PAD, SLOWMO, SLOWMO_LEAD, SLOWMO_TAIL, narrated, openingShown, videoSeconds } from './pacing.ts';
import { balance, balanceProblem, randomMatchup } from './sim/balance.ts';
import { SEQUENCES } from './sim/sequences.ts';
import { STEP } from './sim/types.ts';
import { createWorld, finishTimes, predict, type Outcome, type World } from './sim/world.ts';
import type { Field } from './ui/fields.ts';
import { Panel } from './ui/panel.ts';
import { bindAccountChrome, dayLine, nextVideoAt, paidTag, planChips, planHoldsBack, planInvite, upgradeLink } from './ui/plan.ts';
import { bindThemeToggle } from './ui/theme.ts';

// The page: one run at a time, driven by requestAnimationFrame.
//
//   intro ─▶ race ─▶ slowmo ─▶ winner ─▶ done
//
// The simulation advances in fixed STEPs whatever the frame rate; a phase only
// changes how much simulated time a frame gets (slow motion is fewer steps per
// frame, never a different step), so slowing down cannot change the outcome.
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
  private world: World;
  private outcome: Outcome;
  private readonly canvas = $<HTMLCanvasElement>('#canvas');
  private readonly renderer: Renderer;
  /** Draws first frames off screen: the look thumbnails, and the frame a looping video fades into. */
  private readonly still = new Renderer(document.createElement('canvas'));
  private readonly panel: Panel;
  /**
   * Whether the dice may give a ball a power. The dice's own setting, kept apart from the config
   * (see loadDice). Off until someone turns it on: sequence against sequence is the format.
   */
  private powers = false;
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
  private acc = 0;
  private paused = true;
  private starting = false;
  /** "Play without voice": bounce sounds but no narrator, so nothing to generate and the race starts at once. */
  private voiceless = false;
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
    this.plans = plans;
    this.cfg = this.fitPlan(this.load());
    this.powers = this.loadDice();
    this.world = createWorld(this.cfg);
    this.outcome = predict(this.cfg);
    this.margin = this.measureMargin();
    this.renderer = new Renderer(this.canvas);
    this.renderer.reset(this.cfg);
    this.panel = new Panel($('#sections'), () => this.cfg, (field) => this.changed(field));
    this.panel.body('files').append($('#files'));
    this.buildPresetBlock();
    this.buildLookBlock();
    this.buildSoundBlock();
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
    const showing = this.phase === 'winner' || this.phase === 'done';
    this.renderer.draw(this.world, this.cfg, this.paused ? 0 : dt, {
      winner: showing ? Math.min(1, this.winnerAge / 0.35) : 0,
      age: showing ? this.winnerAge : 0,
      // The end of a looping video: the first frame fades in over most of END_PAD and holds for
      // the last few frames, so the file's last frame is the first one and the loop has no seam.
      loop: this.phase === 'done' && this.cfg.look.loop ? this.phaseAge / (END_PAD * 0.8) : 0,
      start: this.still.canvas,
      // The preview shows what Record writes: on a plan with the watermark, both carry it.
      watermark: this.features.watermark,
      opening: openingShown(this.raceAt === null ? null : this.elapsed - this.raceAt),
      leads: this.outcome.leads,
      margin: this.margin,
    });
    this.updateStatus();
    this.syncTimeline();
    this.syncRecBar();
    requestAnimationFrame((t) => this.frame(t));
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
        const finish = this.outcome.timedOut ? null : this.outcome.time;
        this.simulate(dt * (finish !== null && this.world.time > finish - SLOWMO_LEAD ? SLOWMO : 1));
        if (this.world.winner !== null) this.setPhase(this.world.timedOut ? 'winner' : 'slowmo');
        break;
      }
      case 'slowmo':
        this.simulate(dt * SLOWMO);
        if (this.phaseAge >= SLOWMO_TAIL) this.setPhase('winner');
        break;
      case 'winner': {
        this.simulate(dt * SLOWMO);
        // The card stays until the video reaches its length, and never cuts the winner line short.
        const said = !this.outroPending && this.winnerAge >= this.outroEnds + AFTER_OUTRO && this.winnerAge >= 1.5;
        if (said && this.elapsed >= this.cfg.timing.video - END_PAD) this.setPhase('done');
        break;
      }
      case 'done':
        this.simulate(dt * SLOWMO);
        // The fade into the first frame (or a held moment), so the recording does not end on a cut.
        if (this.recorder && this.phaseAge > END_PAD) void this.finishRecording(false);
        break;
    }
  }

  private simulate(simDt: number): void {
    this.acc += simDt;
    let steps = 0;
    while (this.acc >= STEP && steps < 240) {
      this.world.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    // Hopelessly behind (the tab was in the background): drop it rather than spiral.
    if (steps === 240) this.acc = 0;
    const events = this.world.drain();
    if (events.length) this.renderer.handle(events, this.world, this.cfg);
    // Every frame, events or not: a lead change can come between hits.
    if (this.cfg.sound.track !== 'silent') this.sonifier?.play(events, this.cfg, this.world);
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.phaseAge = 0;
    if (phase === 'intro') this.raceAt = null;
    if (phase === 'race') this.raceAt = this.elapsed;
    if (phase === 'done') this.endsAt = this.elapsed + END_PAD;
    if (phase === 'winner') {
      this.winnerAge = 0;
      this.renderer.celebrate(this.world);
      this.outroPending = this.narrating();
      this.outroEnds = 0;
    }
  }

  private restart(): void {
    window.clearTimeout(this.restartTimer);
    this.world = createWorld(this.cfg);
    this.outcome = predict(this.cfg);
    this.margin = this.measureMargin();
    this.renderer.reset(this.cfg);
    this.sonifier?.reset(this.cfg, this.outcome.leads);
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
   * up to the slow-down, slow motion into and out of the win, the winner card up to the video's
   * length, and its last END_PAD (the fade into the first frame, or a held end). A timed-out race
   * has no slow motion. The card stays at least 1.5 s (advance), so a race that ends late pushes
   * the end past the length; a winner line that runs long does too, which the clock shows.
   */
  private buildTimeline(): void {
    const t = this.cfg.timing;
    const o = this.outcome;
    const race = o.timedOut ? o.time : Math.max(0, o.time - SLOWMO_LEAD);
    const slow = o.timedOut ? 0 : SLOWMO_LEAD / SLOWMO + SLOWMO_TAIL;
    const card = t.startDelay + race + slow;
    this.timelineEnd = Math.max(t.video, card + 1.5 + END_PAD);
    const phases: [string, string, number][] = [
      ['hold', 'Hold', t.startDelay],
      ['race', 'Race', race],
      ['slow', 'Slow motion', slow],
      ['card', 'Winner', this.timelineEnd - END_PAD - card],
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

  /** Seconds between the winner and the loser touching the line, for the predicted race. */
  private measureMargin(): number {
    const finish = finishTimes(this.cfg, this.outcome.time + 30);
    return Math.abs(finish[0] - finish[1]);
  }

  // ── Starting, recording ──────────────────────────────────────────────────

  /** Audio needs a click before it may start; everything that makes sound goes through here first. */
  private async unlock(): Promise<AudioEngine> {
    if (!this.audio) {
      this.audio = new AudioEngine();
      this.audio.volume = this.cfg.sound.volume;
      this.sonifier = new Sonifier(this.audio, this.cfg, this.outcome.leads);
    }
    await this.audio.resume();
    return this.audio;
  }

  /**
   * Starts (or resumes) playback, generating any narration it needs first. A run
   * started `voiceless` has every sound but the narrator and generates nothing;
   * resuming keeps the mode the run was started in. A run from the start holds its
   * first frame until all of that is ready, and until `ready` says yes when given:
   * Record asks the server for the day's video there, so not a frame plays before
   * the answer.
   */
  private async play(fromStart: boolean, voiceless = false, ready?: () => Promise<boolean>): Promise<boolean> {
    if (this.starting) return false;
    this.starting = true;
    $('#start').hidden = true;
    // Every Play and Record comes through here: the first one is what the hint asked for.
    this.hintDone();
    try {
      if (fromStart) {
        this.voiceless = voiceless;
        this.paused = true;
      }
      await this.unlock();
      if (fromStart) this.restart();
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
    // first frame (soundFlowing, takeVideo).
    if (!(await this.play(true, false, async () => (await this.soundFlowing()) && this.takeVideo()))) return;
    try {
      // Silent: a file with no sound track at all (docs/recording-and-export.md says why).
      this.recorder = new Recorder(this.canvas, this.cfg.sound.track === 'silent' ? null : this.audio!.stream);
    } catch (err) {
      this.flash(err instanceof Error ? err.message : String(err));
      return;
    }
    this.startTake();
  }

  /**
   * The page while a take runs: the panel off, Record as Stop & save, and over the preview the bar
   * with what is left and the one thing that spoils a take, said from the first frame.
   */
  private startTake(): void {
    this.hiddenAt = 0;
    document.body.classList.add('recording');
    $<HTMLFieldSetElement>('#controls').disabled = true;
    $('#rec-note').textContent = 'Keep this tab in front: a hidden tab stops drawing.';
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
    const name = `${slug(`${this.cfg.a.name} vs ${this.cfg.b.name}`)}-seed-${slug(this.cfg.seed)}.${rec.extension}`;
    download(blob, name);
    const entry = this.libraryEntry(name, rec.type, seconds, stoppedEarly);
    const saved = await addToLibrary(entry, this.account.account.id);
    if (saved.added) this.account.library.count++;
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

  /** What the library keeps of this run: the config replays it; the rest is for sorting and grouping. */
  private libraryEntry(fileName: string, type: string, seconds: number, stoppedEarly: boolean): NewVideo {
    const { a, b } = this.cfg;
    const winner = this.outcome.winner;
    return {
      game: 'ball-race',
      recordedAt: new Date().toISOString(),
      title: `${a.name} vs ${b.name}`,
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
        leadChanges: this.outcome.leadChanges,
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

  /** Generates both lines this run will say, unless they are already cached. */
  private async prepareVoice(): Promise<void> {
    if (!this.audio) return;
    const voice = voiceOf(this.cfg);
    const lines = plannedLines(this.cfg, this.outcome);
    if (!this.voices.missing(voice, lines).length) return;
    try {
      await this.voices.prepare(this.audio.ctx, voice, lines, (s) => this.setVoiceStatus(s));
      this.setVoiceStatus('Voice ready');
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
   * Whether this run has a narrator: not started with Play without voice, the sound set to
   * Narrator and music, and the plan including it.
   */
  private narrating(): boolean {
    return !this.voiceless && narrated(this.cfg) && this.features.narrator;
  }

  /** The winner line, as soon as the narrator is free: it never talks over (or cuts) the line before it. */
  private sayOutroWhenFree(): void {
    if (!this.outroPending || this.busy()) return;
    this.outroPending = false;
    const winner = this.world.teams.find((t) => t.id === this.world.winner);
    this.outroEnds = this.winnerAge + this.say(outroLine(this.cfg, winner?.name ?? '', this.world.winTime));
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
    // Dragging a slider fires dozens of changes: restart once it settles.
    window.clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => this.restart(), 180);
  }

  private setConfig(cfg: Config): void {
    this.cfg = cfg;
    $('#balance-note').hidden = true;
    this.save();
    this.panel.refresh();
    this.syncTopBlock();
    this.syncMatchup();
    this.syncSafeZones();
    this.restart();
  }

  private syncTopBlock(): void {
    $<HTMLInputElement>('#seed').value = this.cfg.seed;
    $<HTMLInputElement>('#video').value = String(this.cfg.timing.video);
    $('#video-out').textContent = `${this.cfg.timing.video} s`;
    $<HTMLInputElement>('#gap').value = String(this.cfg.timing.gap);
    $('#gap-out').textContent = gapLabel(this.cfg.timing.gap);
    $<HTMLInputElement>('#powers').checked = this.powers && this.features.powers;
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
    if (!f.looks.includes(cfg.look.skin)) cfg.look.skin = f.looks[0];
    if (!soundAllowed(f, cfg.sound.track)) {
      cfg.sound.track = (['music', 'silent', 'narrator'] as Sound[]).find((s) => soundAllowed(f, s)) ?? 'silent';
      // The winner card was planned for a winner line that no longer comes (pacing.ts).
      retime = true;
    }
    if (cfg.timing.video > f.maxSeconds) {
      cfg.timing.video = f.maxSeconds;
      retime = true;
    }
    return retime ? (balance(cfg) ?? cfg) : cfg;
  }

  /** Why the plan does not let this config be recorded, or null when it does. */
  private planProblem(): string | null {
    const f = this.features;
    const c = this.cfg;
    if (c.timing.video > f.maxSeconds) return `Your plan makes videos up to ${f.maxSeconds} s: set a shorter length under Video.`;
    if (!f.looks.includes(c.look.skin)) return 'That look is not in your plan: pick another under Video.';
    if (!soundAllowed(f, c.sound.track)) return `${SOUND_LABELS[c.sound.track]} is not in your plan: pick another sound under Video.`;
    if (!f.powers && [c.a, c.b].some((ball) => ball.special !== 'none' && ball.amount > 0)) {
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
  }

  /** The matchup card: each ball's name, colour, numbers and power, and its speed against the slower one. */
  private syncMatchup(): void {
    const slower = Math.max(1, Math.min(this.cfg.a.speed, this.cfg.b.speed));
    for (const key of ['a', 'b'] as const) {
      const ball = this.cfg[key];
      const sequence = SEQUENCES[ball.sequence];
      document.documentElement.style.setProperty(`--team-${key}`, ball.color);
      setText($(`#name-${key}`), ball.name || (key === 'a' ? 'Top ball' : 'Bottom ball'));
      const rule: (string | HTMLElement)[] = [Object.assign(document.createElement('span'), { textContent: sequence.label }), sequence.hint];
      const power = ball.amount ? POWER_WORDS[ball.special](ball.amount) : '';
      if (power) rule.push(Object.assign(document.createElement('span'), { className: 'power', textContent: power }));
      $(`#rule-${key}`).replaceChildren(...rule);
      const speed = $(`#speed-${key}`);
      setText(speed, `${(ball.speed / slower).toFixed(1)}×`);
      speed.title = `Starts at ${Math.round(ball.speed)} px/s, against ${Math.round(slower)} for the slower ball`;
    }
  }

  /**
   * The first frame of this run in every look, for the thumbnails of the look picker (without the
   * opening title, which would hide the look under its wash); then, drawn last so the still
   * canvas keeps it, the current look's as the video opens, title and all, which a looping video
   * fades into at the end.
   */
  private drawStills(): void {
    for (const skin of SKINS) {
      const cfg = { ...this.cfg, look: { ...this.cfg.look, skin } };
      this.still.reset(cfg);
      this.still.draw(createWorld(cfg), cfg, 0, { winner: 0, age: 0 });
      const tile = document.querySelector<HTMLCanvasElement>(`.look input[value="${skin}"] ~ canvas`);
      tile?.getContext('2d')?.drawImage(this.still.canvas, THUMB.x, THUMB.y, THUMB.w, THUMB.h, 0, 0, tile.width, tile.height);
    }
    this.still.reset(this.cfg);
    this.still.draw(createWorld(this.cfg), this.cfg, 0, { winner: 0, age: 0, opening: 1 });
  }

  /**
   * The account's saved config. One saved before accounts (under the bare key) is taken over by
   * the first account that opens the studio in this browser: on Vuk's computer, Vuk's.
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
      if (saved) return savedConfig(JSON.parse(saved));
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
  private loadDice(): boolean {
    try {
      return mergeConfig({ powers: false }, JSON.parse(localStorage.getItem(DICE_KEY) ?? '{}')).powers;
    } catch {
      return false;
    }
  }

  private saveDice(): void {
    try {
      localStorage.setItem(DICE_KEY, JSON.stringify({ powers: this.powers }));
    } catch {
      // Storage unavailable: the choice lasts until reload.
    }
  }

  // ── Matchups and prediction ──────────────────────────────────────────────

  /** Balances a matchup to the video length and shows it; says why when it cannot fit. */
  private loadMatchup(cfg: Config): void {
    const balanced = balance(cfg);
    this.setConfig(balanced ?? cfg);
    if (!balanced) this.explainUnbalanced(cfg);
  }

  /**
   * Rebalance (or Make it close): this race first, then new races of the same matchup, since a
   * seed's starting angles can decide whether the finish lands; then, if none does, why not.
   */
  private rebalance(): void {
    for (let i = 0; i < 9; i++) {
      const balanced = balance(i ? { ...this.cfg, seed: String(1 + Math.floor(Math.random() * 999_999)) } : this.cfg);
      if (balanced) {
        this.setConfig(balanced);
        if (i) this.flash('Balanced as a new race of the same matchup: this race could not land on time.');
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

  /** The dice: a brand-new matchup, balanced to the video length; a power now and then, if allowed. */
  private randomize(): void {
    const next = randomMatchup(String(1 + Math.floor(Math.random() * 999_999)), this.cfg, this.powers && this.features.powers);
    next.voice.script = '';
    this.setConfig(next);
  }

  /** Same matchup, a new race: new angles from a new seed, balanced again. */
  private reroll(): void {
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
    const video = videoSeconds(this.cfg, o.time);
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
      download(blob, `${slug(`${this.cfg.a.name} vs ${this.cfg.b.name}`)}.json`);
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
      else void this.play(true, this.voiceless);
    });
    $('#voiceless').addEventListener('click', () => void this.play(true, true));
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
          : `${this.phase === 'race' ? 'Racing' : this.phase === 'intro' ? 'Starting' : this.phase === 'slowmo' ? 'Slow motion' : 'Finished'}${this.cfg.sound.track === 'silent' ? ' · silent' : this.narrating() ? '' : ' · no voice'} · ${time} s`;
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
