import { SITE_HOST } from '../../shared/site.ts';
import { openingQuestion } from '../audio/opening.ts';
import type { Config } from '../config.ts';
import { drawKit, sideColors } from '../football/kits.ts';
import { sidePicture } from '../football/pictures.ts';
import { derby, side, type Side } from '../football/teams.ts';
import { H, PITCH, W } from '../layout.ts';
import { BALL_R, CELEBRATE, MINUTES, MOUTH, SPEED, SPIN, minuteAt, type MatchEvent, type MatchOutcome, type MatchWorld } from '../sim/match.ts';
import { createRng, type Rng } from '../sim/rng.ts';
import { Effects } from './effects.ts';
import { FONT, PREVIEW_MARK_FONT, WHITE, drawMark, easeOutBack, easeOutCubic, fitFont, legible, outlined, paintPreviewMarks, rgba, roundRect, type Overlay } from './draw.ts';
import { END_HAND, FOLLOW_IN, FOLLOW_PAD, FOLLOW_RACE_TAP, FOLLOW_RED, FOLLOW_SHOW, FOLLOW_TAP, FollowButton, RACE_HAND, type FollowStyle } from './follow.ts';

// Goal Rush, drawn on a 1080×1920 canvas in one look of its own: the Arena Clash's black stage,
// with a pitch on it.
//
//   the title     under the platforms' top bar: the derby or the rivalry if the two make one (else
//                 the format's line, 90 MINUTES · ONE SPINNING GOAL), and the video's question
//   the board     a broadcast's scoreboard: each side's ball and name, the score, the clock
//   the pitch     a ring of white light round a floodlit turf, mown in stripes, with its halfway
//                 line and centre circle; the goal a gap in it with a net behind and its goal area
//                 and spot in front, turning round it; the crowd round the outside, the home
//                 side's fans on the left half and the away side's on the right; the two balls in
//                 their kits, glowing in their colours, with comet trails
//   the timeline  under the pitch, the ninety minutes as a line filling with the clock, each goal
//                 a small ball of its scorer at its minute
//
// A goal is the moment: the net bulges where the ball hits it, a flash and a shockwave in the
// scorer's colour, GOAL! over the pitch with the scorer and the minute, rays behind it, a burst of
// paper from the goal, the frame shakes, the scorer's number on the board pops and the scorer's
// half of the crowd jumps, lit, phones flashing, while the other half sits dim. Then both balls pop
// up on their kick-off spots, GOAL! fading over the play's first moment. Half time says so under the pitch, as the goal turns back; ninety
// minutes say FULL TIME. The winner card, the loop and the watermark do what the other games' do.
// Effects run on frame time with their own seeded randomness: nothing here touches the match.

/** The stage, as the Arena Clash's: near black, a little blue. */
const STAGE = '#05060b';
const STAGE_LIT = '#0d1120';
/**
 * The turf inside the ring, floodlit in the middle and in shade under the ring: a real pitch's
 * green, kept dark enough that the balls' glows and kits stay what the eye goes to, and the stage
 * round it stays black. The near-black turf it replaced read as no grass at all to the owner.
 */
const TURF = '#1d6a3a';
const TURF_EDGE = '#0b2e19';
/** The scoreboard and the winner card. */
const PANEL = '#12162a';
const PANEL_DEEP = '#0a0d1a';
const MUTED = '#9aa3b5';
/** Golden goal's colour, and the clock's in it. */
const GOLD = '#ffd23f';
/**
 * The pitch drawn at 82 % of the simulation's round its centre, at y 985: the ring 795 px across,
 * from y 587 to 1383, the net and the crowd out to 44 px past it, 98 px from the frame's sides at
 * its widest (the Instagram crop on an iPhone is up to 55 px a side). It leaves the scoreboard over
 * it and, under it, room for the timeline, a chip and the mark apart from the crowd (at 84 % round
 * y 1000 the crowd, the goals on the timeline and HALF TIME touched), inside the 3:4 crop of
 * Instagram's grid (y 240–1680).
 */
const SCALE = 0.82;
const CENTRE_Y = 985;
/** px the net reaches out past the ring, in the simulation's units. */
const NET = 54;
const RING_TOP = CENTRE_Y - (PITCH.r + NET) * SCALE;
const RING_BOTTOM = CENTRE_Y + (PITCH.r + NET) * SCALE;
/**
 * The title and the board, by their middles: under TikTok's search bar (to y 247) and inside
 * Instagram's grid crop (from y 240), the board's bottom 25 px over the net at its highest.
 */
const KICKER_Y = 300;
const HEADLINE_Y = 362;
const BOARD_Y = 466;
const BOARD_H = 104;
const TITLE_W = 920;
/**
 * The timeline (y 1463, 30 px under the crowd's glow at its lowest), the line for the follow button
 * or a chip (HALF TIME, GOLDEN GOAL, y 1535, 27 px under the goals on the timeline), and the free
 * plan's mark, under the pitch.
 */
const TIMELINE_Y = RING_BOTTOM + 36;
const FOOTER_Y = TIMELINE_Y + 72;
/** The mark's middle: its bottom at y 1612, over TikTok's caption (from 1620), as the Arena Clash's. */
const WATERMARK_Y = FOOTER_Y + 56;
const TIMELINE_X = 130;
const TIMELINE_W = W - 2 * TIMELINE_X;
/** A goal on the timeline: its scorer's ball, this radius, on the line at its minute. */
const MARK_R = 15;
/** Positions a ball's trail keeps: about a sixth of a second at 60 fps. */
const TRAIL = 10;
/**
 * Seconds of the goal's moment, on frame time: GOAL! pops, holds until the kick-off (CELEBRATE),
 * and fades over the play's first moment, so the match is never stopped longer than it is.
 */
const GOAL_IN = 0.18;
const GOAL_OUT = CELEBRATE;
const GOAL_FADE = 0.3;
/**
 * The crowd, in a stand round the pitch between the ring and the net's reach (NET): three rows of
 * fans, px past the ring, one every CROWD_GAP px along a row, in sixteen blocks with a stair between
 * each; home's fans on the left half, where home kicks off, away's on the right. Each fan is seen
 * from above as a broadcast's camera on the roof sees one: shoulders in a shirt's colour, a head
 * (its hair), and on a goal, arms up, a scarf held out or a flag waved.
 */
const CROWD_ROWS = [15, 29, 43];
const CROWD_GAP = 13;
/** The stand: from the wall at the pitch's edge to the back, px past the ring. */
const STAND_IN = 7;
const STAND_OUT = 52;
/** A fan at rest, dim, so the crowd frames the pitch without taking the eye from it. */
const FAN_IDLE = 0.55;
/** Seconds a goal's half of the crowd jumps for, dying down; at the whistle the winner's never stops. */
const CHEER = 2.4;
/** A half of the crowd's painted canvas: its reach out from the centre, and past the halfway line. */
const CROWD_R = PITCH.r + NET + 6;
const CROWD_EDGE = 10;
/** Hair seen from above, darkest most often, and the hands' skin, for a crowd of people, not of dots. */
const HAIR = ['#141110', '#1d1612', '#2a1e16', '#3a281b', '#4e3523', '#6d4c30', '#9a7448', '#c9a56e', '#232327', '#5b5550'];
const SKIN = ['#f1cba9', '#d9a47e', '#b07850', '#7a5035', '#4f3423'];
/** The goal area's radius round the goal's middle, px: a ball's width, so a ball in it is a chance. */
const GOAL_AREA = 200;
/** Seconds HALF TIME stays under the pitch. */
const HALF_SHOW = 1.8;
/** The follow button on the stage, as the Arena Clash's. */
const FOLLOW_STYLE: FollowStyle = { ink: WHITE, card: WHITE, text: STAGE, shadow: false };
const CARD_Y = 1110;
const FOLLOW_Y = 1440;

