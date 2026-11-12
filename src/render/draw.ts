import { SITE_HOST } from '../../shared/site.ts';
import { H, W } from '../layout.ts';

// What both games' renderers draw with: the type, colour sums, text that fits and reads on any
// ground, easings, the BounceReel mark and the preview marks, and what the page tells either
// about a frame. A game's own look, layout and effects are in its renderer (renderer.ts the
// race's, battle.ts the Arena Clash's); nothing here knows which game it is drawing.

export const FONT = 'Rubik, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
export const INK = '#1b1b2f';
export const WHITE = '#ffffff';
export const BLACK = '#000000';

/** What the page tells a renderer about a frame, whichever game it draws. */
export interface Overlay {
  /** 0..1 fade of the winner card. */
  winner: number;
  /** Seconds since the winner card started, drives its entrance. */
  age: number;
  /** 0..1 of the first frame drawn over everything: the end of a looping video. */
  loop?: number;
  /** That first frame (see `loop`). */
  start?: CanvasImageSource;
  /** The free plan's mark (drawWatermark): the studio passes its plan's `watermark`. */
  watermark?: boolean;
  /**
   * The free plan's preview marks (drawPreviewMarks): the site's host across the whole frame while
   * the studio plays a preview, never in a take, so a screen recording of the preview is no video
   * to post and the file carries the watermark alone.
   */
  preview?: boolean;
  /**
   * The follow button (`look.follow`): under the winner card and, `at` seconds into the race or
   * the battle, once before it (renderer.ts followAt, battle.ts battleFollowAt); null `at` for
   * no room for that one.
   */
  follow?: { at: number | null };
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
}

/** 0..1, eased in and out, from `t` clamped to 0..1. */
export function smoothstep(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}

/** `text` in lines no wider than `width` at the context's font, broken at spaces. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return line ? [...lines, line] : lines;
}

/**
 * The BounceReel mark (public/mark.svg, drawn on a 32-unit grid) at `x`, `y`, `size` across: the
 * ball with its trail, falling onto the layers it breaks. The canvas draws it rather than loading
 * the file, so a frame never waits for an image.
 */
export function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const k = size / 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  const trail = ctx.createLinearGradient(4, 2.6, 18.4, 12.4);
  trail.addColorStop(0, 'rgba(124, 77, 255, 0)');
  trail.addColorStop(1, 'rgba(124, 77, 255, 0.55)');
  ctx.fillStyle = trail;
  ctx.beginPath();
  ctx.moveTo(4, 2.6);
  ctx.lineTo(15.09, 17.27);
  ctx.lineTo(21.71, 7.53);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7c4dff';
  ctx.beginPath();
  ctx.arc(18.4, 12.4, 6.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.beginPath();
  ctx.ellipse(16.2, 10.3, 2.1, 1.35, (-38 * Math.PI) / 180, 0, Math.PI * 2);
  ctx.fill();
  for (const [bx, by, bw, alpha] of [
    [3, 21.2, 14.6, 1],
    [20.6, 21.2, 8.4, 0.4],
    [3, 27.2, 26, 0.72],
  ]) {
    ctx.fillStyle = `rgba(14, 165, 233, ${alpha})`;
    roundRect(ctx, bx, by, bw, 4.2, 2.1);
    ctx.fill();
  }
  ctx.restore();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

/** Text with an outline under the fill, so it reads on any colour. */
export function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, stroke: string, width: number): void {
  if (width > 0) {
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Sets the largest font up to `max` px at which `text` fits in `width`. */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, width: number, max: number, weight: number): void {
  ctx.font = `${weight} ${max}px ${FONT}`;
  const measured = ctx.measureText(text).width;
  if (measured > width) ctx.font = `${weight} ${Math.max(10, Math.floor((max * width) / measured))}px ${FONT}`;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** `hex` moved toward `other` by `amount`: 0 is `hex` itself, 1 is `other`. */
export function mix(hex: string, other: string, amount: number): string {
  const a = rgb(hex);
  const b = rgb(other);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function luminance(c: [number, number, number]): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const legibleCache = new Map<string, string>();

/**
 * The team colour as text on `background`: darkened on a light page, lightened on a
 * dark one, just until it has the 3:1 contrast large bold text needs. Amber on paper
 * and navy on black both come out readable and still clearly the team's colour.
 */
export function legible(color: string, background: string): string {
  const key = `${color}|${background}`;
  const cached = legibleCache.get(key);
  if (cached) return cached;
  const bg = luminance(rgb(background));
  const from = rgb(color);
  const toward = rgb(bg > 0.4 ? BLACK : WHITE);
  let out = color;
  for (let step = 0; step <= 14; step++) {
    const amount = step * 0.05;
    const c = from.map((v, i) => Math.round(v + (toward[i] - v) * amount)) as [number, number, number];
    const l = luminance(c);
    const ratio = (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05);
    out = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    if (ratio >= 3) break;
  }
  legibleCache.set(key, out);
  return out;
}

/** White text on dark colours, ink on light ones (lime, amber). */
export function readableOn(hex: string): string {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 ? INK : WHITE;
}

export function easeOutBack(t: number): number {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

export const PREVIEW_MARK_FONT = `700 56px ${FONT}`;

/**
 * The preview marks at full strength (drawPreviewMarks fades them): rows 182 px apart, each a half
 * step along from the last, tilted about the centre and wide enough to reach the corners (the
 * frame's half diagonal is 1,101 px).
 */
export function paintPreviewMarks(color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = color;
  g.font = PREVIEW_MARK_FONT;
  g.textBaseline = 'middle';
  g.translate(W / 2, H / 2);
  g.rotate(-Math.PI / 6);
  const step = g.measureText(SITE_HOST).width + 90;
  for (let y = -H, row = 0; y <= H; y += 182, row++) {
    for (let x = -1.6 * W + (row % 2) * (step / 2); x <= 1.6 * W; x += step) g.fillText(SITE_HOST, x, y);
  }
  return canvas;
}
