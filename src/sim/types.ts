/** One ball. A team is usually one, but a splitting team fills its box with them. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/** `team` is 0 for the top box, 1 for the bottom one. */
export type SimEvent =
  /** Off a side wall or the ceiling: no damage, just a bounce. */
  | { type: 'wall'; team: number; x: number; y: number }
  /** Off the floor, which is the top layer: `damage` comes off it. */
  | { type: 'hit'; team: number; x: number; y: number; damage: bigint; layer: number; broken: boolean; last: boolean }
  /** Touched the finish line; `place` 1 is the win. */
  | { type: 'finish'; team: number; x: number; y: number; place: number }
  /** Nobody finished in time: the team furthest along wins. */
  | { type: 'timeout'; team: number };

/**
 * The fixed simulation step: four per 60 fps frame. Frame rate never changes
 * the outcome; only the number of steps per frame does.
 */
export const STEP = 1 / 240;
