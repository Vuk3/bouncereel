// Checks, in plain Node, that matchups balance: every preset and a hundred
// random matchups, at a few video lengths, as photo finishes and with the
// finish gaps the panel offers, and rolls that keep one ball or both; then Flag
// Battles of 2 to 12 flags, on their own and with a chosen winner. Run after
// changing the physics, the presets or the generator.
//
//   npm run tune
//   npm run tune -- 45      one video length

import { DEFAULT_CONFIG, PRESETS, mergeConfig, switchGame, type Contestant } from '../src/config.ts';
import { videoSeconds } from '../src/pacing.ts';
import { predictBattle } from '../src/sim/battle.ts';
import { balanceBattle, randomBattle, slowExtra, spread } from '../src/sim/battle-balance.ts';
import { balance, isComeback, randomMatchup } from '../src/sim/balance.ts';
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
    console.log(`  ${preset.label.padEnd(32)} ${videoSeconds(cfg, o.time, o.winnerName).toFixed(1)} s  ${o.winnerName} wins${isComeback(o) ? ' from behind' : ''}  speeds ${Math.round(cfg.a.speed)}/${Math.round(cfg.b.speed)}`);
  }

  const base = mergeConfig(DEFAULT_CONFIG, { timing: { video } });
  // The dice with powers on (a power or a crowd now and then), and with them off.
  for (const powers of [true, false]) {
    const started = performance.now();
    const slowest: number[] = [];
    let photo = 0;
    let off = 0;
    let powered = 0;
    let crowds = 0;
    let comebacks = 0;
    for (let i = 1; i <= 100; i++) {
      const t = performance.now();
      const cfg = randomMatchup(String(i * 7919), base, { powers }) ?? base;
      slowest.push(performance.now() - t);
      const o = predict(cfg);
      if (o.runnerUp >= 0.949) photo++;
      if (isComeback(o)) comebacks++;
      if (Math.abs(videoSeconds(cfg, o.time, o.winnerName) - video) > 1) off++;
      if (cfg.a.special !== 'none' || cfg.b.special !== 'none') powered++;
      if (cfg.a.count > 1 || cfg.b.count > 1) crowds++;
    }
    slowest.sort((a, b) => b - a);
    const label = powers ? 'random matchups' : 'random, no powers';
    console.log(
      `  100 ${label}: ${((performance.now() - started) / 100).toFixed(1)} ms each (worst ${slowest[0].toFixed(0)} ms), ${powered} with a power, ${crowds} with a crowd, ${photo} photo finishes, ${comebacks} won from behind, ${off} more than 1 s off length`,
    );
  }

  // Kept balls: a new opponent for the top ball kept whole, new layers for two kept whole, and the
  // top ball kept with its count and strength rolled. What is kept must come back as it was, its
  // speed aside.
  const whole = { ball: true, count: true, strength: true };
  const none = { ball: false, count: false, strength: false };
  const ball = (x: Contestant, y: Contestant) => x.sequence === y.sequence && x.special === y.special && x.amount === y.amount && x.color === y.color;
  const same = (x: Contestant, y: Contestant) => ball(x, y) && x.radius === y.radius && x.count === y.count && x.strength === y.strength;
  for (const [label, keep, kept] of [
    ['keeping the top ball', { a: whole, b: none }, same],
    ['keeping both balls', { a: whole, b: whole }, same],
    ['keeping the top ball, rolling its count and strength', { a: { ...none, ball: true }, b: none }, ball],
  ] as const) {
    let nothing = 0;
    let changed = 0;
    let off = 0;
    for (let i = 1; i <= 30; i++) {
      const start = randomMatchup(String(i * 104729), base) ?? base;
      const cfg = randomMatchup(String(i * 7919 + 1), start, { keep });
      if (!cfg) {
        nothing++;
        continue;
      }
      if (!kept(cfg.a, start.a) || (keep.b.ball && !kept(cfg.b, start.b))) changed++;
      const p = predict(cfg);
      if (Math.abs(videoSeconds(cfg, p.time, p.winnerName) - video) > 1) off++;
    }
    console.log(`  30 rolls ${label}: ${nothing} found nothing, ${changed} changed what was kept, ${off} more than 1 s off length`);
  }

  for (const gap of GAPS) {
    const gapBase = mergeConfig(base, { timing: { gap } });
    const gapStarted = performance.now();
    let offLength = 0;
    let offGap = 0;
    for (let i = 1; i <= 100; i++) {
      const cfg = randomMatchup(String(i * 7919), gapBase) ?? gapBase;
      const o = predict(cfg);
      const [a, b] = finishTimes(cfg, o.time + gap + 30);
      if (Math.abs(videoSeconds(cfg, o.time, o.winnerName) - video) > 1) offLength++;
      if (!(Math.abs(Math.abs(a - b) - gap) <= 1)) offGap++;
    }
    console.log(`  100 random, ${String(gap).padStart(2)} s gap: ${((performance.now() - gapStarted) / 100).toFixed(1)} ms each, ${offLength} more than 1 s off length, ${offGap} more than 1 s off the gap`);
  }
}

/** Battles per flag count and length: enough to see the failures, quick enough to run after every change. */
const BATTLES = 20;
for (const video of lengths) {
  console.log(`\n── ${video} s Arena Clashes`);
  const base = mergeConfig(switchGame(DEFAULT_CONFIG, 'arena-clash'), { timing: { video } });
  // Three and four flags are what the game is made for; six and twelve are there to be possible.
  for (const count of [2, 3, 4, 6, 12]) {
    for (const chosen of [false, true]) {
      const started = performance.now();
      let worst = 0;
      let failed = 0;
      let off = 0;
      let lost = 0;
      const firsts: number[] = [];
      const spreads: number[] = [];
      const speeds: number[] = [];
      for (let i = 1; i <= BATTLES; i++) {
        const dealt = randomBattle(String(i * 7919), base, count, 'world');
        // The chosen winner: the last flag dealt, so it is never the one placed first.
        if (chosen) dealt.battle.winner = dealt.battle.flags[count - 1];
        const t = performance.now();
        const cfg = balanceBattle(dealt);
        worst = Math.max(worst, performance.now() - t);
        if (!cfg) {
          failed++;
          continue;
        }
        const o = predictBattle(cfg);
        // A battle's speed is fitted exactly: more than a tenth of a second off is a fault, not chaos.
        if (Math.abs(videoSeconds(cfg, o.time + slowExtra(o), o.winnerName) - video) > 0.1) off++;
        if (chosen && cfg.battle.flags[o.winner ?? -1] !== cfg.battle.winner) lost++;
        firsts.push(o.outs[0].time);
        spreads.push(spread(o, count));
        speeds.push(cfg.battle.speed);
      }
      const mean = spreads.reduce((a, b) => a + b, 0) / Math.max(1, spreads.length);
      const label = `${String(count).padStart(2)} flags${chosen ? ', winner chosen' : ''}`;
      console.log(
        `  ${label.padEnd(26)} ${((performance.now() - started) / BATTLES).toFixed(0)} ms each (worst ${worst.toFixed(0)} ms), ${failed} not balanced, ${off} more than 0.1 s off length${chosen ? `, ${lost} won by another flag` : ''}, first flag out at ${Math.min(...firsts).toFixed(1)} s at the earliest, longest quiet stretch ${Math.round(mean * 100)} % on average (worst ${Math.round(Math.max(0, ...spreads) * 100)} %), speeds ${Math.round(Math.min(...speeds))}–${Math.round(Math.max(...speeds))} px/s`,
      );
    }
  }
}
