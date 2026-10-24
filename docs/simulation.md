# Simulation

The rules of a race, the physics that plays it out, the events the page reacts to, the
prediction that knows the whole run before it is drawn, and the determinism all of that
rests on.

| I need to change... | Touch |
| --- | --- |
| what a floor hit, a break or the finish does | [src/sim/duel.ts](../src/sim/duel.ts) `floorHit`, `finish` |
| what a special does | [src/sim/duel.ts](../src/sim/duel.ts) `special` |
| bounces, sub-steps, start positions and angles | [src/sim/duel.ts](../src/sim/duel.ts) `substep`, `step`, constructor |
| the events | [src/sim/types.ts](../src/sim/types.ts) `SimEvent` |
| the prediction, finish times, lead changes | [src/sim/world.ts](../src/sim/world.ts) |
| a sequence | [src/sim/sequences.ts](../src/sim/sequences.ts) |
| where the walls, floor and finish are | [src/layout.ts](../src/layout.ts) |

## 1. The rules

- Each **team** has its own box: team 0 (`a`) the top card, team 1 (`b`) the bottom one.
  Teams never meet; their races only run side by side.
- A ball bounces off the side walls and the ceiling for nothing (a `wall` event).
- **A hit on the floor scores.** The floor is the top standing layer; the hit takes the
  team's current `damage` off it, then `hits` goes up by one and `damage` becomes
  `term(hits)` of the team's sequence. So the first hit deals `term(0)`.
- **Leftover damage is lost.** A hit bigger than what is left of a layer breaks it, and
  the rest goes nowhere; the next hit lands on the next layer.
- When a layer breaks, the floor drops to the next one: the box grows down by one layer.
- With every layer broken, the floor is the **finish line**. The first ball of a team to
  touch it finishes the team, and the first team to finish wins (`finish` event, `place`
  1). **The race is over at the win**: every ball of both teams stops where it is, so the
  loser does not race on under the winner card and no layer breaks after the winner is
  known. Only `finishTimes` lets it run on (`runOn`, below), to measure when the loser
  would have arrived (`place` 2).
- **Timeout**: if nobody has finished by `timing.maxSeconds`, the team with more
  progress wins (`timeout` event). Balancing sets the limit to the race plus 30 s, so a
  balanced race never times out.

Layer health is a list, top first, parsed by `parseLayers`: `1000, 1e10, 1e15`, also
`1k 10b 1q`, `2.5e9`; unreadable entries are skipped. Health and damage are **BigInt**.

## 2. The physics

- **No gravity** by default (`physics.gravity` 0, and balancing forces it to 0): a ball
  flies in a straight line at constant speed, like the DVD logo.
- **Start**: from the seed, a random point in the open box, a launch angle 30–60° off
  horizontal (flatter takes forever to reach the floor, steeper looks like it only bounces
  up and down), any of the four diagonals, at the team's speed.
