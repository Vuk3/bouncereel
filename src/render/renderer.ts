import { SITE_HOST } from '../../shared/site.ts';
import { openingQuestion } from '../audio/opening.ts';
import type { Config, Skin, Special } from '../config.ts';
import { BORDER, BOX, FINISH_H, H, INSET, PILL_H, STACK, VS_Y, W, finishTop, type Panel } from '../layout.ts';
import type { Team } from '../sim/duel.ts';
import { createRng } from '../sim/rng.ts';
import { SEQUENCES, formatBig } from '../sim/sequences.ts';
import type { Body, SimEvent } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import { Effects } from './effects.ts';

// Draws one frame at the full 1080×1920, in one of three looks (`look.skin`):
//
//   paper  cream boxes in ink frames on a paper page, glossy layers, glowing balls
//          with trails, the name above each box and a stats line inside it: the way
//          the format's biggest channels draw it
//   cards  white cards with a hard offset shadow, name pills and chips on a pastel page
//   night  the cards after dark: near-black cards on a dusk page, violet to deep blue
//
// Every look draws the same geometry (layout.ts): walls, floor and finish line are
// physics, so a look may change colour and decoration, never where a ball bounces.
// The page scales the canvas down for preview; the recorder captures it at full size.

export const FONT = 'Rubik, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const INK = '#1b1b2f';
const WHITE = '#ffffff';
const BLACK = '#000000';
const RADIUS = 26;
/** The hard shadow under every card and pill: the cards look's signature. */
const SHADOW = { x: 12, y: 14 };
/** Space under each layer bar in the cards and night looks; the bar's top edge is the floor balls bounce on. */
const LAYER_GAP = 10;
/** Chips are this tall; with INSET above and beside them they sit the same in both cards. */
const CHIP_H = 56;
/** One floating damage number per box per this many seconds; a box full of split balls (~100 hits a second) gets fewer. */
const TEXT_GAP = 0.09;
const CROWDED_TEXT_GAP = 0.3;
/**
 * A box's hits shake the frame at most this often (a crowded box's at most every CROWDED_TEXT_GAP),
 * with the frame's biggest: every kick adds to the shake, and a box of split balls hitting ~100
 * times a second would hold it at its 14 px cap.
 */
const KICK_GAP = 0.12;
/** The ink line on top of every layer in the paper look: the floor a ball lands on. */
const SEAM = 5;
/** Frames of trail behind a ball: about 0.15 s at 60 fps, a comet rather than a snake. */
const TRAIL = 9;
/** More balls than this in a box and the glow, trails and marks would melt into one blur. */
const CROWD = 8;
/**
 * A ball's power, as the tag beside its name says it: the name is the ball's numbers alone, so
 * this is where a viewer sees which ball has one, and what it does.
 */
const POWER_TAGS: Record<Exclude<Special, 'none'>, string> = { faster: 'SPEEDS UP', slower: 'SLOWS DOWN', grow: 'GROWS', split: 'SPLITS' };
/** The power tag: the dice's gold, a power-up's colour in a game, on every look. */
const TAG_H = 50;
const TAG_FILL = '#ffd23f';
/**
 * The power tag on the opening title, alone where the name row stands: 65 px tall, as tall as
 * that row has room for between the platforms' top bar and the card, so it reads on a profile
 * grid's tile, where the race's own 50 px tag is a smudge.
 */
const OPENING_TAG = 1.3;
/** A lightning bolt in a 1 × 1 box, at the start of the power tag. */
const BOLT: [number, number][] = [
  [0.62, 0],
  [0.04, 0.58],
  [0.46, 0.58],
  [0.3, 1],
  [0.96, 0.38],
  [0.54, 0.38],
  [0.76, 0],
];
/** The address a free plan's videos carry (drawWatermark): the site's own host. */
const WATERMARK = SITE_HOST;
/** Seconds a layer's number takes to count down to a hit's new value, fast first: it never jumps. */
const COUNT = 0.15;
/**
 * The meter beside each card (drawMeters): in the margin left of the cards, where no platform
 * puts a button (docs/look-and-layout.md §9), 10 px from the card's frame. Reels on a tall phone
 * fill the screen with the video and crop about 50 px off each side, so the margin's outer half
 * is not seen there.
 */
const METER = { x: 80, w: 14 };
/** Seconds LEAD CHANGE shows (drawLeadChange). */
const LEAD_SHOW = 0.9;
/** Where LEAD CHANGE ends: 20 px before the side buttons' column, which starts at x 940 from y 902 (§9). */
const LEAD_RIGHT = 920;
/**
 * The follow button in the race (drawRaceFollow): seconds it shows, and when in that it is tapped,
 * turning from FOLLOW to FOLLOWING. Long enough to read both words, short enough to leave the race
 * to itself again; it shows where LEAD CHANGE does, so followAt keeps the two apart.
 */
const FOLLOW_SHOW = 2.4;
const FOLLOW_RACE_TAP = 0.9;
/**
 * The follow button under the winner card (drawEndFollow): seconds after the card comes up that it
 * pops in (the card has finished its own pop by then) and that a finger taps it. pacing.ts
 * (FOLLOW_CARD) keeps the card up long enough to see FOLLOWING after the tap.
 */
const FOLLOW_IN = 0.6;
const FOLLOW_TAP = 1.5;
/** The plus (or tick) before the button's word, and the space after it, in parts of the type's size. */
const FOLLOW_ICON = 0.62;
const FOLLOW_GAP = 0.36;
/** The button's centre under the winner card: clear of the tallest card's shadow (y 1239), and the hand under it clear of the platforms' bottom bar (y 1520). */
const FOLLOW_Y = 1330;
/** The button in the race, in the red of Follow and Subscribe on TikTok and YouTube: it belongs to neither team, and reads as a follow button before its word does. */
const FOLLOW_RED = '#fe2c55';
/** The last layer's pulse (finalGlow), a beat a little faster than a resting heart's double time. */
const PULSE_HZ = 2.4;

/** The paper look's colours. */
interface Flat {
  /** The page behind the boxes, top to bottom. */
  page: [string, string];
  box: string;
  /** The boxes' frames, and the winner card's. */
  frame: string;
  frameWidth: number;
  /** Seams between layers, ball edges, the outline of numbers. */
  ink: string;
  text: string;
  vs: string;
  checker: [string, string];
  card: string;
  /** What the race fades toward under the winner card. */
  wash: string;
  /** Outline of the floating damage numbers. */
  float: string;
}

const PAPER: Flat = {
  page: ['#ece0c7', '#e2d3b3'],
  box: '#fbf8f0',
  frame: INK,
  frameWidth: 6,
  ink: INK,
  text: INK,
  vs: INK,
  checker: [INK, '#fbf8f0'],
  card: '#fffdf8',
  wash: 'rgba(232, 219, 190, 0.8)',
  float: WHITE,
};

/** The cards look by day (`cards`) and after dark (`night`): one drawing, two palettes. */
interface Deck {
  /** The page behind the cards, top, middle and bottom, and its dot grid. */
  page: [string, string, string];
  dots: string;
  /** Inside a card and the winner card; the chips, and the outline of floating numbers. */
  box: string;
  /** Card frames and hard shadows, the outlines of layers, balls and pills, the finish's dark squares, the VS. */
  ink: string;
  /** The finish's light squares. */
  flag: string;
  /** The winner card's lines, and the labels on chips and under the winner's name. */
  text: string;
  muted: string;
  /** What the race fades toward under the winner card. */
  wash: string;
  /**
   * A dark card: team colours written on it are lightened until they read (`legible`), as
   * navy or deep violet on near-black would not. On white the cards look writes them as they are.
   */
  dark: boolean;
}

/**
 * The opening title's colours (drawOpening): the wash over the cards, what the names are written
 * on (for `legible`; null writes them as they are) and their outline, and the VS and the question
 * with theirs. Paper and cards write the colours as they are under an ink outline, which holds a
 * name up on a profile grid's tile; night lightens them on the dark, where ink would not show.
 * The wash only quiets the race under the words: heavier, and the frame people decide on reads
 * as a faded page rather than the game.
 */
