# Look and layout

The video's look: one 1080×1920 canvas, drawn every frame in one of three **looks**
(`look.skin`) over the same geometry, offered in this order, night between the two light
ones. **Paper** (the default) draws what the format's biggest channels draw: the name above
each box, a stats line inside it, full-width glossy layers, glowing balls with trails.
**Night** is BounceReel's own cards after dark: near-black cards on a dusk page. **Cards** is
the same drawing by day, in a second palette: white cards with hard offset shadows, name pills
and chips on a pastel page.

| I need to change... | Touch |
| --- | --- |
| where the boxes, names and VS sit; margins; strip height | [src/layout.ts](../src/layout.ts) |
| a paper colour (page, box, frame, seams, VS, winner card) | [src/render/renderer.ts](../src/render/renderer.ts) `PAPER` |
| a paper box: layers, finish strip, balls, trails, stats line, name | [src/render/renderer.ts](../src/render/renderer.ts) `drawSheet` and what it calls |
| a cards or night colour (page, card, ink, finish, winner card) | [src/render/renderer.ts](../src/render/renderer.ts) `DECKS` |
| a cards or night card: pills, chips, draining bars, the shadow | [src/render/renderer.ts](../src/render/renderer.ts) `drawCard` and what it calls |
| the winner card | [src/render/renderer.ts](../src/render/renderer.ts) `drawSheetWinner` (paper), `drawWinner` (cards, night) |
| the order of the looks, their names | `LOOKS`, `LOOK_LABELS` in [shared/features.ts](../shared/features.ts) (a plan lists the looks it includes), the tiles in [app.html](../app.html) and the home page's in [index.html](../index.html) |
| what a ball wears (F, n!, ×2…) | `mark` in [src/sim/sequences.ts](../src/sim/sequences.ts) |
| the ⚡ tag beside a powered ball's name | [src/render/renderer.ts](../src/render/renderer.ts) `POWER_TAGS`, `drawTag`, called from `drawName` (paper) and `drawNameRow` (cards, night) |
| the free plan's watermark | [src/render/renderer.ts](../src/render/renderer.ts) `drawWatermark`, `WATERMARK`; `Overlay.watermark` from the plan's `watermark` in [src/app.ts](../src/app.ts) |
| the BounceReel mark drawn on a canvas (watermark, Open Graph image) | [src/render/renderer.ts](../src/render/renderer.ts) `drawMark`, the same drawing as [public/mark.svg](../public/mark.svg) |
| the loop at the end | `loop` in [src/app.ts](../src/app.ts) `frame`, `END_PAD` in [src/pacing.ts](../src/pacing.ts) |
| the opening title over the first frame (§11) | [src/render/renderer.ts](../src/render/renderer.ts) `drawOpening`, `OPENINGS`; how long it shows, `openingShown` in [src/pacing.ts](../src/pacing.ts); its question, [src/audio/opening.ts](../src/audio/opening.ts) |
| the meters and LEAD CHANGE (§12) | [src/render/renderer.ts](../src/render/renderer.ts) `drawMeters`, `METER`, `drawLeadChange`, `LEAD_SHOW`, `LEAD_RIGHT`; which changes, `Outcome.leads` from `predict` in [src/sim/world.ts](../src/sim/world.ts) |
| the follow button, in the race and under the winner card (§14) | [src/render/renderer.ts](../src/render/renderer.ts) `drawRaceFollow`, `drawEndFollow`, `drawFollowButton`, `followAt`, `FOLLOW_*`; the hand that taps it, `drawTapHand`, `handPose`, `HAND_*` and its image in [public/hand/](../public/hand/); `Overlay.follow` from `look.follow` in [src/app.ts](../src/app.ts); the card's least time, `FOLLOW_CARD` in [src/pacing.ts](../src/pacing.ts) |
| the last layer's glow (§13) | [src/render/renderer.ts](../src/render/renderer.ts) `finalGlow`, `PULSE_HZ`, drawn in `drawSheetLayers` and `drawLayers` |
| how a hit lands (flash, shake, its number's size), the layer's countdown (§4, §7) | [src/render/renderer.ts](../src/render/renderer.ts) `handle`, `floatDamage`, `KICK_GAP`; `count`, `COUNT` |
| the look picker's thumbnails | [src/app.ts](../src/app.ts) `drawStills`, `THUMB` |
| floating numbers, debris, confetti, shake | [src/render/effects.ts](../src/render/effects.ts) |
| the font | [public/fonts/](../public/fonts/), `@font-face` in [src/style.css](../src/style.css), `FONT` in renderer.ts |
| the platform UI overlay (not recorded) | `#safe-zones` in [app.html](../app.html) and [src/style.css](../src/style.css) |

## 1. The frame

Units are output pixels. Both boxes come from **one template** (`panel()` in
[layout.ts](../src/layout.ts)), so their names, gaps and margins are identical, and every
look draws on it:

| Part | Size |
| --- | --- |
| box (inner) | x 112–968 (856 wide); 340 tall above the layers |
| border (cards, night) | 8 |
| layers | 240 together, split evenly however many there are |
| finish strip | 32 |
| name (a pill in cards and night) | 62 tall, 18 above its card |
| inside margin (chips and bars in cards and night) | `INSET` 16 |

| | Top box | Bottom box |
| --- | --- | --- |
| name centre | 233 | 1045 |
| box top / first floor | 290 / 630 | 1102 / 1442 |
| finish line | 870 | 1682 |
| card bottom | 910 | 1722 |

The VS sits halfway between the top card and the bottom name (y 962). The top name starts
at 202, just below the platforms' status bar and tabs. Left of each card, in the margin no
platform puts a button in, a 14 px meter (x 80–94, 10 px from the card's frame) runs from the
box's top to the bottom of its finish strip (§12).

⚠️ **The box is physics.** Walls, floor and finish line in layout.ts are where balls
bounce; a layer's top edge is drawn exactly on the floor. Changing a box height changes
every race and every balanced speed: run `npm run tune`. A look only ever draws around
these lines.

## 2. Paper

Cream boxes in 6 px ink frames on a paper page (`#ece0c7` to `#e2d3b3`), the palette
`PAPER`. No shadows.

- **Name**: centred above the box, the team colour as text, Rubik 900 up to 54 px with
  3 px tracking. `legible` darkens it just until it has 3:1 contrast on the paper, so
  amber stays readable and still the team's colour. A ball with a power has its tag
  (§10) 18 px after the name, without a shadow, and the pair is centred.
- **Stats line** at the top left inside the box: `NEXT HIT: 2.584  |  SPEED: 3.0x` (what the
  next hit deals, in the format's own words), plus `BALLS: 12` for a splitting ball or a
  crowd, or `SIZE: 1.4x` for a growing one. SPEED is the ball's
  speed now over the slower of the two starting speeds, which is what a viewer weighs
  against the damage; a finished team keeps its last speed. It is outlined in the box's
  colour, or a ball of the same colour passing under it would swallow it.
- **Layers**: full width, flush with the walls, each under a 5 px ink seam (`SEAM`) whose
  top edge is the floor. A vertical gloss (40 % white, the colour, 30 % black) and a shine
  along the top make a flat bar read as a rounded one; what a layer has lost shows as a
  pale track on its right. The health is centred in white with an ink outline (the top
  layer's counting down, §4), and the top layer flashes white after a hit, brighter the
  bigger the hit (§7). The last layer glows up into the box above its seam (§13).
- **Finish strip**: the seam, then two rows of squares. One row between the seam and the
  frame read as a film strip.
- **Balls**: a glossy sphere with an ink edge; a glow in the team colour that reaches
  further as the damage grows (1.5 to 3.2 radii, by the damage's digits); the afterglow
  behind it (§7); and the sequence's `mark` (F, n!, ×2…) on balls of at least 18 px, Always
  the same's its strength (1, 1K, 1M: `strengthMark`), the golden ratio's φ drawn as a ring and
  a stroke (`drawPhi`), since Rubik has no Greek. A box
  of more than 8 balls drops the marks and dims glow and afterglow, which would melt into
  one blur; a crowd of more than 24 is plain balls (below).
- **VS**: plain Rubik 900, 66 px, in ink.

## 3. Cards and night

One drawing with two palettes (`DECKS`): **ink** is the frames, the hard shadows, every
outline, the finish's dark squares and the VS; **box** is inside a card and the winner card.

| | cards | night |
| --- | --- | --- |
| page | warm `#fff3e0` → pink `#fbeff6` → cool `#e3ebff`, ink dots | dusk violet `#2c2654` → `#232552` → deep blue `#18284d`, white dots |
| box | white | near-black `#171a2e` |
| ink | `#1b1b2f` | `#06070f` |
| finish squares | ink and white | ink and `#e8eaf3` |
| a team colour as text (chips, the winner's name, floating numbers) | as it is | lightened until it has 3:1 on the card (`legible`) |
| what the race fades toward under the winner card | ink, 45 % | the dusk `#232552`, 72 % |

⚠️ **Night's page stays lighter than its cards**, as the pastel is lighter than ink: on a
page as dark as the cards, the black frames and hard shadows, the look's signature, would
vanish. For the same reason its winner card fades the race toward the dusk, not toward
black, so the dark card stands out.

Drawn back to front:

1. **Shadow**: the card's shape offset 12, 14 in ink: the look's signature.
2. **Card**: an ink rounded rectangle (radius 26) with the box cut into it, which leaves
   the 8 px border.
3. **Inside, clipped to the box**: a faint tint of the team colour where layers stand;
   each standing layer as a rounded bar inset 16 px from the walls with 10 px under it, a
   pale track filled from the left by the health that is left, a white flash after a hit
   (brighter the bigger the hit, §7), an ink outline, and the health centred in white with
   an ink outline (the top layer's counting down, §4); the last layer ringed in the team's
   colour (§13); the finish strip (two rows of ~16 px squares under a 5 px ink line); the
   balls, flat in the team colour with an ink ring and a highlight, each with its afterglow
   under it (§7), brighter on night's dark cards.
4. **Chips** over the top of the box, 16 px from its top and sides: `NEXT HIT` and what
   the next hit deals on the left; on the right `BALLS` for a crowd or a splitting ball, else
   for a special `SPEED` or `SIZE`. Drawn after the balls, so a full box never hides them.
5. **Name pill** above the card: the team colour, ink outline, its own hard shadow; ink
   text on light colours (lime, amber), white otherwise (`readableOn`). A ball with a
   power has its tag (§10) 14 px after the pill, with the same hard shadow, and the pair
   is centred; the pill gives up the tag's width so the row still fits 760 px.

**Balls**: team colour, ink outline (3–6 px with size), a small white highlight. **VS**: an
ink badge with a white ring.

## 4. Numbers

`formatBig` writes **every digit** with the thousands separator (`look.separator`: `.` as
in the original format, or `,`). There is no scientific notation: the random generator
keeps layers at or under 10^18, and a value too long for its space gets a smaller font
(`fitFont`). Floating damage numbers rise from the hit, one per box every 0.09 s (0.3 s in
a box of more than three balls, which can hit a hundred times a second), **sized by their
digits**, the log of the damage: 27 px for a 1, 32 px at three digits, 64 px from fifteen up
(`floatDamage`), narrowed to fit and moved to stay 40 px inside the box. A new one takes
away at once any it would touch, outlines and all (`float` in
[effects.ts](../src/render/effects.ts)): a big hit's number is up to twice a small one's, so
they cross often, the newest is the one to read, and two numbers are never drawn over each
other. They all rise at one speed, so two that clear each other at the start never meet
later. Their outline is the box's colour
(white on cards and paper, near-black on night), 7 px at 32 px and in proportion.

**A layer's number counts down** to its new value after a hit instead of jumping: over
0.15 s (`COUNT`), fast first (a cubic ease-out), in whole numbers every frame; its bar
follows it. A hit during a count starts the next one from wherever it is.

## 5. The winner card

It pops in with a slight overshoot and confetti falls over it, in every look.

- **Paper**: the race washes out toward the page colour, and a plain card in an ink frame
  (840×440, 520 with a last line) carries `WINNER` (or `TIME'S UP, THE LEADER WINS`), the
  name, **Total damage** (the sum of the winner's sequence over all its hits, leftover
  damage included), "Won by 0.3 s · 18 hits in 22.9 s", and the last line.
- **Cards and night**: a card in the box's colour (880×440, 530 with a last line) with the
  hard shadow over the faded race, the winner's colour along its bottom, a `🏆 WINNER` pill
  in ink on its top edge (`TIME'S UP · LEADER WINS` after a timeout), the name in the team
  colour with an ink outline, "Won by 0.3 s · 22.9 s · 18 hits", "<Sequence> reached
  <damage>", and the last line.

With **Ask viewers to follow** on, the follow button comes up under the card (§14).

**The margin** is the seconds between the winner and the loser touching the line, as the
studio's matchup card measures it (`measureMargin` in [app.ts](../src/app.ts); the hero
measures its own as the card comes up), passed in `Overlay.margin`: "Won by 0.3 s", two
decimals under a tenth, "Photo finish" for a dead heat (under 5 ms), and nothing after a
timeout (`marginLine`).

The **last line** is `look.cta`, written in capitals, set under More → Video (empty for
none). Its default, "Did you call it? Comment below!", answers the opening's question and
sends viewers to the comments. Each roll of the dice deals another of `LAST_LINES`
([config.ts](../src/config.ts)), so a run of videos does not end on the same words; each
answers any of the opening's questions, whoever won and by however much. A line the
creator wrote stays through a roll, and so does none. A saved config whose line is still the earlier default,
"Follow for more!" word for word, reads as today's (`savedConfig` in
[config.ts](../src/config.ts)); a line the creator wrote stays.

## 6. The end: a loop

With `look.loop` on (the default), the last `END_PAD` (0.5 s) of the video cross-fades
into the run's first frame: 0.4 s of fade, then the first frame itself for the last few
frames. A platform replays a short video from the start, so the replay begins on the frame
the video ended on, without a cut. Off, the winner card simply holds.

The first frame, the opening title over it (§11), is drawn off screen at every restart by a
second `Renderer` (`still` in [app.ts](../src/app.ts)), which also draws the look picker's
thumbnails: this matchup's first frame in each look without the title (which would hide
the look), cropped to the top name, its box, its meter and the VS (`THUMB`, x 60–1020).

A video recorded before the looks existed has no `look.skin`; opening it from the library
or a file reads it as cards, no last line and no loop (`savedConfig` in
[config.ts](../src/config.ts)), so it remakes as it was. Any other saved video opens in the
look it names, drawn as that look is drawn today; its MP4 stays as it was recorded.

## 7. Effects

[effects.ts](../src/render/effects.ts), on frame time with their own seeded RNG (`<seed>:fx`),
so they never affect the simulation:

- **Debris**: a broken layer bursts into 26 outlined chunks of itself, with a 5 px shake.
- **Shake**: decays fast, at most 14 px. A hit kicks by its size, the log of its damage
  (0.3 px for a 1 to 3.3 px from 10^15), and on the last layer up to 5 as the team nears
  breaking through (§13); at most once per box every 0.12 s (`KICK_GAP`; 0.3 s in a crowded
  box), with the frame's biggest, since every kick adds up and a box of split balls would
  hold the shake at its cap. The finish adds 8.
- **The top layer's flash** after a hit (the renderer's) is as bright as the hit is big:
  0.3 for a 1, full from 10^15 (and on the last layer at least 0.35 to full, by §13).
- **Confetti**: 240 pieces in the winner's colour, white, gold and ink, drawn above the
  winner card.
- **The afterglow** behind every ball, in every look (`drawAfterglow`): a soft tail in the
  team colour along its last positions, no longer than 3.2 radii however fast it goes
  (`AFTERGLOW`), narrowing to a fifth of the ball and fading to nothing, as the format's balls
  leave one; two passes, a wide faint one under a narrower one, give it a soft edge without a
  canvas blur. Dimmed in a box of more than 8 balls; none in a swarm.
- **A swarm**, a crowd of more than 24 balls (`SWARM`), is drawn plain in every look, the
  colour in an ink ring with a highlight, all in one path, with no glow, so 200 balls still
  draw at 60 fps (`drawPlainBalls`). Only a crowd, which is one from the start: a box of split
  balls (up to 64) keeps its drawing, which changing as its 25th was born would read as a glitch.

The afterglow and glow are the renderer's own (it keeps each ball's last positions); they are
just as visual and never touch the simulation.

## 8. Background and font

- **Background**, painted once per look: cards and night, a vertical three-colour gradient
  with a faint staggered dot grid (the table in §3); paper, a plain sheet a shade darker
  toward the bottom.
- **Font**: Rubik 400–900 (Latin subset, [public/fonts/](../public/fonts/), SIL OFL), also
  the panel's. ⚠️ A canvas never asks for a web font by itself:
  [app.ts](../src/app.ts) calls `document.fonts.load` for each weight at start-up, or text
  falls back to the system font. The look thumbnails are drawn again once it has loaded.

## 9. Platform UI zones

TikTok, Reels and Shorts cover roughly the top 200 px (status bar, tabs), the bottom
~400 px (caption, music, account) and a column down the right edge (like, comment,
share). More → Video → *Show where TikTok, Reels and Shorts put their buttons* lays hatched
boxes over the preview (a DOM overlay, never recorded). The names and the top box sit
below the top zone; the bottom box's last layers and finish strip fall under the caption,
as in the format this follows. The opening title's words keep between the top bar and the
caption and left of the column (§11); the meters sit in the left margin, where none of the
three puts a button, and LEAD CHANGE ends 20 px before the column (§12).

⚠️ **Reels on a tall phone crop the sides.** Instagram fills a 19.5:9 screen with the video
and loses about 50 px off each side (more on a narrower phone), the outer half of the margin
left of the cards. Nothing that matters goes there: the meters keep to its inner half, 10 px
from the cards, and the cards' own frames start at x 104.

## 10. The power tag and the watermark

**The power tag.** A generated name is the ball's numbers alone ("Fibonacci Ball"), so the
picture says which ball has a power: a gold pill (`#ffd23f`, 50 px tall, ink outline) with
an ink lightning bolt and what the power does, in Rubik 900 27 px: `SPEEDS UP`,
`SLOWS DOWN`, `GROWS` or `SPLITS` (`POWER_TAGS`). It is the same gold in every look, a
power-up's colour in a game, and it shows only when the power has an amount. On the opening
title it stands over the ball's name on its panel, 1.2 times as big (`OPENING_TAG`, §11), and
the narrator says the same in words ("…, and it speeds up").

**The watermark**, on a plan whose `watermark` feature is on
([accounts and billing](./accounts-and-billing.md)): the BounceReel mark (42 px) and the site's
host (`SITE_HOST` in [shared/site.ts](../shared/site.ts), `bouncereel.vukcvetkovic.com` for now) in
Rubik 800 up to 32 px, narrowed to fit between 40 px from the frame's edge and the VS (that host
comes out at about 27 px), right-aligned 64 px left of the frame's centre, on
the VS line (y 962). That is the gap between the two cards: it is in every frame of every
look, under no platform's buttons (§9), and nothing of the race is drawn there; the opening's
question stands under the VS for it (§11). Ink at
68 % on paper and cards, white at 78 % on night. It is drawn last, over the loop's fade
too, so it holds still while the frame changes under it. The preview draws it exactly as
Record writes it, so what a free account sees is what its file gets.

**The mark** (`drawMark`): the violet ball with a fading comet trail, falling onto three
sky-blue layers, the top one broken; drawn on the canvas on a 32-unit grid rather than
loaded from [public/mark.svg](../public/mark.svg), so a frame never waits for an image.
⚠️ The two are one drawing: a change to one goes to the other, and to
[public/favicon.svg](../public/favicon.svg) (the same mark on a tile).

## 11. The first second

The first frame is what a viewer swipes past or stays for, and every platform's cover (a
profile grid shows it as a tile about a third of the screen wide), so it carries a title
(`drawOpening`) over the race, which is already moving under it (no hold by default,
`timing.startDelay` 0): a light wash in the look's colours (`OPENINGS`); the balls over it at
full strength; across the top of each box, wall to wall, an opaque **panel** in its ball's
tint (the box's colour 16 % of the way to the ball's, as its chips are), from the box's top
down to 84 px over the floor (`BALL_ROOM`), with the ball's words on it; the race's VS, drawn
again over the wash; and under the VS, where the bottom name row stands in the race, the
opening's question in a pill.

