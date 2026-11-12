# Arena Clash

BounceReel's second game, and a game of its own: its own rules, simulation, balancing, look and
card in the studio. 2 to 12 balls in one round arena on a black stage, each a country's flag,
each tied to the ring by a fan of strings. A ball that touches a rival's strings cuts every one
it touches; a bounce off the ring ties new ones; a ball with no strings left is out; the last
flag in wins. It is the short-video format known as the "string circle". It is made in the same
studio as Ball Race (the switch at the top of the panel), recorded the same way and kept in the
same library, and only on a plan with `allGames` (Champion). This page is the whole game.

**The name** is the game's, not its flags': the contestants are countries today and may be
something else one day, so nothing in its name says flag. Its id is `arena-clash` (the config,
the library, `GAMES` in [shared/features.ts](../shared/features.ts)); while it was being made it
was Flag Battle, `flag-battle`, which a config kept from then still opens as (`savedConfig`), and
which its migration's file name keeps (0011_flag_battle.sql, already applied). **Its icon** is
[public/games/arena-clash.svg](../public/games/arena-clash.svg), Ball Race's
[ball-race.svg](../public/games/ball-race.svg) beside it: on the studio's switch, the site's game
cards and the Videos page's thumbnails ([website](./website.md#4-the-home-page)).