/** What the page tells this renderer about a frame of a match. */
export interface MatchOverlay extends Overlay {
  /** Seconds of match the frame is ahead of the last whole step: the balls and the goal are drawn that much further on. */
  ahead?: number;
}

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
  size: number;
  spin: number;
  angle: number;
}

interface Ripple {
  x: number;
  y: number;
  age: number;
  color: string;
  size: number;
}

/**
 * A seat in the crowd: where, the way out from the pitch there and the way along its row, whose fan,
 * which of the side's colours its shirt is (0 the side's own, 1 its shirt's other, 2 white), its
 * hair and hands, when in a jump it is, and what it holds up on a goal (0 nothing, 1 a scarf, 2 a
 * flag: in the front two rows only, so a flag stays inside the stand).
 */
interface Fan {
  x: number;
  y: number;
  nx: number;
  ny: number;
  tx: number;
  ty: number;
  angle: number;
  side: 0 | 1;
  shade: 0 | 1 | 2;
  hair: number;
  skin: number;
  phase: number;
  holds: 0 | 1 | 2;
}

/** The goal being celebrated: who, where the ball crossed and which way, and how long ago (frame time). */
interface GoalMoment {
  side: 0 | 1;
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** Where round the net it hit, as an angle from the goal's middle. */
  at: number;
  minute: number;
  golden: boolean;
  age: number;
}

