import type { Config, Contestant } from '../config.ts';
import { fillTemplate } from '../config.ts';
import { SEQUENCES } from '../sim/sequences.ts';
import type { Outcome } from '../sim/world.ts';
import { configQuestion, openingDraws } from './opening.ts';

// What the narrator says, and turning it into audio. Two lines: a short opening that says how
// the matchup works, and the winner at the end; nothing while the race runs, which the picture
// tells better. The simulation is deterministic, so both are known before a run starts
// (predict()): a recording first generates them, then plays each as its moment comes.
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
    // Not when the name or the special already says it ("Slow Factorial", a ball that slows down).
    if (/\b(slow|fast)\b/i.test(c.name) || c.special === 'slower') return '';
    const ratio = other.speed / c.speed;
    return ratio >= 2.5 ? ", but it's much slower" : ratio >= 1.4 ? ', but slower' : '';
  };
  const hasSpecial = (c: Contestant) => c.special !== 'none' && c.amount > 0;
  const balls =
    a.sequence === b.sequence
      ? [
          `Both hit with ${SEQUENCES[a.sequence].label} numbers.`,
          [a, b]
            .filter(hasSpecial)
            .map((c) => `${shortName(c.name)} ${OWN[c.special]}`)
            .join(', ')
            .replace(/^(.)/, (m) => m.toUpperCase()),
        ]
      : [a, b].map((c, i) => `${shortName(c.name)} ${SEQUENCES[c.sequence].brief}${pace(c, i ? a : b)}${hasSpecial(c) ? SPECIALS[c.special] : ''}.`);
  // A fact about a ball whose name says its numbers ("Fibonacci Ball"); a "Multiplying Ball" counting
  // in secret would make a fact about counting sound like it came from nowhere.
  const named = [a, b].filter((c) => SEQUENCES[c.sequence].noun && c.name.includes(SEQUENCES[c.sequence].noun));
  const pool = named.length ? named : [a, b];
  const facts = SEQUENCES[pool[Math.floor(draws.ball * pool.length)].sequence].facts;
  const fact = facts[Math.floor(draws.fact * facts.length)];
  const start = fillTemplate(STARTS[Math.floor(draws.start * STARTS.length)], { a: a.name, b: b.name });
  return [start, ...balls.filter(Boolean).map((r) => (/[.!?]$/.test(r) ? r : `${r}.`)), fact, configQuestion(cfg)].join(' ');
}

export function introLine(cfg: Config): string {
  return cfg.voice.script.trim() || autoScript(cfg);
}

/** The winner line; '' when the Winner line field is empty, and then the narrator says nothing at the end. */
export function outroLine(cfg: Config, winner: string, time: number): string {
  return fillTemplate(cfg.voice.outro, { winner, time: time.toFixed(1) }).trim();
}

/** Every line a run will say, in order: the opening, then the winner. */
export function plannedLines(cfg: Config, outcome: Outcome): string[] {
  const outro = outcome.winner === null ? '' : outroLine(cfg, outcome.winnerName, outcome.time);
  return [introLine(cfg), ...(outro ? [outro] : [])];
}

/** What a voice says when it is tried in the Voice tab: this matchup's names, as an opening starts. */
export function previewLine(cfg: Config): string {
  return `${cfg.a.name} versus ${cfg.b.name}! Who do you think wins?`;
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
 * Turns one line into audio in `voice`. Kokoro reads at most ~500 tokens at once, so it goes
 * sentence by sentence, joined with a short breath between sentences.
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
    parts.push(audio.audio as Float32Array, new Float32Array(Math.round(rate * 0.12)));
  }
  const length = parts.reduce((n, p) => n + p.length, 0);
  const buffer = ctx.createBuffer(1, Math.max(1, length), rate);
  let offset = 0;
  for (const p of parts) {
    buffer.copyToChannel(p as Float32Array<ArrayBuffer>, 0, offset);
    offset += p.length;
  }
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
