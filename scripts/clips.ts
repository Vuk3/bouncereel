import { loadFlags } from '../src/battle/flags.ts';
import type { Config } from '../src/config.ts';
import { H, W } from '../src/layout.ts';
import { END_PAD, SLOWMO, SLOWMO_LEAD, SLOWMO_TAIL } from '../src/pacing.ts';
import { BattleRenderer } from '../src/render/battle.ts';
import { MatchRenderer } from '../src/render/match.ts';
import { balanceBattle } from '../src/sim/battle-balance.ts';
import { BattleWorld, STRIDE, predictBattle } from '../src/sim/battle.ts';
import { balanceMatch } from '../src/sim/match-balance.ts';
import { MATCH_STEP, MatchWorld } from '../src/sim/match.ts';
import { SHOWCASES as BATTLES, battleConfig, describeBattle } from '../src/site/arena.ts';
import { SHOWCASES as MATCHES, describeMatch, matchConfig } from '../src/site/pitch.ts';

// The site's recorded clips of Arena Clash and Goal Rush (public/gallery/, docs/website.md §5): a
// showcase of the site's phones (arena.ts, pitch.ts), balanced as they balance it, played in real
// time at the phones' size (540×960) through the studio's phases (the slow motion, the winner card,
// the fade), and recorded off the canvas. Unlike a phone, which fades into the next showcase, a
// clip fades into its own first frame, as a recorded video does, so it loops on the page. Muted,
// as the gallery's are. Only built with STILLS=1 (vite.config.ts); driven from the console:
//
//   await recordClip('match', 0)   → { name, poster, type, video } (data URLs)