On each panel, centred as one block (`drawTitle`): the ball's power tag when it has one,
1.2 times the race's (§10); its name large in its colour (Rubik 900, up to 110 px in 800 px);
and under it what it does, in capitals (Rubik 800, up to 44 px in 800 px): `ruleOf`, from the
sequence's `rule` ("ADDS UP ITS LAST TWO HITS", "×1.618 EVERY HIT"), Always the same saying its
strength ("EVERY HIT = 1.000"), a crowd its count first ("100 BALLS · …"). They are laid out
on Rubik's capitals (`CAP`, 0.7 of the size), so a block with a tag takes 220 px of the
panel's 256 and one without stands in its middle.

⚠️ **Nothing of the race shows through the words.** The panel hides whatever is under it
whole: a ball, a hit number, debris. Over bare words a ball's edge showed below a letter and
read as a stray glyph on the cover. The strip it leaves over the floor is where the ball is
seen from the first frame, coming down to its first hits.

**The question** is gold capitals (`TAG_FILL`) on the look's ink, in a pill as tall as a name
pill (62 px), Rubik 900 from 44 px down to 30 to fit 820 px; a longer one takes two lines at
30 px in an 83 px pill, still 8 px clear of the VS and of the card (`drawQuestionPill`). It
stands under the VS rather than on its row, which the free plan's watermark has (§10). It is
the narrator's last line of the opening: the creator's own last sentence when that is a short
question, else the one typed under More → Video (`look.question`), else the seed's pick of
twenty (`openingQuestion` in [src/audio/opening.ts](../src/audio/opening.ts);
[sound and narration](./sound-and-narration.md) §3), shown with every sound.

