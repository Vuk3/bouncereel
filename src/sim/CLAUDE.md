# src/sim

The race itself: a deterministic simulation with no DOM, plus prediction, balancing and
the random matchup generator. It runs in the page and, unchanged, in Node
(`npm run tune`). Deep-dives: [simulation](../../docs/simulation.md) (rules, physics,
determinism) · [matchups and balancing](../../docs/matchups-and-balancing.md).

## Where code goes

| Kind | Place |
| --- | --- |
| what happens on a bounce, a floor hit, a break, the finish | [duel.ts](./duel.ts) |
| a new number sequence | [sequences.ts](./sequences.ts): `term`, a `noun` for generated names, a `brief` and `facts` for the narration, a `mark` for the ball |
| a whole run without drawing, the finish times | [world.ts](./world.ts): `predict`, `finishTimes` |
| balancing, random matchups | [balance.ts](./balance.ts) |
| randomness, sine and cosine | [rng.ts](./rng.ts), [detmath.ts](./detmath.ts) |
| events the page reacts to | [types.ts](./types.ts): `SimEvent` |

## Rules

- **No engine-rounded maths.** `Math.sin`, `Math.cos`, `Math.atan2`, `Math.exp`,
  `Math.log` and non-integer `**` are rounded differently by engines (and by versions of
  one engine); a bounce sim turns one differing bit into a different winner within
  seconds. Use `dsin`/`dcos` from [detmath.ts](./detmath.ts); `+ − × ÷`, `Math.sqrt`,
  `Math.round`, `Math.floor`, `Math.min`/`max` and `%` are exact everywhere.
- **No `Math.random`, no `Date`.** All randomness comes from `createRng(seed + purpose)`;
  use a distinct purpose string per use (`matchup:`, `balance:`) so one use never shifts
  another's numbers.
- **Damage and health are BigInt.** Sequence terms pass 2^53 within 80 hits, and a maths
  video with wrong last digits gets called out.
- **The race ends at the win.** Every ball stops (`end()` in [duel.ts](./duel.ts)), the
  loser's too; only `finishTimes` builds its world with `runOn`, to measure when the loser
  would have arrived. The page never runs on past the win.
- **Keep the motion time-scalable.** Walls mirror an overshooting ball back by the
  overshoot, so a ball k times faster runs the same path k times sooner; balancing is
  built on that. Never clamp a ball to a wall instead.
- **After a change here, run `npm run tune`.** It must still balance every preset at
  30, 40 and 60 s and keep the random generator at 0 off-length matchups.