- **Bounces are mirrored**: a ball that passed a wall during a step is put back inside by
  the same distance, as if it had bounced at the exact moment, and its velocity flips. No
  time is lost per bounce, so **a ball k times faster runs exactly the same path k times
  sooner**. Balancing is built on that ([matchups and balancing](./matchups-and-balancing.md#1-balancing)).
  A final clamp keeps a ball inside the box even at absurd speeds, so nothing can tunnel.
- **Steps**: the page always advances by `STEP` = 1/240 s; a step is split into up to 32
  sub-steps so the fastest ball moves at most half the smallest ball's radius per
  sub-step. That only sharpens when a hit happens; the box is convex and every ball is
  put back inside it each step, so no speed can carry one through a wall.
- **Speed limit** `physics.maxSpeed` (5000 px/s) caps a ball that speeds up.

## 3. Specials

What a floor hit also does to the ball that made it (`special`, `amount`):

| Special | Effect | Bounds |
| --- | --- | --- |
| `faster` | speed × (1 + amount %) | up to `physics.maxSpeed` |
| `slower` | speed × (1 − amount %) | at least 40 px/s |
| `grow` | radius + amount px; a ball touching the floor is lifted to rest on it | at most a third of the open box height |
| `split` | `amount` new balls at the hitter's position, each turned 19–37° (a different turn per newborn, so no two share a path and merge visually), leaving upward | `MAX_BALLS` = 64 per box |

A split team shares one sequence and one hit counter: more balls means more hits, not
bigger ones. A box full of balls is chaotic (a newborn's path depends on the exact step
it was born in), which balancing tolerates with a wider margin.

## 4. Events

[types.ts](../src/sim/types.ts) `SimEvent`, drained once per frame by the page:

| Event | When | Used by |
| --- | --- | --- |
| `wall` | side wall or ceiling | a quiet tick |
| `hit` | floor hit, with `damage`, `layer`, `broken`, `last` | floating number, flash, note, crack, debris |
| `finish` | a team touches the line: `place` 1 on the page, also 2 when measuring | shake, fanfare |
| `timeout` | the time limit picked a winner | winner card says "time's up" |

## 5. Prediction

- **`predict(cfg)`** runs a config to the win without drawing (a few milliseconds for a
  minute of race) and returns the `Outcome`: winner, the win time, the loser's progress,
  and lead changes (sampled four times a second, and once more at the win: two balls through
  their layers tie at 0.95, so the winner can pass only at the line, on a step no sample
  falls on), with the ones the video marks with LEAD CHANGE and a sting (`leads`: a change
  kept for a second or more, `LEAD_HOLD`, or the last one if kept to the end, that hands the
  lead to the other team than the last marked; the pass at the line is counted, ends the
  hold before it, and is not marked itself; the race time each was seen and the team that
  took it). The page uses the win time to start
  slow motion just before it, the winner for the narrator's winner line, and `leads` in
  the renderer and the sonifier, which act on each as the race reaches it.
- **`finishTimes(cfg, limit)`** builds the world with `runOn` (`createWorld(cfg, true)`),
  so the race does not stop at the win, and returns when each team touches the line
  (Infinity if not by `limit`). Balancing measures with it, and the prediction box shows
  the margin from it ("wins by 0.3 s"). ⚠️ That is the only place `runOn` belongs: a
  world that ran on in the page would show the loser racing under the winner card.
- **Progress** (`DuelWorld.progress`) is layers broken plus how worn the current one is,
  scaled to 0.95, and 1 at the finish. It decides a timeout and counts lead changes.

## 6. Determinism

A seed replays bit for bit, in every browser and in Node. That is what lets a prediction
made before the race *be* the race: slow motion starts at the right moment, the winner
line was generated for the ball that wins, and balancing measures the race that plays.

- **Randomness** comes only from `createRng(text)` (mulberry32 seeded by a cyrb53 hash),
  integer-only. Each use has its own purpose string so they never shift one another.
- ⚠️ **No `Math.sin`, `Math.cos`, `Math.atan2`, `Math.exp`, `Math.log`.** Engines round
  them differently: Node 22 and Chrome disagreed on one bit of an angle and, a few seconds
  in, on the winner. [detmath.ts](../src/sim/detmath.ts) has a sine and cosine built from
  `+ − × ÷` and `Math.round` (Taylor series on ±π/4, under one ulp of error), which IEEE
  754 defines exactly. `Math.sqrt` is exact too.
- **BigInt for damage and health**: Fibonacci passes 2^53 by its 79th term; doubles would
  get the last digits wrong on screen.
- Nothing silently breaks it except a new call to one of the functions above; a prediction
  that no longer matches the page shows up as slow motion at the wrong moment and a winner
  line naming the wrong ball.

## Changelog

- 2026-10-18 - two-box races with floor-only damage, BigInt sequences, specials, mirrored
  bounces, prediction and finish times.
- 2026-10-21 - the race stops at the win, the loser's balls too; `runOn` lets only
  `finishTimes` run past it. The prediction no longer keeps a timeline (no call-outs need it).
- 2026-10-23 - the prediction lists the lead changes the video marks (`Outcome.leads`) and
  counts the winner passing at the line, which no sample saw; read only, nothing in a race
  moves (`npm run tune` unchanged).
