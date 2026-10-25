import { introLine, synthesize, VOICES } from '../src/audio/narration.ts';
import { mergeConfig, PRESETS, type Config, type Skin } from '../src/config.ts';
import { H, W } from '../src/layout.ts';
import { Renderer, drawMark } from '../src/render/renderer.ts';
import { SITE_HOST } from '../shared/site.ts';
import { heroConfig } from '../src/site/hero.ts';
import { STEP } from '../src/sim/types.ts';
import { createWorld, predict } from '../src/sim/world.ts';

// The public site's images, drawn by the studio's own renderer (docs/website.md says when to
// remake them): the hero's first frame, which must match the first frame src/site/hero.ts draws,
// the three looks mid-race, and the 1200×630 Open Graph image; and, on a press, the narrator's
// opening that the home page plays, said by the studio's own Kokoro. Only built with STILLS=1
// (vite.config.ts); each is offered as a download, to be saved under public/.

/** The part of the frame a look's thumbnail shows, as in the studio's look picker (src/app.ts THUMB). */
const THUMB = { x: 60, y: 168, w: 960, h: 832 };

const out = document.querySelector('#out')!;

/** An image to download, to be saved at `dir`/`path` (public/ unless said). */
function offer(canvas: HTMLCanvasElement, path: string, type: string, quality?: number, dir = 'public'): void {
  const url = canvas.toDataURL(type, quality);
  const img = Object.assign(document.createElement('img'), { src: url, alt: path });
  const a = Object.assign(document.createElement('a'), { href: url, download: path.split('/').pop()!, textContent: `${dir}/${path}` });
  a.dataset.path = path;
  const figure = document.createElement('figure');
  figure.append(img, a);
  out.append(figure);
}

function scaled(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number): HTMLCanvasElement {
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  return canvas;
}

/** The race `at` (0..1) of the way to the predicted win, drawn as playback would: trails and all. */
function midRace(cfg: Config, at: number): HTMLCanvasElement {
  const renderer = new Renderer(document.createElement('canvas'));
  renderer.reset(cfg);
  const world = createWorld(cfg);
  const until = predict(cfg).time * at;
  while (world.time < until) {
    for (let i = 0; i < 4; i++) world.step(STEP);
    renderer.handle(world.drain(), world, cfg);
    renderer.draw(world, cfg, 1 / 60, { winner: 0, age: 0 });
  }
  return renderer.canvas;
}