const OPENINGS: Record<Skin, { wash: string; ground: string | null; nameOutline: string; text: string; textOutline: string }> = {
  paper: { wash: 'rgba(236, 224, 199, 0.45)', ground: null, nameOutline: INK, text: INK, textOutline: '#fffdf8' },
  cards: { wash: 'rgba(255, 255, 255, 0.4)', ground: null, nameOutline: INK, text: INK, textOutline: WHITE },
  night: { wash: 'rgba(9, 11, 30, 0.4)', ground: '#0b0d1c', nameOutline: '#0b0d1c', text: WHITE, textOutline: '#0b0d1c' },
};

const DECKS: Record<Exclude<Skin, 'paper'>, Deck> = {
  cards: {
    page: ['#fff3e0', '#fbeff6', '#e3ebff'],
    dots: 'rgba(27, 27, 47, 0.07)',
    box: WHITE,
    ink: INK,
    flag: WHITE,
    text: INK,
    muted: 'rgba(27, 27, 47, 0.6)',
    wash: 'rgba(27, 27, 47, 0.45)',
    dark: false,
  },
  night: {
    // The pastel's warm-to-cool after dark, dusk violet to deep blue. The page stays lighter
    // than the cards, as the pastel is lighter than ink: on a page as dark as the cards, their
    // black frames and hard shadows, the look's signature, would vanish.
    page: ['#2c2654', '#232552', '#18284d'],
    dots: 'rgba(255, 255, 255, 0.07)',
    box: '#171a2e',
    ink: '#06070f',
    flag: '#e8eaf3',
    text: '#f3f4fa',
    muted: 'rgba(232, 235, 250, 0.62)',
    // Toward the page's own dusk, not black: the dark winner card stands out against it, as the white one does on the cards look.
    wash: 'rgba(35, 37, 82, 0.72)',
    dark: true,
  },
};

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
  /** 0..1 of the opening title over the cards (drawOpening; pacing.ts `openingShown`). */
  opening?: number;
  /** The lead changes to mark, from the prediction (Outcome.leads): each shows LEAD CHANGE as the race reaches it. */
  leads?: { at: number; team: number }[];
  /** Seconds between the winner and the loser touching the line: "Won by 0.3 s" on the winner card. */
  margin?: number;
  /**
   * The follow button (`look.follow`), under the winner card and, `at` seconds into the race
   * (followAt), right of the VS; null `at` for no room in the race.
   */
  follow?: { at: number | null };
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  effects = new Effects('');
  private pages = new Map<Skin, HTMLCanvasElement>();
  /** Per team: how bright the top layer flashes after a hit. */
  private flash = [0, 0];
  private lastText = [-1, -1];
  private lastKick = [-1, -1];
  private clock = 0;
  private timedOut = false;
  /** Recent positions of every ball, oldest first, flattened x, y: the trails. */
  private trails = new WeakMap<Body, number[]>();
  /** Per team, the last speed seen while it moved: a finished team stands still, and its stats should not say 0. */
  private speeds = [0, 0];
  /** The winner's total damage, worked out once the card is up. */
  private total: bigint | null = null;
  /** Per team, the top layer's number as it counts down (COUNT): from, to, and how far along, 0..1. */
  private counts = [0, 1].map(() => ({ layer: -1, from: 0n, to: 0n, k: 1 }));
  /** The next of `Overlay.leads` to reach, the team that took the lead at the last one reached, and the seconds since. */
  private lead = 0;
  private leader = -1;
  private leadAge = Infinity;
  /**
   * 0..1 of the race's labels (each name row, the chips or stats line): none under the opening
   * title, which says the names itself, coming in over the second half of its fade, once the
   * title's own power tag, standing where the row does, has gone (drawOpening).
   */
  private labels = 1;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  reset(cfg: Config): void {
    this.effects = new Effects(cfg.seed);
    this.flash = [0, 0];
    this.lastText = [-1, -1];
    this.lastKick = [-1, -1];
    this.clock = 0;
    this.timedOut = false;
    this.trails = new WeakMap();
    this.speeds = [0, 0];
    this.total = null;
    this.counts = [0, 1].map(() => ({ layer: -1, from: 0n, to: 0n, k: 1 }));
    this.lead = 0;
    this.leader = -1;
    this.leadAge = Infinity;
  }

  handle(events: SimEvent[], world: World, cfg: Config): void {
    const kicks = [0, 0];
    for (const e of events) {
      const team = world.teams[e.team];
      if (e.type === 'hit') {
        // A hit lands by its size: the log of its damage, 0 for a 1 and 1 from 10^15 up. On the
        // last layer, also by how far through it the team now is, so a race's end hits hardest.
        const size = Math.min(1, Math.log10(Number(e.damage) + 1) / 15);
        const near = e.layer === team.layers.length - 1 ? lastWorn(team) : 0;
        this.flash[e.team] = Math.max(this.flash[e.team], 0.3 + 0.7 * size, near > 0 ? 0.35 + 0.65 * near : 0);
        // Up to 3.3 px for a big hit and 5 at the end of the last layer: a broken layer's own kick.
        kicks[e.team] = Math.max(kicks[e.team], 0.3 + 3 * size, near > 0 ? 1 + 4 * near : 0);
        if (this.clock - this.lastText[e.team] >= (team.bodies.length > 3 ? CROWDED_TEXT_GAP : TEXT_GAP)) {
          this.lastText[e.team] = this.clock;
          this.floatDamage(e, team, cfg);
        }
        if (e.broken) {
          const h = STACK / team.layers.length;
          this.effects.debris(BOX.left + INSET, team.panel.floor + e.layer * h, BOX.right - BOX.left - 2 * INSET, h - LAYER_GAP, team.color);
          this.effects.kick(5);
        }
      } else if (e.type === 'finish' && e.place === 1) {
        this.effects.kick(8);
      } else if (e.type === 'timeout') {
        this.timedOut = true;
      }
    }
    for (const t of world.teams) {
      if (!kicks[t.id] || this.clock - this.lastKick[t.id] < (t.bodies.length > 3 ? CROWDED_TEXT_GAP : KICK_GAP)) continue;
      this.lastKick[t.id] = this.clock;
      this.effects.kick(kicks[t.id]);
    }
  }

  /**
   * A hit's damage floating up from it, sized by its digits: 27 px for a 1, 32 px at three digits,
   * 64 px from fifteen up; a big one starts a little higher, and all of it stays inside the box.
   */
  private floatDamage(e: Extract<SimEvent, { type: 'hit' }>, team: Team, cfg: Config): void {
    const text = `-${formatBig(e.damage, cfg.look.separator)}`;
    let size = Math.min(64, 24 + 2.8 * e.damage.toString().length);
    this.ctx.font = `800 ${size}px ${FONT}`;
    let width = this.ctx.measureText(text).width;
    const room = BOX.right - BOX.left - 80;
    if (width > room) {
      size *= room / width;
      width = room;
    }
    const x = Math.max(BOX.left + 40 + width / 2, Math.min(BOX.right - 40 - width / 2, e.x));
    const skin = cfg.look.skin;
    const color = skin === 'paper' ? team.color : this.written(team.color, DECKS[skin]);
    this.effects.float(x, e.y - 46 - (size - 32) / 2, text, color, size, width);
  }

  /** The winner card's confetti, in the winner's colour. */
  celebrate(world: World): void {
    const winner = world.teams.find((t) => t.id === world.winner);
    const c = winner?.color ?? INK;
    this.effects.confetti([c, WHITE, c, '#ffd23f', INK], 240, W);
  }

  draw(world: World, cfg: Config, dt: number, overlay: Overlay): void {
    const ctx = this.ctx;
    const skin = cfg.look.skin;
    this.clock += dt;
    this.effects.update(dt);
    this.flash = this.flash.map((f) => f * Math.exp(-dt * 9));
    if (dt > 0) this.track(world);
    for (const t of world.teams) this.count(t, dt);
    // A lead change the prediction marked, on the frame the race reaches it.
    const leads = overlay.leads ?? [];
    while (this.lead < leads.length && leads[this.lead].at <= world.time) {
      this.leader = leads[this.lead++].team;
      this.leadAge = 0;
    }
    this.leadAge += dt;
    this.labels = Math.max(0, 1 - 2 * (overlay.opening ?? 0));

    ctx.globalAlpha = 1;
    ctx.drawImage(this.page(skin), 0, 0);
    const [sx, sy] = this.effects.offset();
    ctx.save();
    ctx.translate(sx, sy);
    if (skin === 'paper') {
      for (const team of world.teams) this.drawSheet(team, cfg, PAPER);
      this.drawPlainVs(PAPER);
    } else {
      const deck = DECKS[skin];
      for (const team of world.teams) this.drawCard(world, team, cfg, deck);
      this.drawVs(deck);
    }
    this.drawMeters(world, skin);
    this.effects.drawPieces(ctx, false);
    this.effects.drawTexts(ctx, FONT, skin === 'paper' ? PAPER.float : DECKS[skin].box);
    this.drawLeadChange(world, skin);
    if (overlay.follow && overlay.follow.at !== null) this.drawRaceFollow(world.time - overlay.follow.at, skin);
    ctx.restore();

    if (overlay.opening) this.drawOpening(world, cfg, overlay.opening, sx, sy);
    if (overlay.winner > 0) {
      if (skin === 'paper') this.drawSheetWinner(world, cfg, overlay, PAPER);
      else this.drawWinner(world, cfg, overlay, DECKS[skin]);
      if (overlay.follow) this.drawEndFollow(world, overlay, skin);
    }
    this.effects.drawPieces(ctx, true);
    if (overlay.loop && overlay.start) {
      ctx.globalAlpha = Math.min(1, overlay.loop);
      ctx.drawImage(overlay.start, 0, 0);
      ctx.globalAlpha = 1;
    }
    // Over everything, the loop's fade too: the mark holds still while the frame changes under it.
    if (overlay.watermark) this.drawWatermark(skin);
  }

  /**
   * The free plan's mark: the BounceReel ball and the site's host in the gap between the two cards,
   * left of the VS, the host's font narrowed (from 32 px) to fit between the frame's edge and the VS. That gap is in every frame of every look, under no platform's buttons
   * (docs/look-and-layout.md §9), and nothing of the race is drawn there.
   */
  private drawWatermark(skin: Skin): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = skin === 'night' ? 0.78 : 0.68;
    ctx.letterSpacing = '0.5px';
    const right = W / 2 - 64;
    // 40 px from the frame's edge, after the 42 px mark and its 10 px gap.
    fitFont(ctx, WATERMARK, right - 40 - 52, 32, 800);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = skin === 'night' ? WHITE : INK;
    ctx.fillText(WATERMARK, right, VS_Y + 2);
    const width = ctx.measureText(WATERMARK).width;
    drawMark(ctx, right - width - 52, VS_Y - 21, 42);
    ctx.restore();
  }

  // ── The opening, the lead, the last layer ────────────────────────────────

  /**
   * The video's first second (pacing.ts `openingShown`): over the cards at rest, a light wash, the
   * balls over it at full strength, each ball's name large in its colour in the empty part of its
   * own box, a ball's power as a big tag where its name row stands (the row itself waits, see
   * `labels`), a big VS between the cards, and the opening's question under the bottom name
   * (src/audio/opening.ts). It is the frame a viewer swipes past or stays for, every platform's
   * cover, and the one a looping video fades back into. The words keep between the platforms' top
   * bar and their caption and inside the side buttons' column (§9); the watermark, drawn after,
   * stays over it. `sx`, `sy` are the frame's shake, which the balls under it move by.
   */
  private drawOpening(world: World, cfg: Config, shown: number, sx: number, sy: number): void {
    const ctx = this.ctx;
    const skin = cfg.look.skin;
    const look = OPENINGS[skin];
    const [top, bottom] = world.teams;
    ctx.save();
    ctx.globalAlpha = shown;
    ctx.fillStyle = look.wash;
    ctx.fillRect(0, 0, W, H);
    for (const t of world.teams) {
      ctx.save();
      ctx.translate(sx, sy);
      roundRect(ctx, BOX.left, t.panel.top, BOX.right - BOX.left, finishTop(t.panel) + FINISH_H - t.panel.top, 6);
      ctx.clip();
      if (skin === 'paper') this.drawGlowingBalls(t, PAPER);
      else this.drawBalls(t, DECKS[skin]);
      ctx.restore();
      const tag = this.powerTag(t);
      if (!tag || shown <= 0.5) continue;
      // Gone over the first half of the fade, before the name row comes in where it stands (`labels`).
      ctx.save();
      ctx.globalAlpha = 2 * shown - 1;
      ctx.translate(W / 2, t.panel.title);
      ctx.scale(OPENING_TAG, OPENING_TAG);
      this.drawTag(tag, -this.tagWidth(tag) / 2, 0, skin === 'paper' ? PAPER.ink : DECKS[skin].ink, skin !== 'paper');
      ctx.restore();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // The top name in the middle of its box's empty part, the bottom one high in its, the question under it.
    const names = [(top.panel.top + top.panel.floor) / 2, bottom.panel.top + (bottom.panel.floor - bottom.panel.top) * 0.24];
    for (const t of world.teams) {
      const name = t.name.toUpperCase();
      fitFont(ctx, name, 800, 124, 900);
      outlined(ctx, name, W / 2, names[t.id], look.ground ? legible(t.color, look.ground) : t.color, look.nameOutline, 16);
    }
    fitFont(ctx, 'VS', 120, 140, 900);
    outlined(ctx, 'VS', W / 2, VS_Y + 6, look.text, look.textOutline, 14);
    // Two lines at most, smaller if it takes that, centred between the bottom name and the layers.
    const question = openingQuestion(cfg);
    let size = 60;
    ctx.font = `800 ${size}px ${FONT}`;
    let lines = wrapLines(ctx, question, 760);
    while (lines.length > 2 && size > 44) {
      size -= 8;
      ctx.font = `800 ${size}px ${FONT}`;
      lines = wrapLines(ctx, question, 760);
    }
    const centre = (names[1] + 45 + bottom.panel.floor) / 2;
    const step = size * 1.2;
    lines.forEach((line, i) => outlined(ctx, line, W / 2, centre + (i - (lines.length - 1) / 2) * step, look.text, look.textOutline, 12));
    ctx.restore();
  }

  /** Moves each team's top-layer number on toward its hit points: a hit starts a new count from wherever the last one is. */
  private count(t: Team, dt: number): void {
    const c = this.counts[t.id];
    const layer = t.layers[t.broken];
    if (!layer) return;
    if (c.layer !== t.broken) Object.assign(c, { layer: t.broken, from: layer.hp, to: layer.hp, k: 1 });
    else if (layer.hp !== c.to) Object.assign(c, { from: counted(c), to: layer.hp, k: 0 });
    c.k = Math.min(1, c.k + dt / COUNT);
  }

  /** A layer's hit points as drawn: the top one's counting down (count), every other's as it is. */
  private shownHp(t: Team, k: number): bigint {
    const c = this.counts[t.id];
    return k === t.broken && c.layer === k ? counted(c) : t.layers[k].hp;
  }

  /** 0..1, how strongly LEAD CHANGE and its ring show: whole most of LEAD_SHOW, fading out at its end. */
  private leadLit(): number {
    return Math.min(1, Math.max(0, (1 - this.leadAge / LEAD_SHOW) / 0.35));
  }

  /**
   * How far each ball has come (`world.progress`, what decides who leads) as a slim meter left of
   * its card, filled from the bottom; the leader's glows while LEAD CHANGE shows.
   */
  private drawMeters(world: World, skin: Skin): void {
    const ctx = this.ctx;
    const lit = this.leadLit();
    for (const t of world.teams) {
      const top = t.panel.top;
      const bottom = finishTop(t.panel) + FINISH_H;
      ctx.fillStyle = skin === 'night' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(27, 27, 47, 0.13)';
      roundRect(ctx, METER.x, top, METER.w, bottom - top, METER.w / 2);
      ctx.fill();
      const fill = (bottom - top) * world.progress(t);
      if (fill <= 0) continue;
      if (t.id === this.leader && lit > 0) {
        // The glow as two wider, fainter bars behind it: a canvas shadow blur costs far more, and
        // the hero draws this on phones. At most 10 px wider, the gap to the card's frame.
        for (const [grow, alpha] of [
          [10, 0.18],
          [5, 0.32],
        ]) {
          ctx.fillStyle = rgba(t.color, alpha * lit);
          roundRect(ctx, METER.x - grow, bottom - fill - grow, METER.w + 2 * grow, fill + 2 * grow, METER.w / 2 + grow);
          ctx.fill();
        }
      }
      ctx.fillStyle = t.color;
      roundRect(ctx, METER.x, bottom - fill, METER.w, fill, METER.w / 2);
      ctx.fill();
    }
  }

  /**
   * The moment the lead changes hands for good (Outcome.leads): a ring round the new leader's
   * name, and LEAD CHANGE in its colour right of the VS, popping in and fading out over
   * LEAD_SHOW. Right of the VS, since its left is the watermark's, and ending before the side
   * buttons' column; in the look's own pill, the cards' with their hard shadow.
   */
  private drawLeadChange(world: World, skin: Skin): void {
    const lit = this.leadLit();
    if (lit <= 0 || this.leader < 0) return;
    const ctx = this.ctx;
    const team = world.teams[this.leader];
    const ink = skin === 'paper' ? PAPER.ink : DECKS[skin].ink;
    ctx.save();
    ctx.globalAlpha = lit;
    ctx.lineWidth = 6;
    ctx.strokeStyle = team.color;
    roundRect(ctx, BOX.left - 12, team.panel.title - PILL_H / 2 - 10, BOX.right - BOX.left + 24, PILL_H + 20, PILL_H / 2 + 10);
    ctx.stroke();
    const text = 'LEAD CHANGE';
    ctx.font = `900 34px ${FONT}`;
    ctx.letterSpacing = '1px';
    const w = ctx.measureText(text).width + 40;
    const h = 58;
    // The pop overshoots by a tenth: the pill's widest stays left of the buttons.
    const pop = easeOutBack(Math.min(1, this.leadAge / 0.25));
    ctx.translate(LEAD_RIGHT - w / 2, VS_Y);
    ctx.scale(pop, pop);
    if (skin !== 'paper') {
      ctx.fillStyle = ink;
      roundRect(ctx, -w / 2 + 5, -h / 2 + 6, w, h, h / 2);
      ctx.fill();
    }
    ctx.fillStyle = team.color;
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.fillStyle = readableOn(team.color);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 2);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  /**
   * 0..1, how brightly a team's last layer glows: faint as it gets there and strong as it nears
   * breaking through (lastWorn), on a pulse. The last layer is by far the biggest (the classic's
   * are 1,000, 10^10 and 10^15), so a team can sit on it for half the race; most of the glow
   * comes in its last few hits.
   */
  private finalGlow(t: Team): number {
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2 * PULSE_HZ);
    return (0.25 + 0.75 * lastWorn(t)) * (0.6 + 0.4 * pulse);
  }

  // ── The follow button ────────────────────────────────────────────────────

  /**
   * The follow button in the race, `age` seconds after it pops in: right of the VS where LEAD CHANGE
   * shows, ending where it does, before the side buttons' column. It is tapped (FOLLOW_RACE_TAP),
   * turns to FOLLOWING and fades out. No hand here: the gap between the cards has no room for one.
   */
  private drawRaceFollow(age: number, skin: Skin): void {
    if (age < 0 || age > FOLLOW_SHOW) return;
    const ctx = this.ctx;
    const size = 34;
    // The pop overshoots by a tenth, as LEAD CHANGE's does: the widest stays left of the buttons.
    const pop = easeOutBack(Math.min(1, age / 0.25));
    ctx.save();
    const w = this.followWidth(size);
    ctx.globalAlpha = Math.min(1, (FOLLOW_SHOW - age) / 0.35);
    ctx.translate(LEAD_RIGHT - w / 2, VS_Y);
    ctx.scale(pop, pop);
    this.drawFollowButton(size, FOLLOW_RED, age >= FOLLOW_RACE_TAP, pressed(age - FOLLOW_RACE_TAP), skin);
    this.drawTapRing(this.followPlusX(size), 0, age - FOLLOW_RACE_TAP, size, skin);
    ctx.restore();
  }

  /**
   * The follow button under the winner card, in the winner's colour: it pops in after the card, a
   * finger (👆) comes up and taps it, and it turns to FOLLOWING and stays, as a platform's own does.
   */
  private drawEndFollow(world: World, overlay: Overlay, skin: Skin): void {
    const winner = world.teams.find((t) => t.id === world.winner);
    const age = overlay.age - FOLLOW_IN;
    if (!winner || age < 0) return;
    const ctx = this.ctx;
    const size = 46;
    const sinceTap = overlay.age - FOLLOW_TAP;
    ctx.save();
    // The finger lands on the plus, a little low, so the hand under it hides little of the word.
    const tapX = this.followPlusX(size);
    const tapY = size * 0.3;
    ctx.globalAlpha = overlay.winner;
    ctx.translate(W / 2, FOLLOW_Y);
    ctx.save();
    const pop = easeOutBack(Math.min(1, age / 0.3));
    ctx.scale(pop, pop);
    this.drawFollowButton(size, winner.color, sinceTap >= 0, pressed(sinceTap), skin);
    ctx.restore();
    this.drawTapRing(tapX, tapY, sinceTap, size, skin);
    // The hand comes up from below right over half a second, rests on the tap, and goes back down.
    if (sinceTap > -0.5 && sinceTap < 0.75) {
      const come = 1 - (1 - Math.min(1, (sinceTap + 0.5) / 0.42)) ** 3;
      const go = Math.max(0, (sinceTap - 0.35) / 0.4);
      ctx.globalAlpha = overlay.winner * Math.min(1, come * 2) * (1 - go);
      ctx.font = `${size * 2}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('👆', tapX + (1 - come + go) * 70, tapY - size * 0.25 + (1 - come) * 140 + go * 120);
    }
    ctx.restore();
  }

  /** Where the plus sits on the button, from its middle: where a finger taps it. Leaves the button's font set. */
  private followPlusX(size: number): number {
    this.followWidth(size);
    return -(size * (FOLLOW_ICON + FOLLOW_GAP) + this.ctx.measureText('FOLLOW').width) / 2 + (size * FOLLOW_ICON) / 2;
  }

  /** The button's width at `size` px: as wide as FOLLOWING, so the tap does not move it. Leaves its font set. */
  private followWidth(size: number): number {
    const ctx = this.ctx;
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.letterSpacing = '1px';
    return ctx.measureText('FOLLOWING').width + size * 2;
  }

  /**
   * The follow button centred on the origin, `size` px type: a plus and FOLLOW on `color`, or once
   * `tapped`, a tick and FOLLOWING on the look's own card, as the platforms' buttons turn once
   * followed; `press` 0..1 squeezes it under the finger. In the look's pill, as LEAD CHANGE: the
   * cards' with their hard shadow.
   */
  private drawFollowButton(size: number, color: string, tapped: boolean, press: number, skin: Skin): void {
    const ctx = this.ctx;
    const ink = skin === 'paper' ? PAPER.ink : DECKS[skin].ink;
    const fill = tapped ? (skin === 'paper' ? PAPER.card : DECKS[skin].box) : color;
    const text = tapped ? (skin === 'paper' ? PAPER.text : DECKS[skin].text) : readableOn(color);
    const w = this.followWidth(size);
    const h = size * 1.7;
    ctx.save();
    ctx.scale(1 - 0.08 * press, 1 - 0.08 * press);
    if (skin !== 'paper') {
      ctx.fillStyle = ink;
      roundRect(ctx, -w / 2 + h * 0.09, -h / 2 + h * 0.1, w, h, h / 2);
      ctx.fill();
    }
    ctx.fillStyle = fill;
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = ink;
    ctx.stroke();

    const word = tapped ? 'FOLLOWING' : 'FOLLOW';
    const icon = size * FOLLOW_ICON;
    const gap = size * FOLLOW_GAP;
    const left = -(icon + gap + ctx.measureText(word).width) / 2;
    // The plus and the tick are drawn, not typed: Rubik has neither, and a fallback font's would not match the word.
    ctx.strokeStyle = text;
    ctx.lineWidth = size * 0.15;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (tapped) {
      ctx.moveTo(left + icon * 0.04, size * 0.04);
      ctx.lineTo(left + icon * 0.38, size * 0.3);
      ctx.lineTo(left + icon, -size * 0.28);
    } else {
      ctx.moveTo(left, 0);
      ctx.lineTo(left + icon, 0);
      ctx.moveTo(left + icon / 2, -icon / 2);
      ctx.lineTo(left + icon / 2, icon / 2);
    }
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, left + icon + gap, size * 0.06);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  /** A tap's ring, spreading from (x, y) and fading over 0.4 s, `age` seconds after the tap: ink, or white on night's dark card. */
  private drawTapRing(x: number, y: number, age: number, size: number, skin: Skin): void {
    if (age < 0 || age > 0.4) return;
    const ctx = this.ctx;
    const k = age / 0.4;
    ctx.save();
    ctx.globalAlpha *= 1 - k;
    ctx.strokeStyle = skin === 'night' ? WHITE : INK;
    ctx.lineWidth = 2 + size * 0.12 * (1 - k);
    ctx.beginPath();
    ctx.arc(x, y, size * (0.3 + 0.9 * k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ── The power tag ────────────────────────────────────────────────────────

  /** The tag beside a ball's name when it has a power, or null. */
  private powerTag(t: Team): string | null {
    const { special, amount } = t.rule;
    return special !== 'none' && amount ? POWER_TAGS[special] : null;
  }

  /** The power tag's width; leaves its font set for drawing it. */
  private tagWidth(text: string): number {
    const ctx = this.ctx;
    ctx.font = `900 27px ${FONT}`;
    ctx.letterSpacing = '1.5px';
    return 18 + TAG_H * 0.31 + 8 + ctx.measureText(text).width + 18;
  }

  /** The bolt and "SPLITS" in a gold pill from `x`, centred on `cy`; with the cards' hard shadow when `shadow`. */
  private drawTag(text: string, x: number, cy: number, ink: string, shadow: boolean): void {
    const ctx = this.ctx;
    const w = this.tagWidth(text);
    const y = cy - TAG_H / 2;
    if (shadow) {
      ctx.fillStyle = ink;
      roundRect(ctx, x + 5, y + 6, w, TAG_H, TAG_H / 2);
      ctx.fill();
    }
    ctx.fillStyle = TAG_FILL;
    roundRect(ctx, x, y, w, TAG_H, TAG_H / 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = ink;
    ctx.stroke();
    const bh = TAG_H * 0.5;
    const bw = bh * 0.62;
    const bx = x + 18;
    ctx.beginPath();
    for (const [i, [fx, fy]] of BOLT.entries()) {
      const px = bx + fx * bw;
      const py = cy - bh / 2 + fy * bh;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = ink;
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + bw + 8, cy + 1);
    ctx.letterSpacing = '0px';
  }

  private page(skin: Skin): HTMLCanvasElement {
    let page = this.pages.get(skin);
    if (!page) this.pages.set(skin, (page = skin === 'paper' ? paintFlatPage(PAPER) : paintCardsPage(DECKS[skin])));
    return page;
  }

  private track(world: World): void {
    for (const t of world.teams) {
      for (const b of t.bodies) {
        let points = this.trails.get(b);
        if (!points) this.trails.set(b, (points = []));
        points.push(b.x, b.y);
        if (points.length > TRAIL * 2) points.splice(0, 2);
      }
    }
  }

  // ── Paper ────────────────────────────────────────────────────────────────

  /** A box in its frame: the box, the layers, the finish strip, the balls; the stats line inside, the name above. */
  private drawSheet(t: Team, cfg: Config, look: Flat): void {
    const ctx = this.ctx;
    const p = t.panel;
    const left = BOX.left;
    const width = BOX.right - BOX.left;
    const height = finishTop(p) + FINISH_H - p.top;
    const fw = look.frameWidth;
    ctx.fillStyle = look.frame;
    roundRect(ctx, left - fw, p.top - fw, width + 2 * fw, height + 2 * fw, 6 + fw);
    ctx.fill();
    ctx.save();
    roundRect(ctx, left, p.top, width, height, 6);
    ctx.clip();
    ctx.fillStyle = look.box;
    ctx.fillRect(left, p.top, width, height);
    this.drawSheetLayers(t, cfg, look);
    this.drawSheetFinish(p, look);
    this.drawGlowingBalls(t, look);
    ctx.restore();
    if (this.labels > 0) {
      ctx.save();
      ctx.globalAlpha = this.labels;
      this.drawStats(t, cfg, look);
      this.drawName(t, look);
      ctx.restore();
    }
  }

  /** Full-width glossy layers under ink seams; what a layer has lost shows as a pale track on its right. */
  private drawSheetLayers(t: Team, cfg: Config, look: Flat): void {
    const ctx = this.ctx;
    const n = t.layers.length;
    if (!n) return;
    const h = STACK / n;
    const x = BOX.left;
    const width = BOX.right - BOX.left;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = t.broken; k < n; k++) {
      const layer = t.layers[k];
      const y = t.panel.floor + k * h;
      const hp = this.shownHp(t, k);
      const health = Number((hp * 1000n) / layer.max) / 1000;
      if (k === n - 1 && k === t.broken) {
        // The last layer glows up into the box above its seam (finalGlow).
        const glow = ctx.createLinearGradient(0, y - 56, 0, y);
        glow.addColorStop(0, rgba(t.color, 0));
        glow.addColorStop(1, rgba(t.color, 0.6 * this.finalGlow(t)));
        ctx.fillStyle = glow;
        ctx.fillRect(x, y - 56, width, 56);
      }
      ctx.fillStyle = mix(t.color, look.box, 0.62);
      ctx.fillRect(x, y, width, h);
      if (health > 0) {
        const left = Math.max(8, width * health);
        const gloss = ctx.createLinearGradient(0, y + SEAM, 0, y + h);
        gloss.addColorStop(0, mix(t.color, WHITE, 0.4));
        gloss.addColorStop(0.45, t.color);
        gloss.addColorStop(1, mix(t.color, BLACK, 0.3));
        ctx.fillStyle = gloss;
        ctx.fillRect(x, y, left, h);
        // The shine along the top that makes a flat bar read as a rounded one.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(x, y + SEAM + 4, left, Math.max(3, h * 0.1));
      }
      if (k === t.broken && this.flash[t.id] > 0.02) {
        ctx.globalAlpha = this.flash[t.id] * 0.5;
        ctx.fillStyle = WHITE;
        ctx.fillRect(x, y, width, h);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = look.ink;
      ctx.fillRect(x, y, width, SEAM);
      const label = formatBig(hp, cfg.look.separator);
      fitFont(ctx, label, width - 60, Math.min(46, (h - SEAM) * 0.58), 800);
      outlined(ctx, label, W / 2, y + SEAM / 2 + h / 2 + 1, WHITE, look.ink, 7);
    }
  }

  /**
   * Two rows of squares under an ink seam, the seam itself being where a race ends. One
   * row between the seam and the frame read as a film strip; two read as a flag.
   */
  private drawSheetFinish(p: Panel, look: Flat): void {
    const ctx = this.ctx;
    const top = finishTop(p) + SEAM;
    const width = BOX.right - BOX.left;
    const row = (FINISH_H - SEAM) / 2;
    // A whole number of squares spans the box, so no half square sits at the edge.
    const columns = Math.round(width / row);
    const square = width / columns;
    ctx.fillStyle = look.checker[1];
    ctx.fillRect(BOX.left, top, width, FINISH_H - SEAM);
    ctx.fillStyle = look.checker[0];
    for (let r = 0; r < 2; r++) {
      for (let c = r % 2; c < columns; c += 2) ctx.fillRect(BOX.left + c * square, top + r * row, square, row);
    }
    ctx.fillStyle = look.ink;
    ctx.fillRect(BOX.left, top - SEAM, width, SEAM);
  }

  private drawGlowingBalls(t: Team, look: Flat): void {
    const ctx = this.ctx;
    const crowded = t.bodies.length > CROWD;
    const strength = crowded ? 0.35 : 1;
    // The glow reaches further as the damage grows: a ball that hits for quadrillions should look it.
    const digits = Math.min(19, t.damage.toString().length);
    const reach = 1.5 + (1.7 * digits) / 19;
    for (const b of t.bodies) this.drawTrail(b, t.color, strength);
    for (const b of t.bodies) {
      const r = b.r * reach;
      const glow = ctx.createRadialGradient(b.x, b.y, b.r * 0.6, b.x, b.y, r);
      glow.addColorStop(0, rgba(t.color, Math.min(0.62, 0.32 * strength)));
      glow.addColorStop(1, rgba(t.color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const mark = crowded ? '' : SEQUENCES[t.rule.sequence].mark;
    for (const b of t.bodies) {
      const sphere = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
      sphere.addColorStop(0, mix(t.color, WHITE, 0.55));
      sphere.addColorStop(0.45, t.color);
      sphere.addColorStop(1, mix(t.color, BLACK, 0.38));
      ctx.fillStyle = sphere;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2.5, b.r * 0.11);
      ctx.strokeStyle = look.ink;
      ctx.stroke();
      // What the ball hits with, as the format's balls wear "x2": too small to read under 18 px.
      if (mark && b.r >= 18) {
        ctx.font = `800 ${Math.round(b.r * (mark.length > 1 ? 0.74 : 0.92))}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        outlined(ctx, mark, b.x, b.y + b.r * 0.06, WHITE, look.ink, Math.max(3, b.r * 0.16));
      }
    }
  }

  /** A comet tail: a ribbon along the ball's last positions, narrowing and fading toward the oldest. */
  private drawTrail(b: Body, color: string, strength: number): void {
    const points = this.trails.get(b);
    if (!points || points.length < 6) return;
    const n = points.length / 2;
    const tailX = points[0];
    const tailY = points[1];
    const headX = points[2 * n - 2];
    const headY = points[2 * n - 1];
    // Standing still (the hold, a finished team): nothing to draw, and a zero-length gradient would paint nothing anyway.
    if (Math.abs(headX - tailX) + Math.abs(headY - tailY) < b.r * 0.5) return;
    const ctx = this.ctx;
    const sides: number[] = [];
    const back: number[] = [];
    for (let i = 0; i < n; i++) {
      const prev = Math.max(0, i - 1);
      const next = Math.min(n - 1, i + 1);
      const dx = points[2 * next] - points[2 * prev];
      const dy = points[2 * next + 1] - points[2 * prev + 1];
      const len = Math.hypot(dx, dy) || 1;
      const half = (b.r * 0.9 * i) / (n - 1);
      sides.push(points[2 * i] - (dy / len) * half, points[2 * i + 1] + (dx / len) * half);
      back.push(points[2 * i] + (dy / len) * half, points[2 * i + 1] - (dx / len) * half);
    }
    ctx.beginPath();
    ctx.moveTo(sides[0], sides[1]);
    for (let i = 1; i < n; i++) ctx.lineTo(sides[2 * i], sides[2 * i + 1]);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(back[2 * i], back[2 * i + 1]);
    ctx.closePath();
    const fade = ctx.createLinearGradient(tailX, tailY, headX, headY);
    fade.addColorStop(0, rgba(color, 0));
    fade.addColorStop(1, rgba(color, Math.min(0.75, 0.42 * strength)));
    ctx.fillStyle = fade;
    ctx.fill();
  }

  /** "DAMAGE: 2.584  |  SPEED: 3.0x" inside the top of the box, plus the power's own number. */
  private drawStats(t: Team, cfg: Config, look: Flat): void {
    const ctx = this.ctx;
    const text = this.stats(t, cfg);
    ctx.letterSpacing = '1px';
    fitFont(ctx, text, BOX.right - BOX.left - 44, 27, 800);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // Outlined in the box's colour: a ball of the same colour passing under it would swallow it otherwise.
    outlined(ctx, text, BOX.left + 22, t.panel.top + 34, legible(t.color, look.box), look.box, 6);
    ctx.letterSpacing = '0px';
  }

  /**
   * What the next hit deals, and the ball's speed against the slower of the two starting
   * speeds ("SPEED: 3.0x" is three times the other's), which is what a viewer weighs
   * against the damage. A power adds its own number.
   */
  private stats(t: Team, cfg: Config): string {
    const parts = [`DAMAGE: ${formatBig(t.damage, cfg.look.separator)}`];
    const b = t.bodies[0];
    const now = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (now > 0) this.speeds[t.id] = now;
    const speed = (this.speeds[t.id] || t.rule.speed) / Math.max(1, Math.min(cfg.a.speed, cfg.b.speed));
    parts.push(`SPEED: ${speed >= 10 ? Math.round(speed) : speed.toFixed(1)}x`);
    const { special, amount } = t.rule;
    if (amount && special === 'split') parts.push(`BALLS: ${t.bodies.length}`);
    if (amount && special === 'grow') parts.push(`SIZE: ${(b.r / t.rule.radius).toFixed(1)}x`);
    return parts.join('  |  ');
  }

  /** The name above the box; a ball with a power has its tag beside it, the pair centred. */
  private drawName(t: Team, look: Flat): void {
    const ctx = this.ctx;
    const text = t.name.toUpperCase();
    const tag = this.powerTag(t);
    const tagRoom = tag ? this.tagWidth(tag) + 18 : 0;
    ctx.letterSpacing = '3px';
    fitFont(ctx, text, 900 - tagRoom, 54, 900);
    const width = ctx.measureText(text).width;
    const left = W / 2 - (width + tagRoom) / 2;
    ctx.fillStyle = legible(t.color, look.page[0]);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left, t.panel.title + 8);
    ctx.letterSpacing = '0px';
    if (tag) this.drawTag(tag, left + width + 18, t.panel.title + 6, look.ink, false);
  }

  private drawPlainVs(look: Flat): void {
    const ctx = this.ctx;
    ctx.fillStyle = look.vs;
    ctx.font = `900 66px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VS', W / 2, VS_Y + 4);
  }

  /** A plain card over the washed-out race: the winner, its total damage, its hits, and the last line. */
  private drawSheetWinner(world: World, cfg: Config, overlay: Overlay, look: Flat): void {
    const ctx = this.ctx;
    const winner = world.teams.find((t) => t.id === world.winner);
    if (!winner) return;
    this.total ??= totalDamage(winner);
    const a = overlay.winner;
    const cta = cfg.look.cta.trim().toUpperCase();
    const color = legible(winner.color, look.card);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = look.wash;
    ctx.fillRect(0, 0, W, H);

    const pop = easeOutBack(Math.min(1, overlay.age / 0.45));
    ctx.translate(W / 2, 960);
    ctx.scale(pop, pop);
    const cw = 840;
    const ch = cta ? 520 : 440;
    const top = -ch / 2;
    const fw = 6;
    ctx.fillStyle = look.frame;
    roundRect(ctx, -cw / 2 - fw, top - fw, cw + 2 * fw, ch + 2 * fw, 18 + fw);
    ctx.fill();
    ctx.fillStyle = look.card;
    roundRect(ctx, -cw / 2, top, cw, ch, 18);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.font = `800 30px ${FONT}`;
    ctx.letterSpacing = '8px';
    ctx.fillText(this.timedOut ? "TIME'S UP, THE LEADER WINS" : 'WINNER', 4, top + 72);
    ctx.letterSpacing = '2px';
    fitFont(ctx, winner.name.toUpperCase(), cw - 100, 88, 900);
    ctx.fillText(winner.name.toUpperCase(), 0, top + 158);
    ctx.letterSpacing = '0px';

    ctx.fillStyle = look.text;
    ctx.globalAlpha = a * 0.72;
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText('Total damage', 0, top + 240);
    ctx.globalAlpha = a;
    const total = formatBig(this.total, cfg.look.separator);
    fitFont(ctx, total, cw - 100, 66, 900);
    ctx.fillText(total, 0, top + 300);

    ctx.fillStyle = color;
    const result = [marginLine(overlay.margin, this.timedOut), `${winner.hits} hits in ${world.winTime.toFixed(1)} s`].filter(Boolean).join(' · ');
    fitFont(ctx, result, cw - 100, 32, 700);
    ctx.fillText(result, 0, top + 368);
    if (cta) {
      ctx.letterSpacing = '4px';
      fitFont(ctx, cta, cw - 100, 42, 900);
      ctx.fillText(cta, 2, top + 448);
      ctx.letterSpacing = '0px';
    }
    ctx.restore();
  }

  // ── Cards and night ──────────────────────────────────────────────────────

  private drawCard(world: World, t: Team, cfg: Config, deck: Deck): void {
    const ctx = this.ctx;
    const p = t.panel;
    const x0 = BOX.left - BORDER;
    const y0 = p.top - BORDER;
    const w = BOX.right - BOX.left + 2 * BORDER;
    const h = finishTop(p) + FINISH_H + BORDER - y0;

    // Shadow, then the border as a filled card with the box cut into it.
    ctx.fillStyle = deck.ink;
    roundRect(ctx, x0 + SHADOW.x, y0 + SHADOW.y, w, h, RADIUS);
    ctx.fill();
    roundRect(ctx, x0, y0, w, h, RADIUS);
    ctx.fill();
    ctx.save();
    roundRect(ctx, BOX.left, p.top, BOX.right - BOX.left, h - 2 * BORDER, RADIUS - BORDER);
    ctx.fillStyle = deck.box;
    ctx.fill();
    ctx.clip();
    this.drawLayers(world, t, cfg, deck);
    this.drawFinish(p, deck);
    this.drawBalls(t, deck);
    ctx.restore();

    if (this.labels > 0) {
      ctx.save();
      ctx.globalAlpha = this.labels;
      this.drawChips(t, cfg, deck);
      this.drawNameRow(t, deck);
      ctx.restore();
    }
  }

  /** The name pill, and the power tag beside it when the ball has one: the pair centred over the card. */
  private drawNameRow(t: Team, deck: Deck): void {
    const text = t.name.toUpperCase();
    const tag = this.powerTag(t);
    const tagRoom = tag ? this.tagWidth(tag) + 14 : 0;
    const room = 760 - tagRoom;
    const width = this.pillWidth(text, room);
    const left = W / 2 - (width + tagRoom) / 2;
    this.drawPill(text, left + width / 2, t.panel.title, t.color, deck, room);
    if (tag) this.drawTag(tag, left + width + 14, t.panel.title, deck.ink, true);
  }

  /** A pill's width for `text` fitted into `room`; leaves its font set. */
  private pillWidth(text: string, room: number): number {
    const ctx = this.ctx;
    fitFont(ctx, text, room, 38, 900);
    ctx.letterSpacing = '1px';
    return ctx.measureText(text).width + 60;
  }

  /** A team colour as text on a card (see `Deck.dark`). */
  private written(color: string, deck: Deck): string {
    return deck.dark ? legible(color, deck.box) : color;
  }

  private drawLayers(world: World, t: Team, cfg: Config, deck: Deck): void {
    const ctx = this.ctx;
    const n = t.layers.length;
    if (!n) return;
    const h = STACK / n;
    const x = BOX.left + INSET;
    const width = BOX.right - BOX.left - 2 * INSET;
    // A faint band where the layers live, so broken ones leave a visible gap.
    ctx.fillStyle = mix(deck.box, t.color, 0.07);
    ctx.fillRect(BOX.left, world.floorY(t), BOX.right - BOX.left, finishTop(t.panel) - world.floorY(t));

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = t.broken; k < n; k++) {
      const layer = t.layers[k];
      const y = t.panel.floor + k * h;
      const bar = h - LAYER_GAP;
      const hp = this.shownHp(t, k);
      const health = Number((hp * 1000n) / layer.max) / 1000;
      // Track, then the health that is left, then the outline.
      ctx.fillStyle = mix(deck.box, t.color, 0.28);
      roundRect(ctx, x, y, width, bar, 12);
      ctx.fill();
      if (health > 0) {
        ctx.save();
        roundRect(ctx, x, y, width, bar, 12);
        ctx.clip();
        ctx.fillStyle = t.color;
        ctx.fillRect(x, y, Math.max(6, width * health), bar);
        ctx.restore();
      }
      if (k === t.broken && this.flash[t.id] > 0.02) {
        ctx.globalAlpha = this.flash[t.id] * 0.45;
        ctx.fillStyle = WHITE;
        roundRect(ctx, x, y, width, bar, 12);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = 4;
      ctx.strokeStyle = deck.ink;
      roundRect(ctx, x, y, width, bar, 12);
      ctx.stroke();
      if (k === n - 1 && k === t.broken) {
        // The last layer rings in the team's colour (finalGlow): a soft wide line under a bright one.
        const glow = this.finalGlow(t);
        ctx.strokeStyle = t.color;
        roundRect(ctx, x - 5, y - 5, width + 10, bar + 10, 16);
        ctx.globalAlpha = 0.35 * glow;
        ctx.lineWidth = 14;
        ctx.stroke();
        ctx.globalAlpha = glow;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const label = formatBig(hp, cfg.look.separator);
      fitFont(ctx, label, width - 40, Math.min(36, bar * 0.6), 800);
      outlined(ctx, label, W / 2, y + bar / 2 + 1, WHITE, deck.ink, 7);
    }
  }

  /**
   * Two rows of squares sized so a whole number of them spans the box
   * (no half square at the right edge), under a solid ink line.
   */
  private drawFinish(p: Panel, deck: Deck): void {
    const ctx = this.ctx;
    const top = finishTop(p);
    const width = BOX.right - BOX.left;
    const columns = Math.round(width / (FINISH_H / 2));
    const square = width / columns;
    const row = FINISH_H / 2;
    ctx.fillStyle = deck.flag;
    ctx.fillRect(BOX.left, top, width, FINISH_H);
    ctx.fillStyle = deck.ink;
    for (let r = 0; r < 2; r++) {
      for (let c = r % 2; c < columns; c += 2) ctx.fillRect(BOX.left + c * square, top + r * row, square, row);
    }
    ctx.fillRect(BOX.left, top, width, 5);
  }

  private drawBalls(t: Team, deck: Deck): void {
    const ctx = this.ctx;
    for (const b of t.bodies) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = t.color;
      ctx.fill();
      ctx.lineWidth = Math.max(3, Math.min(6, b.r * 0.2));
      ctx.strokeStyle = deck.ink;
      ctx.stroke();
      // In the fill rather than globalAlpha, which the opening draws the balls under (drawOpening).
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.ellipse(b.x - b.r * 0.34, b.y - b.r * 0.38, b.r * 0.26, b.r * 0.18, -0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Damage (left) and the special's number (right), as chips over the top of the box. */
  private drawChips(t: Team, cfg: Config, deck: Deck): void {
    const y = t.panel.top + INSET + CHIP_H / 2;
    const right = this.extraLabel(t);
    const damageRoom = BOX.right - BOX.left - 40 - (right ? 260 : 0);
    this.drawChip('DAMAGE', formatBig(t.damage, cfg.look.separator), BOX.left + INSET, y, t.color, 'left', damageRoom, deck);
    if (right) this.drawChip(right[0], right[1], BOX.right - INSET, y, t.color, 'right', 240, deck);
  }

  private drawChip(label: string, value: string, x: number, y: number, color: string, align: 'left' | 'right', maxWidth: number, deck: Deck): void {
    const ctx = this.ctx;
    const labelFont = `800 22px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = labelFont;
    ctx.letterSpacing = '1.5px';
    const lw = ctx.measureText(label).width;
    ctx.letterSpacing = '0px';
    fitFont(ctx, value, maxWidth - lw - 52, 38, 900);
    const valueFont = ctx.font;
    const vw = ctx.measureText(value).width;
    const width = lw + vw + 52;
    const left = align === 'left' ? x : x - width;
    ctx.fillStyle = mix(deck.box, color, 0.16);
    roundRect(ctx, left, y - CHIP_H / 2, width, CHIP_H, CHIP_H / 2);
    ctx.fill();
    // In the fill rather than globalAlpha, which the chips are drawn under while they fade in (`labels`).
    ctx.fillStyle = rgba(deck.box, 0.86);
    roundRect(ctx, left + 3, y - CHIP_H / 2 + 3, width - 6, CHIP_H - 6, CHIP_H / 2 - 3);
    ctx.fill();
    ctx.fillStyle = deck.muted;
    ctx.font = labelFont;
    ctx.letterSpacing = '1.5px';
    ctx.fillText(label, left + 20, y + 1);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = this.written(color, deck);
    ctx.font = valueFont;
    ctx.fillText(value, left + 32 + lw, y + 2);
  }

  /** What the special is doing, where there is room for it. */
  private extraLabel(t: Team): [string, string] | null {
    const { special, amount } = t.rule;
    if (!amount || special === 'none') return null;
    if (special === 'split') return ['BALLS', String(t.bodies.length)];
    const b = t.bodies[0];
    if (special === 'grow') return ['SIZE', String(Math.round(b.r * 2))];
    return ['SPEED', String(Math.round(Math.sqrt(b.vx * b.vx + b.vy * b.vy)))];
  }

  /** A rounded label with the card's hard shadow: the team name, the winner card's title. */
  private drawPill(text: string, cx: number, cy: number, color: string, deck: Deck, room = 760): void {
    const ctx = this.ctx;
    const width = this.pillWidth(text, room);
    const height = PILL_H;
    const x = cx - width / 2;
    const y = cy - height / 2;
    ctx.fillStyle = deck.ink;
    roundRect(ctx, x + 6, y + 7, width, height, height / 2);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, x, y, width, height, height / 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = deck.ink;
    ctx.stroke();
    ctx.fillStyle = readableOn(color);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy + 2);
    ctx.letterSpacing = '0px';
  }

  private drawVs(deck: Deck): void {
    const ctx = this.ctx;
    ctx.fillStyle = deck.ink;
    ctx.beginPath();
    ctx.arc(W / 2, VS_Y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = WHITE;
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.font = `900 28px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VS', W / 2, VS_Y + 1);
  }

  private drawWinner(world: World, cfg: Config, overlay: Overlay, deck: Deck): void {
    const ctx = this.ctx;
    const winner = world.teams.find((t) => t.id === world.winner);
    if (!winner) return;
    const a = overlay.winner;
    const cta = cfg.look.cta.trim().toUpperCase();
    const color = this.written(winner.color, deck);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = deck.wash;
    ctx.fillRect(0, 0, W, H);

    const pop = easeOutBack(Math.min(1, overlay.age / 0.45));
    ctx.translate(W / 2, 960);
    ctx.scale(pop, pop);

    const cw = 880;
    const ch = cta ? 530 : 440;
    // With a last line the card grows down, and everything above moves up by half of it.
    const lift = cta ? -45 : 0;
    ctx.fillStyle = deck.ink;
    roundRect(ctx, -cw / 2 + SHADOW.x, -ch / 2 + SHADOW.y, cw, ch, 34);
    ctx.fill();
    ctx.fillStyle = deck.box;
    roundRect(ctx, -cw / 2, -ch / 2, cw, ch, 34);
    ctx.fill();
    ctx.lineWidth = BORDER;
    ctx.strokeStyle = deck.ink;
    ctx.stroke();
    // The winner's colour along the bottom of the card.
    ctx.save();
    roundRect(ctx, -cw / 2, -ch / 2, cw, ch, 34);
    ctx.clip();
    ctx.fillStyle = winner.color;
    ctx.fillRect(-cw / 2, ch / 2 - 30, cw, 30);
    ctx.restore();

    this.drawPill(this.timedOut ? "TIME'S UP · LEADER WINS" : '🏆 WINNER', 0, -ch / 2, deck.ink, deck);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, winner.name.toUpperCase(), cw - 90, 96, 900);
    // The ink outline keeps light colours (lime, amber) readable on the white card.
    outlined(ctx, winner.name.toUpperCase(), 0, -55 + lift, color, deck.ink, 8);

    ctx.fillStyle = deck.text;
    const result = [marginLine(overlay.margin, this.timedOut), `${world.winTime.toFixed(1)} s`, `${winner.hits} hits`].filter(Boolean).join(' · ');
    fitFont(ctx, result, cw - 90, 40, 800);
    ctx.fillText(result, 0, 40 + lift);
    ctx.fillStyle = deck.muted;
    const reached = `${SEQUENCES[winner.rule.sequence].label} reached ${formatBig(winner.damage, cfg.look.separator)}`;
    fitFont(ctx, reached, cw - 90, 30, 600);
    ctx.fillText(reached, 0, 100 + lift);
    if (cta) {
      ctx.letterSpacing = '2px';
      fitFont(ctx, cta, cw - 90, 40, 900);
      outlined(ctx, cta, 0, 175 + lift, color, deck.ink, 6);
      ctx.letterSpacing = '0px';
    }
    ctx.restore();
  }
}

/**
 * How far through its last layer a team is, 0..1, 1 once through: what the last layer's glow, its
 * hits and its notes (src/audio/sonify.ts) grow with. 0 for a team still above it.
 */
function lastWorn(t: Team): number {
  const layer = t.layers[t.layers.length - 1];
  return layer ? 1 - Number((layer.hp * 1000n) / layer.max) / 1000 : 0;
}

/** Where a countdown (Renderer.count) stands, in whole hit points: cubic ease-out from `from` to `to`. */
function counted(c: { from: bigint; to: bigint; k: number }): bigint {
  return c.to + ((c.from - c.to) * BigInt(Math.round((1 - c.k) ** 3 * 1000))) / 1000n;
}

/**
 * The winner card's margin, "Won by 0.3 s" (two decimals under a tenth), "Photo finish" for a dead
 * heat; nothing when none was passed, or nobody finished.
 */
function marginLine(margin: number | undefined, timedOut: boolean): string {
  if (margin === undefined || timedOut || !Number.isFinite(margin)) return '';
  if (margin < 0.005) return 'Photo finish';
  return `Won by ${margin.toFixed(margin < 0.095 ? 2 : 1)} s`;
}

/**
 * When the follow button pops up in the race, in seconds of race (`race`, the predicted win): as
 * near 45 % of it as LEAD CHANGE allows, which shows in the same place, with 0.3 s clear either
 * side; null when 30–75 % of the race has no such room. Near the middle: a viewer still watching
 * then is the one worth asking, the opening title and its question are long gone, and slow motion
 * and the winner card, with a button of their own, are still to come.
 */
export function followAt(race: number, leads: { at: number }[]): number | null {
  const clear = (t: number) => leads.every((l) => t + FOLLOW_SHOW + 0.3 <= l.at || t >= l.at + LEAD_SHOW + 0.3);
  const mid = race * 0.45;
  // Out from the middle a quarter second at a time, later and earlier in turn.
  for (let k = 0; k < 120; k++) {
    const t = mid + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.25;
    if (t >= race * 0.3 && t + FOLLOW_SHOW <= race * 0.75 && clear(t)) return t;
  }
  return null;
}

/** 0..1, how far a button is pressed in, `since` seconds after the tap: in and out over a tenth of a second either side. */
function pressed(since: number): number {
  return Math.max(0, 1 - Math.abs(since) / 0.1);
}

/** `text` in lines no wider than `width` at the context's font, broken at spaces. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
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

/** Everything a team dealt, leftover damage included: the sum of its sequence over its hits. */
function totalDamage(t: Team): bigint {
  const sequence = SEQUENCES[t.rule.sequence];
  let sum = 0n;
  for (let n = 0; n < t.hits; n++) sum += sequence.term(n);
  return sum;
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

/** Text with an outline under the fill, so it reads on any colour. */
function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, stroke: string, width: number): void {
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
function fitFont(ctx: CanvasRenderingContext2D, text: string, width: number, max: number, weight: number): void {
  ctx.font = `${weight} ${max}px ${FONT}`;
  const measured = ctx.measureText(text).width;
  if (measured > width) ctx.font = `${weight} ${Math.max(10, Math.floor((max * width) / measured))}px ${FONT}`;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** `hex` moved toward `other` by `amount`: 0 is `hex` itself, 1 is `other`. */
function mix(hex: string, other: string, amount: number): string {
  const a = rgb(hex);
  const b = rgb(other);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function rgba(hex: string, alpha: number): string {
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
function legible(color: string, background: string): string {
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
function readableOn(hex: string): string {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 ? INK : WHITE;
}

function easeOutBack(t: number): number {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

/** The cards and night page, painted once: a three-colour gradient with a faint dot grid. */
function paintCardsPage(deck: Deck): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, H);
  deck.page.forEach((color, i) => sky.addColorStop(i / 2, color));
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  g.fillStyle = deck.dots;
  const rng = createRng('dots');
  for (let y = 18; y < H; y += 36) {
    for (let x = 18 + ((y / 36) % 2) * 18; x < W; x += 36) {
      g.beginPath();
      g.arc(x, y, 1.8 + rng.next() * 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  return canvas;
}

/** The paper page: a plain sheet, a shade darker toward the bottom. */
function paintFlatPage(look: Flat): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const sheet = g.createLinearGradient(0, 0, 0, H);
  sheet.addColorStop(0, look.page[0]);
  sheet.addColorStop(1, look.page[1]);
  g.fillStyle = sheet;
  g.fillRect(0, 0, W, H);
  return canvas;
}
