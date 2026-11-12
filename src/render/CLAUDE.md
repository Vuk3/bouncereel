# src/render

The video's look, drawn on one 1080×1920 canvas every frame. Deep-dive:
[look and layout](../../docs/look-and-layout.md).

## Where code goes

| Kind | Place |
| --- | --- |
| where the boxes, names and VS sit | [layout.ts](../layout.ts): both cards come from one template |
| the three looks: paper (`PAPER`, `drawSheet`…), cards and night, one drawing in two palettes (`DECKS`, `drawCard`…); balls, their afterglow (`drawAfterglow`), a swarm's plain balls (`drawPlainBalls`), the winner card | [renderer.ts](./renderer.ts) |
| the ⚡ power tag beside a name, the race's watermark | [renderer.ts](./renderer.ts) `drawTag`, `drawWatermark`; the BounceReel mark is [draw.ts](./draw.ts) `drawMark` |
| floating damage numbers, debris, confetti, shake | [effects.ts](./effects.ts); how big a hit lands (flash, kick, number size) in renderer.ts `handle`, `floatDamage` |
| the opening title over the first frame, the meters and LEAD CHANGE, the last layer's glow and LAST LAYER!, a layer's number counting down | [renderer.ts](./renderer.ts) `drawOpening`, `drawMeters`, `drawLeadChange`, `finalGlow`, `drawTitleRow`, `count` |
| the race's follow button: where (right of the VS, where LEAD CHANGE shows, and under the winner card) and when | [renderer.ts](./renderer.ts) `drawRaceFollow`, `drawEndFollow`, `followAt`; the button itself is [follow.ts](./follow.ts), the hand's image in [public/hand/](../../public/hand/) |
| Arena Clash, a look of its own: the black stage, the title with N LEFT and OUT, the strings, the balls and their counts, ghosts and sparks, the slow motion tag, its follow button, winner card and watermark | [battle.ts](./battle.ts) `BattleRenderer`, `battleFollowAt` ([arena-clash](../../docs/arena-clash.md#4-the-look)) |
| what both games draw with: the type, colour sums, text that fits, easings, the mark, the preview marks, the base `Overlay` | [draw.ts](./draw.ts) |
| the follow button and the hand that taps it, for both games | [follow.ts](./follow.ts) `FollowButton`; each renderer says where and when |

## Rules

- **Both cards are the same template.** Change a margin in [layout.ts](../layout.ts)
  (`PILL_GAP`, `INSET`, `FINISH_H`…), never with an offset for one card; mismatched top
  and bottom spacing is the first thing a viewer's eye catches.
- **Box geometry is physics.** The floor, walls and finish line in
  [layout.ts](../layout.ts) are where balls bounce; a layer bar's top edge must be exactly
  the floor. Changing a box height changes every race: run `npm run tune`.
- **Numbers are whole, every digit.** `formatBig` writes the full value with the
  separator; a value too long for its space gets a smaller font (`fitFont`), never
  scientific notation.
- **Effects never touch the simulation.** They run on frame time with their own seeded
  RNG, so they can be changed freely without changing who wins.
- **Text is Rubik**, loaded at start-up; a canvas never asks for a web font on its own.
- **A look draws, it never moves a line.** Paper, night and cards share the geometry;
  a look that needs a box of another size is a physics change, not a look.
- **The watermark's gap stays empty.** It sits between the cards, left of the VS: the one
  place in every frame that no platform covers and the race never uses. Nothing else goes
  there, and a layout change that moves the VS moves it too. An Arena Clash's sits under the
  arena, above the platforms' caption zone.
- **The two games' renderers are independent.** [renderer.ts](./renderer.ts) is the race's,
  [battle.ts](./battle.ts) the Arena Clash's; neither imports the other. What both need goes in
  [draw.ts](./draw.ts) or [follow.ts](./follow.ts), which know nothing of either game.
- **`drawMark` ([draw.ts](./draw.ts)) and [public/mark.svg](../../public/mark.svg) are one drawing**: change both,
  and [public/favicon.svg](../../public/favicon.svg).
- **Check both cards, a full box (64 split balls) and the winner card, in each look**, in
  the browser after a visual change ([how](../../docs/development.md#4-checking-it-in-a-browser)).
