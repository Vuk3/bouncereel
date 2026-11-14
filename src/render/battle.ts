import { SITE_HOST } from '../../shared/site.ts';
import { openingQuestion } from '../audio/opening.ts';
import { country, sharedRegion } from '../battle/countries.ts';
import { flagPicture, lineColors } from '../battle/flags.ts';
import type { Config } from '../config.ts';
import { ARENA, H, W } from '../layout.ts';
import { BUNDLE, HEARTBEAT, inDanger, type BattleEvent, type BattleOutcome, type BattleWorld, type Flag, type Str } from '../sim/battle.ts';
import { createRng, type Rng } from '../sim/rng.ts';
import { Effects } from './effects.ts';
import { FONT, PREVIEW_MARK_FONT, WHITE, drawMark, easeOutBack, fitFont, outlined, paintPreviewMarks, rgba, roundRect, type Overlay } from './draw.ts';
import { END_HAND, FOLLOW_IN, FOLLOW_PAD, FOLLOW_RACE_TAP, FOLLOW_RED, FOLLOW_SHOW, FOLLOW_TAP, FollowButton, RACE_HAND, type FollowStyle } from './follow.ts';

// Arena Clash, drawn on a 1080×1920 canvas in one look of its own: the format's, a black stage
// where only the strings and the flags are lit. The race's looks (`look.skin`) are the race's;
// a battle has none to choose.
//
//   the title   under the platforms' top bar: the region all its flags are from, if one; who is
//               in it (the names up to four flags, those out struck through, else how many), the
//               video's question in big type, and under it how many are left, which turns into
//               "CROATIA OUT" as a flag goes
//   the arena   a thin white ring; every string from where it is tied to its ball, fine lines in
//               the flag's colour that add up to a lit wedge where they are many; the balls, each
//               its flag in a ring of its colour, glowing, the strings it holds counted under it,
//               red and beating once it is down to its last bundle
//
// A cut string lingers a moment as a ghost, with sparks where the rival is, and a sweep through a
// bundle or more shows how many it took over the cutter ("-34"); a bounce ripples on the ring where
// it ties its bundle, and "+10" rises from there; a flag out bursts and shakes the frame. Slow motion says so under
// the ring, in the middle, where the follow button also pops up once (FOLLOW_SHOW). The winner card, the loop and
// the watermark do what the race's do, each game drawing its own; what the two share is in
// draw.ts and follow.ts. Effects run on frame time with their own seeded randomness: nothing
// here touches the battle.

/** The stage: near black, a little blue, so the colours on it stay clean. */
const STAGE = '#05060b';
/** What the stage lightens to behind the arena's middle: enough to give the black some depth. */
const STAGE_LIT = '#0d1120';
/** The winner card and the follow button's FOLLOWING: a dark panel, lighter than the stage. */
const PANEL = '#12162a';
/** The words that are not the headline: how many are left, the result under the winner. */
const MUTED = '#9aa3b5';
/**
 * px the whole picture sits below the simulation's arena (layout.ts ARENA): the ring is drawn
 * centred at y 1035, not 915. Moved in the drawing alone, since a battle's every px is worked out
 * from where the arena is, and a battle recorded before must open again in the studio exactly as
 * it played. Measured on the three apps on a 6.1" phone, where the video fills the screen's
 * height: TikTok's search bar reaches y 247 and Instagram's profile grid shows only y 240–1680
 * (3:4), so the names at 244 were cut and the black under the ring was a third of the frame. At
 * 80 a reel on an iPhone still had the region just under the top buttons and some 250 px of black
 * under the ring; 120 is as low as TikTok's caption (from y 1620) leaves the watermark room.
 */
const DROP = 120;
/**
 * How big the arena is drawn, of the simulation's, round its centre: 892 px across, not 970. At
 * full size the ring came within 55 px of the frame's sides, and Instagram on an iPhone, filling
 * the screen's height, crops about 38 px a side (measured on a screenshot): the ring touched the
 * screen's edges and its right was cut, under the side buttons. The balls, strings and counts
 * are smaller by as much. The drawing alone, as DROP is.
 */
const SCALE = 0.92;
/** Where the arena's centre is drawn on the frame, and its ring's lowest point (y 1481). */
const CENTRE_Y = ARENA.y + DROP;
const RING_BOTTOM = CENTRE_Y + ARENA.r * SCALE;
/** The title block, by the middle of each line: under TikTok's search bar (to y 247) and the profile grid's top (240), over the ring (from 589). */
const REGION_Y = 196 + DROP;
const KICKER_Y = 244 + DROP;
const HEADLINE_Y = 308 + DROP;
const STATUS_Y = 388 + DROP;
/**
 * The widest a line of the title may be: 80 px a side. Instagram on an iPhone crops a reel by up to
 * 55 px a side (measured on a screenshot), so a question fitted to 960 ran to the screen's edge.
 */