| I need to change... | Touch |
| --- | --- |
| the rules: strings, cuts, bundles, the speed-up, ball sizes, collisions, the time limit | [src/sim/battle.ts](../src/sim/battle.ts) `BattleWorld`, then `npm run tune` |
| how many flags | `MIN_FLAGS`/`MAX_FLAGS` in [battle.ts](../src/sim/battle.ts); 12 also bounds the Worker's check ([worker/validate.ts](../worker/validate.ts)) |
| how a battle is fitted to the video length, the spread of its outs, a chosen winner, the speeds | [src/sim/battle-balance.ts](../src/sim/battle-balance.ts) `searchBattle` |
| the dice: flags from a region, its words | `randomBattle` in [battle-balance.ts](../src/sim/battle-balance.ts); the regions in [src/battle/countries.ts](../src/battle/countries.ts) `DICE_REGIONS` |
| which countries are offered, their names, figures | [src/battle/countries.ts](../src/battle/countries.ts), the SVGs in [public/flags/](../public/flags/) |
| a flag's picture, its strings' colour | [src/battle/flags.ts](../src/battle/flags.ts) |
| the arena's geometry | `ARENA` in [src/layout.ts](../src/layout.ts) (physics: run `npm run tune`, and a battle recorded before no longer replays as it played); where the picture sits on the frame, `DROP` and the title's heights in [src/render/battle.ts](../src/render/battle.ts) |
| how it looks: the stage, the title, N LEFT and OUT, the strings, the balls and their counts, effects, the slow motion tag, the follow button, the winner card, the watermark | [src/render/battle.ts](../src/render/battle.ts) `BattleRenderer` |
| what both games draw with (type, colour sums, the mark), the follow button itself | [src/render/draw.ts](../src/render/draw.ts), [src/render/follow.ts](../src/render/follow.ts) |
| what it sounds like | `Sonifier.battle` in [src/audio/sonify.ts](../src/audio/sonify.ts) |
| what the narrator says | `battleScript` in [src/audio/narration.ts](../src/audio/narration.ts); the title's questions `BATTLE_QUESTIONS` in [opening.ts](../src/audio/opening.ts); the winner and last lines `BATTLE_WINNER_LINES`, `BATTLE_LAST_LINES` in [src/config.ts](../src/config.ts) |
| the studio's card, the switch, balancing between frames, slow motion in playback | [app.html](../app.html) `.games`, `.battle`; [src/app.ts](../src/app.ts) "Arena Clash" (`buildBattleBlock`, `searchBattle`, `syncBattle`), `slowed`, `simulate` |
| what the library keeps | `battle` on `videos` ([0011_flag_battle.sql](../migrations/0011_flag_battle.sql)), `BattleSummary` in [shared/api.ts](../shared/api.ts), [worker/validate.ts](../worker/validate.ts), [worker/videos.ts](../worker/videos.ts) |
| which plans make it | `allGames` and `gameAllowed` in [shared/features.ts](../shared/features.ts) ([accounts-and-billing](./accounts-and-billing.md#6-plans-and-features)) |
| its name, icon, the site's card and page | `GAME_LABELS` in [shared/features.ts](../shared/features.ts), [public/games/](../public/games/), [games.html](../games.html) and the home page's `#games` ([website](./website.md)) |

## 1. The rules

- **The arena** is one circle (`ARENA`: centre 540, 915, radius 485; 970 px across, 55 px from
  each side of the frame). Balls fly straight, all at one speed, and bounce off the ring and off
  each other.
- **They speed up.** Every ball starts at `battle.speed` (set by balancing) and gains that speed
  again every 8,000 px it travels, to twice it (`pace`), as the format's videos speed up. A long
  duel plays faster and ends sooner in seconds. With every bounce tying strings (below) the last
  two can hold out a long while (half of sixty duels took more than 6,000 px); growing the balls
  instead only wedged them (more than half never ended).
- **Strings.** Each flag starts with `STRINGS` (100) in one fan across its slice of the ring
  (never wider than 109°: two flags would each hold half the ring, a comb and not a fan), its
  ball in front of the middle of it, heading for the centre. A string runs from where it is tied
  on the ring to its ball and moves with it.
- **Cuts.** A ball cuts every rival string it touches, at once; its own it passes through. So a
  ball flying between a rival and its fan takes all of the fan. Seen from a flag's ball, a rival
  hides a stretch of the ring (between the two lines from the ball that graze the rival); every
  string tied in that stretch runs through the rival and no other does, so a cut is one slice
  out of the flag's strings, kept in the ring's order (`sever`).
- **Bounces.** **Every bounce off the ring ties a `BUNDLE` (10) where it hit**, a narrow fan
  about 55 px wide, however many the ball already holds: there is no most, so a ball may hold
  150 or more (250, the most in sixty battles), and strings only ever go by being cut. Strings
  come from nowhere else: a viewer who sees one appear looks for the bounce that tied it, and
  one who sees a ball hit the ring looks for its new strings. A bounce also turns the ball by up
  to `SCATTER` (0.3 rad) and never leaves it skimming the ring: a perfect circle is too regular a
  table, and without it two flags settle into paths that never meet (more than half of sixty
  duels never ended).
- **Meeting.** Two balls that meet bounce off each other as equal masses, each turned by up to
  `CLASH` (0.3 rad) more: without it two balls that met head on bounced straight back, met again
  in the middle, and went on so for 4,000 px with neither ever behind the other, where its
  strings are.
- **Out, and the win.** A ball with no strings is out (`place` counts down: the first out of
  twelve is #12); the last one in wins, place 1, and flies on alone behind the winner card.
- **Sizes.** Balls grow as rivals go out (`RADII`: 48 px for twelve in, 90 for three, 100 for the
  last two), so a flag is read on a phone at twelve and the last two fill the arena.
- **What ends a battle** is the cuts. A rival passing near a ball hides a stretch of the ring
  from it and cuts every string tied there, so strings spread round the ring go a stretch at a
  time, and a ball down to its last bundle, where it last hit the ring, is out the next time a
  rival passes behind it; with the balls speeding up (above), a long duel plays faster. Nothing
  else takes strings away: no cap, no fuse, no strings let go of.
- **Time limit.** At `timing.maxSeconds` (balancing sets the battle plus 30 s) the flag with the
  most strings wins, then the most cuts, then the order given. A balanced battle never gets there.

**It steps by distance, not time.** Every step moves every ball `STRIDE` (1 px) whatever the
speed, which only says how long a step lasts (`BattleWorld.dt` at the start, `nextStep` as the
balls speed up). So a battle twice as fast is the same battle, to the last string, in half the
time: what balancing is built on (section 2). A battle's seconds are a sum of each step's
(`timeAt`, the sums of 1 / pace shared by every battle), so the same everywhere. The page runs as
many steps as a frame's time holds and draws the balls the part of a step further on
(`BattleOverlay.lead`), so motion is even at any speed and in slow motion.

**Determinism**, as the race's ([simulation](./simulation.md)): no `Math.sin`/`cos`/`atan2`/
`hypot`, only `dsin`/`dcos` and `Math.sqrt`; a string's place round the ring is a number made
from sums and one division (`ringKey`) where an angle would take an arctangent; randomness from
`createRng(\`battle:${seed}:${n}\`)` (the flags' count, not their codes, so a swapped flag keeps
the geometry). `predictBattle` runs it to the win in a few milliseconds; the page replays it
exactly, which the Videos page's Open in studio shows.

**The game is made for three or four flags**, the format's usual count and what the studio
opens with; up to twelve are there to be possible.

⚠️ **With many flags the first ones go in a burst.** Each flag starts with all its strings in
one fan, which one rival between the ball and the ring can hide whole; bounces cannot spread
them before the first melee, since a ball holding a hundred ties nothing. Twelve flags are down
to five within about 1,500 px whatever the bundle size, the ball size, the scatter or how many
strings they start with (all measured). The format's own videos do the same. Balancing picks the
battles where it is least so (section 2); three and four flags have no burst to speak of.

## 2. Balancing

`searchBattle` ([battle-balance.ts](../src/sim/battle-balance.ts)) makes a battle end when the
video needs it to, with its outs spread over it:

1. The target is `raceSeconds(cfg, name)`: the video length less the frame around it
   ([pacing.ts](../src/pacing.ts), the same as a race's), one per flag, since the winner card is
   planned for the winner line said with the winner's own name: a battle fitted to "Saint Vincent
   and the Grenadines wins!" that Chad wins would end a second and a half short.
2. A seed is run once at a starting speed of 1 px/s. If it is won after 9,000 of its seconds and
   its winner leaves the battle 26 s, starting at 346 px/s puts its last string on the 26th
   second **exactly**: the balls speed up the same way at any starting speed, so every second
   scales alike, and nothing is nudged or approximated. The seed is the only other choice. The outs among the last flags play in slow motion
   (`BattleOutcome.slow`, below), which is video too: the speed is the battle's px plus that
   extra, over the seconds (`slowExtra`).
3. A seed lands if that starting speed is one worth watching: 260 to 460 px/s, up to twice it by
   the end. The format's channels fly at 200 to 320 in an arena this size, and one at 100 reads
   as slow motion all through.
4. Of the seeds that land, the first whose flags go out when a video wants them to is taken
   (`uneven`):
   - **up to five flags, a schedule**: every stage as long as the others but the duel, 0.7 of
     one. Of three flags the first is due out at 59 % of the battle, so most of the video has
     all three in it and the last 41 % is the duel; of four, at 37 % and 74 %. A battle passes
     when no out is further than 12 % of the battle from its due moment (18 % after 40 seeds);
   - **more than five, spread**: no stretch without a flag going out longer than `spreadLimit`
     (0.43 of the battle for six flags, 0.35 for twelve; 0.14 more after 40 seeds), counting half
     the share of outs within a second of each other (`RUSH`) against it;
   - never a flag out in the video's first 2.5 s.

   After 120 seeds (400 with a chosen winner) the best found is taken. With a chosen winner
   (`battle.winner`) only seeds where that flag wins land.

Seeds are the config's own first, then `<seed>.1`, `<seed>.2`…, so an already balanced battle
lands again at once. `npm run tune` checks 20 random battles of 2, 3, 4, 6 and 12 flags at 30, 40
and 60 s, with and without a chosen winner: all land, none more than 0.1 s off the length, the
chosen winner always wins. Three flags in a 30 s video: about 25 ms, the first flag out between
the 10th and the 13th second, the last two fighting 8 to 10 s; in 40 s, the first out from the
15th second on; in 60 s, from the 18th. Four flags in 30 s: out at about the 7th and the 18th
second. Twelve: the first out at 2.5 s or later (2 s, now and then, with a chosen winner),
about a third of the battle the longest quiet stretch at 30 s, up to 4 s to balance with a
chosen winner.

⚠️ **A 60 s video of many flags ends on a long duel**: the burst (section 1) is as long in px
whatever the video's length, so the last two or three stages take what is left, 15 to 30 s of
it. 30 to 45 s suits five flags and more; three flags fill a minute well.

⚠️ A battle that cannot be balanced (none of the tries landed) is loaded as it is and the card
says so; Record still works, and the video may end off its length. It can happen with twelve
flags, a chosen winner and a 60 s video: one battle of twenty, in one run of `npm run tune`.

**Slow motion for the last outs.** A flag going out while at most four are in plays slowed
(`SLOWMO`, pacing.ts, as the win's): from 120 px before its last string is cut to 30 px after,
unless the win's own slow motion is that near. The stretches are in px, so they are the same at
any speed; `predictBattle` gives them in the battle's seconds, the page slows down inside them
(`App.slowed`) and the picture says SLOW MOTION.

## 3. The flags

The list ([countries.ts](../src/battle/countries.ts)): the 193 members of the United Nations,
the Vatican and Palestine, and England, Scotland, Wales and Northern Ireland as countries of
their own. **Kosovo and Taiwan are not offered, by the owner's decision**; do not add them
without asking. Each has the name the narrator says in English ("Ivory Coast", "Turkey", "DR
Congo"), a short form for the title and the winner card when the name is long ("BOSNIA", "N.
MACEDONIA"), a region for the dice (the Balkans are in Europe too), people and land area.

**The figures** feed one sentence of the narrator's opening. People: World Bank `SP.POP.TOTL`,
2025; land: World Bank `AG.LND.TOTL.K2`, 2024 (both CC BY 4.0; Serbia's includes Kosovo, as the
World Bank's does); the Vatican's own figures; the four UK nations from the Office for National
Statistics, mid-2023. The narrator only ranks them or rounds them ("about 6.5 million"), so a
year-old estimate never makes a fact false.

**The pictures** are flag-icons 7.5.0's square flags (MIT, [its licence](../public/flags/LICENSE.txt)),
copied into `public/flags/<code>.svg` with `width`/`height` (512) added, so an image of one has
a size before it is drawn. Served from this site, so no outside request
([privacy](../privacy.html)). [flags.ts](../src/battle/flags.ts) draws each once into a 256 px
canvas (a canvas copies; an SVG image would be rasterised every frame). Play and Record wait for
a battle's flags before the first frame; until one loads its ball is drawn in its colour.

**Strings' colours.** Twelve that tell apart on the black stage (`PALETTE`). On loading, a
flag's picture is sampled (every fourth pixel) and each coloured pixel votes for the nearest of
the first ten; white, black and greys do not vote. A flag takes its first choice still free in
the battle, in the order given: Serbia red, Croatia (red taken) blue. The colour comes from the
picture in the page, so it is not in the library or the superadmin's text.

## 4. The look

One look, the format's: a black stage where only the strings and the flags are lit
([src/render/battle.ts](../src/render/battle.ts)). The race's three looks (`look.skin`) are the
race's; the studio hides the Look field in a battle. The two games' renderers share only what is
in [draw.ts](../src/render/draw.ts) (the type, colour sums, text that fits, the mark, the
preview marks, the base `Overlay`) and [follow.ts](../src/render/follow.ts) (the follow button).

- **The title**, under the platforms' top bar and over the ring, from the first frame to the
  last, so the first frame is the thumbnail:
  - who is in it, at y 324: up to four flags' names, each in its strings' colour, with VS
    between ("SERBIA VS CROATIA VS SLOVENIA"), 38 px or as small as 28 to fit, those out dimmed
    and struck through; from five flags, or when four long names would not fit, "8 FLAGS · ONE
    SURVIVES";
  - the question in big white type at y 388 (up to 84 px, fitted to 960 px): the video's
    `look.question`, which the narrator's opening ends on, in capitals without its full stop;
  - how many are left at y 468 ("2 LEFT"), centred and alone. For 1.7 s after a flag goes it is
    that flag and "CROATIA OUT" in its colour instead, popping in. Who went is said in the names
    above: a flag out stays where it was, dimmed and struck through. Small flags of those gone
    beside "2 LEFT" read as the two that are left, so there are none.
- **The arena**: a thin white ring with a soft glow. Strings are 2.2 px at 60 % of the flag's
  colour, added to what is under them: one alone is a fine line on a phone, a hundred meeting at
  a ball a wedge of light, and where two fans cross both show. A dot of the colour where each is
  tied, so the ring wears the colours of whoever holds it. A ball is its flag in a ring of its
  colour, glowing, with a short comet trail and **the strings it holds counted under it**, every
  count drawn over every ball, so one ball never hides another's.
- **Effects**: cut strings linger 0.22 s as ghosts, white then their colour, with sparks off the
  rival; every bounce ripples on the ring where it ties, two balls meeting ripple white; a flag
  out bursts into pieces with a shake.
- **Under the ring, in the middle of the frame** (`FOOTER_Y`, 1532): a red dot and SLOW MOTION
  while an out plays slowed, and once in the battle the **follow button** (`look.follow`), the
  race's own (follow.ts): it pops in red, a hand comes up and taps it, it turns to FOLLOWING and
  fades, 2.4 s in all. `battleFollowAt` picks the moment: near 45 % of the battle, clear of every
  out's slow motion and OUT, so the two never share the line.
- **Where it all sits** was measured on the three apps on a 6.1" phone, where the video fills the
  screen's height: TikTok's search bar reaches y 247, Instagram's and YouTube's top buttons 210;
  the captions start at about y 1620 on TikTok (its pinned comment, while it shows, at 1460),
  1690 on Shorts and 1740 on Reels; and Instagram's profile grid shows only y 240–1680 of a reel
  (3:4). So the title takes y 305 to 495, the ring 510 to 1480, the line under it 1532 and the
  watermark 1581, all inside the grid's crop, and the black under the ring is the captions'. The
  picture is drawn `DROP` (80 px) lower than the simulation's arena (`ARENA`, centre y 915),
  which stays where every battle so far was worked out, so one recorded before still opens in
  the studio as it played. ⚠️ The black below the line looks free in the studio and is not: it
  is where the platforms put the caption, the account and the music (More → Video → *Show where
  TikTok, Reels and Shorts put their buttons* shows it). A button there is read by nobody.
- **The winner card**: a dark card framed in the winner's colour, its flag big over it, WINNER,
  its name, "Last flag standing · 26.0 s", and the last line; confetti; with `look.follow` the
  follow button under it in the winner's colour, tapped 1.5 s in and left as FOLLOWING, and the
  card held 2.5 s at least (pacing.ts), as the race's.
- **The watermark** (a plan with `watermark`) sits under the arena, centred at y 1581, above the
  platforms' captions. The ring's right edge crosses the platforms' side
  buttons' column (x 940 on, from y 902): a circle this big cannot keep out of it. The preview
  marks across the frame are in the preview alone.

## 5. Sound and narrator

**Sound** (`Sonifier.battle`): every bounce off the ring plays the melody (it always ties
strings), two balls meeting tick, a flag out shatters, the win is the fanfare; each panned to
where it happens. Strings being cut are plucked: one quiet note at most every three frames, climbing the
pentatonic scale as the flag's strings run out (C4 with a hundred or more, C7 with none), so a fan being
swept is a run up a harp and a flag's last strings the top of it.

**The narrator** ([narration.ts](../src/audio/narration.ts)) says two lines, as in a race, and
nothing while the battle runs (the format's channels have no narrator at all; its sound is the
strings):

- **The opening** (`battleScript`), unless one is typed: the flags (all of them up to four, else
  how many and the first three and "N more"), the rule in one sentence ("Cut every rival's
  strings to win."), one fact and the question. A race's opening never explains its rules; a
  battle's does once, because that a flag with no strings is out is the one thing the first
  second of picture does not say. The fact is one of: the most people, the fewest, the biggest,
  the smallest, or "about 280 times the size of".
- **The winner line** (`voice.outro`, from `BATTLE_WINNER_LINES` when the dice deals it), and
  "Follow for more!" after it with `look.follow`.

The question (`BATTLE_QUESTIONS`) is the title too, so each is short, and none tells viewers to
comment: Instagram says it may not recommend a video that asks for a comment in so many words.

## 6. In the studio

- **The switch** at the top of the panel (`.games`, not `.track`: the sound's segments are read
  by that class). Switching keeps what both games share (length, sound, voice, the follow
  switch) and deals the other game's words where the dice's were (`switchGame` in
  [config.ts](../src/config.ts)). On a plan without `allGames` it is off, with a paid tag and the
  plans that have it.
- **The battle card** replaces the matchup card: a row per flag (its flag in its strings'
  colour, every country to pick, a die for a random one), how many (2–12), where the dice picks
  from (`DICE_REGIONS`, kept with the dice's powers switch in `bouncereel:dice`), the winner
  (Random or one of the flags), and the verdict ("Croatia wins after 33.2 s · The video runs
  40 s · first flag out at 13.6 s").
- **Balancing runs between frames**: each change balances a new battle (a new seed; not for the
  winner, which tries the current one first) a dozen milliseconds a slice, the card shows
  "Balancing the battle…" and the run on screen goes on; an edit meanwhile starts over. Record
  waits for it.
- **Random flags** deals new flags of the same count from the region; **New battle** keeps the
  flags. The race's Balls tab, finish gap, powers, classics, locks, physics, big-number setting
  and Look hide.

## 7. In the library

`videos.game` is `arena-clash`; `battle` holds `BattleSummary` as JSON (the flags in the order
given, the winner, the order they went out), the race's columns stay NULL
([0011_flag_battle.sql](../migrations/0011_flag_battle.sql)). The Worker checks the game against
the plan (`gameAllowed`), 2–12 flag codes each once, the winner and those out among them. The
Videos page shows "Arena Clash, 5 flags", "Equatorial Guinea survives" and the winner's flag as
the thumbnail; Open in studio replays it exactly. The superadmin's text for posts starts
`BounceReel arena clash:` ([library.ts](../src/library.ts) `battlePrompt`).

## Changelog

- 2026-10-27 - Arena Clash: 2–12 flags, lines tied by bounces, cuts with a recharge, sudden death, balancing by seed, speed and sudden death, a chosen winner; 199 flags (flag-icons) with World Bank figures; three looks; calls as flags go out; the game switch and battle card; `videos.battle` (0011); `allGames` gates it.
- 2026-10-27 - every touch cuts at once; the flag that lost a line is shielded for 300 px instead of the cutter recharging; the arena 970 px across (radius 485, centre y 975), smaller balls, faster battles (450–1300 px/s, gentle speed nudges in balancing, 260 tries for a chosen winner); trails, line-count badges, the leader's crown, a tile's flash, blinking shielded lines, a lit floor; three board rows of 70 px.
- 2026-11-11 - merged with the studio as it had grown: each flag's own target in balancing (the winner card is planned for the winner's own line and ends a beat after it); calls timed by `spokenSeconds`; no follow button, "Follow for more!" or longer card in a battle (`asksToFollow`), the switch hidden; the preview marks; the migration is 0011_flag_battle.sql.
- 2026-11-12 - remade as the format's string circle, a game of its own: a hundred strings a flag in one fan, every string a ball touches cut at once, bundles of ten tied by bounces alone, balls that grow as flags go out, the fuse in place of the shield and sudden death; stepped by distance, so the speed (260–460 px/s) is fitted exactly to the length; the last outs in slow motion; one look, a black stage with the title, N LEFT and OUT, counts under the balls; the follow button; no calls as flags go out; the renderers' shared parts in draw.ts and follow.ts.
- 2026-11-12 - made for three and four flags: up to five are balanced to a schedule (the first of three out at about 59 % of the battle, the duel the rest); the fans stay thick for the first 40 % of a stage (`HOLD`), the last two have half the fuse (`DUEL`); four flags' names in the title; `npm run tune` checks 2, 3, 4, 6 and 12 flags.
- 2026-11-12 - the follow button and the slow motion tag in the middle under the ring, not in its lower left corner, where the button lay across the ring; the arena (centre y 915) and the title moved up 60 px for the line; counts drawn over all balls.
- 2026-11-12 - a flag out is struck through in the names over the title; "2 LEFT" stands alone, without the small flags of those gone, which read as the ones left.
- 2026-11-12 - every bounce off the ring ties a bundle: a full ball lets go of its oldest strings as it does (they fade), so its count never falls at a bounce; the balls speed up as a battle goes on (to twice their starting speed, `pace`), which ends long duels; two balls meeting swerve a little (`CLASH`), which ends the head-on ping-pong.
- 2026-11-12 - no most: every bounce adds ten whatever a ball holds, and strings go only by being cut; the fuse, `HOLD`, `FLOOR` and `DUEL` are gone, and balancing chooses the seed and the starting speed alone.
- 2026-11-12 - named Arena Clash (`arena-clash`), from Flag Battle: a name of its own, not its flags'; an icon for each game (public/games/), on the studio's switch, the site's game cards and the Videos page's thumbnails.
- 2026-11-12 - the picture 80 px lower (`DROP`, the drawing alone): the names were under TikTok's search bar and cut in Instagram's profile grid, and a third of the frame was black under the ring; positions measured on the three apps.
