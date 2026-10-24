import { createRng, type Rng } from '../sim/rng.ts';

// Purely visual: damage numbers, layer debris, confetti, a small shake. Runs
// on real frame time with its own seeded RNG, never the simulation's, so the
// effects can never change who wins.

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  w: number;
  h: number;
  angle: number;
  spin: number;
  color: string;
  gravity: number;
  /** Outlined in black like the layers it came from; confetti is not. */
  outline: boolean;
  /** Drawn above the winner card (confetti) instead of under it. */
  top: boolean;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  /** Font size, px: the renderer sizes a number by its digits. */
  size: number;
  /** Its drawn width at that size, px. */
  width: number;
  /** Covered by a newer number: it fades out four times as fast. */
  covered: boolean;
}

const MAX_PIECES = 700;
const MAX_TEXTS = 40;
/** How long a "-21" floats, seconds. */
const TEXT_LIFE = 0.85;

export class Effects {
  pieces: Piece[] = [];
  texts: FloatText[] = [];
  shake = 0;
  private rng: Rng;

  constructor(seed: string) {
    this.rng = createRng(`${seed}:fx`);
  }

  /** A broken layer bursts into chunks of itself. */
  debris(x: number, y: number, w: number, h: number, color: string): void {
    for (let i = 0; i < 26 && this.pieces.length < MAX_PIECES; i++) {
      const life = this.rng.range(0.7, 1.3);
      const size = this.rng.range(14, 34);
      this.pieces.push({
        x: x + this.rng.range(0, w),
        y: y + this.rng.range(0, h),
        vx: this.rng.range(-380, 380),
        vy: this.rng.range(-620, -120),
        life,
        maxLife: life,
        w: size,
        h: size * this.rng.range(0.4, 0.8),
        angle: this.rng.range(0, 6),
        spin: this.rng.range(-10, 10),
        color,
        gravity: 2200,
        outline: true,
        top: false,
      });
    }
  }

  confetti(colors: string[], count: number, width: number): void {
    for (let i = 0; i < count && this.pieces.length < MAX_PIECES; i++) {
      const life = this.rng.range(2.4, 3.8);
      const size = this.rng.range(12, 22);
      this.pieces.push({
        x: this.rng.range(0, width),
        y: this.rng.range(-320, -20),
        vx: this.rng.range(-140, 140),
        vy: this.rng.range(160, 540),
        life,
        maxLife: life,
        w: size,
        h: size / 2,
        angle: this.rng.range(0, 6),
        spin: this.rng.range(-9, 9),
        color: colors[i % colors.length],
        gravity: 260,
        outline: false,
        top: true,
      });
    }
  }

  /**
   * A number at `size` px, `width` wide. One it would cover fades out fast: a big hit's number is
   * up to twice the size of a small one's, so numbers cross often, and the newest is the one to read.
   */
  float(x: number, y: number, text: string, color: string, size = 32, width = 0): void {
    for (const t of this.texts) {
      if (Math.abs(t.y - y) < (t.size + size) * 0.55 && Math.abs(t.x - x) < (t.width + width) / 2) {
        t.covered = true;
        t.life = Math.min(t.life, TEXT_LIFE / 2);
      }
    }
    if (this.texts.length >= MAX_TEXTS) this.texts.shift();
    this.texts.push({ x, y, text, color, life: TEXT_LIFE, size, width, covered: false });
  }

  kick(amount: number): void {
    this.shake = Math.min(14, this.shake + amount);
  }

  /** Shake offset for this frame. */
  offset(): [number, number] {
    if (this.shake < 0.3) return [0, 0];
    return [this.rng.range(-1, 1) * this.shake, this.rng.range(-1, 1) * this.shake];
  }

  update(dt: number): void {
    for (const p of this.pieces) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.vx *= 1 - 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
    }
    this.pieces = this.pieces.filter((p) => p.life > 0);
    for (const t of this.texts) {
      t.life -= dt * (t.covered ? 4 : 1);
      t.y -= 70 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    this.shake *= Math.exp(-dt * 10);
  }

  drawPieces(ctx: CanvasRenderingContext2D, top: boolean): void {
    for (const p of this.pieces) {
      if (p.top !== top) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (p.life / p.maxLife) * 2.5);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      if (p.outline) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#1b1b2f';
        ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
  }

  /** `outline` is the box's own colour, so a number reads over a ball or a layer edge. */
  drawTexts(ctx: CanvasRenderingContext2D, font: string, outline: string): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outline;
    for (const t of this.texts) {
      ctx.font = `800 ${t.size}px ${font}`;
      // 7 px at 32 px, in proportion.
      ctx.lineWidth = t.size * 0.22;
      ctx.globalAlpha = Math.min(1, (t.life / TEXT_LIFE) * 2);
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }
}
