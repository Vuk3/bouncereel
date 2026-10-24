// The 1080×1920 frame, in the simulation's own units (1 unit = 1 output pixel).
//
// Two stacked cards, top and bottom: a name pill, a white box the balls
// bounce in, the layers under it, a checkered finish line. Box heights only
// set how often a ball reaches the floor; balancing adapts the speeds to them.
//
// TikTok, Reels and Shorts draw their own UI over roughly the top 200 px, the
// bottom ~400 px and a column down the right edge; the safe-zone overlay
// (Advanced → Show platform UI zones) shows where.

export const W = 1080;
export const H = 1920;
export const FPS = 60;

/** Inner edges of both boxes. */
export const BOX = { left: 112, right: 968 };
/** Border width; the ball bounces off its inner edge. */
export const BORDER = 8;
/** All layers together; each of n layers is STACK / n tall, so any count fits. */
export const STACK = 240;
/** The checkered finish strip: two rows of ~16 px squares. */
export const FINISH_H = 32;
/** The name pill above each card. */
export const PILL_H = 62;
/** Space between a name pill and its card: the same above both cards. */
export const PILL_GAP = 18;
/** Margin of everything inside a card (chips, layer bars) from its inner edges. */
export const INSET = 16;

/** Height of the open box above the layers. */
const BOX_H = 340;
/** The top pill starts just under the platforms' status bar and tabs. */
const FIRST_PILL_TOP = 202;
/** From the top card's lower edge to the bottom name pill; the VS badge sits in the middle. */
const BETWEEN = 104;

export interface Panel {
  /** Vertical centre of the name pill. */
  title: number;
  /** Inner top edge of the box. */
  top: number;
  /** Where the layers start: the floor while every layer stands. */
  floor: number;
}

/** Top of the checkered finish line of a panel. */
export function finishTop(p: Panel): number {
  return p.floor + STACK;
}

/** Outer bottom edge of a card (the hard shadow reaches a little further). */
export function cardBottom(p: Panel): number {
  return finishTop(p) + FINISH_H + BORDER;
}

/** Both cards are built from the same template, so pill, gaps and margins match exactly. */
function panel(pillTop: number): Panel {
  const top = pillTop + PILL_H + PILL_GAP + BORDER;
  return { title: pillTop + PILL_H / 2, top, floor: top + BOX_H };
}

const TOP = panel(FIRST_PILL_TOP);
export const PANELS: [Panel, Panel] = [TOP, panel(cardBottom(TOP) + BETWEEN)];
export const VS_Y = cardBottom(TOP) + BETWEEN / 2;