The race's own labels wait under it: the name rows (pills or names, with their tags) and the
chips or stats line are not drawn while the title is up, so a name is never said twice and
`NEXT HIT 1` does not clutter the cover (`labels` in the renderer). The wash is light: at
70–80 % the cards, layers and balls read as a faded page on a grid.

| | wash | names | rules |
| --- | --- | --- | --- |
| paper | the page, 45 % | as they are, ink outline | ink, cream outline |
| cards | white, 40 % | as they are, ink outline | ink, white outline |
| night | near-black, 40 % | lightened to 3:1 (`legible`), near-black outline | white, near-black outline |

It shows whole through any hold and the race's first 0.9 s, then goes over 0.6 s
(`openingShown` in [pacing.ts](../src/pacing.ts)): the words and the question over the first
quarter of that, on panels still whole, then the bare panels over the second, so a ball is
never seen through a fading letter; the race's labels come in over the second half, where the
panels stood. About 1.5 s in all, the time its words take to read, while the first layer, kept
small, breaks in about a second ([matchups and balancing](./matchups-and-balancing.md) §3).
All of it but the wash shakes with the race, so a panel never slides off its box. The
watermark is drawn after it, so it stays over the wash.

⚠️ It is frame 0: the frame a looping video fades back into (§6), and the home page's
still, its looks and the share image (remade with it, [website](./website.md) §5).