const TITLE_W = 920;
/** The smallest the names over the title are set: under 28 px a name is not read on a phone, and the line says how many flags instead. */
const KICKER_MIN = 28;
/** Seconds "CROATIA OUT" stays in place of the count: time to read a name, and gone before the next flag goes. */
const OUT_SHOW = 1.7;
/**
 * A string is 2.2 px at 60 % of its colour, added to what is under it: one alone is a fine line on
 * a phone, and a hundred meeting at a ball are a wedge of light, as the format draws them.
 */
const STRING_W = 2.2;
const STRING_ALPHA = 0.6;
/** Seconds a cut string stays as a fading ghost: long enough to see what the rival took. */
const GHOST = 0.22;
/** A bounce's "+10": its size, and how far inside the ring from where the bundle is tied, so it reads off the ring's line. */
const TIE_SIZE = 42;
const TIE_IN = 34;
/**
 * A sweep's "-34" over the cutter: cuts of one flag's strings by one ball count as one sweep while
 * they come within TALLY_JOIN seconds of each other (a ball crossing a fan cuts a few a step), it
 * shows once it is a bundle or more (a nick of three would be numbers all over the arena), and
 * after the sweep it rises and fades over TALLY_FADE.
 */
const TALLY_JOIN = 0.2;
const TALLY_FADE = 0.7;
const BIG_CUT = BUNDLE;
/** Positions a ball's trail keeps: about a sixth of a second at 60 fps. */
const TRAIL = 10;
/**
 * The line under the ring, in the middle of the frame: the follow button and the slow motion
 * tag, never both at once (battleFollowAt). Between the ring (to y 1441, its glow a little
 * further) and the free plan's mark; the black below that is the platforms' caption, account
 * and music (from about y 1620 on TikTok, 1690 on Shorts, 1740 on Reels, measured), where a
 * button would be read by nobody.
 */
const FOOTER_Y = RING_BOTTOM + 52;
/** Where the free plan's mark sits: under that line, above the platforms' captions. */
const WATERMARK_Y = FOOTER_Y + 49;
/** The follow button on the stage: framed in white, and white with dark type once followed. */
const FOLLOW_STYLE: FollowStyle = { ink: WHITE, card: WHITE, text: STAGE, shadow: false };
/** The winner card's middle, over the ring's, and its button under it, as the race's is. */
const CARD_Y = 1000 + DROP;
const FOLLOW_Y = 1330 + DROP;

/** What the page tells this renderer about a frame of a battle. */
export interface BattleOverlay extends Overlay {
  /** The battle is playing in slow motion: an out among its last flags, or its win. */
  slow?: boolean;
  /** px the balls are drawn ahead of where the last whole step left them: the part of a step this frame is into the next. */
  lead?: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  color: string;
}

/** One sweep of `by` through `flag`'s strings: how many it has cut, and where its number is (BIG_CUT). */
interface Tally {
  flag: number;
  by: number;
  n: number;
  /** Seconds since its last cut: it follows the cutter while cuts keep coming (TALLY_JOIN), then rises and fades. */
  idle: number;
  /** Seconds it has been shown, for its pop. */
  shown: number;
  x: number;
  y: number;
}

/** Strings just cut: where each was tied, and where their ball was. */
interface Ghost {
  strings: Str[];
  x: number;
  y: number;
  age: number;
  color: string;
}

