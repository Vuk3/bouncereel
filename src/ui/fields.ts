import type { Config, Special } from '../config.ts';
import { MELODIES } from '../audio/music.ts';
import { autoScript } from '../audio/narration.ts';
import { COLORS } from '../sim/balance.ts';
import { MAX_BALLS } from '../sim/duel.ts';
import { SEQUENCES, formatBig, parseLayers } from '../sim/sequences.ts';

// The control panel's tabs, as data. Each field names a path into Config; the
// panel builds the inputs from this list. The matchup block above the tabs
// (dice, length, finish gap, sound, look) lives in app.html and app.ts.
//
// `live` fields take effect on the running video (looks, sound, words);
// every other change restarts the run, since it changes the simulation.

type When = (cfg: Config) => boolean;

interface Base {
  path: string;
  label: string;
  show?: When;
  live?: boolean;
  /** Small text under the input; may depend on the config. */
  hint?: string | ((cfg: Config) => string);
  /** Values shown as chips under the input, such as the layers as they will read on screen. */
  chips?: (cfg: Config) => string[];
}

export type Field =
  | (Base & { kind: 'range'; min: number; max: number; step: number; format?: (v: number) => string })
  | (Base & { kind: 'select'; options: (cfg: Config) => [value: string, label: string][] })
  | (Base & { kind: 'text'; placeholder?: string })
  | (Base & { kind: 'textarea'; placeholder: (cfg: Config) => string })
  | (Base & { kind: 'color'; swatches: readonly string[] })
  | (Base & { kind: 'check' });

export interface Section {
  id: string;
  title: string;
  /** A ball's section carries that ball's colour. */
  team?: 'a' | 'b';
  fields: Field[];
}

export interface Tab {
  id: string;
  title: string;
  sections: Section[];
}

const px = (v: number) => `${v} px`;
const pxs = (v: number) => `${v} px/s`;
const secs = (v: number) => `${v} s`;

const SPECIAL_LABELS: [Special, string][] = [
  ['none', 'No power'],
  ['faster', 'Speeds up'],
  ['slower', 'Slows down'],
  ['grow', 'Grows'],
  ['split', 'Splits into another ball'],
];

const AMOUNT_HINTS: Record<Special, string> = {
  none: '',
  faster: '% faster per floor hit',
  slower: '% slower per floor hit',
  grow: 'px bigger (radius) per floor hit',
  split: `new balls per floor hit, up to ${MAX_BALLS} in the box`,
};

function ball(key: 'a' | 'b', title: string): Section {
  return {
    id: key,
    title,
    team: key,
    fields: [
      { kind: 'text', path: `${key}.name`, label: 'Name' },
      { kind: 'color', path: `${key}.color`, label: 'Colour', swatches: COLORS },
      {
        kind: 'select',
        path: `${key}.sequence`,
        label: 'Damage per floor hit',
        options: () => Object.values(SEQUENCES).map((s) => [s.id, s.label]),
        hint: (c) => SEQUENCES[c[key].sequence].hint,
      },
      { kind: 'select', path: `${key}.special`, label: 'Power', options: () => SPECIAL_LABELS },
      {
        kind: 'range',
        path: `${key}.amount`,
        label: 'How much',
        min: 0,
        max: 20,
        step: 0.5,
        show: (c) => c[key].special !== 'none',
        hint: (c) => AMOUNT_HINTS[c[key].special],
      },
    ],
  };
}

function speed(key: 'a' | 'b', label: string): Field {
  return { kind: 'range', path: `${key}.speed`, label, min: 100, max: 3000, step: 1, format: (v) => pxs(Math.round(v)) };
}

