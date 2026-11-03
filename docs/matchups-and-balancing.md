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
| how often it makes a crowd, of how many balls, how hard they hit | [src/sim/balance.ts](../src/sim/balance.ts) `CROWD_CHANCE`, `CROWD_COUNTS`, `CROWD_HITS`, `crowdRadius`; `STRENGTHS` in [sequences.ts](../src/sim/sequences.ts) |
| what the dice keeps (the locks beside each ball, and under its Balls and Hit strength) | `#lock-a`, `#lock-b` and `#dice-label` in [app.html](../app.html); `locks`, `addFieldLock`, `randomize`, `syncDice` in [src/app.ts](../src/app.ts); `Keep`, `keep` in `randomMatchup`, `keptWhole` |
| a ball changed by hand (its numbers, Balls, Hit strength, power): its name, size and balance | `count`, `strength` in [src/ui/fields.ts](../src/ui/fields.ts); `reshape`, `rebalance` in [src/app.ts](../src/app.ts); `relayer`, `sizeFor`, `plainName`, `diceName` in balance.ts |
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
  picked by the seed (`balance:<seed>`, or the other one for a comeback, below), gets
  exactly that; the other gets the race plus the **finish gap**:
  - `timing.gap` 0 (the default, "photo finish" on the slider): 0.15–1.1 s more, also
    picked by the seed. A near photo finish.
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
- **The comeback.** Four seeds in five ask for one (`comeback:<seed>`, `COMEBACK`): the
  winner spends more of the race behind than ahead and goes ahead for good only in its last
  30 %, or at the line (`isComeback`, from `predict`'s `trailed`, `led` and `decided`). Who
  wins is then open until the end, and that is what keeps viewers watching. Both teams are
  scaled to arrive together, so whichever trails most of the way is still close at the end:
  when the seed's winner does not give what the seed asks for, the other one is solved too,
  and the race nearer the ask is kept (longer behind for a comeback, shorter for a hold). The
  fifth seed asks for the leader to hold on, by a hair: a viewer who learnt that the ball
  behind always wins would know the end from the first second. A matchup whose other winner
  does not fit keeps the seed's. The dice passes over up to four matchups that cannot make a
  comeback its seed asks for (`COMEBACK_TRIES`), so 78 of 100 rolls win from behind at every
  length (`npm run tune`; 37 before), against 6 of the 9 built-in matchups.
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
| hold before the start | `timing.startDelay` (0: the balls move from the first frame, under the opening title) |
| slow motion into the win | the last 0.6 s of race play at 0.3×, so 1.4 s extra |
| slow motion after the win | 1.2 |
| winner card | `cardSeconds`: `timing.hold` (2: once the race is decided viewers leave, and a short end loops back sooner), or, when the video is narrated, the winner line's length at 11 characters a second + 0.4 s, whichever is more. Narrated (`narrated`) means a narrator is picked and the Sound is Narrator and music; music only and silent videos plan the hold alone |
| the end | `END_PAD` 0.5: the fade into the first frame (`look.loop`), or a held moment |

`raceSeconds(cfg)` = video − all of that (at least 8 s). The estimate errs long; the page
then stretches the winner card so the recording ends exactly on the length, never cutting
the winner line ([recording](./recording-and-export.md#2-ending-on-the-exact-length)). A
recording lands within a few hundredths of a second of the requested length.

## 3. The dice: random matchups

`randomMatchup(seed, base)` tries combinations from the seed until one balances, usually
in a few milliseconds:

1. **Two different sequences**, from all but Always the same (`ones`: a hundred hits for even
   the smallest round layer its size, so it is a crowd's) and `pi` (4.5 a hit pairs with
   nothing but Counting, on one layer of 100). Fifteen sequences make 79 pairs that can race.
2. **Often a crowd** (`CROWD_CHANCE`, about one roll in four, powers switch or not): one ball
   becomes Always the same, 30 to 200 balls (`CROWD_COUNTS`) that all hit with the same number
   every time, at a strength the roll picks from 1 to a million in powers of ten (`STRENGTHS`):
   spam against skill, the format's favourite twist ("100× Millionaire Balls vs Penny Ball").
   Only Always the same is ever a crowd: a hundred balls of numbers that grow would break every
   layer within seconds. A crowd has no power and no size word; its balls are 13 px, 11 from a
   hundred, 9 at two hundred (`crowdRadius`). Its hits come from all of its balls together, so
   what has to be watchable is the hits each ball makes: 8–36 (`CROWD_HITS`, where a lone ball's
   are 14–80; at 36 hits each a 30 s crowd moves at about 1,800 px/s, where a swarm at a lone
   ball's 2,500 is a blur). Its strength chooses the layers: a crowd hitting for one gets
   hundreds and thousands, one hitting for a million gets billions. The home page's hero makes
   none.
3. **Layers**: for each power of ten up to **10^18**, count the hits each ball needs to deal
   it (`hitsFor`, over running totals kept per sequence, so a crowd's thousands of hits are
   counted once), per ball for a crowd; keep powers where both are in their window and
   neither needs more than 8× the other. With a crowd in the race, 2 and 5 × a power of ten
   are tried as the top too: a hundred balls hitting for one need 2,000 or 5,000, where 1,000
   is too few and 10,000 too many. Pick from the upper half of what fits (big numbers are
   half the fun), then 2–4 layers rising to it, as round values (1, 2 or 5 × a power of ten).
   10^18 is the cap so every value, and the damage that breaks it, fits a card as whole
   digits. In front of three or fewer goes a **small first layer** (`starterLayer`): the
   biggest round value both balls deal within their first four hits, at least 2 and kept only
   when it is at most a fifth of the layer after it. Something breaks in the first second
   (the median is 0.9 s in `npm run tune`), with a shake and the box growing down, while a
   viewer is still deciding whether to stay.
4. **Colours** from `COLORS`, at least 75° apart in hue (two greens read as one team).
5. **Often a power** (a special; the panel says power): with the **Powers in random
   matchups** switch on, about every other matchup gets one (39 to 56 of 100 in
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
6. **Now and then a size** (`SIZED`, about one matchup in three), on a ball without a power,
   powers switch or not: one ball **Big** (34–40 px) or **Tiny** (14–16 px), or one time in
   three a big one against a tiny one. It is a real difference, not a costume: a bigger ball
   has less far to fall, and balancing evens it out like any other.
7. **A melody**, then **balance**. A combination that does not balance is skipped.
8. **Names** from the ball's numbers: the sequence's noun, with one word in front. **Big**
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
   told apart by their powers). Always the same is named after its strength (One, Ten,
   Hundred, Thousand, Ten Thousand, Hundred Thousand, Millionaire: `strengthNoun`), and a crowd
   after its number and that: "100× Millionaire Balls", "200× One Balls", "50× Thousand
   Balls", as the format writes them.

9. **The words**, from a stream of their own (`words:<seed>`) so the matchup a seed gives
   stays the same: the question goes back to the new seed's pick, and the winner card's
   last line and the winner line are new picks from `LAST_LINES` and `WINNER_LINES`
   ([config.ts](../src/config.ts)), never the one before. Only the dice's own words: a
   line the creator wrote, or none, stays. Dealt before balancing, since the winner line's
   length is part of the timing.

Voice, volume, timing and look come from the current config; the page clears a
hand-written opening, which would describe the old matchup.

**Locks**, all open on every visit. Beside each ball in the matchup card, one that keeps the
ball (`Keep.ball`): its numbers, power, colour, size, and a name its creator wrote. Under its
**Balls** and **Hit strength** in the Balls tab, one each that keeps how many balls it is
(`count`) and how hard it hits (`strength`); either closes the ball's lock too, since they are the
ball's, and opening the ball's lock opens them. Whatever is not locked is rolled: a kept Always
the same ball with its count locked gets a new strength, a new opponent and new layers; with its
count and strength locked, only a new opponent and new layers. A kept ball's speed is always
balanced again, and a name the dice gave it is given again (`diceName`), since Slow, Fast, its
count or its strength may no longer be true. The dice button says what a roll will do: **New
opponent** with one ball kept; with both kept, **New layers** when nothing of either is left
to roll (`keptWhole`), else **Roll the rest**. When nothing fits (one Always the same ball on its
own needs a hundred hits for the smallest layer; two kept balls no round layers suit), the roll
is null and the matchup card says why and what to change.

**A ball changed by hand**, its numbers, **Balls**, **Hit strength** or power (`reshape`): its
name follows when the dice gave the one it had ("Fibonacci Ball" made Always the same at a
thousand, a hundred of them, is "100× Thousand Balls"; a name its creator wrote stays), Always
the same becomes a crowd of a hundred (one ball alone cannot race), any other numbers one ball,
and its size follows its count (`sizeFor`). **Balls** and **Hit strength** are Always the same's
alone. Then the race is balanced again by itself, as **Make it close** does (`rebalance`): this
race, new races of it, then new layers for the same two balls (`relayer`); and, for the ball
just changed, a new opponent when no layers suit the two (a hundred balls hitting for a
thousand against Factorial), unless the opponent is locked. A message says which.

`npm run tune` generates 100 random matchups at 30, 40 and 60 s, as the dice comes and
with powers off, and reports how many have a power or a crowd, how many were photo finishes
and how many came out more than 1 s off length (it should be 0); 30 rolls keeping the top
ball and 30 keeping both, with how many found nothing (a few, for two kept balls), changed a
kept ball (it should be 0) or came out off length (0); then 100 more at finish gaps of 3, 5
and 10 s, with how many came out more than 1 s off length or off the gap (both should be 0).

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
| `golden` | 1, 2, 3, 4, 7, 11, 18… (the golden ratio's powers rounded, so each hit is 1.618 times the last; from the second, the Lucas numbers, so exact however far it goes) | Golden Ratio |
| `catalan` | 1, 1, 2, 5, 14, 42… (nearly ×4 a hit once going) | Catalan |
| `tenfold` | 1, 10, 100, 1000… (a zero a hit; races only on layers of 10^13 and up) | Tenfold |
| `collatz` | 27, 82, 41, 124, 62… (halve when even, 3n+1 when odd: up and down, peaks at 9,232 on hit 78, reaches 1 on hit 112, then 4, 2, 1; races only on layers up to 10^4) | Collatz |
| `counting` | 1, 2, 3, 4… | Counting |
| `pi` | 3, 1, 4, 1, 5, 9… (the digits of pi, worked out by Machin's formula; a 0 hits for nothing; only by hand) | Pi |
| `ones` | Always the same: one number every hit, the ball's strength (1 to a million, `STRENGTHS`); the only crowd | its strength's: One, Thousand, Millionaire… |

Each also has a `brief` (one clause for the opening: "adds up its last two hits"),
`facts` (two or three true lines the opening can add, the seed picking one: "Fibonacci
numbers hide in sunflowers and pine cones."), a `mark`, the one to three characters its ball wears in the paper look (F, n!,
×2, n², P…; only characters Rubik's Latin set has, and the golden ratio's φ, which the
renderer draws), and a `rule`, what it does in a few capitals under its name on the first frame
("ADDS UP ITS LAST TWO HITS", "×1.618 EVERY HIT", "HITS 1, 4, 9, 16, 25…"; Always the same
writes its strength instead, [look and layout](./look-and-layout.md) §11). Adding a sequence is
one entry with all of them (`id`, `label`, `hint`, `noun`, `brief`, `facts`, `mark`, `rule`,
`term`); the panel, the generator, the narrator and the renderer pick it up. ⚠️ A table runs 400 terms deep (`LENGTH`): a crowd makes
thousands of hits, so what a crowd hits with, Always the same, has a formula instead; past 400 a
table repeats its last term.

## 5. Built-in matchups

[config.ts](../src/config.ts) `PRESETS`, each balanced to the video length when loaded
(keeping the narrator and the length):

| Matchup | Notes |
| --- | --- |
| Fibonacci vs Slow Factorial | the original format: 5 / 1.000 / 10 billion / 10^14 (the format's 10^15 would take Fibonacci past 3,200 px/s at 30 s) |
| Doubling vs Fibonacci | 5 / 1.000 / 10^8 / 10^12 |
| Primes vs Squares | primes lead early, squares overtake late; 10 / 150 / 1.500 / 8.000 |
| Speeding Ball vs Doubling | counting that speeds up 3 % a hit; 10 / 100 / 500 / 2.000, kept small so it stays under the speed limit |
| Multiplying Ball vs Fibonacci | counting that splits; up to 64 balls; 1.000 / 10^5 / 10^6, no small first layer: a box that splits on every hit is busy from the first, and would not balance at every length with one |
| Growing vs Speeding | both Fibonacci: bigger against faster; 5 / 1.000 / 10^8 / 10^12 |
| Tribonacci vs Tripling | 5 / 1.000 / 10^9 / 10^14 |
| Golden Ratio vs Tripling | 1.618 times a hit against 3 times; 10 / 50.000 / 4 billion / 5 × 10^14, after the reel this follows |
| 100× Millionaire Balls vs Doubling | a crowd of a hundred hitting for a million against one ball doubling from 1; 10 / 1 million / 1 billion / 2 billion |

Every one but Multiplying Ball starts on a small layer, broken within the first four hits, as
the dice's do.

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
- 2026-10-26 - the dice deals the words too (`words:<seed>`): the seed's question, a new last line and winner line, keeping a creator's own; sequences carry two or three `facts`.
- 2026-11-02 - crowds (`count`, up to 200 balls), Always the same's alone: about one roll in four, of 30–200 balls at a strength of 1 to a million (`strength`), on layers chosen per ball (`CROWD_HITS`, tops of 2 and 5 × a power of ten); the Balls and Hit strength fields; locks for a ball, its count and its strength (New opponent, New layers, Roll the rest); a ball changed by hand renamed and balanced again, on new layers or against a new opponent when it must; the golden ratio; Golden Ratio vs Tripling and 100× Millionaire Balls vs Doubling.
- 2026-11-03 - a small first layer (`starterLayer`), broken within both balls' first four hits, in front of three or fewer rolled layers and on every built-in matchup but Multiplying Ball (Fibonacci vs Slow Factorial tops at 10^14, Golden Ratio vs Tripling at 5 × 10^14); no hold before the start by default; a `rule` per sequence for the first frame.
- 2026-11-03 - comebacks: four seeds in five ask for the winner to trail most of the race and go ahead only in its last 30 % (`isComeback`, `COMEBACK`), the other winner solved when the seed's does not give it and the dice passing over matchups that cannot (`COMEBACK_TRIES`): 78 of 100 rolls win from behind, from 37; the winner card's default hold 2 s, from 3.5.