export class BattleRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  effects = new Effects('');
  private readonly follow: FollowButton;
  private rng: Rng = createRng('sparks');
  private sparks: Spark[] = [];
  private ghosts: Ghost[] = [];
  private rings: { x: number; y: number; age: number; color: string; size: number }[] = [];
  private tallies: Tally[] = [];
  /** The flag that last went out and the seconds since: its OUT in place of the count. */
  private out: { flag: number; age: number } | null = null;
  /** Each ball's last positions, flattened x, y, oldest first: its trail. */
  private trails = new Map<number, number[]>();
  /** Where each ball is drawn this frame: its place, and the part of a step the frame is ahead of it. */
  private at: { x: number; y: number }[] = [];
  /** The stage, painted once. */
  private stage: HTMLCanvasElement | null = null;
  /** The preview marks, painted once (paintPreviewMarks): a frame only lays them on. */
  private previewMarks: HTMLCanvasElement | null = null;
  /** Seconds of slow motion shown so far in this stretch, for the tag's pop; 0 out of it. */
  private slow = 0;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.canvas = canvas;
    this.ctx = ctx;
    this.follow = new FollowButton(ctx);
  }

  reset(cfg: Config): void {
    this.effects = new Effects(cfg.seed);
    this.rng = createRng(`${cfg.seed}:sparks`);
    this.sparks = [];
    this.ghosts = [];
    this.rings = [];
    this.tallies = [];
    this.out = null;
    this.trails = new Map();
    this.slow = 0;
    if (cfg.look.follow) this.follow.load();
  }

  handle(events: BattleEvent[], world: BattleWorld, cfg: Config): void {
    const colors = lineColors(cfg.battle.flags);
    for (const e of events) {
      if (e.type === 'tie') {
        this.rings.push({ x: e.x, y: e.y, age: 0, color: colors[e.flag], size: 46 });
        // Where the strings come from, as a number: the bundle it tied, rising from where it is tied.
        const text = `+${e.n}`;
        this.ctx.font = `800 ${TIE_SIZE}px ${FONT}`;
        const nx = (e.x - ARENA.x) / ARENA.r;
        const ny = (e.y - ARENA.y) / ARENA.r;
        this.effects.float(e.x - nx * TIE_IN, e.y - ny * TIE_IN, text, colors[e.flag], TIE_SIZE, this.ctx.measureText(text).width);
      }
      else if (e.type === 'clash') this.rings.push({ x: e.x, y: e.y, age: 0, color: WHITE, size: 30 });
      else if (e.type === 'cut') {
        const owner = world.flags[e.flag];
        const color = colors[e.flag];
        this.ghosts.push({ strings: e.strings, x: owner.x, y: owner.y, age: 0, color });
        // Sparks off the rival's edge, toward the ball whose strings it is in; a few, since a fan being swept sends them every frame.
        const cutter = world.flags[e.by];
        const sweep = this.tallies.find((t) => t.flag === e.flag && t.by === e.by && t.idle < TALLY_JOIN);
        if (sweep) {
          sweep.n += e.n;
          sweep.idle = 0;
        } else this.tallies.push({ flag: e.flag, by: e.by, n: e.n, idle: 0, shown: 0, x: cutter.x, y: cutter.y });
        const dx = owner.x - cutter.x;
        const dy = owner.y - cutter.y;
        const d = Math.hypot(dx, dy) || 1;
        for (let i = 0; i < Math.min(3, e.n) && this.sparks.length < 90; i++) {
          const a = Math.atan2(dy, dx) + this.rng.range(-1.3, 1.3);
          const speed = this.rng.range(220, 620);
          this.sparks.push({ x: cutter.x + (dx / d) * cutter.r, y: cutter.y + (dy / d) * cutter.r, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, age: 0, color: i % 2 ? WHITE : color });
        }
      } else if (e.type === 'out') {
        const f = world.flags[e.flag];
        this.effects.debris(e.x - f.r, e.y - f.r, 2 * f.r, 2 * f.r, colors[e.flag]);
        this.effects.kick(8);
        this.rings.push({ x: e.x, y: e.y, age: 0, color: colors[e.flag], size: 2.6 * f.r });
        this.out = { flag: e.flag, age: 0 };
      }
    }
  }

  /** The winner card's confetti, in the winner's colour. */
  celebrate(world: BattleWorld, cfg: Config): void {
    const c = world.winner === null ? WHITE : lineColors(cfg.battle.flags)[world.winner];
    this.effects.confetti([c, WHITE, c, '#ffd23f', WHITE], 240, W);
  }

  draw(world: BattleWorld, cfg: Config, dt: number, overlay: BattleOverlay): void {
    const ctx = this.ctx;
    const colors = lineColors(cfg.battle.flags);
    this.effects.update(dt);
    this.age(dt, overlay.slow === true);
    // Each ball where it will be by this frame: the battle is a whole number of steps along, the frame usually a part of one more.
    const lead = overlay.lead ?? 0;
    this.at = world.flags.map((f) => ({ x: f.x + f.ux * lead, y: f.y + f.uy * lead }));
    if (dt > 0) this.track(world);

    ctx.globalAlpha = 1;
    ctx.drawImage((this.stage ??= paintStage()), 0, 0);
    const [sx, sy] = this.effects.offset();
    ctx.save();
    ctx.translate(sx, sy);
    this.drawTitle(world, cfg, colors);
    // The arena and all that happens in it, in the simulation's own px: SCALE of its size round its centre, DROP lower on the frame.
    ctx.save();
    ctx.translate(ARENA.x, CENTRE_Y);
    ctx.scale(SCALE, SCALE);
    ctx.translate(-ARENA.x, -ARENA.y);
    this.drawRing();
    this.drawGhosts();
    this.drawStrings(world, colors);
    this.drawRipples();
    for (const f of world.flags) if (f.alive) this.drawTrail(f, colors[f.id]);
    for (const f of world.flags) if (f.alive) this.drawBall(f, colors[f.id]);
    // Every count over every ball: two balls side by side would hide one's number behind the other. None once the battle is won.
    if (world.winner === null) for (const f of world.flags) if (f.alive) this.drawCount(f, world.time);
    this.drawSparks();
    this.effects.drawTexts(ctx, FONT, STAGE);
    this.drawTallies(world, colors);
    this.effects.drawPieces(ctx, false);
    ctx.restore();
    if (this.slow > 0 && world.winner === null) this.drawSlowTag();
    ctx.restore();

    if (overlay.follow && overlay.follow.at !== null && world.winner === null) this.drawFollow(world.time - overlay.follow.at, sx, sy);
    if (overlay.winner > 0) {
      this.drawWinner(world, cfg, colors, overlay);
      if (overlay.follow) this.drawEndFollow(world, colors, overlay);
    }
    this.effects.drawPieces(ctx, true);
    if (overlay.loop && overlay.start) {
      ctx.globalAlpha = Math.min(1, overlay.loop);
      ctx.drawImage(overlay.start, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (overlay.watermark) this.drawWatermark();
    if (overlay.preview) this.drawPreviewMarks();
  }

  private age(dt: number, slow: boolean): void {
    for (const s of this.sparks) {
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.exp(-dt * 6);
      s.vy *= Math.exp(-dt * 6);
    }
    this.sparks = this.sparks.filter((s) => s.age < 0.32);
    for (const g of this.ghosts) g.age += dt;
    this.ghosts = this.ghosts.filter((g) => g.age < GHOST);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < 0.45);
    for (const t of this.tallies) {
      t.idle += dt;
      if (t.n >= BIG_CUT) t.shown += dt;
    }
    this.tallies = this.tallies.filter((t) => t.idle < TALLY_JOIN + TALLY_FADE);
    if (this.out) this.out.age += dt;
    this.slow = slow ? this.slow + dt : 0;
  }

  private track(world: BattleWorld): void {
    for (const f of world.flags) {
      if (!f.alive) continue;
      let points = this.trails.get(f.id);
      if (!points) this.trails.set(f.id, (points = []));
      points.push(this.at[f.id].x, this.at[f.id].y);
      if (points.length > TRAIL * 2) points.splice(0, 2);
    }
  }

  // ── The title ────────────────────────────────────────────────────────────

  /** A flag's name as the title and the card write it. */
  private name(code: string): string {
    return country(code)?.short ?? code.toUpperCase();
  }

  private drawTitle(world: BattleWorld, cfg: Config, colors: string[]): void {
    const ctx = this.ctx;
    ctx.textBaseline = 'middle';
    this.drawRegion(cfg);
    this.drawKicker(world, colors);
    // The question, without the full stop a spoken sentence ends on.
    const headline = openingQuestion(cfg).toUpperCase().replace(/\.$/, '');
    ctx.textAlign = 'center';
    ctx.letterSpacing = '1px';
    fitFont(ctx, headline, TITLE_W, 84, 900);
    ctx.fillStyle = WHITE;
    ctx.fillText(headline, W / 2, HEADLINE_Y);
    ctx.letterSpacing = '0px';
    this.drawStatus(world, colors);
  }

  /** The region every flag is from, small over the names ("THE BALKANS"), as the format's titles lead with it; nothing when they are from all over. */
  private drawRegion(cfg: Config): void {
    const region = sharedRegion(cfg.battle.flags);
    if (!region) return;
    const ctx = this.ctx;
    ctx.letterSpacing = '8px';
    ctx.font = `800 30px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = MUTED;
    // Centred on the letters, not on the trailing letter spacing.
    ctx.fillText(region.label.toUpperCase(), W / 2 + 4, REGION_Y);
    ctx.letterSpacing = '0px';
  }

  /**
   * Who is in it: up to four names, each in its flag's colour, with VS between, as long as they
   * fit the line at a size still read on a phone (KICKER_MIN); else, and from five flags, how many.
   * A flag out stays where it was, dimmed and struck through: the line says who is gone, in the
   * place a viewer already read its name.
   */
  private drawKicker(world: BattleWorld, colors: string[]): void {
    const ctx = this.ctx;
    const flags = world.flags;
    ctx.letterSpacing = '2px';
    const parts = flags.flatMap((f, i) => (i ? [{ text: ' VS ', color: MUTED, out: false }] : []).concat({ text: this.name(f.code), color: colors[f.id], out: !f.alive }));
    let size = 38;
    const width = () => {
      ctx.font = `900 ${size}px ${FONT}`;
      return parts.reduce((sum, p) => sum + ctx.measureText(p.text).width, 0);
    };
    while (flags.length <= 4 && width() > TITLE_W && size > KICKER_MIN) size -= 2;
    if (flags.length > 4 || width() > TITLE_W) {
      ctx.font = `800 36px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = MUTED;
      ctx.fillText(`${flags.length} FLAGS · ONE SURVIVES`, W / 2, KICKER_Y);
      ctx.letterSpacing = '0px';
      return;
    }
    let x = W / 2 - width() / 2;
    ctx.textAlign = 'left';
    for (const p of parts) {
      const w = ctx.measureText(p.text).width;
      ctx.save();
      if (p.out) ctx.globalAlpha *= 0.4;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, KICKER_Y);
      // The strike through the letters' middle, a little past them either side; the letter spacing's trailing 2 px left off.
      if (p.out) ctx.fillRect(x - 4, KICKER_Y - size * 0.06, w + 6, Math.max(3, size * 0.11));
      ctx.restore();
      x += w;
    }
    ctx.letterSpacing = '0px';
  }

  /**
   * How many flags are left, centred; for OUT_SHOW after a flag goes, its flag and "CROATIA OUT"
   * in its colour instead, popping in. Who went is said by the names above, struck through: small
   * flags of those gone beside "2 LEFT" read as the two that are left.
   */
  private drawStatus(world: BattleWorld, colors: string[]): void {
    const ctx = this.ctx;
    const out = this.out && this.out.age < OUT_SHOW ? this.out : null;
    if (out) {
      const f = world.flags[out.flag];
      const text = `${this.name(f.code)} OUT`;
      const pop = easeOutBack(Math.min(1, out.age / 0.2));
      ctx.save();
      ctx.globalAlpha = Math.min(1, (OUT_SHOW - out.age) / 0.25);
      ctx.translate(W / 2, STATUS_Y);
      ctx.scale(pop, pop);
      ctx.letterSpacing = '2px';
      fitFont(ctx, text, TITLE_W - 80, 56, 900);
      // Its flag, then the words: the two centred as one.
      const left = -(74 + ctx.measureText(text).width) / 2;
      this.flagDisc(f.code, left + 30, 0, 26, colors[f.id], 4);
      ctx.textAlign = 'left';
      ctx.fillStyle = colors[f.id];
      ctx.fillText(text, left + 74, 3);
      ctx.restore();
      ctx.letterSpacing = '0px';
      return;
    }
    ctx.letterSpacing = '3px';
    ctx.font = `800 42px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = MUTED;
    // Centred on the letters, not on the trailing letter spacing.
    ctx.fillText(`${world.alive} LEFT`, W / 2 + 1.5, STATUS_Y + 2);
    ctx.letterSpacing = '0px';
  }

  // ── The arena ────────────────────────────────────────────────────────────

  private drawRing(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 5;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.55)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    // Its inner edge is where balls bounce and strings are tied.
    ctx.arc(ARENA.x, ARENA.y, ARENA.r + 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Every flag's strings in one path each, added to what is under them, so where fans cross both
   * show and where a fan narrows to its ball it brightens. Then a dot of the colour where each is
   * tied: the ring wears the colours of whoever holds it.
   */
  private drawStrings(world: BattleWorld, colors: string[]): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = STRING_W;
    ctx.lineCap = 'butt';
    ctx.globalAlpha = STRING_ALPHA;
    for (const f of world.flags) {
      if (!f.alive || !f.strings.length) continue;
      const { x, y } = this.at[f.id];
      ctx.strokeStyle = colors[f.id];
      ctx.beginPath();
      for (const s of f.strings) {
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    for (const f of world.flags) {
      if (!f.alive) continue;
      ctx.fillStyle = colors[f.id];
      ctx.beginPath();
      for (const s of f.strings) ctx.rect(s.x - 3, s.y - 3, 6, 6);
      ctx.fill();
    }
  }

  /** Strings just cut, fading where they hung: white at first, as a wire glows when it snaps. */
  private drawGhosts(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = STRING_W;
    for (const g of this.ghosts) {
      const k = g.age / GHOST;
      ctx.globalAlpha = 0.85 * (1 - k) ** 2;
      ctx.strokeStyle = k < 0.3 ? WHITE : g.color;
      ctx.beginPath();
      for (const s of g.strings) {
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(g.x, g.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A ring spreading from a bounce that tied strings, two balls meeting, or a flag going out. */
  private drawRipples(): void {
    const ctx = this.ctx;
    for (const r of this.rings) {
      const k = r.age / 0.45;
      ctx.strokeStyle = rgba(r.color, 0.9 * (1 - k));
      ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8 + r.size * (1 - (1 - k) ** 3), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** A comet tail in the flag's colour, widening and brightening toward the ball. */
  private drawTrail(f: Flag, color: string): void {
    const points = this.trails.get(f.id);
    if (!points || points.length < 4) return;
    const ctx = this.ctx;
    const n = points.length / 2;
    ctx.lineCap = 'round';
    for (let i = 1; i < n; i++) {
      const k = i / (n - 1);
      ctx.strokeStyle = rgba(color, 0.22 * k);
      ctx.lineWidth = f.r * 1.6 * k;
      ctx.beginPath();
      ctx.moveTo(points[2 * i - 2], points[2 * i - 1]);
      ctx.lineTo(points[2 * i], points[2 * i + 1]);
      ctx.stroke();
    }
  }

  private drawSparks(): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    for (const s of this.sparks) {
      ctx.globalAlpha = 1 - s.age / 0.32;
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.03, s.y - s.vy * 0.03);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** A ball: a glow of its colour, and its flag in a ring of it. */
  private drawBall(f: Flag, color: string): void {
    const ctx = this.ctx;
    const { x, y } = this.at[f.id];
    const glow = ctx.createRadialGradient(x, y, f.r * 0.9, x, y, f.r * 1.75);
    glow.addColorStop(0, rgba(color, 0.55));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, f.r * 1.75, 0, Math.PI * 2);
    ctx.fill();
    const ring = Math.max(5, f.r * 0.09);
    // The ring is inside the ball's own radius: what bounces and cuts is what is drawn.
    this.flagDisc(f.code, x, y, f.r - ring, color, ring);
  }

  /**
   * The strings a ball holds, under it, white in a dark outline so it reads over strings and other
   * balls alike; red once it is down to its last bundle (inDanger), kicking up a quarter on every
   * HEARTBEAT of the battle's clock, the beat the sonifier's heart plays on.
   */
  private drawCount(f: Flag, time: number): void {
    const ctx = this.ctx;
    const { x, y } = this.at[f.id];
    const size = Math.round(Math.max(28, f.r * 0.5));
    const danger = inDanger(f);
    const beat = danger ? 1 + 0.25 * Math.max(0, 1 - (time % HEARTBEAT) / 0.25) : 1;
    ctx.save();
    ctx.translate(x, y + f.r + size * 0.62);
    ctx.scale(beat, beat);
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    outlined(ctx, String(f.strings.length), 0, 0, danger ? FOLLOW_RED : WHITE, STAGE, Math.round(size * 0.28));
    ctx.restore();
  }

  /**
   * Each sweep of a bundle or more as "-34" in the cut strings' colour, over the cutter while it
   * lasts (one over another when it sweeps two flags), then rising and fading where it ended. A
   * cutter against the top of the ring has no room over it, where the number would sit on "3 LEFT":
   * it goes under the ball's count instead.
   */
  private drawTallies(world: BattleWorld, colors: string[]): void {
    const ctx = this.ctx;
    const stacked = new Map<number, number>();
    for (const t of this.tallies) {
      if (t.n < BIG_CUT) continue;
      const cutter = world.flags[t.by];
      const size = Math.round(Math.min(64, 40 + t.n * 0.25));
      const live = t.idle < TALLY_JOIN;
      if (live && cutter.alive) {
        const above = stacked.get(t.by) ?? 0;
        stacked.set(t.by, above + 1);
        const { x, y } = this.at[t.by];
        const ringTop = ARENA.y - Math.sqrt(Math.max(0, ARENA.r * ARENA.r - (x - ARENA.x) ** 2));
        const over = y - cutter.r - size * (0.75 + above);
        const count = Math.max(28, cutter.r * 0.5);
        t.x = x;
        t.y = over - size / 2 > ringTop + 8 ? over : y + cutter.r + count * 1.3 + size * (0.6 + above);
      }
      const after = live ? 0 : t.idle - TALLY_JOIN;
      const pop = easeOutBack(Math.min(1, t.shown / 0.15));
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - after / TALLY_FADE);
      ctx.translate(t.x, t.y - after * 60);
      ctx.scale(pop, pop);
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      outlined(ctx, `-${t.n}`, 0, 0, colors[t.flag], STAGE, Math.round(size * 0.24));
      ctx.restore();
    }
  }

  /** The flag in a circle of radius `r`, a ring of `color` round it `ring` wide, and a soft shine; its colour alone until the picture has loaded. */
  private flagDisc(code: string, x: number, y: number, r: number, color: string, ring: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r + ring, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    const picture = flagPicture(code);
    if (picture) ctx.drawImage(picture, x - r, y - r, 2 * r, 2 * r);
    else ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    const shine = ctx.createRadialGradient(x - r * 0.4, y - r * 0.5, r * 0.05, x - r * 0.2, y - r * 0.2, r * 1.1);
    shine.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
    shine.addColorStop(0.45, 'rgba(255, 255, 255, 0.04)');
    shine.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
    ctx.fillStyle = shine;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    ctx.restore();
    // A dark hairline between the flag and its ring, so a red flag in a red ring is still a flag.
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.stroke();
  }

  /** A red dot and SLOW MOTION under the ring, in the middle, while an out plays slowed (BattleOutcome.slow). */
  private drawSlowTag(): void {
    const ctx = this.ctx;
    const pop = easeOutBack(Math.min(1, this.slow / 0.2));
    ctx.save();
    ctx.translate(W / 2, FOOTER_Y);
    ctx.scale(pop, pop);
    ctx.font = `900 34px ${FONT}`;
    ctx.letterSpacing = '2px';
    // The dot (26 px) and its gap (14 px), then the words: the two centred as one.
    const left = -(40 + ctx.measureText('SLOW MOTION').width) / 2;
    ctx.fillStyle = FOLLOW_RED;
    ctx.beginPath();
    ctx.arc(left + 13, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('SLOW MOTION', left + 40, 2);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  // ── The follow button, the winner, the watermark ────────────────────────

  /**
   * The follow button in the battle, `age` seconds after it pops in, under the ring in the middle
   * of the frame (FOOTER_Y): a hand comes up from below and taps it, it turns to FOLLOWING, and
   * it fades out, timed as the race's (FOLLOW_SHOW, FOLLOW_RACE_TAP). The button shakes with the
   * frame; the hand is over the screen, and holds still.
   */
  private drawFollow(age: number, sx: number, sy: number): void {
    if (age < 0 || age > FOLLOW_SHOW) return;
    const ctx = this.ctx;
    // 34 px type: a pill 58 px tall, which the ring's glow above and the free plan's mark below leave room for.
    const size = 34;
    const pop = easeOutBack(Math.min(1, age / 0.25));
    ctx.save();
    ctx.globalAlpha = Math.min(1, (FOLLOW_SHOW - age) / 0.35);
    ctx.save();
    ctx.translate(W / 2 + sx, FOOTER_Y + sy);
    ctx.scale(pop, pop);
    this.follow.draw(size, FOLLOW_RED, age - FOLLOW_RACE_TAP, FOLLOW_STYLE);
    ctx.restore();
    this.follow.drawHand(W / 2 + this.follow.plusX(size), FOOTER_Y + size * FOLLOW_PAD, age - FOLLOW_RACE_TAP, RACE_HAND);
    ctx.restore();
  }

  /** The follow button under the winner card, in the winner's colour, tapped as the race's is and left as FOLLOWING. */
  private drawEndFollow(world: BattleWorld, colors: string[], overlay: BattleOverlay): void {
    const age = overlay.age - FOLLOW_IN;
    if (world.winner === null || age < 0) return;
    const ctx = this.ctx;
    const size = 46;
    ctx.save();
    ctx.globalAlpha = overlay.winner;
    ctx.save();
    ctx.translate(W / 2, FOLLOW_Y);
    const pop = easeOutBack(Math.min(1, age / 0.3));
    ctx.scale(pop, pop);
    this.follow.draw(size, colors[world.winner], overlay.age - FOLLOW_TAP, FOLLOW_STYLE);
    ctx.restore();
    this.follow.drawHand(W / 2 + this.follow.plusX(size), FOLLOW_Y + size * FOLLOW_PAD, overlay.age - FOLLOW_TAP, END_HAND);
    ctx.restore();
  }

  /** The winner's flag big over a dark card framed in its colour: WINNER, its name, how long it lasted, the last line. */
  private drawWinner(world: BattleWorld, cfg: Config, colors: string[], overlay: BattleOverlay): void {
    const ctx = this.ctx;
    const winner = world.winner === null ? null : world.flags[world.winner];
    if (!winner) return;
    const color = colors[winner.id];
    const cta = cfg.look.cta.trim().toUpperCase();
    const name = this.name(winner.code);
    ctx.save();
    ctx.globalAlpha = overlay.winner;
    ctx.fillStyle = rgba(STAGE, 0.8);
    ctx.fillRect(0, 0, W, H);
    const pop = easeOutBack(Math.min(1, overlay.age / 0.45));
    ctx.translate(W / 2, CARD_Y);
    ctx.scale(pop, pop);
    const cw = 860;
    const ch = cta ? 500 : 420;
    const top = -ch / 2;
    ctx.save();
    ctx.shadowColor = rgba(color, 0.55);
    ctx.shadowBlur = 60;
    roundRect(ctx, -cw / 2, top, cw, ch, 36);
    ctx.fillStyle = PANEL;
    ctx.fill();
    ctx.restore();
    roundRect(ctx, -cw / 2, top, cw, ch, 36);
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.stroke();
    this.flagDisc(winner.code, 0, top - 30, 120, color, 12);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '8px';
    ctx.font = `800 32px ${FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(world.timedOut ? "TIME'S UP · MOST STRINGS WINS" : 'WINNER', 4, top + 152);
    ctx.letterSpacing = '2px';
    fitFont(ctx, name, cw - 100, 96, 900);
    ctx.fillStyle = WHITE;
    ctx.fillText(name, 0, top + 236);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = MUTED;
    const result = world.timedOut ? `${winner.strings.length} strings left` : `Last flag standing · ${world.winTime.toFixed(1)} s`;
    fitFont(ctx, result, cw - 100, 38, 700);
    ctx.fillText(result, 0, top + 318);
    if (cta) {
      ctx.letterSpacing = '3px';
      fitFont(ctx, cta, cw - 100, 42, 900);
      ctx.fillStyle = color;
      ctx.fillText(cta, 0, top + 410);
      ctx.letterSpacing = '0px';
    }
    ctx.restore();
  }

  /**
   * The preview marks (draw.ts paintPreviewMarks): the site's host across the
   * frame at 14 % while the studio plays a preview, never in a take; white, on the stage.
   */
  private drawPreviewMarks(): void {
    let layer = this.previewMarks;
    if (!layer) {
      layer = paintPreviewMarks(WHITE);
      // Kept only once Rubik is there, or it would keep the fallback face for good.
      if (document.fonts.check(PREVIEW_MARK_FONT)) this.previewMarks = layer;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  /** The free plan's mark and the site's host, centred under the arena, above the platforms' caption zone. */
  private drawWatermark(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.letterSpacing = '0.5px';
    ctx.font = `800 32px ${FONT}`;
    const width = ctx.measureText(SITE_HOST).width;
    const left = W / 2 - (width + 52) / 2;
    drawMark(ctx, left, WATERMARK_Y - 21, 42);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = WHITE;
    ctx.fillText(SITE_HOST, left + 52, WATERMARK_Y + 2);
    ctx.restore();
  }
}

/**
 * When the follow button pops up in a battle, in its seconds: as near 45 % of it as the outs
 * allow, clear of each from half a second before its slow motion (or the out itself) until its
 * OUT has gone from the title; null when 20–80 % of the battle has no such room. The line it
 * shows on is the slow motion tag's, and a viewer watching a flag go is not looking down there.
 */
export function battleFollowAt(outcome: BattleOutcome): number | null {
  const busy: [number, number][] = outcome.outs.map((out) => {
    const slow = outcome.slow.find(([from, to]) => out.time >= from && out.time <= to);
    return [(slow ? slow[0] : out.time) - 0.5, out.time + OUT_SHOW + 0.2];
  });
  const clear = (t: number) => busy.every(([from, to]) => t + FOLLOW_SHOW <= from || t >= to);
  const mid = outcome.time * 0.45;
  // Out from the middle a quarter second at a time, later and earlier in turn.
  for (let k = 0; k < 160; k++) {
    const t = mid + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
    if (t >= outcome.time * 0.2 && t + FOLLOW_SHOW <= outcome.time * 0.8 && clear(t)) return t;
  }
  return null;
}

/** The stage: black, lit a little behind the arena's middle, so the frame is not a flat hole on a phone's OLED. */
function paintStage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = STAGE;
  ctx.fillRect(0, 0, W, H);
  const light = ctx.createRadialGradient(ARENA.x, CENTRE_Y, 0, ARENA.x, CENTRE_Y, ARENA.r * SCALE * 1.5);
  light.addColorStop(0, STAGE_LIT);
  light.addColorStop(1, rgba(STAGE_LIT, 0));
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
  return canvas;
}
