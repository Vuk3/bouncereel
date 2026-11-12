import { FONT, easeOutCubic, mix, readableOn, roundRect, smoothstep } from './draw.ts';

// The follow button and the hand that taps it, for the race and the Arena Clash alike: a plus and
// FOLLOW on a colour; a hand comes up, presses it, and it turns to a tick and FOLLOWING, as the
// platforms' own buttons do. Each renderer says where it sits, when it is tapped and in what pill.

/**
 * The button before the win: seconds it shows, and when in that it is tapped, turning from FOLLOW
 * to FOLLOWING. Long enough to read both words, short enough to leave the video to itself again.
 */
export const FOLLOW_SHOW = 2.4;
export const FOLLOW_RACE_TAP = 0.9;
/**
 * The button under the winner card: seconds after the card comes up that it pops in (the card
 * has finished its own pop by then) and that a finger taps it. pacing.ts (FOLLOW_CARD) keeps the
 * card up long enough to see FOLLOWING after the tap.
 */
export const FOLLOW_IN = 0.6;
export const FOLLOW_TAP = 1.5;
/** The button before the win, in the red of Follow and Subscribe on TikTok and YouTube: it belongs to no side, and reads as a follow button before its word does. */
export const FOLLOW_RED = '#fe2c55';
/** The plus (or tick) before the button's word, and the space after it, in parts of the type's size. */
const FOLLOW_ICON = 0.62;
const FOLLOW_GAP = 0.36;
/** Seconds after the tap that the button turns to FOLLOWING: as the finger lifts, since a platform's button changes when the touch ends. */
const FOLLOW_SWITCH = 0.08;
/** The finger's pad lands on the plus, this much of the type's size below the button's middle: the plus's top shows above it, the word beside it. */
export const FOLLOW_PAD = 0.2;
/**
 * The hand that taps the follow button: Microsoft's 3D 👆 (Fluent Emoji, MIT, public/hand/README.md),
 * not the font's emoji, which every system draws its own way (and a recording shows whichever its
 * computer has). The image is 256 px square; the index's tip is at (99.5, 16) in it, and the hand
 * 223 px tall from there.
 */
const HAND_SRC = '/hand/pointing-up.png';
const HAND_TIP = { x: 99.5, y: 16 };
/** The finger's pad, where it touches the screen, this far below its tip in the image's px. */
const HAND_PAD = 14;
/** The hand's size: about an emoji's beside the word, 74 px tall in the race (34 px type) and 100 px at the end (46 px). */
export const RACE_HAND = 74 / 223;
export const END_HAND = 100 / 223;
/** The hand leans a little left, as a right hand does reaching up to a button from below. */
const HAND_TILT = -0.1;

/** The pill a button is drawn in: its frame, what it turns into once followed and the word on that, and whether it casts the cards' hard shadow. */
export interface FollowStyle {
  ink: string;
  card: string;
  text: string;
  shadow: boolean;
}

export class FollowButton {
  private readonly ctx: CanvasRenderingContext2D;
  /** The hand's image (HAND_SRC), asked for once a video with the button is set up. */
  private hand: HTMLImageElement | null = null;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  /** Asks for the hand's image: it is drawn seconds into the video, so asked for at the start it is there by then. */
  load(): void {
    if (this.hand) return;
    this.hand = new Image();
    this.hand.src = HAND_SRC;
  }

  /** Where the plus sits on the button, from its middle: where the finger taps it. Leaves the button's font set. */
  plusX(size: number): number {
    this.width(size);
    return -(size * (FOLLOW_ICON + FOLLOW_GAP) + this.ctx.measureText('FOLLOW').width) / 2 + (size * FOLLOW_ICON) / 2;
  }

  /** The button's width at `size` px: as wide as FOLLOWING, so the tap does not move it. Leaves its font set. */
  width(size: number): number {
    const ctx = this.ctx;
    ctx.font = `900 ${size}px ${FONT}`;
    ctx.letterSpacing = '1px';
    return ctx.measureText('FOLLOWING').width + size * 2;
  }

