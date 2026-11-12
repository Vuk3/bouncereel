import { country, flagName, type Country } from '../battle/countries.ts';
import type { Config, Contestant } from '../config.ts';
import { fillTemplate, spokenName, spokenOutro } from '../config.ts';
import type { BattleOutcome } from '../sim/battle.ts';
import { SEQUENCES, strengthSaid } from '../sim/sequences.ts';
import type { Outcome } from '../sim/world.ts';
import { configQuestion, openingDraws } from './opening.ts';

// What the narrator says, and turning it into audio. Two lines: a short opening that says how
// the matchup works, and the winner at the end; nothing while the race or the battle runs, which
// the picture tells better (the format's channels have no narrator at all). The simulation is
// deterministic, so every line is known before a run starts (predict()): a recording first
// generates them, then plays each as its moment comes.
//
// The voice is Kokoro, an open model (Apache 2.0) that runs in the browser: free, and the words
// never leave the computer.

/** Appended to a ball's sentence in the opening. */
const SPECIALS: Record<Contestant['special'], string> = {
  none: '',
  faster: ', and it speeds up',
  slower: ', and it slows down',
  grow: ', and it grows',
  split: ', and it multiplies',
};

/** The same, as a sentence of its own when both balls share their numbers. */
const OWN: Record<Contestant['special'], string> = {
  none: '',
  faster: 'gets faster',
  slower: 'gets slower',
  grow: 'gets bigger',
  split: 'multiplies',
};

/** How the opening starts: both names, said one of these ways. */
const STARTS = ['{a} versus {b}!', "It's {a} against {b}!", '{a} takes on {b}!', '{a} and {b}, head to head!', 'Next up: {a} versus {b}!'];

/** "Fibonacci Ball" → "Fibonacci": the short form reads better mid-sentence. */
export function shortName(name: string): string {
  return name.replace(/\s+ball$/i, '').trim() || name;
}


/**
 * The opening: who is racing, one clause on what each ball does, one fact,
 * and a question for the comments. It never explains the floor, the layers or
 * the finish line: everyone gets that from the picture within a second.
 * About 10–12 seconds read aloud. How it starts, the fact and the question are
 * picked by the seed, so a new race of the same matchup sounds a little different.
 */
export function autoScript(cfg: Config): string {
  const { a, b } = cfg;
  const draws = openingDraws(cfg.seed);
  const pace = (c: Contestant, other: Contestant) => {
    // Not when the name or the special already says it ("Slow Factorial", a ball that slows down),
    // nor for a crowd, whose number is the story.
    if (/\b(slow|fast)\b/i.test(c.name) || c.special === 'slower' || c.count > 1) return '';
    const ratio = other.speed / c.speed;
    return ratio >= 2.5 ? ", but it's much slower" : ratio >= 1.4 ? ', but slower' : '';
  };
  const hasSpecial = (c: Contestant) => c.special !== 'none' && c.amount > 0;
  // What a ball does, in one clause: its sequence's brief; Always the same, as hard as it hits.
  const brief = (c: Contestant) => (c.sequence === 'ones' ? `always hits for ${strengthSaid(c.strength)}` : SEQUENCES[c.sequence].brief);
  // A crowd is one subject for its sentence: "Each of the 100 Millionaire Balls hits for a million".
  const who = (c: Contestant) => (c.count > 1 ? `Each of the ${spokenName(c.name)}` : shortName(spokenName(c.name)));
  const balls =
    a.sequence === b.sequence
      ? [
          `Both hit with ${SEQUENCES[a.sequence].label} numbers.`,
          [a, b]
            .filter(hasSpecial)
            .map((c) => `${shortName(spokenName(c.name))} ${OWN[c.special]}`)
            .join(', ')
            .replace(/^(.)/, (m) => m.toUpperCase()),
        ]
      : [a, b].map((c, i) => `${who(c)} ${brief(c)}${pace(c, i ? a : b)}${hasSpecial(c) ? SPECIALS[c.special] : ''}.`);
  // A fact about a ball whose name says its numbers ("Fibonacci Ball"); a "Multiplying Ball" counting
  // in secret would make a fact about counting sound like it came from nowhere.
  const named = [a, b].filter((c) => SEQUENCES[c.sequence].noun && c.name.includes(SEQUENCES[c.sequence].noun));
  const pool = named.length ? named : [a, b];
  const facts = SEQUENCES[pool[Math.floor(draws.ball * pool.length)].sequence].facts;
  const fact = facts[Math.floor(draws.fact * facts.length)];
  const start = fillTemplate(STARTS[Math.floor(draws.start * STARTS.length)], { a: spokenName(a.name), b: spokenName(b.name) });
  return [start, ...balls.filter(Boolean).map((r) => (/[.!?]$/.test(r) ? r : `${r}.`)), fact, configQuestion(cfg)].join(' ');
}