## 12. Who is ahead

**A meter per ball** (`drawMeters`): left of its card (x 80, 14 px wide, `METER`; clear of the
side Reels crops on a tall phone, §9), from the
box's top to the bottom of its finish strip, filled from the bottom by how far the ball has
come (`world.progress`, the same measure that decides a timeout and counts lead changes), in
the team colour on a faint track (white 12 % on night, ink 13 % on paper and cards).

**LEAD CHANGE** (`drawLeadChange`), when the race reaches a change of leader the prediction
marked (`Outcome.leads` in [world.ts](../src/sim/world.ts)): a change kept for a second or
more (or the last one, kept to the end) that hands the lead to the other team than the last
marked. A close race swaps the lead back and forth (the classic three times in 1.5 s; of 60
random matchups at 30 s, 39 had two changes within a second, up to 27 in a race), and a
flash for each would be noise, as would one for a lead that flipped and came back. The
winner passing at the line itself is not marked (the finish says it), but it ends the hold
of the lead before it, so a loser that broke through first and led for half a second is not
flashed either. Marked, a race has one at the median and at most two (none in 14 of the 60).
For 0.9 s (`LEAD_SHOW`): a ring
in the new leader's colour round its name row; its meter glowing, as two wider and fainter
bars behind it (a canvas shadow blur costs far more, and the hero draws this on phones);
and LEAD CHANGE in its colour right of the VS, in the look's own pill (the cards' with their
hard shadow), popping in over 0.25 s and fading at the end. Right of the VS because its
left is the watermark's, and ending at x 920 (`LEAD_RIGHT`), 20 px before the side buttons'
column. The sting that goes with it is in [sound and narration](./sound-and-narration.md).
The follow button shows in the same place once in the race (§14), never at the same time.

