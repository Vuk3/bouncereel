import type { Config } from '../config.ts';
import type { SimEvent } from '../sim/types.ts';
import type { Outcome, World } from '../sim/world.ts';
import type { AudioEngine } from './engine.ts';
import { Music } from './music.ts';

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

  constructor(audio: AudioEngine, cfg: Config, leads: Outcome['leads']) {
    this.audio = audio;
    this.music = new Music(cfg.sound);
    this.leads = leads;
  }

  reset(cfg: Config, leads: Outcome['leads']): void {
    this.music = new Music(cfg.sound);
    this.leads = leads;
    this.lead = 0;
  }

  /** A frame's events from `world`, and the sting when the race reaches a lead change the picture marks. */
  play(events: SimEvent[], cfg: Config, world: World): void {
    // More than three melody notes in one 16 ms frame is a smear, not a tune
    // (a box full of split balls hits ~100 times a second); the rest stay
    // silent and the melody keeps its shape.
    let notes = 0;
    let ticks = 0;
    for (const e of events) {
      switch (e.type) {
        case 'hit':
          // The bottom box an octave lower: two voices of one tune, told apart by ear.
          if (notes++ < 3) this.audio.note(this.music.next() - (e.team === 1 ? 12 : 0) + climb(world, e), 0.85, cfg.sound.timbre, e.team === 0 ? -0.15 : 0.15);
          if (e.broken) this.audio.crack(1, true, 0);
          break;
        case 'wall':
          if (ticks++ < 2) this.audio.tick(0.5, 0);
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