export function introLine(cfg: Config): string {
  return cfg.voice.script.trim() || (cfg.game === 'arena-clash' ? battleScript(cfg) : autoScript(cfg));
}

// ── Arena Clash ────────────────────────────────────────────────────────────

const NUMBERS = ['', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
/**
 * The battle's rule in one sentence. A race's opening never explains the floor or the layers; a
 * battle's does once, since that a flag with no strings is out is the one thing the picture does
 * not say in its first second.
 */
const BATTLE_RULES = ["Cut every rival's strings to win.", 'Lose all your strings and you are out.', 'Cut their strings and keep your own.'];

/** "about 6.5 million", "about 760": a figure as the narrator rounds it. */
function people(n: number): string {
  if (n >= 1e9) return `about ${(n / 1e9).toFixed(1)} billion`;
  if (n >= 1e7) return `about ${Math.round(n / 1e6)} million`;
  if (n >= 1e6) return `about ${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e4) return `about ${Math.round(n / 1e3)} thousand`;
  return `about ${Math.round(n / 10) * 10}`;
}

/**
 * One fact about the flags in this arena, from the countries' figures: who has the most or the
 * fewest people, the biggest or the smallest, or how many times the biggest is the smallest. Only
 * ranks and rounded figures, so a year-old estimate never makes it false.
 */
function battleFact(flags: Country[], draw: number): string {
  const by = (key: 'people' | 'area', most: boolean) => [...flags].sort((a, b) => (most ? b[key] - a[key] : a[key] - b[key]))[0];
  const big = by('area', true);
  const small = by('area', false);
  const ratio = big.area / small.area;
  const times = ratio >= 10 ? Math.round(ratio / 10 ** Math.floor(Math.log10(ratio) - 1)) * 10 ** Math.floor(Math.log10(ratio) - 1) : Math.round(ratio);
  const facts = [
    `${by('people', true).name} has the most people here, ${people(by('people', true).people)}.`,
    `${by('people', false).name} has the fewest, ${people(by('people', false).people)} people.`,
    `${big.name} is the biggest country in the arena.`,
    `${small.name} is the smallest country in the arena.`,
    ...(ratio >= 3 ? [`${big.name} is about ${times.toLocaleString('en-US')} times the size of ${small.name}.`] : []),
  ];
  return facts[Math.floor(draw * facts.length)];
}

/**
 * The battle's opening: the flags (all of them up to four, else how many and the first three), the
 * rule in one sentence, one fact and the question, about 10 seconds read aloud. How it starts, the
 * rule's words and the fact are picked by the seed.
 */
export function battleScript(cfg: Config): string {
  const draws = openingDraws(cfg.seed);
  const names = cfg.battle.flags.map(flagName);
  const n = names.length;
  const starts =
    n === 2
      ? [`${names[0]} versus ${names[1]}!`, `${names[0]} takes on ${names[1]}!`, `It's ${names[0]} against ${names[1]}!`]
      : n === 3
        ? [`${names[0]}, ${names[1]} and ${names[2]}, in one arena!`, `Three flags, one arena: ${names[0]}, ${names[1]} and ${names[2]}!`]
        : n === 4
          ? [`Four flags, one arena: ${names[0]}, ${names[1]}, ${names[2]} and ${names[3]}!`]
          : [`${NUMBERS[n]} flags, one arena: ${names[0]}, ${names[1]}, ${names[2]} and ${n - 3} more!`];
  const flags = cfg.battle.flags.map(country).filter((c): c is Country => !!c);
  const fact = flags.length >= 2 ? battleFact(flags, draws.fact) : '';
  return [starts[Math.floor(draws.start * starts.length)], BATTLE_RULES[Math.floor(draws.ball * BATTLE_RULES.length)], fact, configQuestion(cfg)].filter(Boolean).join(' ');
}

/**
 * The winner line, and "Follow for more!" after it when the video asks viewers to follow
 * (spokenOutro); '' when the Winner line field is empty and it does not, and then the narrator
 * says nothing at the end.
 */
export function outroLine(cfg: Config, winner: string, time: number): string {
  return spokenOutro(cfg, { winner, time: time.toFixed(1) });
}

/** Every line a run will say, in order: the opening, then the winner. */
export function plannedLines(cfg: Config, outcome: Outcome | BattleOutcome): string[] {
  const outro = outcome.winner === null ? '' : outroLine(cfg, outcome.winnerName, outcome.time);
  return [introLine(cfg), ...(outro ? [outro] : [])];
}

/** What a voice says when it is tried in the Voice tab: this matchup's names, as an opening starts. */
export function previewLine(cfg: Config): string {
  if (cfg.game === 'arena-clash') {
    const names = cfg.battle.flags.slice(0, 3).map(flagName);
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}! Who survives?`;
  }
  return `${spokenName(cfg.a.name)} versus ${spokenName(cfg.b.name)}! Who do you think wins?`;
}

// ── Voices ─────────────────────────────────────────────────────────────────

export interface Voice {
  id: string;
  name: string;
  /** The accent and the voice, as the Voice tab describes it. */
  about: string;
  /** Kokoro's authors' own grade for how natural it sounds. */
  grade: string;
}

/** Kokoro's English voices with the best grades; the first is the default. */
export const VOICES: Voice[] = [
  { id: 'af_heart', name: 'Heart', about: 'American, female', grade: 'A' },
  { id: 'af_bella', name: 'Bella', about: 'American, female', grade: 'A−' },
  { id: 'bf_emma', name: 'Emma', about: 'British, female', grade: 'B−' },
  { id: 'af_nicole', name: 'Nicole', about: 'American, female, soft', grade: 'B−' },
  { id: 'am_michael', name: 'Michael', about: 'American, male', grade: 'C+' },
  { id: 'am_fenrir', name: 'Fenrir', about: 'American, male', grade: 'C+' },
  { id: 'am_puck', name: 'Puck', about: 'American, male', grade: 'C+' },
  { id: 'bm_george', name: 'George', about: 'British, male', grade: 'C' },
];

/** The config's voice when Kokoro has it; a config from elsewhere may name another, and gets the default. */
export function voiceOf(cfg: Config): string {
  return VOICES.some((v) => v.id === cfg.voice.voice) ? cfg.voice.voice : VOICES[0].id;
}

/**
 * ONNX Runtime, which runs Kokoro, served from this site with the rest of the build: left alone,
 * transformers.js fetches it from jsDelivr, one more company each visitor's browser would call
 * (the privacy page lists who does) and one more that can be down.
 */
const ORT = {
  mjs: new URL('../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs', import.meta.url).href,
  wasm: new URL('../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm', import.meta.url).href,
};

type KokoroModule = typeof import('kokoro-js');
type KokoroInstance = Awaited<ReturnType<KokoroModule['KokoroTTS']['from_pretrained']>>;
let kokoro: Promise<KokoroInstance> | null = null;

/**
 * Loads Kokoro once per page, from Hugging Face the first time and the browser
 * cache after. On the GPU (WebGPU) it needs the full-precision model (~330 MB
 * once) and speaks ~20 s of narration in a few seconds; without a GPU it falls
 * back to the 8-bit model (~90 MB) on the CPU, several times slower.
 */
function loadKokoro(onStatus: (text: string) => void): Promise<KokoroInstance> {
  const progress = (p: { status: string; progress?: number }) => {
    if (p.status === 'progress' && p.progress !== undefined) onStatus(`Downloading the voice model (once)… ${Math.round(p.progress)} %`);
  };
  kokoro ??= (async () => {
    const { KokoroTTS, env } = await import('kokoro-js');
    env.wasmPaths = ORT;
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu && (await gpu.requestAdapter().catch(() => null))) {
      try {
        return await KokoroTTS.from_pretrained(MODEL, { dtype: 'fp32', device: 'webgpu', progress_callback: progress });
      } catch {
        // A GPU that cannot run it (old driver, missing feature): use the CPU.
      }
    }
    return KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'wasm', progress_callback: progress });
  })().catch((err: unknown) => {
    kokoro = null;
    throw err;
  });
  return kokoro;
}

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * Below this a sample is Kokoro's own silence. It pads every sentence with 0.2–0.4 s before the
 * first word and 0.4–0.8 s after the last, depending on the voice, and its padding peaks under
 * -68 dB. A clip that kept them would start late, and hold the winner card up that long after
 * the narrator stops.
 */
const QUIET = 10 ** (-50 / 20);
/** Kept either side of the voice, so a word's first breath and last release are whole. */
const EDGE = 0.05;

/**
 * Turns one line into audio in `voice`. Kokoro reads at most ~500 tokens at once, so it goes
 * sentence by sentence, joined with a short breath between sentences, and the clip is cut to
 * the voice: it starts on the first word and ends on the last.
 */
export async function synthesize(ctx: BaseAudioContext, voice: string, text: string, onStatus: (text: string) => void): Promise<AudioBuffer> {
  const tts = await loadKokoro(onStatus);
  onStatus('');
  // Split only at punctuation followed by a space, so "2.5 million" stays whole.
  // (kokoro-js's own stream() never yields the last sentence of a plain string.)
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const parts: Float32Array[] = [];
  let rate = 24000;
  for (const sentence of sentences) {
    const audio = await tts.generate(sentence, { voice: voice as never });
    rate = audio.sampling_rate;
    if (parts.length) parts.push(new Float32Array(Math.round(rate * 0.12)));
    parts.push(audio.audio as Float32Array);
  }
  const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    joined.set(p, offset);
    offset += p.length;
  }
  let first = 0;
  while (first < joined.length && Math.abs(joined[first]) < QUIET) first++;
  let last = joined.length;
  while (last > first && Math.abs(joined[last - 1]) < QUIET) last--;
  const edge = Math.round(rate * EDGE);
  const voiced = joined.subarray(Math.max(0, first - edge), Math.min(joined.length, last + edge));
  const buffer = ctx.createBuffer(1, Math.max(1, voiced.length), rate);
  buffer.copyToChannel(voiced, 0);
  return buffer;
}

/** Generated lines, kept for the session so re-recording the same seed costs nothing. */
export class VoiceCache {
  private clips = new Map<string, AudioBuffer>();

  get(voice: string, text: string): AudioBuffer | undefined {
    return this.clips.get(`${voice}|${text}`);
  }

  missing(voice: string, lines: string[]): string[] {
    return [...new Set(lines)].filter((t) => !this.clips.has(`${voice}|${t}`));
  }

  /** Generates every missing line, one at a time: Kokoro has one model to share. */
  async prepare(ctx: BaseAudioContext, voice: string, lines: string[], onStatus: (text: string) => void): Promise<void> {
    const todo = this.missing(voice, lines);
    for (const [i, text] of todo.entries()) {
      const line = todo.length > 1 ? `Generating voice ${i + 1}/${todo.length}…` : 'Generating voice…';
      onStatus(line);
      // A download message replaces the line count while the model loads; '' brings it back.
      this.clips.set(`${voice}|${text}`, await synthesize(ctx, voice, text, (s) => onStatus(s || line)));
    }
  }
}
