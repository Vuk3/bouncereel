# Matchups and balancing

How any matchup becomes a race of an exact video length that ends as close as asked (a
photo finish, or a chosen gap), the frame of time around the race, the random matchup
generator, and the sequences, specials and built-in matchups it draws on.

| I need to change... | Touch |
| --- | --- |
| how speeds are found, how close a photo finish is, speed bounds | [src/sim/balance.ts](../src/sim/balance.ts) `balance`, `MIN_SPEED`, `MAX_SPEED`, `PHOTO_FINISH` |
| the finish gap slider | [app.html](../app.html), [src/app.ts](../src/app.ts) `gapLabel`, `showPrediction`; `timing.gap` in [config.ts](../src/config.ts) |
| what the dice can produce | [src/sim/balance.ts](../src/sim/balance.ts) `randomMatchup`, `side`, `pickLayers`, `COLORS`, `HITS`, `MAX_POWER` |
| how often the dice gives a ball a power | [src/sim/balance.ts](../src/sim/balance.ts) `POWER_CHANCE`, `BOTH_POWERED`, `POWERS` |
| how often it gives a ball a size (Big, Tiny), which pace words names say | [src/sim/balance.ts](../src/sim/balance.ts) `SIZED`, `BIG`, `TINY`; `PACE_WORDS` |
| the Powers in random matchups switch next to the dice | `#powers` and `#powers-hint` in [app.html](../app.html); `powers`, `loadDice` in [src/app.ts](../src/app.ts) |
| why a matchup cannot balance, and what the page says | `balanceProblem` in [balance.ts](../src/sim/balance.ts); `rebalance`, `explainUnbalanced` and `#balance-note` in [src/app.ts](../src/app.ts) |
| generated names | [src/sim/balance.ts](../src/sim/balance.ts) `nameFor`; nouns in [sequences.ts](../src/sim/sequences.ts) |
| the time around the race (hold, slow motion, winner card) | [src/pacing.ts](../src/pacing.ts) |
| a sequence | [src/sim/sequences.ts](../src/sim/sequences.ts) |
| a built-in matchup | [src/config.ts](../src/config.ts) `PRESETS` |
| what the buttons do (dice, new race, make it close, video length, finish gap) | [src/app.ts](../src/app.ts) `randomize`, `reroll`, `loadMatchup` |
| the check that it all still balances | [scripts/tune.ts](../scripts/tune.ts), `npm run tune` |

## 1. Balancing

`balance(cfg)` returns the config with both speeds set so the race fits the video length
and the two teams reach the line as far apart as `timing.gap` asks (a fraction of a second
when it is 0), or `null` when that is not possible.