async function main(): Promise<void> {
  await Promise.all([400, 600, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px Rubik`)));
  const hero = heroConfig(PRESETS[0].config)!;

  // 1. The hero's first frame (night, HERO_LOOKS[0]), its opening title and all: the LCP of the home
  // page, under the live canvas.
  const first = new Renderer(document.createElement('canvas'));
  first.reset(hero);
  first.draw(createWorld(hero), hero, 0, { winner: 0, age: 0, opening: 1 });
  offer(scaled(first.canvas, 0, 0, W, H, 540, 960), 'hero/first-frame-3.webp', 'image/webp', 0.86);

  // 2. The three looks, the same race mid-way.
  const frames: Partial<Record<Skin, HTMLCanvasElement>> = {};
  for (const skin of ['paper', 'night', 'cards'] as Skin[]) {
    const cfg = mergeConfig(hero, { look: { skin } });
    frames[skin] = midRace(cfg, 0.55);
    offer(scaled(frames[skin], THUMB.x, THUMB.y, THUMB.w, THUMB.h, 480, 416), `looks/${skin}.webp`, 'image/webp', 0.85);
  }

  // 3. Open Graph, 1200×630, as the site's hero: the ink stage, the mark, the name and the headline
  // on the left with the address along the bottom (as vukcvetkovic.com's card has it), two phones
  // (night, paper) in the two balls' light on the right.
  const og = Object.assign(document.createElement('canvas'), { width: 1200, height: 630 });
  const ctx = og.getContext('2d')!;
  ctx.fillStyle = '#0b0e16';
  ctx.fillRect(0, 0, 1200, 630);
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1200, 630);
  };
  glow(880, 190, 320, 'rgba(124, 77, 255, 0.38)');
  glow(1010, 470, 300, 'rgba(14, 165, 233, 0.3)');
  // The wordmark: the mark and the name.
  drawMark(ctx, 70, 84, 54);
  ctx.fillStyle = '#f2f4f8';
  ctx.font = '700 38px Rubik';
  ctx.textBaseline = 'middle';
  ctx.fillText('BounceReel', 138, 113);
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 70px Rubik';
  ctx.letterSpacing = '-2.5px';
  ['Ball race videos,', 'ready to post.'].forEach((line, i) => ctx.fillText(line, 72, 262 + i * 78));
  ctx.letterSpacing = '0px';
  ctx.font = '400 28px Rubik';
  ctx.fillStyle = '#a6adbb';
  ['Vertical MP4s for Shorts, TikTok and Reels,', 'made in your browser.'].forEach((line, i) => ctx.fillText(line, 74, 420 + i * 40));
  // The address, a violet rule, and the line after it, narrowed if they would reach the phones (x 760).
  ctx.font = '400 30px Rubik';
  const rest = 25 + ctx.measureText('Free to start').width;
  let size = 32;
  ctx.font = `700 ${size}px Rubik`;
  while (74 + ctx.measureText(SITE_HOST).width + 22 + rest > 730 && size > 22) ctx.font = `700 ${--size}px Rubik`;
  ctx.fillStyle = '#f2f4f8';
  ctx.fillText(SITE_HOST, 74, 560);
  const after = 74 + ctx.measureText(SITE_HOST).width + 22;
  ctx.fillStyle = '#7c4dff';
  ctx.fillRect(after, 532, 3, 36);
  ctx.font = '400 30px Rubik';
  ctx.fillStyle = '#a6adbb';
  ctx.fillText('Free to start', after + 25, 560);
  const phone = (frame: HTMLCanvasElement, x: number, y: number, w: number) => {
    const h = (w * 16) / 9;
    const bezel = 9;
    ctx.fillStyle = '#1a1e2a';
    ctx.beginPath();
    ctx.roundRect(x, y, w + bezel * 2, h + bezel * 2, 34);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + bezel, y + bezel, w, h, 26);
    ctx.clip();
    ctx.drawImage(frame, x + bezel, y + bezel, w, h);
    ctx.restore();
  };
  phone(frames.night!, 760, 56, 264);
  phone(frames.paper!, 968, 170, 196);
  offer(og, 'og.png', 'image/png');

  // 4. The profile picture for Instagram, YouTube and TikTok, 1080×1080 (each shows it as a circle):
  // the mark on the ink stage in the balls' light, as the share image has it, violet behind the ball
  // and sky behind the layers. Its drawing spans x 3–29, y 2.6–31.4 of its 32-unit grid, so it is
  // centred on (16, 17), and at 680 px across its farthest corner stays 412 px from the centre,
  // well inside the circle's 540. Not for public/: kept in brand/.
  const avatar = Object.assign(document.createElement('canvas'), { width: 1080, height: 1080 });
  const av = avatar.getContext('2d')!;
  av.fillStyle = '#0b0e16';
  av.fillRect(0, 0, 1080, 1080);
  const light = (x: number, y: number, r: number, color: string) => {
    const g = av.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    av.fillStyle = g;
    av.fillRect(0, 0, 1080, 1080);
  };
  light(590, 440, 560, 'rgba(124, 77, 255, 0.42)');
  light(540, 760, 560, 'rgba(14, 165, 233, 0.3)');
  const k = 680 / 32;
  drawMark(av, 540 - 16 * k, 540 - 17 * k, 680);
  offer(avatar, 'brand/profile.png', 'image/png', undefined, '.');

  // 5. The classic's opening in the default voice, for the home page's narrator card: a WAV here,
  // an AAC file under public/voice/ after ffmpeg (docs/website.md). On a press, since Kokoro
  // downloads its model the first time.
  const make = Object.assign(document.createElement('button'), { type: 'button', textContent: `Make the opening (Kokoro, ${VOICES[0].name})` });
  out.append(make);
  make.addEventListener('click', async () => {
    make.disabled = true;
    const text = introLine(hero);
    // Only for its buffers: nothing is played here.
    const buffer = await synthesize(new OfflineAudioContext(1, 1, 24000), VOICES[0].id, text, (s) => (make.textContent = s || 'Generating…'));
    make.textContent = `${text} (${buffer.duration.toFixed(1)} s)`;
    const url = URL.createObjectURL(wav(buffer));
    const audio = Object.assign(document.createElement('audio'), { src: url, controls: true });
    const a = Object.assign(document.createElement('a'), { href: url, download: 'opening-heart.wav', textContent: 'public/voice/opening-heart.wav' });
    const figure = document.createElement('figure');
    figure.append(audio, a);
    out.append(figure);
  });
}

/** A buffer as 16-bit PCM WAV, mono: what ffmpeg makes the AAC file from. */
function wav(buffer: AudioBuffer): Blob {
  const samples = buffer.getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Blob([view], { type: 'audio/wav' });
}

void main();
