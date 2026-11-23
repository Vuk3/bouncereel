import { FONT, INK, WHITE, fitFont, legible } from '../render/draw.ts';
import { sideKind, sidePicture, sidesVersion } from './pictures.ts';
import type { Side } from './teams.ts';

// A side's ball as drawn: its shirt in a circle. The shirt's first colour, its pattern in the
// second (stripes, hoops, a sash…), a collar at the top so it reads as a shirt, then on a club a
// roundel with its letters, as a crest has, and on a player his number, as a shirt's back has (his
// name where he has no one number). A shine and a dark hairline, as the Arena Clash's flags have.
// Drawn from colours alone: nothing here is a club's crest or a player's picture.
//
// A superadmin's studio has the real pictures (pictures.ts): a club's crest on a light ground, a
// player's photo filling the ball with his number on a small badge of his shirt. Those are drawn
// instead, where a side has one.
//
// The renderer draws it on the video, and the studio as the icons of its pickers (kitIcon).

/** The black stage's colour, which a side's glow must show on (src/render/match.ts STAGE). */
const STAGE = '#05060b';

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance, 0 for black to 1 for white. */
export function lum(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The one of `options` that reads best on `ground`. */
function bestOn(ground: string, options: string[]): string {
  return options.reduce((best, c) => (contrast(c, ground) > contrast(best, ground) ? c : best));
}

/** A side's colour on the black stage, as hex: its kit's glow, or its shirt's colour, or the pattern's when the shirt is near black. */
export function glowOf(s: Side | undefined): string {
  if (!s) return '#94a3b8';
  const [c1, c2] = s.kit.colors;
  return s.kit.glow ?? (lum(c1) < 0.03 ? c2 : c1);
}

/**
 * The two sides' colours on the stage, home first, made legible on it: Real Madrid's white and
 * Tottenham's white would be one colour, so an away side whose colour is too near the home side's
 * takes its kit's other colour, or failing that a blue or a gold no shirt pairs with.
 */
export function sideColors(home: Side | undefined, away: Side | undefined): [string, string] {
  const a = glowOf(home);
  let b = glowOf(away);
  const near = (x: string, y: string) => {
    const [p, q] = [rgb(x), rgb(y)];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 110;
  };
  if (near(a, b)) {
    const other = away ? away.kit.colors.find((c) => c !== b && lum(c) > 0.03 && !near(a, c)) : undefined;
    b = other ?? (near(a, '#38bdf8') ? '#facc15' : '#38bdf8');
  }
  return [legible(a, STAGE), legible(b, STAGE)].map(toHex) as [string, string];
}

/** legible() writes rgb(); the renderer mixes colours as hex. */
function toHex(color: string): string {
  if (color.startsWith('#')) return color;
  const m = color.match(/\d+/g) ?? ['0', '0', '0'];
  return `#${m
    .slice(0, 3)
    .map((v) => Number(v).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The side's shirt in a circle of radius `r` at x, y, with its letters or number. `label` false
 * leaves the mark off (the timeline's small balls, where letters would be a smudge).
 */
export function drawKit(ctx: CanvasRenderingContext2D, s: Side | undefined, x: number, y: number, r: number, label = true): void {
  const picture = s && sidePicture(s.id);
  if (s && picture) {
    drawPicture(ctx, s, picture, x, y, r, label);
    return;
  }
  const [c1, c2] = s?.kit.colors ?? ['#3a4152', '#5b6478'];
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = c1;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  if (s) pattern(ctx, s.kit.pattern, c2, x, y, r);
  if (s) collar(ctx, c2 === c1 ? INK : c2, x, y, r);
  if (s && label) mark(ctx, s, x, y, r);
  // A soft shine from the top left and a shade at the bottom right: a ball, not a sticker.
  const shine = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.05, x - r * 0.2, y - r * 0.2, r * 1.1);
  shine.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  shine.addColorStop(0.45, 'rgba(255, 255, 255, 0.04)');
  shine.addColorStop(1, 'rgba(0, 0, 0, 0.26)');
  ctx.fillStyle = shine;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, r * 0.03);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.stroke();
}

/**
 * A real picture in the ball: a crest on a ground of white going to its shirt's colour at the edge
 * (most crests are drawn for white, and the edge still says whose), fitted inside with room round it;
 * a photo filling it, with his number on a small badge of his shirt at the lower right, as a
 * player's card has it.
 */
function drawPicture(ctx: CanvasRenderingContext2D, s: Side, picture: HTMLCanvasElement, x: number, y: number, r: number, label: boolean): void {
  const photo = sideKind(s.id) === 'photo';
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  if (photo) ctx.drawImage(picture, x - r, y - r, 2 * r, 2 * r);
  else {
    const ground = ctx.createRadialGradient(x, y - r * 0.2, r * 0.2, x, y, r);
    ground.addColorStop(0, '#ffffff');
    ground.addColorStop(0.72, '#eef1f6');
    ground.addColorStop(1, s.kit.colors[0] === '#ffffff' ? '#d5dbe5' : s.kit.colors[0]);
    ctx.fillStyle = ground;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    // The shield big, its longer side 1.64 of the ball's radius: a tall shield's corners stay just inside the ring.
    const k = 0.82;
    ctx.drawImage(picture, x - r * k, y - r * k, 2 * r * k, 2 * r * k);
  }
  const shine = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.05, x - r * 0.2, y - r * 0.2, r * 1.1);
  shine.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
  shine.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  shine.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
  ctx.fillStyle = shine;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, r * 0.03);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.stroke();
  if (!photo || !label || !s.mark || r < 30) return;
  // The number's badge: his shirt in small, at the lower right, over the ball's edge.
  const [c1, c2] = s.kit.colors;
  const br = r * 0.34;
  const bx = x + r * 0.7;
  const by = y + r * 0.7;
  ctx.save();
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = c1;
  ctx.fillRect(bx - br, by - br, 2 * br, 2 * br);
  pattern(ctx, s.kit.pattern, c2, bx, by, br);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.lineWidth = br * 0.16;
  ctx.strokeStyle = '#0b0e18';
  ctx.stroke();
  const ink = bestOn(c1, [c2, WHITE, INK]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, s.mark, br * 1.4, br * 1.15, 900);
  ctx.lineJoin = 'round';
  ctx.lineWidth = br * 0.16;
  ctx.strokeStyle = bestOn(ink, [c1, WHITE, INK]);
  ctx.strokeText(s.mark, bx, by + br * 0.08);
  ctx.fillStyle = ink;
  ctx.fillText(s.mark, bx, by + br * 0.08);
}

/** The pattern in `color` over the shirt, inside the clip of a circle of radius `r`. */
function pattern(ctx: CanvasRenderingContext2D, kind: Side['kit']['pattern'], color: string, x: number, y: number, r: number): void {
  ctx.fillStyle = color;
  const d = 2 * r;
  switch (kind) {
    case 'stripes': {
      // Five bands of the shirt's colour and four of the other, the middle one the shirt's: a stripe never runs down the middle of the letters.
      const w = d / 9;
      for (let i = 1; i < 9; i += 2) ctx.fillRect(x - r + i * w, y - r, w, d);
      break;
    }
    case 'hoops': {
      const h = d / 7;
      for (let i = 1; i < 7; i += 2) ctx.fillRect(x - r, y - r + i * h, d, h);
      break;
    }
    case 'halves':
      ctx.fillRect(x, y - r, r, d);
      break;
    case 'diagonal':
      ctx.beginPath();
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      ctx.fill();
      break;
    case 'sash': {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-r * 1.5, -r * 0.22, r * 3, r * 0.44);
      ctx.restore();
      break;
    }
    case 'band':
      ctx.fillRect(x - r * 0.34, y - r, r * 0.68, d);
      break;
    case 'bar':
      ctx.fillRect(x - r, y - r * 0.24, d, r * 0.48);
      break;
    case 'sleeves':
      ctx.fillRect(x - r, y - r, r * 0.42, d);
      ctx.fillRect(x + r * 0.58, y - r, r * 0.42, d);
      break;
    case 'checks': {
      const c = d / 6;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2) ctx.fillRect(x - r + i * c, y - r + j * c, c, c);
      break;
    }
    case 'solid':
      break;
  }
}

/** A V-neck at the top of the shirt. */
function collar(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x - r * 0.3, y - r * 0.97);
  ctx.lineTo(x, y - r * 0.7);
  ctx.lineTo(x + r * 0.3, y - r * 0.97);
  ctx.lineWidth = r * 0.09;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
}

/**
 * A club's letters on a roundel in its darker colour, ringed in its lighter one, as a crest sits on
 * a shirt; a player's number big across the middle, in the colour that reads on his shirt and
 * outlined in the other, as a shirt's back has it, or his name where he has no one number.
 */
function mark(ctx: CanvasRenderingContext2D, s: Side, x: number, y: number, r: number): void {
  const [c1, c2] = s.kit.colors;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (s.mode === 'clubs') {
    const [dark, light] = lum(c1) <= lum(c2) ? [c1, c2] : [c2, c1];
    const rr = r * 0.56;
    ctx.beginPath();
    ctx.arc(x, y + r * 0.06, rr, 0, Math.PI * 2);
    ctx.fillStyle = dark;
    ctx.fill();
    ctx.lineWidth = r * 0.07;
    ctx.strokeStyle = light;
    ctx.stroke();
    fitFont(ctx, s.mark, rr * 1.55, rr * (s.mark.length > 3 ? 0.62 : 0.78), 900);
    ctx.fillStyle = bestOn(dark, [WHITE, INK, light]);
    ctx.fillText(s.mark, x, y + r * 0.08);
    return;
  }
  const text = s.mark || s.short;
  const ink = bestOn(c1, [c2, WHITE, INK]);
  const edge = bestOn(ink, [c1, WHITE, INK]);
  fitFont(ctx, text, r * (s.mark ? 1.3 : 1.62), r * (s.mark ? 1.02 : 0.5), 900);
  ctx.lineJoin = 'round';
  ctx.lineWidth = r * 0.1;
  ctx.strokeStyle = edge;
  ctx.strokeText(text, x, y + r * 0.1);
  ctx.fillStyle = ink;
  ctx.fillText(text, x, y + r * 0.1);
}

const icons = new Map<string, string>();

/** The side's ball as a small picture (a data URL), for the studio's pickers and the Videos page. */
export function kitIcon(s: Side | undefined, size = 64): string {
  const key = `${s?.id ?? ''}|${size}|${s && sidePicture(s.id) ? sidesVersion() : ''}`;
  const cached = icons.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  drawKit(ctx, s, size / 2, size / 2, size / 2 - 1);
  const url = canvas.toDataURL();
  // Only once Rubik is there: an icon drawn in the fallback face would be kept for good.
  if (document.fonts.check(`900 20px ${FONT}`)) icons.set(key, url);
  return url;
}