export const TABS: Tab[] = [
  {
    id: 'balls',
    title: 'Balls',
    sections: [
      ball('a', 'Top ball'),
      ball('b', 'Bottom ball'),
      {
        id: 'layers',
        title: 'Layers',
        fields: [
          {
            kind: 'text',
            path: 'layers',
            label: 'Health of each layer, top first',
            placeholder: '1000, 1e10, 1e15',
            chips: (c) => parseLayers(c.layers).map((v) => formatBig(v, c.look.separator)),
            hint: (c) => (parseLayers(c.layers).length ? '' : 'No layers: straight to the finish line'),
          },
        ],
      },
    ],
  },
  {
    id: 'voice',
    title: 'Voice',
    sections: [
      {
        id: 'voice',
        title: 'Narrator',
        // The voices, each with a way to hear it, are drawn above these by app.ts (buildVoiceBlock).
        fields: [
          { kind: 'textarea', path: 'voice.script', label: 'Opening (leave empty for the automatic one)', live: true, placeholder: autoScript },
          { kind: 'text', path: 'voice.outro', label: 'Winner line', live: true, hint: '{winner} and {time} are filled in. Leave it empty for none.' },
        ],
      },
    ],
  },
  {
    id: 'sound',
    title: 'Sound',
    sections: [
      {
        id: 'sound',
        title: 'Music',
        fields: [
          {
            kind: 'select',
            path: 'sound.melody',
            label: 'Floor hits play',
            live: true,
            options: () => [...Object.entries(MELODIES).map(([id, m]): [string, string] => [id, m.label]), ['scale', 'A scale, up and down']],
          },
          {
            kind: 'select',
            path: 'sound.timbre',
            label: 'Instrument',
            live: true,
            options: () => [
              ['marimba', 'Marimba'],
              ['bell', 'Bell'],
              ['pluck', 'Pluck'],
              ['chip', 'Chiptune'],
            ],
          },
          { kind: 'range', path: 'sound.volume', label: 'Volume', min: 0, max: 1, step: 0.05, live: true, format: (v) => `${Math.round(v * 100)} %` },
        ],
      },
    ],
  },
  {
    id: 'more',
    title: 'More',
    sections: [
      {
        id: 'ending',
        title: 'Video',
        fields: [
          { kind: 'text', path: 'look.cta', label: 'Last line on the winner card', placeholder: 'Did you call it? Comment below!', live: true, hint: 'Leave it empty for none' },
          { kind: 'check', path: 'look.loop', label: 'End on the first frame, so the video loops without a cut', live: true },
          { kind: 'range', path: 'timing.startDelay', label: 'Hold before the start', min: 0, max: 3, step: 0.1, format: secs, live: true },
          { kind: 'range', path: 'timing.hold', label: 'Winner card, at least', min: 1.5, max: 8, step: 0.5, format: secs, hint: 'Longer when the video length or the winner line needs it' },
          {
            kind: 'select',
            path: 'look.separator',
            label: 'Big numbers',
            live: true,
            options: () => [
              ['.', '1.000.000 (as in the format)'],
              [',', '1,000,000'],
            ],
          },
          { kind: 'check', path: 'look.safeZones', label: 'Show where TikTok, Reels and Shorts put their buttons (not recorded)', live: true },
        ],
      },
      {
        id: 'physics',
        title: 'Physics',
        fields: [
          { ...speed('a', 'Top ball speed'), hint: 'Balancing sets both speeds when a matchup loads' },
          speed('b', 'Bottom ball speed'),
          { kind: 'range', path: 'a.radius', label: 'Top ball size', min: 8, max: 80, step: 1, format: px },
          { kind: 'range', path: 'b.radius', label: 'Bottom ball size', min: 8, max: 80, step: 1, format: px },
          { kind: 'range', path: 'physics.gravity', label: 'Gravity', min: 0, max: 3000, step: 50, format: (v) => `${v} px/s²`, hint: '0 is the format: straight lines, constant speed' },
          { kind: 'range', path: 'physics.maxSpeed', label: 'Speed limit', min: 1000, max: 9000, step: 100, format: pxs },
        ],
      },
      { id: 'files', title: 'Seed and files', fields: [] },
    ],
  },
];
