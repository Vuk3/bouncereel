import type { Timbre } from '../config.ts';
import { createRng } from '../sim/rng.ts';
import { midiToHz } from './music.ts';

// Every sound is synthesised on the spot, nothing is a sample. All of it ends
// in `master`, which feeds both the speakers and `stream`: the recorder takes
// that stream, so what you hear is exactly what the video gets.
//
//   notes, ticks   ─┐                                           ┌─▶ speakers
//   cracks          ┼─▶ sfx ─▶ compressor ─┐                    │
//   fanfare, sting ─┘                      ├─▶ master ─▶ limiter
//   narration ──────────────────▶ voice ───┘                    └─▶ stream (recorder)

/** A run with eight balls can bounce hundreds of times a second; past this many ringing notes, new ones are skipped. */
const MAX_VOICES = 48;

/** The recorded sounds a Goal Rush plays (public/sounds/): the referee's whistle and the stadium going up at a goal. */
export const MATCH_SOUNDS = ['whistle', 'crowd-goal'] as const;

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly stream: MediaStream;
  private readonly master: GainNode;
  private readonly sfx: GainNode;
  private readonly voice: GainNode;
  private readonly noise: AudioBuffer;
  private active = 0;
  private narration: AudioBufferSourceNode | null = null;
  /** Recorded sounds (public/sounds/), decoded once: a Goal Rush's referee and stadium (loadSounds). */
  private readonly samples = new Map<string, AudioBuffer>();

  constructor() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // Glues many quiet bounces into one level and keeps a 20-note pile-up from clipping.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value = 12;
    glue.ratio.value = 4;
    glue.attack.value = 0.003;
    glue.release.value = 0.2;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;

    this.sfx = ctx.createGain();
    this.voice = ctx.createGain();
    this.voice.gain.value = 1.1;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;

    this.sfx.connect(glue).connect(this.master);
    this.voice.connect(this.master);
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
    const tap = ctx.createMediaStreamDestination();
    limiter.connect(tap);
    this.stream = tap.stream;

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    const rng = createRng('noise');
    for (let i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;
  }

  resume(): Promise<void> {
    return this.ctx.resume();
  }

  /**
   * Fetches and decodes recorded sounds from public/sounds/ (`<name>.m4a`), once each, before a
   * game that uses them plays: a recording must not start without them. One that fails to come is
   * left out, and its sound falls back to the synthesised one.
   */
  async loadSounds(names: readonly string[]): Promise<void> {
    await Promise.all(
      names
        .filter((name) => !this.samples.has(name))
        .map(async (name) => {
          try {
            const res = await fetch(`/sounds/${name}.m4a`);
            if (!res.ok) return;
            this.samples.set(name, await this.ctx.decodeAudioData(await res.arrayBuffer()));
          } catch {
            // The synthesised sound plays instead.
          }
        }),
    );
  }

  /**
   * A recorded sound, or `length` seconds of it from its start, at `level`, ending in a short fade
   * so a cut blast never clicks. False when it is not loaded.
   */
  private sample(name: string, t: number, level: number, pan: number, length?: number): boolean {
    const buffer = this.samples.get(name);
    if (!buffer) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    const end = t + Math.min(length ?? buffer.duration, buffer.duration);
    gain.gain.setValueAtTime(level, t);
    gain.gain.setValueAtTime(level, Math.max(t, end - 0.05));
    gain.gain.linearRampToValueAtTime(0, end);
    src.connect(gain).connect(this.channel(pan));
    src.start(t, 0, end - t);
    this.track(src);
    return true;
  }

  /**
   * Resolves true once the audio clock moves, false if it has not after `timeout` ms. A context
   * says "running" before its device does: on a Mac whose sound output had been idle,
   * `currentTime` stayed at 0 for 2.3 s (measured). A recorder started then has no sound to pair
   * the first frames with, and Chrome's MP4 writer drops them: the file began seconds into the
   * race. Record waits on this (app.ts).
   */
  async flowing(timeout = 4000): Promise<boolean> {
    const from = this.ctx.currentTime;
    const until = performance.now() + timeout;
    while (this.ctx.currentTime <= from) {
      if (performance.now() > until) return false;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return true;
  }

  set volume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** One pitched bounce. velocity 0..1, pan −1..1. */
  note(midi: number, velocity: number, timbre: Timbre, pan: number): void {
    if (this.active >= MAX_VOICES) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.004;
    const f = midiToHz(midi);
    const out = this.channel(pan);
    const v = velocity;

    switch (timbre) {
      case 'marimba': {
        // A struck bar: the fundamental rings, the 4th partial is the short "tock".
        this.osc('sine', f, t, 0.75, envelope(out, t, v * 0.55, 0.004, 0.7));
        this.osc('sine', f * 4, t, 0.12, envelope(out, t, v * 0.16, 0.002, 0.09));
        break;
      }
      case 'bell': {
        // FM bell: a 3.5× modulator whose depth dies away leaves a clean ring.
        const carrier = ctx.createOscillator();
        carrier.frequency.value = f;
        const mod = ctx.createOscillator();
        mod.frequency.value = f * 3.5;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(f * 2.2, t);
        depth.gain.exponentialRampToValueAtTime(1, t + 1.2);
        mod.connect(depth).connect(carrier.frequency);
        carrier.connect(envelope(out, t, v * 0.36, 0.003, 1.5));
        this.start(t, 1.6, carrier, mod);
        this.osc('sine', f * 2, t, 0.45, envelope(out, t, v * 0.1, 0.003, 0.4));
        break;
      }
      case 'pluck': {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 2;
        filter.frequency.setValueAtTime(5200, t);
        filter.frequency.exponentialRampToValueAtTime(700, t + 0.35);
        filter.connect(envelope(out, t, v * 0.5, 0.003, 0.45));
        this.osc('triangle', f, t, 0.5, filter);
        const saw = ctx.createGain();
        saw.gain.value = 0.3;
        saw.connect(filter);
        this.osc('sawtooth', f * 1.003, t, 0.5, saw);
        break;
      }
      case 'chip': {
        // Square waves are loud for their level: a third of the others' gain.
        this.osc('square', f, t, 0.25, envelope(out, t, v * 0.16, 0.002, 0.22));
        break;
      }
    }
  }

  /**
   * The lead changing hands for good (the video's LEAD CHANGE, src/render): two glassy pings a
   * fifth apart, C6 and then G6 85 ms later, each sliding up into its pitch over 30 ms, with an
   * inharmonic 2.76× partial. The melodies reach these pitches (the scale runs to C7, and the last
   * layer's climb lifts a tune an octave), but no note of theirs slides or rings like this, in
   * any instrument. Like the fanfare it never waits for the voice cap: the picture flashes either way.
   */
  sting(): void {
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.004;
    for (const [midi, after] of [
      [84, 0],
      [91, 0.085],
    ]) {
      const t = now + after;
      const f = midiToHz(midi);
      const out = envelope(this.channel(0), t, 0.3, 0.004, 0.55);
      for (const [ratio, level] of [
        [1, 1],
        [2.76, 0.35],
      ]) {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(f * ratio * 0.94, t);
        o.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.03);
        const gain = ctx.createGain();
        gain.gain.value = level;
        o.connect(gain).connect(out);
        this.start(t, 0.6, o);
      }
    }
  }

  /** Ball against ball: a dry tick that does not advance the melody. */
  tick(velocity: number, pan: number): void {
    if (this.active >= MAX_VOICES) return;
    const t = this.ctx.currentTime + 0.004;
    this.osc('sine', 1500, t, 0.05, envelope(this.channel(pan), t, velocity * 0.12, 0.001, 0.04));
  }

  /** A brick taking a hit, or shattering. */
  crack(velocity: number, broken: boolean, pan: number): void {
    if (this.active >= MAX_VOICES) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.004;
    const out = this.channel(pan);
    const len = broken ? 0.45 : 0.1;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = broken ? 'lowpass' : 'bandpass';
    filter.frequency.value = broken ? 2600 : 1800;
    filter.Q.value = broken ? 0.7 : 0.9;
    src.connect(filter).connect(envelope(out, t, velocity * (broken ? 0.6 : 0.32), 0.002, len));
    src.start(t, (t * 7.3) % 0.5, len + 0.05);
    this.track(src);

    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(broken ? 120 : 160, t);
    thump.frequency.exponentialRampToValueAtTime(broken ? 36 : 60, t + len);
    thump.connect(envelope(out, t, velocity * (broken ? 0.8 : 0.4), 0.002, len));
    this.start(t, len + 0.05, thump);
  }

  /**
   * A heartbeat, lub then dub 170 ms later (an Arena Clash's flag in danger): each a sine falling
   * from 150 to 50 Hz, with its octave above for phone speakers, which give out below about
   * 200 Hz and would leave the beat silent. It never waits for the voice cap, as the picture
   * beats either way.
   */
  heartbeat(): void {
    const now = this.ctx.currentTime + 0.004;
    for (const [after, level] of [
      [0, 0.7],
      [0.17, 0.45],
    ]) {
      const t = now + after;
      for (const [ratio, part] of [
        [1, 1],
        [2, 0.35],
      ]) {
        const o = this.ctx.createOscillator();
        o.frequency.setValueAtTime(150 * ratio, t);
        o.frequency.exponentialRampToValueAtTime(50 * ratio, t + 0.14);
        o.connect(envelope(this.channel(0), t, level * part, 0.004, 0.15));
        this.start(t, 0.2, o);
      }
    }
  }

  /**
   * A referee's whistle (Goal Rush): a pea whistle's 2.9 kHz with the pea's rattle, a fast flutter
   * of its level, and a breath of noise round the pitch. `blasts` are their lengths in seconds, 0.12 s
   * apart: one short for a kick-off, two for half time, three for full time, the last long.
   */
  whistle(blasts: number[]): void {
    const ctx = this.ctx;
    let t = ctx.currentTime + 0.01;
    // A real referee's pea whistle when it is loaded (public/sounds/whistle.m4a): each blast its
    // first `length` seconds. The synthesised one below read as a toy to the owner.
    if (this.samples.has('whistle')) {
      for (const length of blasts) {
        this.sample('whistle', t, 0.55, 0, length);
        t += length + 0.12;
      }
      return;
    }
    for (const length of blasts) {
      const out = this.channel(0);
      const level = ctx.createGain();
      level.gain.setValueAtTime(0, t);
      level.gain.linearRampToValueAtTime(0.16, t + 0.015);
      level.gain.setValueAtTime(0.16, t + length - 0.04);
      level.gain.linearRampToValueAtTime(0, t + length);
      level.connect(out);
      const trill = ctx.createGain();
      trill.gain.value = 0.6;
      const pea = ctx.createOscillator();
      pea.frequency.value = 38;
      const depth = ctx.createGain();
      depth.gain.value = 0.4;
      pea.connect(depth).connect(trill.gain);
      trill.connect(level);
      const tone = ctx.createOscillator();
      tone.frequency.setValueAtTime(2750, t);
      tone.frequency.linearRampToValueAtTime(2950, t + 0.05);
      tone.connect(trill);
      const air = ctx.createBufferSource();
      air.buffer = this.noise;
      air.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2900;
      band.Q.value = 6;
      const airLevel = ctx.createGain();
      airLevel.gain.value = 0.35;
      air.connect(band).connect(airLevel).connect(trill);
      this.start(t, length + 0.02, tone, pea, air);
      t += length + 0.12;
    }
  }

  /**
   * A goal (Goal Rush), as a stadium sounds one. The referee's blast is the whistle's, played with
   * it (sonify.ts). Here, as the ball hits the net: a thud, a sine falling from 150 Hz to 38 over
   * half a second on a burst of low noise, and the stadium going up: a recording of a real crowd's
   * reaction to a goal (public/sounds/crowd-goal.m4a: its burst in the first half second, full for
   * about a second and gone by two; longer read as a stall to the owner).
   * Synthesised stadiums (filtered noise, horns, flares) read as rustling and as fake to the owner;
   * one is left only for when the recording has not loaded: noise through the bands where voices
   * shout (350, 700, 1000 Hz), nothing above 1.2 kHz. It never waits for the voice cap: the picture
   * celebrates either way.
   */
  goal(pan: number): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const centre = this.channel(0);
    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(150, t);
    boom.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    boom.connect(envelope(centre, t, 0.7, 0.003, 0.55));
    this.start(t, 0.6, boom);
    this.burst(t, 'lowpass', 300, 0.45, 0.12, centre);
    if (this.sample('crowd-goal', t, 0.9, pan * 0.3)) return;
    const side = this.channel(pan * 0.4);
    const crowd = ctx.createBufferSource();
    crowd.buffer = this.noise;
    crowd.loop = true;
    const level = ctx.createGain();
    level.gain.setValueAtTime(0.0001, t);
    level.gain.exponentialRampToValueAtTime(0.4, t + 0.25);
    level.gain.setValueAtTime(0.4, t + 0.6);
    level.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    const top = ctx.createBiquadFilter();
    top.type = 'lowpass';
    top.frequency.value = 1200;
    top.connect(level).connect(side);
    for (const f of [350, 700, 1000]) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(f * 0.8, t);
      band.frequency.exponentialRampToValueAtTime(f, t + 0.3);
      band.Q.value = 2.5;
      crowd.connect(band).connect(top);
    }
    crowd.start(t, (t * 3.1) % 0.5);
    crowd.stop(t + 1.9);
    this.track(crowd);
  }

  /** A burst of noise through one filter, shaped attack-then-decay: a thud's body. */
  private burst(t: number, type: BiquadFilterType, frequency: number, peak: number, decay: number, out: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    src.connect(filter).connect(envelope(out, t, peak, 0.001, decay));
    src.start(t, (t * 7.3) % 0.5, decay + 0.05);
    this.track(src);
  }

  /** Ball against ball in a match: a kick's thud, 110 Hz falling to 45, with a click on top for phone speakers. */
  kick(velocity: number, pan: number): void {
    if (this.active >= MAX_VOICES) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.004;
    const thud = ctx.createOscillator();
    thud.frequency.setValueAtTime(110, t);
    thud.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    thud.connect(envelope(this.channel(pan), t, velocity * 0.7, 0.002, 0.14));
    this.start(t, 0.18, thud);
    this.osc('triangle', 900, t, 0.04, envelope(this.channel(pan), t, velocity * 0.12, 0.001, 0.03));
  }

  /** A ball off the post: a struck metal tube, three inharmonic partials ringing out over half a second. */
  clang(pan: number): void {
    const t = this.ctx.currentTime + 0.004;
    for (const [f, level, decay] of [
      [523, 0.22, 0.6],
      [1420, 0.12, 0.35],
      [2710, 0.07, 0.2],
    ]) {
      this.osc('sine', f, t, decay + 0.05, envelope(this.channel(pan), t, level, 0.002, decay));
    }
  }

  /** The win: an arpeggio into a held major chord over a noise swell. */
  fanfare(): void {
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.01;
    [72, 76, 79, 84, 88].forEach((m, i) => {
      const t = now + i * 0.09;
      this.osc('triangle', midiToHz(m), t, 0.6, envelope(this.channel(0), t, 0.32, 0.003, 0.5));
    });
    const chordAt = now + 0.45;
    for (const m of [60, 64, 67, 72, 76]) {
      this.osc('sine', midiToHz(m), chordAt, 2.4, envelope(this.channel(0), chordAt, 0.13, 0.04, 2.3));
      this.osc('triangle', midiToHz(m) * 1.004, chordAt, 2.4, envelope(this.channel(0), chordAt, 0.06, 0.04, 2.3));
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const sweep = ctx.createBiquadFilter();
    sweep.type = 'bandpass';
    sweep.Q.value = 1.2;
    sweep.frequency.setValueAtTime(400, now);
    sweep.frequency.exponentialRampToValueAtTime(6000, now + 0.7);
    src.connect(sweep).connect(envelope(this.channel(0), now, 0.25, 0.3, 0.6));
    src.start(now);
    src.stop(now + 1);
    this.track(src);
  }

  /** Plays a narration clip over everything, ducking the bounces under it. Returns its length in seconds. */
  speak(buffer: AudioBuffer): number {
    this.silence();
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.voice);
    const now = ctx.currentTime;
    src.start(now + 0.02);
    this.sfx.gain.setTargetAtTime(0.4, now, 0.05);
    this.sfx.gain.setTargetAtTime(1, now + buffer.duration, 0.25);
    src.onended = () => {
      if (this.narration === src) this.narration = null;
    };
    this.narration = src;
    return buffer.duration;
  }

  /** Whether a narration clip is still playing: the winner line waits for it rather than talk over it. */
  get speaking(): boolean {
    return this.narration !== null;
  }

  silence(): void {
    this.narration?.stop();
    this.narration = null;
    this.sfx.gain.cancelScheduledValues(this.ctx.currentTime);
    this.sfx.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
  }

  private channel(pan: number): AudioNode {
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(this.sfx);
    return panner;
  }

  private osc(type: OscillatorType, freq: number, t: number, length: number, to: AudioNode): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(to);
    this.start(t, length, o);
  }

  private start(t: number, length: number, ...nodes: AudioScheduledSourceNode[]): void {
    for (const n of nodes) {
      n.start(t);
      n.stop(t + length);
    }
    this.track(nodes[0]);
  }

  private track(node: AudioScheduledSourceNode): void {
    this.active++;
    node.onended = () => {
      this.active--;
      node.disconnect();
    };
  }
}

/** A gain node shaped as attack-then-exponential-decay, connected to `out`. */
function envelope(out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = out.context.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}