## 13. The last layer

The last layer is by far the biggest (the classic's are 1,000, 10^10 and 10^15), so a team
can sit on it for half the race. What marks it grows with how far through it the team is
(`lastWorn`, 0 as it gets there, 1 at the break), so most of it comes in its last few hits:

- **It glows** (`finalGlow`), on a 2.4 Hz pulse (`PULSE_HZ`), at 25 % of full when the team
  gets there: on cards and night a ring in the team colour round the bar (a soft 14 px line
  under a bright 4 px one), on paper a glow up into the box above its seam.
- **Its hits land harder**: the flash at least 0.35 to full, the shake 1 to 5 px.
- **Its notes climb**, an octave by the hit that breaks it
  ([sound and narration](./sound-and-narration.md)).

## 14. The follow button

With **Ask viewers to follow** on (`look.follow`, the switch under the looks, on a plan with the
`follow` feature, [accounts and billing](./accounts-and-billing.md)), the video asks for a
follow twice, with a button like the platforms' own: a plus and FOLLOW on a pill, which a tap
turns into a tick and FOLLOWING on the look's card (white on paper and cards, dark on night).
It is drawn in the look's pill, the cards' with their hard shadow, and the plus and the tick
are lines, since Rubik has neither. It is as wide as FOLLOWING in both states, so the tap does
not move it.

**The tap** is a hand, both times: Microsoft's 3D 👆 from Fluent Emoji (MIT,
[public/hand/](../public/hand/), `HAND_SRC`), the same on every computer, where a font's emoji is
each system's own drawing. The renderer asks for it when a video with the button is set up
(`reset`); until it has loaded there is no hand, only the tap. It is about an emoji's size beside
the word (74 px tall in the race, 100 px at the end: `RACE_HAND`, `END_HAND`), leans a little left
(`HAND_TILT`), and its shadow falls down and to the right, further and softer the higher it is.
It moves as a finger does (`handPose`): up from below right, fading in and slowing (0.3 s); a
quick strike onto the plus, speeding up into it (0.12 s), and a push, the hand going into the
screen (7 % smaller, squashed along the finger) with its shadow tight under it; held (0.08 s);
let go and lifted (0.16 s); a moment, and away down, fading, 0.8 s after the tap.
The button gives under it (7 % smaller while the finger is on it, `pressDepth`) and a ripple
spreads from the finger across it. As the finger lets go (`FOLLOW_SWITCH`, 0.08 s) it changes:
the fill fades to the look's card, FOLLOW rolls up and out while FOLLOWING rolls in from below,
the pill bounces (6 %), and short strokes of its colour burst out round it.