  /**
   * The button centred on the origin and what a tap does to it, `since` seconds from the tap
   * (negative before): it gives under the finger (pressDepth), and as the finger lifts
   * (FOLLOW_SWITCH) it turns to FOLLOWING with a small bounce and a burst of its colour round it.
   */
  draw(size: number, color: string, since: number, style: FollowStyle): void {
    const ctx = this.ctx;
    const after = since - FOLLOW_SWITCH;
    const bounce = after > 0 && after < 0.34 ? 0.06 * Math.sin((Math.PI * after) / 0.34) : 0;
    const scale = 1 - 0.07 * pressDepth(since) + bounce;
    ctx.save();
    ctx.scale(scale, scale);
    this.drawButton(size, color, smoothstep(after / 0.22), since, style);
    ctx.restore();
    if (after > 0 && after < 0.45) this.drawBurst(this.width(size), size * 1.7, after / 0.45, color);
  }

  /**
   * The follow button centred on the origin, `size` px type: a plus and FOLLOW on `color`, turning
   * (`done` 0..1) into a tick and FOLLOWING on the pill's own card, as the platforms' buttons turn
   * once followed: the fill fades from one to the other while the words roll up, the old out at the
   * top and the new in from below. From the tap (`since`) a ripple spreads from under the finger.
   */
  private drawButton(size: number, color: string, done: number, since: number, style: FollowStyle): void {
    const ctx = this.ctx;
    const { ink, card } = style;
    const w = this.width(size);
    const h = size * 1.7;
    if (style.shadow) {
      ctx.fillStyle = ink;
      roundRect(ctx, -w / 2 + h * 0.09, -h / 2 + h * 0.1, w, h, h / 2);
      ctx.fill();
    }
    ctx.fillStyle = done <= 0 ? color : done >= 1 ? card : mix(color, card, done);
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.save();
    ctx.clip();
    if (since >= 0 && since < 0.45) {
      ctx.save();
      ctx.globalAlpha *= 0.3 * (1 - since / 0.45);
      ctx.fillStyle = readableOn(color);
      ctx.beginPath();
      ctx.arc(this.plusX(size), size * FOLLOW_PAD, size * 0.4 + w * easeOutCubic(since / 0.45), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // FOLLOW rolls up and out, and FOLLOWING up and in from below as it goes: they share only the
    // middle of the change, each mostly out of the pill by then, so the words never sit on each other
    // and the button is never empty.
    const out = Math.min(1, done / 0.6);
    const into = Math.max(0, (done - 0.35) / 0.65);
    if (out < 1) this.drawLabel(size, false, readableOn(color), -h * 0.5 * out, 1 - out);
    if (into > 0) this.drawLabel(size, true, style.text, h * 0.5 * (1 - into), into);
    ctx.restore();
    // The frame last, over the clip's edge, so a rolling word never draws across it.
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }

  /**
   * The plus and FOLLOW, or the tick and FOLLOWING, centred on the origin and `dy` below it, at
   * `alpha`. The plus and the tick are lines, not type: Rubik has neither, and a fallback font's
   * would not match the word. Needs the button's font set (width).
   */
  private drawLabel(size: number, following: boolean, color: string, dy: number, alpha: number): void {
    const ctx = this.ctx;
    const word = following ? 'FOLLOWING' : 'FOLLOW';
    const icon = size * FOLLOW_ICON;
    const gap = size * FOLLOW_GAP;
    const left = -(icon + gap + ctx.measureText(word).width) / 2;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(0, dy);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.15;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (following) {
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
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, left + icon + gap, size * 0.06);
    ctx.restore();
  }

  /**
   * Short strokes of the button's colour bursting out round a `w` × `h` pill, `k` 0..1 of their
   * way: the tap landing, as a like's does on the platforms. Round an ellipse a little wider than
   * the pill, so they leave its edge at about the same distance all round.
   */
  private drawBurst(w: number, h: number, k: number, color: string): void {
    const ctx = this.ctx;
    const e = easeOutCubic(k);
    ctx.save();
    ctx.globalAlpha *= 1 - k * k;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineWidth = 2 + h * 0.07 * (1 - e);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = ((i + 0.5) / 10) * Math.PI * 2;
      const from = 6 + h * 0.28 * e;
      const to = from + 3 + h * 0.18 * (1 - e);
      ctx.moveTo(Math.cos(a) * (w / 2 + from), Math.sin(a) * (h / 2 + from));
      ctx.lineTo(Math.cos(a) * (w / 2 + to), Math.sin(a) * (h / 2 + to));
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The hand that taps the follow button, the pad of its finger on (x, y), `since` seconds from the
   * tap (handPose), at `scale`. Lifted it is a little bigger, nearer the camera, its shadow further
   * off and softer; pressing, it goes into the screen, a little smaller and its finger giving (the
   * hand squashed along it), its shadow tight under it. The shadow falls down and to the right, lit
   * from the top left as the cards' are. Until the image has loaded there is no hand, only the tap.
   */
  drawHand(x: number, y: number, since: number, scale: number): void {
    const pose = handPose(since);
    const hand = this.hand;
    if (!pose || !hand?.complete || !hand.naturalWidth) return;
    const ctx = this.ctx;
    // The shadow's blur and offset are not scaled with the drawing: in px of the frame, smaller in the race.
    const k = scale / END_HAND;
    ctx.save();
    ctx.globalAlpha *= pose.alpha;
    ctx.translate(x + pose.dx * scale, y + pose.dy * scale);
    ctx.rotate(HAND_TILT + pose.turn);
    const s = scale * (1 + 0.05 * pose.lift - 0.07 * pose.press);
    ctx.scale(s * (1 + 0.03 * pose.press), s * (1 - 0.06 * pose.press));
    ctx.shadowColor = `rgba(0, 0, 0, ${0.34 - 0.12 * pose.lift})`;
    ctx.shadowBlur = (4 + 12 * pose.lift) * k;
    ctx.shadowOffsetX = (2 + 8 * pose.lift) * k;
    ctx.shadowOffsetY = (3 + 14 * pose.lift) * k;
    ctx.drawImage(hand, -HAND_TIP.x, -HAND_TIP.y - HAND_PAD);
    ctx.restore();
  }
}

/** 0..1, how far the follow button is pressed in, `since` seconds from the tap: in as the finger lands, held while it rests, out as it lets go (handPose's timings). */
function pressDepth(since: number): number {
  if (since < -0.05 || since > 0.16) return 0;
  if (since < 0) return 1 + since / 0.05;
  return since < 0.08 ? 1 : 1 - (since - 0.08) / 0.08;
}

/**
 * Where the tapping hand is `t` seconds from its tap (negative before), or null while it is not
 * there: (dx, dy) from the tap in the image's px, `turn` radians on top of its lean, `lift` 1 in
 * the air to 0 touching, `press` how far the finger pushes in, and its `alpha`. It comes up from
 * below right, fading in and slowing, the wrist turning as it does (0.3 s); strikes, speeding up
 * into the button as a finger does into a tap, and pushes (0.12 s); holds (0.08 s); lets go and
 * lifts (0.16 s); waits a moment, and goes back down, fading.
 */
function handPose(t: number): { dx: number; dy: number; turn: number; lift: number; press: number; alpha: number } | null {
  if (t < -0.42 || t > 0.8) return null;
  if (t < -0.12) {
    const k = (t + 0.42) / 0.3;
    const e = easeOutCubic(k);
    return { dx: 22 + 90 * (1 - e), dy: 28 + 150 * (1 - e), turn: 0.3 * (1 - e), lift: 1, press: 0, alpha: Math.min(1, k * 2.5) };
  }
  if (t < 0) {
    const e = ((t + 0.12) / 0.12) ** 2;
    return { dx: 22 * (1 - e), dy: 28 * (1 - e), turn: 0, lift: 1 - e, press: Math.max(0, 2 * e - 1), alpha: 1 };
  }
  if (t < 0.08) return { dx: 0, dy: 0, turn: 0, lift: 0, press: 1, alpha: 1 };
  if (t < 0.45) {
    const e = easeOutCubic((t - 0.08) / 0.16);
    return { dx: 14 * e, dy: 18 * e, turn: 0, lift: e, press: 1 - e, alpha: 1 };
  }
  const e = ((t - 0.45) / 0.35) ** 2;
  return { dx: 14 + 70 * e, dy: 18 + 120 * e, turn: 0.2 * e, lift: 1, press: 0, alpha: 1 - e };
}