- **The idea.** With no gravity and mirrored bounces, a ball k times faster follows
  exactly the same path, hits the floor at the same spots and breaks the same layers,
  only k times sooner ([simulation](./simulation.md#2-the-physics)). So a team's finish
  time T at speed v becomes T × v / v′ at speed v′, and v′ = v × T / target puts it on
  the line at the target.
- **The targets.** The race length comes from [pacing](#2-the-video-length). One team,
  picked by the seed (`balance:<seed>`), gets exactly that; the other gets the race plus
  the **finish gap**:
  - `timing.gap` 0 (the default, "photo finish" on the slider): 0.15–1.1 s more, also
    picked by the seed. A near photo finish, with a winner the seed decides.
  - `timing.gap` 1–10 s (the **Finish gap** slider under Video length): exactly that much
    more, so the winner is through 5 s or 10 s before the loser. The same scaling does it;
    the loser simply gets a slower speed. The race (the winner's time) and the video length
    do not change, and the loser is still on its way when the winner card comes.

  The photo finish's random gap is drawn only when it is used, after the winner, so a seed
  balances to the same race it always did.
- **The loop.** Measure both finish times (`finishTimes`), scale each speed by
  time / target, repeat until both are within 0.05 % (at most 10 rounds). Rounds are
  needed because a ball that speeds up into the speed limit, or a box of splitting balls,
  does not scale perfectly.
- **The checks.** One more measurement; the result is kept only if both teams are within
  0.6 s of their targets (split boxes are chaotic), the chosen winner really is first, and
  both starting speeds are between 140 and 3200 px/s: slower looks stuck, faster is a blur
  on a phone. Anything else returns `null`.
- **Side effects**: gravity is set to 0, and `timing.maxSeconds` to the race plus 30 s.

**Why not** (`balanceProblem(cfg)`): the same solve, read for the first thing in the way,
as `{ side, why }`. `fast`: that ball would have to pass 3200 px/s (or never reaches the
line at all) because its sequence needs too many hits for these layers; `slow`: it gets
through them so soon it would crawl under 140 px/s; `uneven`: the speeds are fine but the
finish does not land within 0.6 s, or the chosen winner is not first (powers that bend the
scaling). It returns `null` when `balance` would succeed.

What the page does with `null`:

- **Balancing on load** (a classic, a typed seed, the length or gap slider, the Sound
  field) keeps the matchup unbalanced when it cannot fit, and explains why
  (`explainUnbalanced`). A file or a video from the library is not balanced again: it
  opens as it was made.
- **Rebalance** and **Make it close** (`rebalance`) try this race first, then up to eight
  new seeds of the same matchup, since a seed's starting angles can decide whether a
  finish with powers lands; a new seed says so in a message. If none fits, it explains why.
- **New race** tries up to 12 new seeds; the dice simply tries another combination.

The explanation names the ball and what to change, for example "Factorial Ball needs too
many hits for these layers: it would have to move faster than a viewer can follow to
finish a 30 s video. Lower the layers, give it a faster-growing sequence, or make the video
longer." It shows in a message and stays in the matchup card (`#balance-note`) until the
matchup changes: a button that only flashed a line for a few seconds read as one that did
nothing. A matchup made for a big gap may not make a photo finish at a short length (the
faster ball would pass 3200 px/s); that is a `fast` problem, and says so.

The matchup card at the top of the panel shows the result under the two balls ("X wins by
5.0 s", and "The video runs 40 s").
Its button appears when a hand edit left the race off length, or not as close as asked
(a photo finish over 1.5 s, or more than 1.5 s off the chosen gap): **Make it close** for a
photo finish, **Rebalance** for a gap.

## 2. The video length

`timing.video` is the length of the whole video. [pacing.ts](../src/pacing.ts) knows what
surrounds the race:

| Part | Seconds |
| --- | --- |
| hold before the start | `timing.startDelay` (0.5) |
| slow motion into the win | the last 0.6 s of race play at 0.3×, so 1.4 s extra |
| slow motion after the win | 1.2 |
| winner card | `cardSeconds`: `timing.hold` (3.5), or, when the video is narrated, the winner line's length at 11 characters a second + 0.4 s, whichever is more. Narrated (`narrated`) means a narrator is picked and the Sound is Narrator and music; music only and silent videos plan the hold alone |
| the end | `END_PAD` 0.5: the fade into the first frame (`look.loop`), or a held moment |

`raceSeconds(cfg)` = video − all of that (at least 8 s). The estimate errs long; the page
then stretches the winner card so the recording ends exactly on the length, never cutting
the winner line ([recording](./recording-and-export.md#2-ending-on-the-exact-length)). A
recording lands within a few hundredths of a second of the requested length.

## 3. The dice: random matchups

`randomMatchup(seed, base)` tries combinations from the seed until one balances, usually
in a few milliseconds:

1. **Two different sequences**, from all but `ones` (which needs a hundred hits for even
   the smallest round layer) and `pi` (4.5 a hit pairs with nothing but Counting, on one
   layer of 100). Fourteen sequences make 65 pairs that can race.
2. **Layers**: for each power of ten up to **10^18**, count the hits each sequence needs to
   deal it (`hitsFor`); keep powers where both need 14–80 hits and neither needs more than
   8× the other. Pick from the upper half of what fits (big numbers are half the fun), then
   2–4 layers rising to it, as round values (1, 2 or 5 × a power of ten). 10^18 is the
   cap so every value, and the damage that breaks it, fits a card as whole digits.
3. **Colours** from `COLORS`, at least 75° apart in hue (two greens read as one team).
4. **Often a power** (a special; the panel says power): with the **Powers in random
   matchups** switch on, about every other matchup gets one (51 to 59 of 100 in
   `npm run tune`), on one ball, or a different one on each ball one time in three ("one
   splits, the other speeds up"); with it off (the default), never. Half the rolls stay
   sequence against sequence, the format; the other half are the twist that keeps a run of
   videos from looking alike. The hint under it (`#powers-hint`) says what a power does and that the video marks the ball
   with a ⚡ tag ([look and layout](./look-and-layout.md)). The switch is
   the dice's own setting, kept under `bouncereel:dice` and not in the config, so loading a
   classic, a file or a video does not change it; a plan without powers locks it off. The
   home page's hero rolls without powers, and plays only the classics that have none.
   Amounts: `faster` 1.5–4 %, `slower` 1–2.5 %, `grow` 3–9 px, `split` 1. Ball size
   22–28 px; 18 for growing, 16 for splitting.
5. **Now and then a size** (`SIZED`, about one matchup in three), on a ball without a power,
   powers switch or not: one ball **Big** (34–40 px) or **Tiny** (14–16 px), or one time in
   three a big one against a tiny one. It is a real difference, not a costume: a bigger ball
   has less far to fall, and balancing evens it out like any other.
6. **A melody**, then **balance**. A combination that does not balance is skipped.
7. **Names** from the ball's numbers: the sequence's noun, with one word in front. **Big**
   or **Tiny** for a size; else **Slow** or **Fast** when its speed is half or double the
   other's, as far as the matchup's pace words allow (`PACE_WORDS`, drawn per matchup:
   both, only Fast, only Slow, or neither). A fast-growing sequence against a slow one
   balances to speeds 2× apart nearly every time, and both words every time would make two
   rolls in three "Slow X vs Fast Y"; without a word, the narrator says the slower ball is
   slower
   ([sound and narration](./sound-and-narration.md)). "Fibonacci Ball", "Big Prime Ball",
   "Fast Triangle Ball". A power stays out of the name ("Tiring Triangle Ball" is a word puzzle; the picture and
   the opening say what the ball does), and a ball that speeds up or slows down gets
   neither Slow nor Fast, since its starting speed is wrong within seconds. Named once
   before balancing (the winner line's length is part of the timing) and again after. The
   built-in matchups keep their own names ("Growing vs Speeding" is two Fibonacci balls
   told apart by their powers).

Voice, volume, timing and look come from the current config; the page clears a
hand-written opening, which would describe the old matchup.

`npm run tune` generates 100 random matchups at 30, 40 and 60 s, as the dice comes and
with powers off, and reports how many have a power, how many were photo finishes and how
many came out more than 1 s off length (it should be 0); then 100 more at finish gaps of
3, 5 and 10 s, with how many came out more than 1 s off length or off the gap (both should
be 0).

## 4. Sequences

[sequences.ts](../src/sim/sequences.ts). `term(n)` is the damage of a team's (n+1)-th
floor hit, a BigInt, precomputed 400 terms deep.

| Id | Terms | Noun (generated names) |
| --- | --- | --- |
| `fibonacci` | 1, 1, 2, 3, 5, 8… | Fibonacci |
| `factorial` | 1, 2, 6, 24, 120… | Factorial |
| `doubling` | 1, 2, 4, 8, 16… | Doubling |
| `tripling` | 1, 3, 9, 27… | Tripling |
| `squares` | 1, 4, 9, 16… | Square |
| `cubes` | 1, 8, 27, 64… | Cube |
| `primes` | 2, 3, 5, 7, 11… | Prime |
| `triangular` | 1, 3, 6, 10… | Triangle |
| `tribonacci` | 1, 1, 2, 4, 7, 13… | Tribonacci |
| `lucas` | 2, 1, 3, 4, 7, 11… (Fibonacci's rule from 2 and 1) | Lucas |
| `catalan` | 1, 1, 2, 5, 14, 42… (nearly ×4 a hit once going) | Catalan |
| `tenfold` | 1, 10, 100, 1000… (a zero a hit; races only on layers of 10^13 and up) | Tenfold |
| `collatz` | 27, 82, 41, 124, 62… (halve when even, 3n+1 when odd: up and down, peaks at 9,232 on hit 78, reaches 1 on hit 112, then 4, 2, 1; races only on layers up to 10^4) | Collatz |
| `counting` | 1, 2, 3, 4… | Counting |
| `pi` | 3, 1, 4, 1, 5, 9… (the digits of pi, worked out by Machin's formula; a 0 hits for nothing; only by hand) | Pi |
| `ones` | 1, 1, 1… | (none: "Steady Ball") |

Each also has a `brief` (one clause for the opening: "adds up its last two hits"), a
`fact` (one true line the opening can add: "Fibonacci numbers hide in sunflowers and pine
cones.") and a `mark`, the one or two characters its ball wears in the paper look (F, n!,
×2, n², P…; only characters Rubik's Latin set has). Adding a sequence is one
entry with all six; the panel, the generator, the narrator and the renderer pick it up.

## 5. Built-in matchups

[config.ts](../src/config.ts) `PRESETS`, each balanced to the video length when loaded
(keeping the narrator and the length):

| Matchup | Notes |
| --- | --- |
| Fibonacci vs Slow Factorial | the original format: 1.000 / 10 billion / 10^15 |
| Doubling vs Fibonacci | 1.000 / 10^8 / 10^12 |
| Primes vs Squares | primes lead early, squares overtake late; 150 / 1.500 / 8.000 |
| Speeding Ball vs Doubling | counting that speeds up 3 % a hit; layers kept small so it stays under the speed limit |
| Multiplying Ball vs Fibonacci | counting that splits; up to 64 balls |
| Growing vs Speeding | both Fibonacci: bigger against faster |
| Tribonacci vs Tripling | 1.000 / 10^9 / 10^14 |

A new one: add a `preset(...)` call, then `npm run tune` must show it balancing at 30, 40
and 60 s. Speeds in a preset are only a starting point; balancing replaces them. Loading one keeps
the narrator, video length, finish gap and look.

## Changelog

- 2026-10-18 - balancing by speed scaling, video length and pacing, the random matchup
  generator, layers capped at 10^18, seven built-in matchups.
- 2026-10-19 - the finish gap: a photo finish by default, or 1–10 s between winner and loser; `tune` checks 3, 5 and 10 s.
- 2026-10-19 - powers only now and then (about one matchup in four, mostly on one ball) and a switch to turn them off; sequences carry a `mark`; the end is the loop's 0.5 s fade.
- 2026-10-20 - the winner card is planned around a winner line only when the video is narrated (`narrated`: a narrator and the Sound Narrator and music); music only and silent balance to the hold.
- 2026-10-21 - generated names leave the power out (no more Speeding, Tiring, Growing, Multiplying in front); the dice's Powers switch starts off; the hero rolls without powers.
- 2026-10-21 - the switch is Powers in random matchups, with a hint; `balanceProblem` says which ball keeps a matchup from balancing and why; Rebalance tries new seeds of the same matchup, then explains in the matchup card.
- 2026-10-25 - more varied rolls: a power about every other roll with the switch on (two different ones on both balls one time in three), a Big or Tiny ball about one roll in three with or without powers, and Slow and Fast said on both, one or neither name.
- 2026-10-25 - five more sequences: Lucas, Catalan, Tenfold and Collatz on the dice (65 pairings, from 33), Digits of pi by hand.
