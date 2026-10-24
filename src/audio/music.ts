import type { Config, MelodyId } from '../config.ts';

// Which note a bounce plays. The satisfying-bounce format works because the
// notes form a tune or a scale, never random pitches: every bounce advances
// one shared position, so whichever ball hits next plays the next note.

/** Public-domain tunes only (Beethoven, the 18th-century French air), so a video is never claimed. */
export const MELODIES: Record<Exclude<MelodyId, 'scale'>, { label: string; notes: number[] }> = {
  ode: {
    label: 'Ode to Joy',
    // Beethoven, 9th symphony, in C, an octave up: C5–G5 is where the marimba sings.
    notes: [
      64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62,
      64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60,
      62, 62, 64, 60, 62, 64, 65, 64, 60, 62, 64, 65, 64, 62, 60, 62, 55,
      64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60,
    ].map((n) => n + 12),
  },
  elise: {
    label: 'Für Elise',
    // The right hand of the A section, as written (E5 down to C4).
    notes: [
      76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 68, 71, 72,
      64, 76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 72, 71, 69,
    ],
  },
  twinkle: {
    label: 'Twinkle Twinkle',
    notes: [
      60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60,
      67, 67, 65, 65, 64, 64, 62, 67, 67, 65, 65, 64, 64, 62,
      60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60,
    ].map((n) => n + 12),
  },
};

/** Major pentatonic: no two notes clash, so overlapping bounces still sound like music. */
const PENTATONIC = [0, 2, 4, 7, 9];

export function pentatonic(step: number, root: number): number {
  const octave = Math.floor(step / 5);
  return root + 12 * octave + PENTATONIC[((step % 5) + 5) % 5];
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export class Music {
  private index = 0;
  private readonly sound: Config['sound'];

  constructor(sound: Config['sound']) {
    this.sound = sound;
  }

  /** The MIDI note for the next floor hit, whichever box it came from. */
  next(): number {
    const i = this.index++;
    if (this.sound.melody === 'scale') {
      // Up two octaves and back down: C5 … C7 … C5.
      const step = i % 20;
      return pentatonic(step <= 10 ? step : 20 - step, 72);
    }
    const notes = MELODIES[this.sound.melody].notes;
    return notes[i % notes.length];
  }
}