declare global {
  interface Window {
    recordClip(game: 'battle' | 'match', showcase: number): Promise<{ name: string; poster: string; type: string; video: string }>;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const SCALE = canvas.width / W;

type Phase = 'race' | 'slowmo' | 'winner' | 'done';

/** A game as the clip plays it: one step of `dt` seconds, and a draw. */
interface Player {
  advance(dt: number): boolean;
}

function matchPlayer(cfg: Config): Player {
  const first = new MatchRenderer(document.createElement('canvas'));
  first.reset(cfg);
  first.draw(new MatchWorld(cfg), cfg, 0, { winner: 0, age: 0 });
  const renderer = new MatchRenderer(canvas);
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  renderer.ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  renderer.reset(cfg);
  const world = new MatchWorld(cfg);
  let phase: Phase = 'race';
  let phaseAge = 0;
  let winnerAge = 0;
  let acc = 0;
  const simulate = (simDt: number) => {
    acc += simDt;
    while (acc >= MATCH_STEP) {
      acc -= MATCH_STEP;
      world.step();
    }
    const events = world.drain();
    if (events.length) renderer.handle(events, world, cfg);
  };
  const draw = (dt: number) => {
    const showing = phase === 'winner' || phase === 'done';
    renderer.draw(world, cfg, dt, {
      winner: showing ? Math.min(1, winnerAge / 0.35) : 0,
      age: showing ? winnerAge : 0,
      loop: phase === 'done' ? phaseAge / (END_PAD * 0.8) : 0,
      start: first.canvas,
      ahead: acc,
    });
  };
  const set = (next: Phase) => {
    phase = next;
    phaseAge = 0;
    if (next === 'winner') {
      winnerAge = 0;
      renderer.celebrate(world, cfg);
    }
  };
  draw(0);
  return {
    advance(dt) {
      phaseAge += dt;
      winnerAge += dt;
      if (phase === 'race') {
        simulate(dt);
        if (world.winner !== null) set(world.timedOut ? 'winner' : 'slowmo');
      } else if (phase === 'slowmo') {
        simulate(dt * SLOWMO);
        if (phaseAge >= SLOWMO_TAIL) set('winner');
      } else if (phase === 'winner') {
        simulate(dt * SLOWMO);
        if (winnerAge >= cfg.timing.hold) set('done');
      } else {
        simulate(dt * SLOWMO);
        if (phaseAge > END_PAD) return false;
      }
      draw(dt);
      return true;
    },
  };
}

function battlePlayer(cfg: Config): Player {
  const first = new BattleRenderer(document.createElement('canvas'));
  first.reset(cfg);
  first.draw(new BattleWorld(cfg), cfg, 0, { winner: 0, age: 0 });
  const renderer = new BattleRenderer(canvas);
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  renderer.ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  renderer.reset(cfg);
  const world = new BattleWorld(cfg);
  const outcome = predictBattle(cfg);
  let phase: Phase = 'race';
  let phaseAge = 0;
  let winnerAge = 0;
  let acc = 0;
  const slowed = () => {
    const t = world.time;
    if (!outcome.timedOut && t > outcome.time - SLOWMO_LEAD) return true;
    return outcome.slow.some(([from, to]) => t >= from && t < to);
  };
  const simulate = (simDt: number) => {
    acc += simDt;
    while (acc >= world.nextStep) {
      acc -= world.nextStep;
      world.step();
    }
    const events = world.drain();
    if (events.length) renderer.handle(events, world, cfg);
  };
  const draw = (dt: number) => {
    const showing = phase === 'winner' || phase === 'done';
    renderer.draw(world, cfg, dt, {
      winner: showing ? Math.min(1, winnerAge / 0.35) : 0,
      age: showing ? winnerAge : 0,
      loop: phase === 'done' ? phaseAge / (END_PAD * 0.8) : 0,
      start: first.canvas,
      slow: phase === 'race' && slowed(),
      lead: (acc / world.nextStep) * STRIDE,
    });
  };
  const set = (next: Phase) => {
    phase = next;
    phaseAge = 0;
    if (next === 'winner') {
      winnerAge = 0;
      renderer.celebrate(world, cfg);
    }
  };
  draw(0);
  return {
    advance(dt) {
      phaseAge += dt;
      winnerAge += dt;
      if (phase === 'race') {
        simulate(dt * (slowed() ? SLOWMO : 1));
        if (world.winner !== null) set(world.timedOut ? 'winner' : 'slowmo');
      } else if (phase === 'slowmo') {
        simulate(dt * SLOWMO);
        if (phaseAge >= SLOWMO_TAIL) set('winner');
      } else if (phase === 'winner') {
        simulate(dt * SLOWMO);
        if (winnerAge >= cfg.timing.hold) set('done');
      } else {
        simulate(dt * SLOWMO);
        if (phaseAge > END_PAD) return false;
      }
      draw(dt);
      return true;
    },
  };
}

const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

window.recordClip = async (game, showcase) => {
  await Promise.all([600, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px Rubik`)));
  let cfg: Config | null;
  let name: string;
  if (game === 'match') {
    const show = MATCHES[showcase];
    cfg = balanceMatch(matchConfig(show.mode, show.home, show.away, show.seed));
    name = cfg ? describeMatch(cfg) : '';
  } else {
    const show = BATTLES[showcase];
    await loadFlags(show.flags);
    cfg = balanceBattle(battleConfig(show.flags, show.seed ?? '1', show.question));
    name = cfg ? describeBattle(cfg) : '';
  }
  if (!cfg) throw new Error('the showcase did not balance');
  const player = game === 'match' ? matchPlayer(cfg) : battlePlayer(cfg);
  const poster = canvas.toDataURL('image/webp', 0.86);
  const type = ['video/mp4;codecs=avc1.4D0028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))!;
  const recorder = new MediaRecorder(canvas.captureStream(60), { mimeType: type, videoBitsPerSecond: 10_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve) => (recorder.onstop = resolve));
  recorder.start(1000);
  await new Promise<void>((resolve) => {
    let last = 0;
    const frame = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (player.advance(dt)) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  recorder.stop();
  await stopped;
  return { name, poster, type, video: await asDataUrl(new Blob(chunks, { type })) };
};
