// Checks, in plain Node, that matchups balance: every preset and a hundred
// random matchups, at a few video lengths, as photo finishes and with the
// finish gaps the panel offers. Run after changing the physics, the presets or
// the generator.
//
//   npm run tune
//   npm run tune -- 45      one video length

import { DEFAULT_CONFIG, PRESETS, mergeConfig } from '../src/config.ts';
import { videoSeconds } from '../src/pacing.ts';
import { balance, randomMatchup } from '../src/sim/balance.ts';
import { finishTimes, predict } from '../src/sim/world.ts';

// The one Node global used here; declared instead of pulling in @types/node.
declare const process: { argv: string[] };

const lengths = process.argv[2] ? [Number(process.argv[2])] : [30, 40, 60];
/** Finish gaps checked besides the photo finish: the middle and the top of the panel's slider. */
const GAPS = [3, 5, 10];

for (const video of lengths) {
  console.log(`\n── ${video} s videos`);
  for (const preset of PRESETS) {
    const cfg = balance(mergeConfig(preset.config, { timing: { video } }));
    if (!cfg) {
      console.log(`  ${preset.label.padEnd(32)} cannot fit (a ball would be under 140 or over 2600 px/s)`);
      continue;
    }
    const o = predict(cfg);
    console.log(`  ${preset.label.padEnd(32)} ${videoSeconds(cfg, o.time).toFixed(1)} s  ${o.winnerName} wins  speeds ${Math.round(cfg.a.speed)}/${Math.round(cfg.b.speed)}`);
  }

  const base = mergeConfig(DEFAULT_CONFIG, { timing: { video } });
  // The dice as it comes (a power now and then), and with powers switched off.
  for (const powers of [true, false]) {
    const started = performance.now();
    const slowest: number[] = [];
    let photo = 0;
    let off = 0;
    let powered = 0;
    for (let i = 1; i <= 100; i++) {
      const t = performance.now();
      const cfg = randomMatchup(String(i * 7919), base, powers);
      slowest.push(performance.now() - t);
      const o = predict(cfg);
      if (o.runnerUp >= 0.949) photo++;
      if (Math.abs(videoSeconds(cfg, o.time) - video) > 1) off++;
      if (cfg.a.special !== 'none' || cfg.b.special !== 'none') powered++;
    }
    slowest.sort((a, b) => b - a);
    const label = powers ? 'random matchups' : 'random, no powers';
    console.log(
      `  100 ${label}: ${((performance.now() - started) / 100).toFixed(1)} ms each (worst ${slowest[0].toFixed(0)} ms), ${powered} with a power, ${photo} photo finishes, ${off} more than 1 s off length`,
    );
  }

  for (const gap of GAPS) {
    const gapBase = mergeConfig(base, { timing: { gap } });
    const gapStarted = performance.now();
    let offLength = 0;
    let offGap = 0;
    for (let i = 1; i <= 100; i++) {
      const cfg = randomMatchup(String(i * 7919), gapBase);
      const o = predict(cfg);
      const [a, b] = finishTimes(cfg, o.time + gap + 30);
      if (Math.abs(videoSeconds(cfg, o.time) - video) > 1) offLength++;
      if (!(Math.abs(Math.abs(a - b) - gap) <= 1)) offGap++;
    }
    console.log(`  100 random, ${String(gap).padStart(2)} s gap: ${((performance.now() - gapStarted) / 100).toFixed(1)} ms each, ${offLength} more than 1 s off length, ${offGap} more than 1 s off the gap`);
  }
}
