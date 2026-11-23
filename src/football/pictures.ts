import type { SidesResponse } from '../../shared/api.ts';
import { api } from '../api.ts';

// The superadmin's real pictures for Goal Rush: clubs' crests and players' photos, from the private
// bucket (worker/routes/sides.ts, put there by scripts/pictures.ts). Only a superadmin's studio asks
// for them; everyone else's draws the kits (kits.ts), and so does his for a side with no picture.
//
// Each picture is drawn once into a canvas when a match needs it, as the flags are (src/battle/
// flags.ts): a canvas drawn onto another is copied, an image decoded again. A crest is trimmed to
// its shield as it is (crestBox): the clear margin round it goes, and so do the parts that stand
// apart over or beside it (the stars of a club's titles over Red Star's and Partizan's), so the
// ball shows the shield itself, big. A run waits for its two before its first frame (the studio's
// loadSidePictures), so a recording never starts on a kit that turns into a crest a moment later.

/** The square a picture is drawn into: the winner card shows a ball 240 px across. */
const SIZE = 320;

let index: SidesResponse['sides'] = {};
let version = '';
const pictures = new Map<string, HTMLCanvasElement>();
const loading = new Map<string, Promise<void>>();

/** Asks for the list of pictures, once; for a superadmin only (the server refuses anyone else). */
export async function loadSideIndex(): Promise<void> {
  try {
    const list = await api<SidesResponse>('GET', '/api/admin/sides');
    index = list.sides;
    version = list.version;
  } catch {
    // No list (not uploaded yet, or offline): the kits, as for everyone.
    index = {};
  }
}

/** What has a picture changes when the list loads: the kits' icons key on this. */
export function sidesVersion(): string {
  return version;
}

/** The picture's address, for an <img> (the studio's pickers); undefined when the side has none. */
export function sideSrc(id: string): string | undefined {
  const picture = index[id];
  return picture ? `/api/admin/sides/${picture.file}` : undefined;
}

/** Whether the side has a crest, a photo, or neither. */
export function sideKind(id: string): 'crest' | 'photo' | undefined {
  return index[id]?.kind;
}

/** The side's picture drawn into a square, once loaded; undefined before that or when it has none. */
export function sidePicture(id: string): HTMLCanvasElement | undefined {
  return pictures.get(id);
}

/** Loads the pictures of `ids` not loaded yet; resolves when all have, or failed (a failed one stays a kit). */
export function loadSidePictures(ids: string[]): Promise<void> {
  return Promise.all(ids.map(load)).then(() => undefined);
}

function load(id: string): Promise<void> {
  const src = sideSrc(id);
  if (!src) return Promise.resolve();
  let promise = loading.get(src);
  if (!promise) {
    promise = new Promise<void>((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        if (index[id]?.kind === 'photo') {
          // A photo fills the square: it was cut square round the face.
          const k = Math.max(SIZE / img.width, SIZE / img.height);
          ctx.drawImage(img, (SIZE - img.width * k) / 2, (SIZE - img.height * k) / 2, img.width * k, img.height * k);
        } else {
          // A crest's shield, fitted inside the square with its proportions kept.
          const box = WHOLE.has(id) ? { x: 0, y: 0, w: img.width, h: img.height } : crestBox(img);
          const k = Math.min(SIZE / box.w, SIZE / box.h);
          ctx.drawImage(img, box.x, box.y, box.w, box.h, (SIZE - box.w * k) / 2, (SIZE - box.h * k) / 2, box.w * k, box.h * k);
        }
        pictures.set(id, canvas);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = src;
    });
    loading.set(src, promise);
  }
  return promise;
}

/**
 * Crests taken whole: their biggest shape is not their shield (Slavia's star is bigger than its
 * halves, Verona's ladder is in pieces), so trimming them to it leaves a part of the crest.
 */
const WHOLE = new Set(['slavia', 'verona']);

/** The crest's work size and the cells its shape is looked at in: a 2 px grid on a 320 px picture, fine enough to part stars a few px over a shield. */
const WORK = 320;
const CELL = 2;

/**
 * The part of a crest's picture that is its shield, in the picture's own px: the box round its
 * biggest drawn shape and whatever touches or sits inside that box, leaving out the clear margin
 * and the parts that stand apart from it (stars over it, a name under it). A picture with no clear
 * ground (a JPEG) is one shape, and comes back whole.
 */
function crestBox(img: HTMLImageElement): { x: number; y: number; w: number; h: number } {
  const k = Math.min(1, WORK / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const g = work.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const { data } = g.getImageData(0, 0, w, h);
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  // A cell is drawn when any pixel in it is more than faintly there.
  const drawn = new Uint8Array(cols * rows);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 60) drawn[Math.floor(y / CELL) * cols + Math.floor(x / CELL)] = 1;
  }
  // The drawn cells in touching groups, each with its box and size.
  const group = new Int32Array(cols * rows).fill(-1);
  const boxes: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
  for (let start = 0; start < drawn.length; start++) {
    if (!drawn[start] || group[start] >= 0) continue;
    const id = boxes.length;
    const box = { x0: cols, y0: rows, x1: -1, y1: -1, n: 0 };
    const stack = [start];
    group[start] = id;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % cols;
      const cy = (c - cx) / cols;
      box.x0 = Math.min(box.x0, cx);
      box.y0 = Math.min(box.y0, cy);
      box.x1 = Math.max(box.x1, cx);
      box.y1 = Math.max(box.y1, cy);
      box.n++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        const n = ny * cols + nx;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !drawn[n] || group[n] >= 0) continue;
        group[n] = id;
        stack.push(n);
      }
    }
    boxes.push(box);
  }
  if (!boxes.length) return { x: 0, y: 0, w: img.width, h: img.height };
  const main = boxes.reduce((a, b) => (b.n > a.n ? b : a));
  // What overlaps the shield's box is part of it (a crown on it, letters inside it); what stands clear of it is not.
  const union = { ...main };
  for (const b of boxes) {
    if (b === main || b.x1 < main.x0 || b.x0 > main.x1 || b.y1 < main.y0 || b.y0 > main.y1) continue;
    union.x0 = Math.min(union.x0, b.x0);
    union.y0 = Math.min(union.y0, b.y0);
    union.x1 = Math.max(union.x1, b.x1);
    union.y1 = Math.max(union.y1, b.y1);
  }
  const x = (union.x0 * CELL) / k;
  const y = (union.y0 * CELL) / k;
  return { x, y, w: Math.min(img.width - x, ((union.x1 + 1) * CELL) / k - x), h: Math.min(img.height - y, ((union.y1 + 1) * CELL) / k - y) };
}
