import type { Config } from '../config.ts';
import { W } from '../layout.ts';
import { HEARTBEAT, STRINGS, inDanger, type BattleEvent, type BattleWorld } from '../sim/battle.ts';
import type { SimEvent } from '../sim/types.ts';
import type { Outcome, World } from '../sim/world.ts';
import type { AudioEngine } from './engine.ts';
import { Music, pentatonic } from './music.ts';

/**
 * A crowd's notes (Contestant.count): a hundred balls hit about a hundred times a second, and three
 * notes a frame of that is a wall of sound the narrator drowns in. At most one note this often (race
 * seconds), this much quieter than a lone ball's, and nothing for its bounces off the walls; a
 * layer breaking still cracks.
 */
const CROWD_NOTE_GAP = 0.12;
const CROWD_VELOCITY = 0.4;
/** Frames between two plucks of strings being cut (Sonifier.battle): twenty a second, a run of notes and not a buzz. */
const CUT_FRAMES = 3;
/** Steps of the pentatonic scale a flag's strings span, from C4 with a hundred or more to C7 with none: three octaves. */
const CUT_STEPS = 15;

/**
 * Turns simulation events into sound, once per rendered frame with that
 * frame's events, so sound and picture land on the same frame. Only floor
 * hits play the melody (they are what scores); walls are a quiet tick.
 */
export class Sonifier {
  private music: Music;
  private readonly audio: AudioEngine;
  /** The lead changes the video marks (Outcome.leads), and the next one to reach. */
  private leads: Outcome['leads'];
  private lead = 0;
  /** Per team, the race time a crowd's last note played (CROWD_NOTE_GAP). */
  private crowdNote = [-Infinity, -Infinity];
  /** Frames until strings being cut may be plucked again (CUT_FRAMES). */
  private cutWait = 0;
  /** The last whole HEARTBEAT of a battle reached: a beat plays as the next is passed with a flag in danger. */
  private beat = -1;

  constructor(audio: AudioEngine, cfg: Config, leads: Outcome['leads']) {
    this.audio = audio;
    this.music = new Music(cfg.sound);
    this.leads = leads;
  }

  reset(cfg: Config, leads: Outcome['leads']): void {
    this.music = new Music(cfg.sound);
    this.leads = leads;
    this.lead = 0;
    this.crowdNote = [-Infinity, -Infinity];
    this.cutWait = 0;
    this.beat = -1;
  }

  /** A frame's events from `world`, and the sting when the race reaches a lead change the picture marks. */
  play(events: SimEvent[], cfg: Config, world: World): void {
    // More than three melody notes in one 16 ms frame is a smear, not a tune
    // (a box full of split balls hits ~100 times a second); the rest stay
    // silent and the melody keeps its shape.
    let notes = 0;
    let ticks = 0;
    for (const e of events) {
      const crowd = e.type !== 'timeout' && world.teams[e.team].rule.count > 1;
      switch (e.type) {
        case 'hit': {
          if (e.broken) this.audio.crack(1, true, 0);
          if (crowd) {
            if (world.time - this.crowdNote[e.team] < CROWD_NOTE_GAP) break;
            this.crowdNote[e.team] = world.time;
          }
          // The bottom box an octave lower: two voices of one tune, told apart by ear.
          if (notes++ < 3) this.audio.note(this.music.next() - (e.team === 1 ? 12 : 0) + climb(world, e), crowd ? CROWD_VELOCITY : 0.85, cfg.sound.timbre, e.team === 0 ? -0.15 : 0.15);
          break;
        }
        case 'wall':
          if (!crowd && ticks++ < 2) this.audio.tick(0.5, 0);
          break;
        case 'finish':
          if (e.place === 1) this.audio.fanfare();
          break;
        case 'timeout':
          this.audio.fanfare();
          break;
      }
    }
    while (this.lead < this.leads.length && this.leads[this.lead].at <= world.time) {
      this.lead++;
      this.audio.sting();
    }
  }

  /**
   * An Arena Clash frame's events: a bounce off the ring plays the melody (it always ties strings,
   * which are what a bounce wins), two balls meeting tick, a flag out shatters, the win is the
   * fanfare; each panned to where it happens. Strings being cut are plucked: one note at
   * most every CUT_FRAMES frames however many go, quiet under the tune, climbing the scale as the
   * flag's strings run out, so a fan being swept is a run up a harp and its last strings the top
   * of it. As with the race, at most three notes and two ticks a frame. While a flag is in danger
   * (DANGER) a heart beats, on the whole HEARTBEATs of the battle's clock, the beats the renderer
   * pulses its count on.
   */
  battle(events: BattleEvent[], cfg: Config, world: BattleWorld): void {
    let notes = 0;
    let ticks = 0;
    let cut: Extract<BattleEvent, { type: 'cut' }> | null = null;
    const pan = (x: number) => ((x - W / 2) / (W / 2)) * 0.5;
    for (const e of events) {
      switch (e.type) {
        case 'tie':
          if (notes++ < 3) this.audio.note(this.music.next(), 0.8, cfg.sound.timbre, pan(e.x));
          break;
        case 'clash':
          if (ticks++ < 2) this.audio.tick(0.45, pan(e.x));
          break;
        case 'cut':
          // The flag nearest its end is the one to hear.
          if (!cut || e.left < cut.left) cut = e;
          break;
        case 'out':
          this.audio.crack(1, true, pan(e.x));
          break;
        case 'win':
          this.audio.fanfare();
          break;
      }
    }
    if (this.cutWait > 0) this.cutWait--;
    if (cut && this.cutWait === 0) {
      this.cutWait = CUT_FRAMES;
      this.audio.note(pentatonic(CUT_STEPS - Math.ceil((Math.min(STRINGS, cut.left) / STRINGS) * CUT_STEPS), 60), 0.3, 'pluck', pan(cut.x));
    }
    const beat = Math.floor(world.time / HEARTBEAT);
    if (beat > this.beat && world.winner === null && world.flags.some(inDanger)) this.audio.heartbeat();
    this.beat = beat;
  }
}

/**
 * Semitones a hit's note climbs on the team's last layer: one for every whole twelfth of the
 * layer gone, so the octave only for the hit that breaks it (or leaves under 0.1 %), and the tune
 * rises as the end nears (the renderer's last-layer glow grows the same way). Most of the climb
 * comes in the last few hits: a sequence's last terms are its biggest.
 */
function climb(world: World, e: Extract<SimEvent, { type: 'hit' }>): number {
  const layers = world.teams[e.team].layers;
  if (e.layer !== layers.length - 1) return 0;
  const last = layers[e.layer];
  return Math.floor(12 * (1 - Number((last.hp * 1000n) / last.max) / 1000));
}