- **In the race**, once, in 34 px type and TikTok's and YouTube's follow red (`FOLLOW_RED`,
  `#fe2c55`: neither team's colour, and a follow button before its word is read): right of the
  VS, where LEAD CHANGE shows, ending at x 920 as it does. It pops in, is tapped 0.9 s in and
  has faded by 2.4 s (`FOLLOW_SHOW`). `followAt` puts it as near 45 % of the race as LEAD
  CHANGE allows (0.3 s clear of each marked lead change), within 30–75 % of the race: a viewer
  still watching then is the one worth asking, the opening's question is long gone, and the
  finish has a button of its own. With no such room (4 in 100 random 20 s videos, none at 30 s
  and longer), the race has none. Its hand is the smaller one, over the bottom name for the
  second it is there, and holds still while the frame shakes under it.
- **Under the winner card**, in 46 px type and the winner's colour, centred at y 1330
  (`FOLLOW_Y`): clear of the tallest card's shadow, with the hand under it clear of the
  platforms' bottom bar (§9). It pops in 0.6 s after the card (`FOLLOW_IN`), the hand taps its
  plus at 1.5 s (`FOLLOW_TAP`), and FOLLOWING stays to the end, under the confetti. The card stays up at least 2.5 s with it (`FOLLOW_CARD` in
  [pacing.ts](../src/pacing.ts)), so FOLLOWING is seen.

The narrator's "Follow for more!" is in [sound and narration](./sound-and-narration.md).

## Changelog

- 2026-10-18 - own card style (gradient, hard shadows, pills, draining layer bars, Rubik),
  both cards from one template, whole numbers only, a cleaner finish strip.
- 2026-10-19 - three looks: paper (the default) and night after the format's big channels
  (names above the boxes, stats line, glossy full-width layers, glowing balls with trails
  and marks), and cards; a winner card with total damage and a last line; the loop ending.
- 2026-10-21 - night is the cards look after dark (`DECKS`: near-black cards on a dusk
  page) instead of paper on black; the looks come in the order paper, cards, night.
- 2026-10-21 - a gold ⚡ tag beside a powered ball's name; the free plan's watermark between the cards, left of the VS; the BounceReel mark drawn on the canvas (`drawMark`).
- 2026-10-23 - the opening title over the first frame (the names, the VS, the narrator's question); a meter per ball and LEAD CHANGE when the lead changes hands for good; the last layer glowing and hitting harder as the team nears breaking through; hits landing by their size, numbers sized by their digits and a layer's number counting down; "Won by 0.3 s" on the winner card and "Did you call it? Comment below!" as its default last line.
- 2026-10-24 - the watermark prints the site's host (`SITE_HOST`), narrowed to fit the gap.
- 2026-10-25 - the opening made for the cover: a lighter wash (paper 45 %, cards and night 40 %), the balls over it, a ball's power tag 1.3× where its name row stands, the name rows and chips held back under it, paper's names with an ink outline; the meters moved to x 80, out of the side Reels crops on a tall phone.
- 2026-10-26 - the question over the first frame can be typed (`look.question`, More → Video) and is otherwise one of twenty; the dice deals the last line on the winner card from `LAST_LINES`.
- 2026-10-30 - the follow button (`look.follow`, on plans with `follow`): once in the race right of the VS, in follow red, and under the winner card in the winner's colour, tapped into FOLLOWING (§14).
- 2026-11-02 - the follow button's tap: Microsoft's 3D 👆 (public/hand/) that strikes, presses and lets go, in the race too; a ripple, the words rolling to FOLLOWING, a bounce and a burst instead of the ring.
- 2026-11-02 - a soft afterglow behind every ball in every look (paper's comet trail gone); NEXT HIT for DAMAGE on the chips and the stats line; BALLS for a crowd; a crowd of more than 24 drawn plain; the golden ratio ball's φ.
- 2026-10-30 - the looks come in the order paper, night, cards: in the studio, the admin's plan form, a plan's words and the home page.
- 2026-11-03 - the opening title on panels: each ball's tag, name and what it does (`rule`) on an opaque panel in its tint across the top of its box, over the strip where the ball comes down to its first hits; the race's VS over the wash and the question in a gold-on-ink pill under it, clear of the watermark; the words go before the panels. A damage number takes away any it would touch: nothing is drawn through or over anything else.
