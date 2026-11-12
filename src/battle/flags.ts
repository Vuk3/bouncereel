// The flags' pictures for the canvas, and the colour each flag's strings are drawn in.
//
// Each public/flags/<code>.svg is drawn once into a square canvas: a canvas drawn onto another is
// copied, where an SVG image would be rasterised again on every frame, a dozen times a frame.
// A run waits for its flags before its first frame (the studio's loadFlags), so a recording never
// starts with a ball still blank; until one has loaded, its ball is drawn in its strings' colour.

const SIZE = 256;

/**
 * The strings' colours: twelve that tell apart at a glance on the battle's black stage, each
 * bright enough that one string 2 px wide still shows. A flag takes the one nearest its own main
 * colour still free in the battle; the last two (sand, silver) are no flag's own and go to the
 * eleventh and twelfth whose colours are taken.
 */
const PALETTE = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#8b5cf6', '#f97316', '#38bdf8', '#ec4899', '#a3e635', '#14b8a6', '#d6b98c', '#94a3b8'];

const pictures = new Map<string, HTMLCanvasElement>();
const loading = new Map<string, Promise<void>>();
/** Per flag, the palette's colours nearest its own, most of its area first. */
const preferred = new Map<string, string[]>();

export function flagSrc(code: string): string {
  return `/flags/${code}.svg`;
}

/** The flag drawn into a square, once loaded; undefined before that or when it failed. */
export function flagPicture(code: string): HTMLCanvasElement | undefined {
  return pictures.get(code);
}

/** Loads every flag not yet loaded; resolves when all have, or failed (a failed one stays a plain ball). */
export function loadFlags(codes: string[]): Promise<void> {
  return Promise.all(codes.map(load)).then(() => undefined);
}

function load(code: string): Promise<void> {
  let promise = loading.get(code);
  if (!promise) {
    promise = new Promise<void>((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        pictures.set(code, canvas);
        preferred.set(code, nearest(ctx));
        resolve();
      };
      img.onerror = () => resolve();
      img.src = flagSrc(code);
    });
    loading.set(code, promise);
  }
  return promise;
}

/**
 * Each flag's strings' colour, in the order the flags are given: its first preference no flag
 * before it took, else the palette's first free one. Two red flags (Serbia, Croatia) get red and
 * the next nearest, blue.
 */
export function lineColors(codes: string[]): string[] {
  const taken = new Set<string>();
  return codes.map((code) => {
    const color = (preferred.get(code) ?? []).find((c) => !taken.has(c)) ?? PALETTE.find((c) => !taken.has(c)) ?? PALETTE[0];
    taken.add(color);
    return color;
  });
}

/**
 * The palette's colours closest to the flag's own coloured areas, the biggest area first. White,
 * black and greys are left out: nearly every flag has some white, and black strings on the black
 * stage would not show.
 */
function nearest(ctx: CanvasRenderingContext2D): string[] {
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const votes = new Map<string, number>();
  // Every fourth pixel each way: 4096 samples, plenty for areas.
  for (let y = 0; y < SIZE; y += 4) {
    for (let x = 0; x < SIZE; x += 4) {
      const i = (y * SIZE + x) * 4;
      const [h, s, l] = hsl(data[i], data[i + 1], data[i + 2]);
      if (s < 0.3 || l < 0.12 || l > 0.9) continue;
      let best = PALETTE[0];
      let bestDistance = Infinity;
      for (const color of PALETTE.slice(0, 10)) {
        const [ph, ps, pl] = hsl(...rgb(color));
        const dh = Math.min(Math.abs(h - ph), 360 - Math.abs(h - ph)) / 180;
        const distance = dh * dh * 4 + (s - ps) ** 2 + (l - pl) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = color;
        }
      }
      votes.set(best, (votes.get(best) ?? 0) + 1);
    }
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color);
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Hue in degrees, saturation and lightness 0..1. */
function hsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