export class MatchRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  effects = new Effects('');
  private readonly follow: FollowButton;
  private rng: Rng = createRng('match-fx');
  private pieces: Piece[] = [];
  private ripples: Ripple[] = [];
  private moment: GoalMoment | null = null;
  /** Seconds since each side last scored, for its number's pop on the board; Infinity before. */
  private scored: [number, number] = [Infinity, Infinity];
  /** Seconds since the last kick-off, for the balls' pop onto their spots; Infinity for none. */
  private kicked = Infinity;
  private halfAge = Infinity;
  private whistleAge = Infinity;
  /** Seconds since each goal on the timeline appeared, by its index. */
  private marks: number[] = [];
  private trails = new Map<number, number[]>();
  /** Where each ball is drawn this frame. */
  private at: { x: number; y: number }[] = [];
  /** The half of the crowd on its feet: whose, for how long, and whether for good (the winner's, at the whistle). */
  private cheer: { side: 0 | 1; age: number; hold: boolean } | null = null;
  /** Each half of the crowd at rest, painted once per match's colours. */
  private crowd: { key: string; halves: [HTMLCanvasElement, HTMLCanvasElement]; palettes: [string[], string[]] } | null = null;
  private standCanvas: HTMLCanvasElement | null = null;
  private stage: HTMLCanvasElement | null = null;
  private turf: HTMLCanvasElement | null = null;
  private previewMarks: HTMLCanvasElement | null = null;

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
    this.rng = createRng(`${cfg.seed}:match-fx`);
    this.pieces = [];
    this.ripples = [];
    this.moment = null;
    this.scored = [Infinity, Infinity];
    this.kicked = Infinity;
    this.halfAge = Infinity;
    this.whistleAge = Infinity;
    this.marks = [];
    this.trails = new Map();
    this.cheer = null;
    if (cfg.look.follow) this.follow.load();
  }

  handle(events: MatchEvent[], world: MatchWorld, cfg: Config): void {
    const colors = this.colors(cfg);
    for (const e of events) {
      switch (e.type) {
        case 'bounce':
          this.ripples.push({ x: e.x, y: e.y, age: 0, color: colors[e.side], size: 40 });
          break;
        case 'clash':
          this.ripples.push({ x: e.x, y: e.y, age: 0, color: WHITE, size: 34 });
          this.burst(e.x, e.y, 0, 0, [WHITE, WHITE, '#cbd5e1'], 8, 260, 0.35, 5);
          break;
        case 'post': {
          this.ripples.push({ x: e.x, y: e.y, age: 0, color: WHITE, size: 60 });
          this.burst(e.x, e.y, 0, 0, [WHITE, GOLD, WHITE], 14, 420, 0.45, 6);
          this.ctx.font = `900 46px ${FONT}`;
          const text = 'POST!';
          const nx = (e.x - PITCH.x) / PITCH.r;
          const ny = (e.y - PITCH.y) / PITCH.r;
          this.effects.float(e.x - nx * 70, e.y - ny * 70, text, WHITE, 46, this.ctx.measureText(text).width);
          this.effects.kick(3);
          break;
        }
        case 'goal': {
          const g = world.mouth;
          // Where round the net the ball went in: the angle between the goal's middle and the crossing.
          const at = Math.atan2(g.x * e.ny - g.y * e.nx, g.x * e.nx + g.y * e.ny);
          this.moment = { side: e.side, x: e.x, y: e.y, nx: e.nx, ny: e.ny, at, minute: e.goal.minute, golden: world.golden, age: 0 };
          this.scored[e.side] = 0;
          this.marks.push(0);
          this.cheer = { side: e.side, age: 0, hold: false };
          this.effects.kick(13);
          const color = colors[e.side];
          this.burst(e.x, e.y, -e.nx, -e.ny, [color, WHITE, color, GOLD], 70, 900, 1.4, 14);
          this.ripples.push({ x: e.x, y: e.y, age: 0, color, size: 160 });
          break;
        }
        case 'kickoff':
          // The match's own start is the first frame, which the loop fades back into: no pop there.
          // The goal's moment stays a little longer (GOAL_FADE), its ball out of the net.
          if (!e.first) {
            this.kicked = 0;
            this.trails = new Map();
          }
          for (const b of world.balls) this.ripples.push({ x: b.x, y: b.y, age: 0, color: colors[b.side], size: 70 });
          break;
        case 'half':
          this.halfAge = 0;
          break;
        case 'whistle':
          this.whistleAge = 0;
          break;
        case 'win':
          this.cheer = { side: e.side, age: 0, hold: true };
          break;
        case 'golden':
          break;
      }
    }
  }

  /** The winner card's confetti, in the winner's colour. */
  celebrate(world: MatchWorld, cfg: Config): void {
    const c = world.winner === null ? WHITE : this.colors(cfg)[world.winner];
    this.effects.confetti([c, WHITE, c, GOLD, WHITE], 240, W);
  }

  draw(world: MatchWorld, cfg: Config, dt: number, overlay: MatchOverlay): void {
    const ctx = this.ctx;
    const colors = this.colors(cfg);
    const sides = [side(cfg.match.home), side(cfg.match.away)] as const;
    this.effects.update(dt);
    this.age(dt);
    // The balls and the goal as far as this frame is past the last whole step.
    const ahead = world.stopped >= 0 ? 0 : (overlay.ahead ?? 0);
    const angle = world.angle + world.spin * SPIN * ahead;
    this.at = world.balls.map((b) => ({ x: b.x + b.ux * SPEED * ahead, y: b.y + b.uy * SPEED * ahead }));
    if (dt > 0 && world.stopped < 0) this.track(world);

    ctx.globalAlpha = 1;
    ctx.drawImage((this.stage ??= paintStage()), 0, 0);
    const [sx, sy] = this.effects.offset();
    ctx.save();
    ctx.translate(sx, sy);
    this.drawTitle(cfg);
    this.drawBoard(world, cfg, sides, colors);
    this.drawTimeline(world, sides, colors, 1 - overlay.winner);
    ctx.save();
    ctx.translate(PITCH.x, CENTRE_Y);
    ctx.scale(SCALE, SCALE);
    ctx.translate(-PITCH.x, -PITCH.y);
    ctx.drawImage((this.turf ??= paintTurf()), PITCH.x - PITCH.r - 8, PITCH.y - PITCH.r - 8);
    this.drawCrowd(sides, colors);
    this.drawRing(angle);
    this.drawGoal(angle, colors);
    this.drawRipples();
    for (const b of world.balls) this.drawTrail(b.side, colors[b.side], b.r);
    for (const b of world.balls) this.drawBall(world, b.side, sides[b.side], colors[b.side]);
    // Names under the players' balls, over both balls, as the Arena Clash's counts are; a player with
    // no number and no photo has his name on his ball already. Not the scorer's while it is in the net.
    if (cfg.match.mode === 'players') {
      for (const b of world.balls) if (world.scorer !== b.side && (sides[b.side]?.mark || sidePicture(sides[b.side]?.id ?? ''))) this.drawName(b.side, sides[b.side], b.r);
    }
    this.drawPieces();
    this.effects.drawTexts(ctx, FONT, STAGE);
    ctx.restore();
    this.drawGoalMoment(cfg, sides, colors);
    this.drawFooter(world);
    ctx.restore();

    if (world.winner !== null && overlay.winner < 1) this.drawWhistle(world, 1 - overlay.winner);
    if (overlay.follow && overlay.follow.at !== null && world.winner === null) this.drawFollow(world.time - overlay.follow.at, sx, sy);
    if (overlay.winner > 0) {
      this.drawWinner(world, cfg, sides, colors, overlay);
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

  /** The two sides' colours on the stage (football/kits.ts sideColors). */
  private colors(cfg: Config): [string, string] {
    return sideColors(side(cfg.match.home), side(cfg.match.away));
  }

  private age(dt: number): void {
    for (const p of this.pieces) {
      p.age += dt;
      p.vy += 900 * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
    }
    this.pieces = this.pieces.filter((p) => p.age < p.life);
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < 0.5);
    if (this.moment) this.moment.age += dt;
    if (this.moment && this.moment.age > GOAL_OUT + GOAL_FADE + 0.5) this.moment = null;
    if (this.cheer) this.cheer.age += dt;
    this.scored = [this.scored[0] + dt, this.scored[1] + dt];
    this.kicked += dt;
    this.halfAge += dt;
    this.whistleAge += dt;
    this.marks = this.marks.map((m) => m + dt);
  }

  private track(world: MatchWorld): void {
    for (const b of world.balls) {
      let points = this.trails.get(b.side);
      if (!points) this.trails.set(b.side, (points = []));
      points.push(this.at[b.side].x, this.at[b.side].y);
      if (points.length > TRAIL * 2) points.splice(0, 2);
    }
  }

  /** Paper and sparks from x, y: `n` of them, toward nx, ny when given (out of the goal), else all round. */
  private burst(x: number, y: number, nx: number, ny: number, colors: string[], n: number, speed: number, life: number, size: number): void {
    const toward = nx || ny ? Math.atan2(ny, nx) : 0;
    const spread = nx || ny ? 1.3 : Math.PI;
    for (let i = 0; i < n && this.pieces.length < 400; i++) {
      const a = toward + this.rng.range(-spread, spread);
      const v = this.rng.range(0.35, 1) * speed;
      this.pieces.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        age: 0,
        life: this.rng.range(0.6, 1) * life,
        color: colors[i % colors.length],
        size: this.rng.range(0.6, 1.2) * size,
        spin: this.rng.range(-12, 12),
        angle: this.rng.range(0, 6),
      });
    }
  }

  // ── The title and the board ──────────────────────────────────────────────

  private drawTitle(cfg: Config): void {
    const ctx = this.ctx;
    const named = derby(cfg.match.home, cfg.match.away);
    const kicker = (named ? named.replace(/^the /, '') : '90 minutes · one spinning goal').toUpperCase();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '6px';
    fitFont(ctx, kicker, TITLE_W - 40, 30, 800);
    ctx.fillStyle = named ? GOLD : MUTED;
    // Centred on the letters, not on the trailing letter spacing.
    ctx.fillText(kicker, W / 2 + 3, KICKER_Y);
    const headline = openingQuestion(cfg).toUpperCase().replace(/\.$/, '');
    ctx.letterSpacing = '1px';
    fitFont(ctx, headline, TITLE_W, 80, 900);
    ctx.fillStyle = WHITE;
    ctx.fillText(headline, W / 2, HEADLINE_Y);
    ctx.letterSpacing = '0px';
  }

  /**
   * The scoreboard, a broadcast's: a dark bar the title's width, each side's ball and name at its
   * end (home left, away right) over a line in its colour, the score in the middle on a deeper
   * block with the clock under it. A side that scores has its number pop in its colour and its half
   * of the bar flash.
   */
  private drawBoard(world: MatchWorld, cfg: Config, sides: readonly [Side | undefined, Side | undefined], colors: [string, string]): void {
    const ctx = this.ctx;
    const top = BOARD_Y - BOARD_H / 2;
    const left = (W - TITLE_W) / 2;
    ctx.save();
    roundRect(ctx, left, top, TITLE_W, BOARD_H, 30);
    ctx.fillStyle = PANEL;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();
    // A side's half flashing in its colour as it scores.
    for (const s of [0, 1] as const) {
      const k = this.scored[s];
      if (k > 0.9) continue;
      ctx.save();
      roundRect(ctx, left, top, TITLE_W, BOARD_H, 30);
      ctx.clip();
      const glow = ctx.createLinearGradient(s ? left + TITLE_W : left, 0, W / 2, 0);
      glow.addColorStop(0, rgba(colors[s], 0.55 * (1 - k / 0.9)));
      glow.addColorStop(1, rgba(colors[s], 0));
      ctx.fillStyle = glow;
      ctx.fillRect(left, top, TITLE_W, BOARD_H);
      ctx.restore();
    }
    // The score's block.
    const bw = 250;
    roundRect(ctx, W / 2 - bw / 2, top + 8, bw, BOARD_H - 16, 22);
    ctx.fillStyle = PANEL_DEEP;
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const s of [0, 1] as const) {
      const k = this.scored[s];
      const pop = k < 0.45 ? 1 + 0.55 * (1 - easeOutBack(Math.min(1, k / 0.45))) + 0.35 * (1 - k / 0.45) : 1;
      ctx.save();
      ctx.translate(W / 2 + (s ? 58 : -58), BOARD_Y - 12);
      ctx.scale(pop, pop);
      ctx.font = `900 64px ${FONT}`;
      ctx.fillStyle = k < 0.8 ? colors[s] : WHITE;
      ctx.fillText(String(world.score[s]), 0, 2);
      ctx.restore();
    }
    ctx.font = `800 44px ${FONT}`;
    ctx.fillStyle = MUTED;
    ctx.fillText('–', W / 2, BOARD_Y - 14);
    this.drawClock(world);
    // Each side's ball and name at its end of the bar.
    const nameW = (TITLE_W - bw) / 2 - 92;
    for (const s of [0, 1] as const) {
      const discX = s ? left + TITLE_W - 52 : left + 52;
      drawKit(ctx, sides[s], discX, BOARD_Y, 34);
      ctx.beginPath();
      ctx.arc(discX, BOARD_Y, 35.5, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors[s];
      ctx.stroke();
      const name = sides[s]?.short ?? (s ? cfg.match.away : cfg.match.home).toUpperCase();
      ctx.letterSpacing = '1px';
      fitFont(ctx, name, nameW, 36, 900);
      const w = ctx.measureText(name).width;
      const x = s ? discX - 50 - w : discX + 50;
      ctx.textAlign = 'left';
      ctx.fillStyle = WHITE;
      ctx.fillText(name, x, BOARD_Y - 6);
      ctx.letterSpacing = '0px';
      ctx.fillStyle = colors[s];
      roundRect(ctx, x, BOARD_Y + 18, Math.min(w, 90), 6, 3);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The clock under the score: a red dot and the minute ("67'"), gold in golden goal ("90+'"), FT once it is over. */
  private drawClock(world: MatchWorld): void {
    const ctx = this.ctx;
    const t = world.winner !== null ? world.winTime : world.time;
    const text = world.winner !== null ? 'FT' : world.golden ? `${MINUTES}+${Math.max(1, minuteAt(t, world.length) - MINUTES)}'` : t <= 0 ? "0'" : `${Math.min(MINUTES, minuteAt(t, world.length))}'`;
    const y = BOARD_Y + 30;
    ctx.font = `800 26px ${FONT}`;
    const w = ctx.measureText(text).width;
    const live = world.winner === null;
    const left = W / 2 - (w + (live ? 22 : 0)) / 2;
    if (live) {
      // The dot breathes once a second, as a live broadcast's does.
      ctx.fillStyle = world.golden ? GOLD : FOLLOW_RED;
      ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.cos(world.time * Math.PI));
      ctx.beginPath();
      ctx.arc(left + 6, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = world.golden && live ? GOLD : MUTED;
    ctx.fillText(text, left + (live ? 22 : 0), y + 1);
    ctx.textAlign = 'center';
  }

  /**
   * The ninety minutes under the pitch: a line filling with the clock, a tick at half time, and
   * each goal its scorer's small ball on the line at its minute, popping in as it is scored. A goal
   * too close to the one before sits just after it, so each ball shows whole; on the line, not on a
   * pin over it, the goals keep clear of the crowd above. `alpha` fades it for the winner card.
   */
  private drawTimeline(world: MatchWorld, sides: readonly [Side | undefined, Side | undefined], colors: [string, string], alpha: number): void {
    if (alpha <= 0) return;
    const ctx = this.ctx;
    const y = TIMELINE_Y;
    const t = Math.min(1, (world.winner !== null ? world.winTime : world.time) / world.length);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
    roundRect(ctx, TIMELINE_X, y - 3, TIMELINE_W, 6, 3);
    ctx.fill();
    ctx.fillStyle = world.golden ? GOLD : 'rgba(255, 255, 255, 0.85)';
    roundRect(ctx, TIMELINE_X, y - 3, Math.max(6, TIMELINE_W * t), 6, 3);
    ctx.fill();
    // Half time's tick, and the minutes at the ends.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(TIMELINE_X + TIMELINE_W / 2 - 1.5, y - 10, 3, 20);
    ctx.font = `700 20px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'right';
    ctx.fillText("0'", TIMELINE_X - 14, y + 1);
    ctx.textAlign = 'left';
    ctx.fillText("90'", TIMELINE_X + TIMELINE_W + 12, y + 1);
    // The clock's head: a dot that glows.
    const hx = TIMELINE_X + TIMELINE_W * t;
    ctx.fillStyle = world.golden ? GOLD : WHITE;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(hx, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    let last = -Infinity;
    world.goals.forEach((g, i) => {
      const x = Math.max(TIMELINE_X + TIMELINE_W * Math.min(1, g.time / world.length), last + 2 * MARK_R + 7);
      last = x;
      const since = this.marks[i] ?? Infinity;
      const pop = easeOutBack(Math.min(1, since / 0.35));
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pop, pop);
      ctx.beginPath();
      ctx.arc(0, 0, MARK_R + 4, 0, Math.PI * 2);
      ctx.fillStyle = STAGE;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, MARK_R + 2.5, 0, Math.PI * 2);
      ctx.fillStyle = colors[g.side];
      ctx.fill();
      drawKit(ctx, sides[g.side], 0, 0, MARK_R, false);
      ctx.restore();
    });
    ctx.restore();
  }

  // ── The pitch ────────────────────────────────────────────────────────────

  /** The ring of light, all round but the goal's mouth. */
  private drawRing(angle: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 255, 255, 0.55)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(PITCH.x, PITCH.y, PITCH.r + 2.5, angle + MOUTH, angle + 2 * Math.PI - MOUTH);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The goal at `angle` round the ring and its end of the pitch, turning together: the mouth
   * floodlit, the goal area (an arc round the mouth, as futsal's, which a round pitch suits better
   * than boxes) and the spot on the turf; behind the line the net out to NET past the ring, dark
   * inside so its mesh reads, the frame bright, the line dashed across the mouth, and the posts two
   * white blocks. In a goal's moment the net bulges where the ball went in, in the scorer's colour,
   * and settles.
   */
  private drawGoal(angle: number, colors: [string, string]): void {
    const ctx = this.ctx;
    const m = this.moment;
    const k = m ? m.age : Infinity;
    // The bulge: out fast, then a few damped wobbles.
    const bulge = m ? 30 * Math.exp(-4.2 * k) * Math.cos(13 * k) * Math.min(1, k / 0.05 + 0.4) : 0;
    const at = m?.at ?? 0;
    const color = m ? colors[m.side] : WHITE;
    const tint = m ? Math.max(0, 1 - k / (GOAL_OUT + GOAL_FADE)) : 0;
    const R = PITCH.r;
    const edge = MOUTH * 0.9;
    const steps = 24;
    /** The net's depth at `a` round it from the goal's middle, `part` of the way out. */
    const depth = (a: number, part: number) => R + 3 + (NET - 3) * part + bulge * part * Math.exp(-(((a - at) / 0.13) ** 2));
    const point = (a: number, r: number) => [Math.cos(a) * r, Math.sin(a) * r] as const;
    /** The net's outline: from a post round the back to the other. */
    const outline = () => {
      ctx.beginPath();
      ctx.moveTo(...point(-MOUTH, R + 3));
      for (let i = 0; i <= steps; i++) {
        const a = -edge + (2 * edge * i) / steps;
        ctx.lineTo(...point(a, depth(a, 1)));
      }
      ctx.lineTo(...point(MOUTH, R + 3));
    };
    ctx.save();
    ctx.translate(PITCH.x, PITCH.y);
    ctx.rotate(angle);
    // The goal's end, on the turf alone: the mouth lit, the goal area's arc, the spot.
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.clip();
    const lit = ctx.createRadialGradient(R, 0, 0, R, 0, GOAL_AREA + 90);
    lit.addColorStop(0, tint ? rgba(color, 0.12 + 0.2 * tint) : 'rgba(255, 255, 255, 0.11)');
    lit.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = lit;
    ctx.fillRect(R - GOAL_AREA - 90, -GOAL_AREA - 90, GOAL_AREA + 90, 2 * (GOAL_AREA + 90));
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.36)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(R, 0, GOAL_AREA, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(R - GOAL_AREA - 55, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Inside the net: dark, the crowd behind it seen through, lit in the scorer's colour in a goal's moment.
    outline();
    ctx.closePath();
    ctx.fillStyle = 'rgba(3, 5, 10, 0.6)';
    ctx.fill();
    ctx.fillStyle = tint ? rgba(color, 0.14 + 0.36 * tint) : 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    // The mesh: lines out from the goal line to the back, and across at each quarter of the way.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = tint ? rgba(color, 0.55 + 0.4 * tint) : 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    for (let i = 1; i < 14; i++) {
      const a = -MOUTH + (2 * MOUTH * i) / 14;
      const b = (a / MOUTH) * edge;
      ctx.moveTo(...point(a, R + 3));
      ctx.lineTo(...point(b, depth(b, 1)));
    }
    for (const part of [0.25, 0.5, 0.75]) {
      for (let i = 0; i <= steps; i++) {
        const a = -MOUTH + (2 * MOUTH * i) / steps;
        const b = (a / MOUTH) * (MOUTH + (edge - MOUTH) * part);
        const p = point(b, depth(b, part));
        if (i) ctx.lineTo(...p);
        else ctx.moveTo(...p);
      }
    }
    ctx.stroke();
    // The frame: the sides and the back of the net.
    ctx.save();
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = tint ? color : WHITE;
    ctx.shadowColor = tint ? color : 'rgba(255, 255, 255, 0.6)';
    ctx.shadowBlur = 14 + 22 * tint;
    outline();
    ctx.stroke();
    ctx.restore();
    // The goal line across the mouth, dashed.
    ctx.save();
    ctx.setLineDash([10, 9]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(0, 0, R + 2.5, -MOUTH, MOUTH);
    ctx.stroke();
    ctx.restore();
    // The posts: white blocks square to the ring, in a glow.
    for (const a of [-MOUTH, MOUTH]) {
      const [x, y] = point(a, R + 2.5);
      const glow = ctx.createRadialGradient(x, y, 2, x, y, 30);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.65)');
      glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = WHITE;
      roundRect(ctx, -12, -12, 24, 24, 6);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // ── The crowd ────────────────────────────────────────────────────────────

  /**
   * The crowd: the stand, then each half at rest from its painted canvas; the half on its feet
   * (`cheer`) fan by fan, jumping each in its own time, lit full, arms, scarves and flags up, a
   * phone flashing here and there, its colour glowing over its stand, while the other half sits
   * dimmer.
   */
  private drawCrowd(sides: readonly [Side | undefined, Side | undefined], colors: [string, string]): void {
    const ctx = this.ctx;
    const crowd = this.crowdFor(sides, colors);
    ctx.drawImage((this.standCanvas ??= paintStand()), PITCH.x - CROWD_R, PITCH.y - CROWD_R);
    const c = this.cheer;
    const rise = c ? Math.min(1, c.age / 0.12) : 0;
    const amp = c ? rise * (c.hold ? 1 : Math.max(0, 1 - c.age / CHEER)) : 0;
    for (const s of [0, 1] as const) {
      if (c?.side === s && amp > 0.01) {
        // The stand's glow: its colour over its half.
        ctx.save();
        ctx.lineWidth = STAND_OUT - STAND_IN + 14;
        ctx.strokeStyle = rgba(colors[s], 0.16 * amp);
        ctx.beginPath();
        ctx.arc(PITCH.x, PITCH.y, PITCH.r + (STAND_IN + STAND_OUT) / 2, s ? -Math.PI / 2 : Math.PI / 2, s ? Math.PI / 2 : (3 * Math.PI) / 2);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = FAN_IDLE + (1 - FAN_IDLE) * amp;
        drawFans(ctx, s, crowd.palettes[s], c.age, amp);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.globalAlpha = amp > 0.01 ? 1 - 0.4 * amp : 1;
      ctx.drawImage(crowd.halves[s], s ? PITCH.x - CROWD_EDGE : PITCH.x - CROWD_R, PITCH.y - CROWD_R);
    }
    ctx.globalAlpha = 1;
  }

  /** Each half of the crowd at rest, painted again only when the sides' colours change. */
  private crowdFor(sides: readonly [Side | undefined, Side | undefined], colors: [string, string]): NonNullable<MatchRenderer['crowd']> {
    const palettes: [string[], string[]] = [fanColors(sides[0], colors[0]), fanColors(sides[1], colors[1])];
    const key = palettes.flat().join();
    if (this.crowd?.key !== key) this.crowd = { key, palettes, halves: [paintFans(0, palettes[0]), paintFans(1, palettes[1])] };
    return this.crowd;
  }

  private drawRipples(): void {
    const ctx = this.ctx;
    for (const r of this.ripples) {
      const k = r.age / 0.5;
      ctx.strokeStyle = rgba(r.color, 0.9 * (1 - k));
      ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8 + r.size * (1 - (1 - k) ** 3), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawTrail(s: 0 | 1, color: string, r: number): void {
    const points = this.trails.get(s);
    if (!points || points.length < 4) return;
    const ctx = this.ctx;
    const n = points.length / 2;
    ctx.lineCap = 'round';
    for (let i = 1; i < n; i++) {
      const k = i / (n - 1);
      ctx.strokeStyle = rgba(color, 0.22 * k);
      ctx.lineWidth = r * 1.6 * k;
      ctx.beginPath();
      ctx.moveTo(points[2 * i - 2], points[2 * i - 1]);
      ctx.lineTo(points[2 * i], points[2 * i + 1]);
      ctx.stroke();
    }
  }

  /**
   * A ball: a glow of its colour and its kit in a ring of it. The scorer, in a goal's moment, rolls
   * on into the net; both pop up on their spots at a kick-off.
   */
  private drawBall(world: MatchWorld, s: 0 | 1, team: Side | undefined, color: string): void {
    const ctx = this.ctx;
    let { x, y } = this.at[s];
    const m = this.moment;
    if (m && m.side === s && world.scorer === s) {
      const into = (NET * 0.55 + BALL_R * 0.35) * easeOutCubic(m.age / 0.28);
      x += m.nx * into;
      y += m.ny * into;
    }
    const r = world.balls[s].r;
    const pop = this.kicked < 0.3 ? easeOutBack(this.kicked / 0.3) : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pop, pop);
    const glow = ctx.createRadialGradient(0, 0, r * 0.9, 0, 0, r * 1.7);
    glow.addColorStop(0, rgba(color, 0.55));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2);
    ctx.fill();
    const ring = Math.max(5, r * 0.08);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    // The ring inside the ball's own radius: what bounces is what is drawn.
    drawKit(ctx, team, 0, 0, r - ring);
    ctx.restore();
  }

  /** A player's name under his ball, white in a dark outline, as the Arena Clash's counts are. */
  private drawName(s: 0 | 1, team: Side | undefined, r: number): void {
    if (!team) return;
    const ctx = this.ctx;
    const { x, y } = this.at[s];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '1px';
    fitFont(ctx, team.short, r * 2.6, 34, 900);
    outlined(ctx, team.short, x, y + r + 26, WHITE, STAGE, 9);
    ctx.restore();
  }

  private drawPieces(): void {
    const ctx = this.ctx;
    for (const p of this.pieces) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
  }

  // ── The goal's moment ────────────────────────────────────────────────────

  /**
   * GOAL! over the pitch, in white edged in the scorer's colour and leaning forward, with rays of
   * the colour turning behind it and a flash and a shockwave from the goal; under it the scorer and
   * the minute ("VINÍCIUS 67'"). It pops in, holds, and is gone before the kick-off.
   */
  private drawGoalMoment(cfg: Config, sides: readonly [Side | undefined, Side | undefined], colors: [string, string]): void {
    const m = this.moment;
    if (!m || m.age > GOAL_OUT + GOAL_FADE) return;
    const ctx = this.ctx;
    const color = colors[m.side];
    const gx = PITCH.x + (m.x - PITCH.x) * SCALE;
    const gy = CENTRE_Y + (m.y - PITCH.y) * SCALE;
    // The flash at the goal, and its shockwave across the pitch.
    if (m.age < 0.4) {
      const k = m.age / 0.4;
      const flash = ctx.createRadialGradient(gx, gy, 0, gx, gy, 420);
      flash.addColorStop(0, `rgba(255, 255, 255, ${0.75 * (1 - k)})`);
      flash.addColorStop(0.35, rgba(color, 0.35 * (1 - k)));
      flash.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = flash;
      ctx.fillRect(gx - 420, gy - 420, 840, 840);
    }
    if (m.age < 0.7) {
      const k = m.age / 0.7;
      ctx.strokeStyle = rgba(color, 0.8 * (1 - k));
      ctx.lineWidth = 14 * (1 - k) + 2;
      ctx.beginPath();
      ctx.arc(gx, gy, 30 + 700 * easeOutCubic(k), 0, Math.PI * 2);
      ctx.stroke();
    }
    const fade = m.age < GOAL_OUT ? 1 : Math.max(0, 1 - (m.age - GOAL_OUT) / GOAL_FADE);
    const pop = m.age < GOAL_IN ? easeOutBack(m.age / GOAL_IN) : 1 + 0.04 * Math.sin((m.age - GOAL_IN) * 6);
    const cy = CENTRE_Y - 30;
    ctx.save();
    ctx.globalAlpha = fade;
    // Rays of the scorer's colour, turning slowly behind the word.
    ctx.save();
    ctx.translate(W / 2, cy);
    ctx.rotate(m.age * 0.6);
    const rays = ctx.createRadialGradient(0, 0, 40, 0, 0, 520);
    rays.addColorStop(0, rgba(color, 0.42));
    rays.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = rays;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 520, a, a + 0.16);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
    ctx.translate(W / 2, cy);
    ctx.scale(pop, pop);
    ctx.transform(1, 0, -0.14, 1, 0, 0);
    const word = m.golden ? 'GOLDEN GOAL!' : 'GOAL!';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '4px';
    fitFont(ctx, word, 900, 200, 900);
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 50;
    ctx.lineWidth = 30;
    ctx.strokeStyle = color;
    ctx.strokeText(word, 0, 0);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 12;
    ctx.strokeStyle = STAGE;
    ctx.strokeText(word, 0, 0);
    ctx.fillStyle = WHITE;
    ctx.fillText(word, 0, 0);
    // The scorer and the minute.
    const who = `${sides[m.side]?.short ?? (m.side ? cfg.match.away : cfg.match.home).toUpperCase()}  ${m.minute > MINUTES ? `${MINUTES}+${m.minute - MINUTES}` : m.minute}'`;
    ctx.letterSpacing = '2px';
    fitFont(ctx, who, 820, 54, 900);
    outlined(ctx, who, 0, 122, color, STAGE, 12);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  /** Under the pitch, in the middle: HALF TIME for a moment as the goal turns back, GOLDEN GOAL while it lasts. */
  private drawFooter(world: MatchWorld): void {
    if (world.winner !== null) return;
    const chip = world.golden ? { text: 'GOLDEN GOAL · NEXT GOAL WINS', color: GOLD, age: Infinity } : this.halfAge < HALF_SHOW ? { text: 'HALF TIME · THE GOAL TURNS BACK', color: WHITE, age: this.halfAge } : null;
    if (!chip) return;
    const ctx = this.ctx;
    const pop = chip.age === Infinity ? 1 : easeOutBack(Math.min(1, chip.age / 0.25));
    ctx.save();
    ctx.globalAlpha = chip.age === Infinity ? 1 : Math.min(1, (HALF_SHOW - chip.age) / 0.3);
    ctx.translate(W / 2, FOOTER_Y);
    ctx.scale(pop, pop);
    ctx.font = `900 30px ${FONT}`;
    ctx.letterSpacing = '3px';
    const w = ctx.measureText(chip.text).width + 56;
    roundRect(ctx, -w / 2, -27, w, 54, 27);
    ctx.fillStyle = rgba(chip.color, 0.14);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(chip.color, 0.6);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = chip.color;
    ctx.fillText(chip.text, 2, 2);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  /** FULL TIME over the pitch as the whistle goes, in the slow motion before the winner card. */
  private drawWhistle(world: MatchWorld, alpha: number): void {
    if (world.timedOut || this.whistleAge === Infinity || (this.moment && this.moment.age < GOAL_OUT)) return;
    const ctx = this.ctx;
    const pop = easeOutBack(Math.min(1, this.whistleAge / 0.3));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(STAGE, 0.45 * Math.min(1, this.whistleAge / 0.3));
    ctx.fillRect(0, RING_TOP, W, RING_BOTTOM - RING_TOP);
    ctx.translate(W / 2, CENTRE_Y);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '6px';
    ctx.font = `900 132px ${FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = STAGE;
    ctx.strokeText('FULL TIME', 0, 0);
    ctx.fillStyle = WHITE;
    ctx.fillText('FULL TIME', 0, 0);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  // ── The follow button, the winner, the watermark ────────────────────────

  /** The follow button in the match, under the pitch in the middle, as the Arena Clash's. */
  private drawFollow(age: number, sx: number, sy: number): void {
    if (age < 0 || age > FOLLOW_SHOW) return;
    const ctx = this.ctx;
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

  private drawEndFollow(world: MatchWorld, colors: [string, string], overlay: MatchOverlay): void {
    const age = overlay.age - FOLLOW_IN;
    if (world.winner === null || age < 0) return;
    const ctx = this.ctx;
    const size = 46;
    ctx.save();
    ctx.globalAlpha = overlay.winner;
    ctx.save();
    ctx.translate(W / 2, FOLLOW_Y);
    ctx.scale(easeOutBack(Math.min(1, age / 0.3)), easeOutBack(Math.min(1, age / 0.3)));
    this.follow.draw(size, colors[world.winner], overlay.age - FOLLOW_TAP, FOLLOW_STYLE);
    ctx.restore();
    this.follow.drawHand(W / 2 + this.follow.plusX(size), FOLLOW_Y + size * FOLLOW_PAD, overlay.age - FOLLOW_TAP, END_HAND);
    ctx.restore();
  }

  /**
   * The winner's ball big over a dark card framed in its colour: WINNER (GOLDEN GOAL in golden
   * goal), its name, the score with the loser's ball and name beside it, each side's goals by minute,
   * and the last line.
   */
  private drawWinner(world: MatchWorld, cfg: Config, sides: readonly [Side | undefined, Side | undefined], colors: [string, string], overlay: MatchOverlay): void {
    const w = world.winner;
    if (w === null) return;
    const l = w === 0 ? 1 : 0;
    const ctx = this.ctx;
    const color = colors[w];
    const cta = cfg.look.cta.trim().toUpperCase();
    const name = (s: 0 | 1) => sides[s]?.short ?? (s ? cfg.match.away : cfg.match.home).toUpperCase();
    ctx.save();
    ctx.globalAlpha = overlay.winner;
    ctx.fillStyle = rgba(STAGE, 0.82);
    ctx.fillRect(0, 0, W, H);
    const pop = easeOutBack(Math.min(1, overlay.age / 0.45));
    ctx.translate(W / 2, CARD_Y);
    ctx.scale(pop, pop);
    const cw = 880;
    const ch = cta ? 560 : 480;
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
    ctx.beginPath();
    ctx.arc(0, top - 30, 132, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    drawKit(ctx, sides[w], 0, top - 30, 120);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '8px';
    ctx.font = `800 32px ${FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(world.timedOut ? 'WINNER' : world.golden ? 'GOLDEN GOAL · WINNER' : 'FULL TIME · WINNER', 4, top + 152);
    ctx.letterSpacing = '2px';
    fitFont(ctx, name(w), cw - 100, 92, 900);
    ctx.fillStyle = WHITE;
    ctx.fillText(name(w), 0, top + 232);
    // The score, the winner's first, and who it was against.
    ctx.letterSpacing = '0px';
    ctx.font = `900 76px ${FONT}`;
    const score = `${world.score[w]} – ${world.score[l]}`;
    const sw = ctx.measureText(score).width;
    ctx.font = `800 34px ${FONT}`;
    const against = `vs ${name(l)}`;
    const aw = Math.min(360, ctx.measureText(against).width);
    const rowW = sw + 36 + 44 + 14 + aw;
    let x = -rowW / 2;
    ctx.textAlign = 'left';
    ctx.font = `900 76px ${FONT}`;
    ctx.fillStyle = WHITE;
    ctx.fillText(score, x, top + 322);
    x += sw + 36;
    drawKit(ctx, sides[l], x + 22, top + 320, 22);
    x += 44 + 14;
    fitFont(ctx, against, 360, 34, 800);
    ctx.fillStyle = MUTED;
    ctx.fillText(against, x, top + 322);
    // The goals by minute, each side's in its colour.
    const minutes = (s: 0 | 1) =>
      world.goals
        .filter((g) => g.side === s)
        .map((g) => (g.minute > MINUTES ? `${MINUTES}+${g.minute - MINUTES}'` : `${g.minute}'`))
        .join('  ');
    const line = [minutes(w), minutes(l)].map((t) => t || '–');
    ctx.font = `700 28px ${FONT}`;
    ctx.textAlign = 'center';
    const gap = 40;
    const lw = ctx.measureText(line[0]).width;
    const rw = ctx.measureText(line[1]).width;
    const scale = Math.min(1, (cw - 100) / (lw + rw + gap));
    ctx.save();
    ctx.translate(0, top + 392);
    ctx.scale(scale, scale);
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(line[0], -gap / 2, 0);
    ctx.textAlign = 'left';
    ctx.fillStyle = colors[l];
    ctx.fillText(line[1], gap / 2, 0);
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'center';
    ctx.fillText('·', 0, 0);
    ctx.restore();
    if (cta) {
      ctx.letterSpacing = '3px';
      fitFont(ctx, cta, cw - 100, 42, 900);
      ctx.fillStyle = color;
      ctx.fillText(cta, 0, top + 476);
      ctx.letterSpacing = '0px';
    }
    ctx.restore();
  }

  private drawPreviewMarks(): void {
    let layer = this.previewMarks;
    if (!layer) {
      layer = paintPreviewMarks(WHITE);
      if (document.fonts.check(PREVIEW_MARK_FONT)) this.previewMarks = layer;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  /** The free plan's mark and the site's host, centred under the timeline, above the platforms' caption zone. */
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
 * When the follow button pops up in a match, in its seconds: as near 45 % of it as its goals
 * allow, clear of each from half a second before it until its moment is over; null when 20–80 %
 * of the match has no such room. A viewer watching a goal is not looking under the pitch.
 */
export function matchFollowAt(outcome: MatchOutcome): number | null {
  const busy = outcome.goals.map((g) => [g.time - 0.5, g.time + GOAL_OUT + GOAL_FADE + 0.2] as const);
  const half = outcome.time / 2;
  const clear = (t: number) => busy.every(([from, to]) => t + FOLLOW_SHOW <= from || t >= to) && (t + FOLLOW_SHOW <= half - 0.2 || t >= half + HALF_SHOW);
  const mid = outcome.time * 0.45;
  for (let k = 0; k < 160; k++) {
    const t = mid + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
    if (t >= outcome.time * 0.2 && t + FOLLOW_SHOW <= outcome.time * 0.8 && clear(t)) return t;
  }
  return null;
}

/** The stage: black, lit a little behind the pitch's middle. */
function paintStage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = STAGE;
  ctx.fillRect(0, 0, W, H);
  const light = ctx.createRadialGradient(PITCH.x, CENTRE_Y, 0, PITCH.x, CENTRE_Y, PITCH.r * SCALE * 1.5);
  light.addColorStop(0, STAGE_LIT);
  light.addColorStop(1, rgba(STAGE_LIT, 0));
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);
  return canvas;
}

/**
 * The turf inside the ring, in the simulation's px, painted once: floodlit green, mown in broad
 * stripes, its grass a seeded scatter of blades a shade lighter or darker (seeded, so a frame never
 * differs from the last), in shade toward the ring as under a stand; the halfway line between the
 * two kick-off spots, the centre circle and its spot in soft chalk, so the eye reads a pitch and
 * goes to the balls.
 */
function paintTurf(): HTMLCanvasElement {
  const size = 2 * PITCH.r + 16;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  ctx.beginPath();
  ctx.arc(c, c, PITCH.r, 0, Math.PI * 2);
  ctx.clip();
  const turf = ctx.createRadialGradient(c, c, 0, c, c, PITCH.r);
  turf.addColorStop(0, TURF);
  turf.addColorStop(1, TURF_EDGE);
  ctx.fillStyle = turf;
  ctx.fillRect(0, 0, size, size);
  const band = (2 * PITCH.r) / 12;
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.045)';
    ctx.fillRect(c - PITCH.r + i * band, 0, band, size);
  }
  const rng = createRng('turf');
  for (const color of ['rgba(200, 255, 210, 0.06)', 'rgba(0, 24, 10, 0.14)']) {
    ctx.fillStyle = color;
    for (let i = 0; i < 7000; i++) ctx.fillRect(rng.next() * size, rng.next() * size, 2, 4 + rng.next() * 3);
  }
  const shade = ctx.createRadialGradient(c, c, PITCH.r * 0.55, c, c, PITCH.r);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(c, c - PITCH.r);
  ctx.lineTo(c, c + PITCH.r);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, 118, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.beginPath();
  ctx.arc(c, c, 8, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

let fans: [Fan[], Fan[]] | null = null;

/** The crowd's seats, each side's, worked out once: CROWD_ROWS round the ring, each row a half seat round from the last, a stair between blocks. */
function seats(side: 0 | 1): Fan[] {
  if (fans) return fans[side];
  const rng = createRng('crowd');
  const out: [Fan[], Fan[]] = [[], []];
  CROWD_ROWS.forEach((past, row) => {
    const r = PITCH.r + past;
    const n = Math.floor((2 * Math.PI * r) / CROWD_GAP);
    const seat = CROWD_GAP / ((2 * Math.PI * r) / 16);
    for (let i = 0; i < n; i++) {
      const a = ((i + (row % 2) * 0.5) / n) * 2 * Math.PI;
      // Sixteen blocks, a seat's stair between each; two of the stairs part the halves, top and bottom.
      if (((a / (2 * Math.PI)) * 16 + seat / 2) % 1 < seat) continue;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      const pick = rng.next();
      const prop = rng.next();
      const fan: Fan = {
        x: PITCH.x + nx * r,
        y: PITCH.y + ny * r,
        nx,
        ny,
        tx: -ny,
        ty: nx,
        angle: a + Math.PI / 2,
        side: nx < 0 ? 0 : 1,
        shade: pick < 0.6 ? 0 : pick < 0.85 ? 1 : 2,
        hair: Math.floor(rng.next() * HAIR.length),
        skin: Math.floor(rng.next() * SKIN.length),
        phase: rng.range(0, 2 * Math.PI),
        holds: prop < 0.06 && row < 2 ? 2 : prop < 0.3 ? 1 : 0,
      };
      out[fan.side].push(fan);
    }
  });
  return (fans = out)[side];
}

/** A side's fans' colours: its colour on the stage, its shirt's other colour (lifted where the stage would swallow it), and white. */
function fanColors(s: Side | undefined, color: string): string[] {
  const other = s?.kit.colors.find((c) => c.toLowerCase() !== color.toLowerCase()) ?? WHITE;
  return [color, legible(other, STAGE), WHITE];
}

/**
 * A side's fans as seen from above, at rest or (`amp` over 0) on their feet `age` seconds into it:
 * flags behind them, then shoulders by shirt colour, heads by hair, hands up, scarves held out,
 * and a phone's flash here and there. Batched a colour at a time: a few hundred fans a frame.
 */
function drawFans(ctx: CanvasRenderingContext2D, side: 0 | 1, palette: string[], age: number, amp: number): void {
  const list = seats(side);
  const up = list.map((f) => 8 * amp * Math.abs(Math.sin(age * 9 + f.phase)));
  const at = list.map((f, i) => [f.x + f.nx * up[i], f.y + f.ny * up[i]] as const);
  const on = amp > 0.05;
  if (on) {
    // Flags behind their fans, out toward the back of the stand, two colours split down the pole, waving.
    palette.slice(0, 2).forEach((fill, k) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      list.forEach((f, i) => {
        if (f.holds !== 2) return;
        const [x, y] = at[i];
        const wave = Math.sin(age * 7 + f.phase) * 4 * amp;
        const p = (along: number, out: number) => [x + f.tx * (along + (wave * out) / 20) + f.nx * out, y + f.ty * (along + (wave * out) / 20) + f.ny * out] as const;
        const [a0, a1] = k ? [0, 11] : [-11, 0];
        ctx.moveTo(...p(a0, 6));
        ctx.lineTo(...p(a1, 6));
        ctx.lineTo(...p(a1, 21));
        ctx.lineTo(...p(a0, 21));
        ctx.closePath();
      });
      ctx.fill();
    });
  }
  palette.forEach((fill, shade) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    list.forEach((f, i) => {
      if (f.shade !== shade) return;
      const cx = at[i][0] + f.nx * 1.6;
      const cy = at[i][1] + f.ny * 1.6;
      ctx.moveTo(cx + f.tx * 5.6, cy + f.ty * 5.6);
      ctx.ellipse(cx, cy, 5.6, 4, f.angle, 0, Math.PI * 2);
    });
    ctx.fill();
  });
  HAIR.forEach((fill, h) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    list.forEach((f, i) => {
      if (f.hair !== h) return;
      const x = at[i][0] - f.nx * 1.4;
      const y = at[i][1] - f.ny * 1.4;
      ctx.moveTo(x + 3, y);
      ctx.arc(x, y, 3, 0, Math.PI * 2);
    });
    ctx.fill();
  });
  if (!on) return;
  // Hands up, either side of the head, on the fans high in their jump.
  SKIN.forEach((fill, k) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    list.forEach((f, i) => {
      if (f.skin !== k || f.holds === 2 || up[i] < 2.5) return;
      for (const s of [-1, 1]) {
        const x = at[i][0] - f.nx * 4 + f.tx * 5.4 * s;
        const y = at[i][1] - f.ny * 4 + f.ty * 5.4 * s;
        ctx.moveTo(x + 1.8, y);
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      }
    });
    ctx.fill();
  });
  // Scarves held out over the heads, swinging.
  ctx.fillStyle = palette[1];
  ctx.beginPath();
  list.forEach((f, i) => {
    if (f.holds !== 1) return;
    const swing = Math.sin(age * 8 + f.phase) * 2.5 * amp;
    const x = at[i][0] - f.nx * 6.5 + f.tx * swing;
    const y = at[i][1] - f.ny * 6.5 + f.ty * swing;
    ctx.moveTo(x - f.tx * 7 - f.nx * 1.6, y - f.ty * 7 - f.ny * 1.6);
    ctx.lineTo(x + f.tx * 7 - f.nx * 1.6, y + f.ty * 7 - f.ny * 1.6);
    ctx.lineTo(x + f.tx * 7 + f.nx * 1.6, y + f.ty * 7 + f.ny * 1.6);
    ctx.lineTo(x - f.tx * 7 + f.nx * 1.6, y - f.ty * 7 + f.ny * 1.6);
    ctx.closePath();
  });
  ctx.fill();
  // Phones flashing: a fan here and there lit white for a blink.
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = amp;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  list.forEach((f, i) => {
    if ((age * 1.7 + f.phase * 5) % 1 > 0.035) return;
    const x = at[i][0] - f.nx * 5;
    const y = at[i][1] - f.ny * 5;
    ctx.moveTo(x + 3.5, y);
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  });
  ctx.fill();
  ctx.globalAlpha = alpha;
}

/** One half of the crowd at rest, dim (FAN_IDLE), on a canvas CROWD_R tall each way and from the halfway line out. */
function paintFans(side: 0 | 1, palette: string[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CROWD_R + CROWD_EDGE;
  canvas.height = 2 * CROWD_R;
  const ctx = canvas.getContext('2d')!;
  ctx.translate((side ? CROWD_EDGE : CROWD_R) - PITCH.x, CROWD_R - PITCH.y);
  ctx.globalAlpha = FAN_IDLE;
  drawFans(ctx, side, palette, 0, 0);
  return canvas;
}

/**
 * The stand the crowd sits in, painted once: dark terraces from the wall at the pitch's edge to the
 * back (STAND_IN to STAND_OUT), a line between each row, the sixteen stairs a shade lighter, and
 * the back's edge catching the light, so the crowd sits in a stadium, not on the stage.
 */
function paintStand(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2 * CROWD_R;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(CROWD_R - PITCH.x, CROWD_R - PITCH.y);
  const ring = (r: number) => {
    ctx.beginPath();
    ctx.arc(PITCH.x, PITCH.y, r, 0, Math.PI * 2);
  };
  ctx.lineWidth = STAND_OUT - STAND_IN;
  ctx.strokeStyle = '#0d1019';
  ring(PITCH.r + (STAND_IN + STAND_OUT) / 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#171c28';
  for (const r of [22, 36]) {
    ring(PITCH.r + r);
    ctx.stroke();
  }
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#161b27';
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 2 * Math.PI;
    ctx.moveTo(PITCH.x + Math.cos(a) * (PITCH.r + STAND_IN + 2), PITCH.y + Math.sin(a) * (PITCH.r + STAND_IN + 2));
    ctx.lineTo(PITCH.x + Math.cos(a) * (PITCH.r + STAND_OUT), PITCH.y + Math.sin(a) * (PITCH.r + STAND_OUT));
  }
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ring(PITCH.r + STAND_OUT);
  ctx.stroke();
  return canvas;
}
