import type { PublicPlan } from '../../shared/api.ts';
import { LOOK_LABELS, LOOKS, MAX_VIDEO_SECONDS, soundAllowed, type Sound } from '../../shared/features.ts';
import type { Config, Skin } from '../config.ts';
import './chrome.ts';
import type { Facts, Settings } from './hero.ts';
import { renderPlans } from './pricing.ts';

// The home page. The still frames in the phones are the first paint; the race engine
// (src/site/hero.ts, the simulation and the renderer) loads only after the page has, so it never
// delays it. Under prefers-reduced-motion it loads only when the dice is rolled or a step is
// changed, to draw that matchup's first frame.
//
// How it works is a small working studio: step 1 rolls the dice, step 2 sets the video, step 3
// shows the video as it will be posted, and the phone beside them plays what they set. The cards
// on the stage below work on the same matchup: the race board (with the steps' Length and Finish
// gap again, in step) and a look played larger; a power's sketch and the narrator's opening are
// their own. The gallery's videos play only while they are on screen.

const phone = document.querySelector<HTMLElement>('#phone')!;
const canvas = phone.querySelector('canvas')!;
const roll = document.querySelector<HTMLButtonElement>('#roll')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const how = {
  phone: $('#how-phone').querySelector('canvas')!,
  post: $('#how-post').querySelector('canvas')!,
  roll: $<HTMLButtonElement>('#how-roll'),
  balls: $('#how-balls'),
  verdict: $('#how-verdict'),
  caption: $('#how-caption'),
  length: $<HTMLInputElement>('#how-length'),
  lengthOut: $('#how-length-out'),
  lengthFact: $('#how-length-fact'),
  gap: $<HTMLInputElement>('#how-gap'),
  gapOut: $('#how-gap-out'),
  soundHint: $('#how-sound-hint'),
  free: $('#how-free'),
};
const board = {
  race: $('#board-race'),
  lanes: $('#board-lanes'),
  ruler: $('#board-ruler'),
  length: $<HTMLInputElement>('#board-length'),
  lengthOut: $('#board-length-out'),
  gap: $<HTMLInputElement>('#board-gap'),
  gapOut: $('#board-gap-out'),
};
const lookDialog = $<HTMLDialogElement>('#look-dialog');
const lookCanvas = lookDialog.querySelector('canvas')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), { className, textContent: text });
}

/** What the file gets, in the page's words (the studio's own speak of its Voice tab). */
const SOUND_HINTS: Record<Sound, string> = {
  narrator: 'A narrator opens the race and calls the winner, over the notes and cracks.',
  music: 'Notes, cracks and the fanfare; no narrator.',
  silent: 'No sound at all, for a sound you add in the app you post from.',
};

type HeroModule = typeof import('./hero.ts');
type Phone = InstanceType<HeroModule['Hero']>;
let engine: Promise<{ module: HeroModule; hero: Phone; demo: Phone }> | null = null;
/** The matchup the steps have set; null until the engine has made the first one. */
let steps: Config | null = null;

function showMatchup(cfg: Config, describe: HeroModule['describeRace']): void {
  const side = (ball: Config['a']) => {
    const span = document.createElement('span');
    const dot = document.createElement('i');
    dot.className = 'ball';
    dot.style.setProperty('--c', ball.color);
    span.append(dot, ball.name);
    return span;
  };
  const vs = Object.assign(document.createElement('span'), { className: 'vs', textContent: 'vs' });
  document.querySelector('#matchup-names')!.replaceChildren(side(cfg.a), vs, side(cfg.b));
  document.querySelector('#matchup-note')!.textContent = describe(cfg);
}

/**
 * Only one race runs at a time: of the phones on screen, the most visible plays and the others
 * hold their frame; with a look open larger, only that one. Ratios are kept from the start, so
 * each phone has its turn as soon as the engine is there.
 */
const shown = new Map<Element, number>();
let phones: [Element, Phone][] = [];
function share(): void {
  let best: Element | null = lookDialog.open ? lookCanvas : null;
  if (!best) for (const [target, ratio] of shown) if (ratio > 0 && (!best || ratio > shown.get(best)!)) best = target;
  for (const [target, p] of phones) p.setActive(target === best);
}
const sharing = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) shown.set(entry.target, entry.intersectionRatio);
    share();
  },
  { threshold: [0, 0.25, 0.5, 0.75, 1] },
);
sharing.observe(canvas);
sharing.observe(how.phone);

/** A task of its own for what follows: two phones and a first frame in one would be a long task on a slow phone. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

function start(): NonNullable<typeof engine> {
  engine ??= (async () => {
    // A canvas never loads a web font by itself: without this the race would draw in the
    // fallback font over a still frame drawn in Rubik.
    await Promise.all([600, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px Rubik`)));
    const module = await import('./hero.ts');
    const hero = timed('hero', () => new module.Hero(canvas, (cfg) => showMatchup(cfg, module.describeRace)));
    phones = [[canvas, hero]];
    share();
    await nextTask();
    // Whatever the steps were set to before the engine came, it starts from there.
    const first = timed('first', () => module.firstMatchup(settings()));
    steps = first;
    await nextTask();
    const demo = timed('show', () => new module.Hero(how.phone, () => {}, first));
    phones.push([how.phone, demo]);
    share();
    await nextTask();
    timed('facts', () => describeSteps(module, first));
    return { module, hero, demo };
  })();
  return engine;
}

roll.addEventListener('click', async () => {
  roll.disabled = true;
  try {
    (await start()).hero.roll();
  } finally {
    roll.disabled = false;
  }
});

if (!reducedMotion) {
  const later = () => ('requestIdleCallback' in window ? requestIdleCallback(() => void start(), { timeout: 2000 }) : setTimeout(() => void start(), 200));
  if (document.readyState === 'complete') later();
  else addEventListener('load', later, { once: true });
}

// ── How it works ──────────────────────────────────────────────────────────

const checked = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)!.value;

function settings(): Settings {
  return { video: Number(how.length.value), gap: Number(how.gap.value), skin: checked('how-look') as Skin, track: checked('how-sound') as Sound };
}

/** `timing.gap` as the studio's panel shows it (app.ts gapLabel). */
const gapLabel = (gap: number) => (gap > 0 ? `${gap} s` : 'photo finish');

function caption(cfg: Config | null): void {
  const s = settings();
  const names = cfg ? `${cfg.a.name} vs ${cfg.b.name}, ` : '';
  how.caption.textContent = `${names}${s.video} s, ${LOOK_LABELS[s.skin].toLowerCase()} look, muted`;
}

/** The margin as the studio's matchup card says it. */
const marginLabel = (margin: number) => (Number.isFinite(margin) ? `${margin.toFixed(1)} s` : 'a mile');

/** The steps' matchup in words: the two balls in step 1, how it ends, and what the phones and the race board show. */
function describeSteps(module: HeroModule, cfg: Config, outcome?: ReturnType<Phone['show']>): void {
  const facts = module.factsOf(cfg, outcome);
  how.balls.replaceChildren(
    ...facts.balls.map((ball) => {
      const li = el('li', 'piece-row');
      const dot = el('i', 'ball');
      dot.style.setProperty('--c', ball.color);
      li.append(dot, el('b', '', ball.name), el('em', '', ball.terms));
      return li;
    }),
  );
  if (facts.winner) how.verdict.replaceChildren(el('strong', '', facts.winner), ` wins by ${marginLabel(facts.margin)}`);
  else how.verdict.textContent = 'Nobody reaches the line in time: roll another.';
  caption(cfg);
  drawBoard(facts);
  module.drawFirstFrame(how.post, cfg);
}

/**
 * The race board: the winner's lane to the line, the loser's as far as it had got when the winner
 * touched it, on a ruler in the race's own seconds. New lanes replay the lanes' story by
 * themselves once the card has played it (site.css, Motion), and wait for it before.
 */
function drawBoard(facts: Facts): void {
  board.race.textContent = facts.first < 0 ? `nobody finishes in a ${facts.video} s video` : `${facts.race.toFixed(1)} s of a ${facts.video} s video`;
  if (facts.first < 0) return;
  const lanes = [facts.first, 1 - facts.first].map((k, place) => {
    const ball = facts.balls[k];
    const lane = el('span', 'lane');
    lane.style.setProperty('--c', ball.color);
    lane.style.setProperty('--w', place ? `${Math.round(facts.runnerUp * 100)}%` : '100%');
    lane.append(el('i'), el('b', '', ball.name), el('em', '', place ? `${marginLabel(facts.margin)} behind` : 'wins'));
    return lane;
  });
  board.lanes.replaceChildren(...lanes, el('span', 'finish-line'));
  const t = facts.race;
  board.ruler.replaceChildren(...[0, Math.round(t / 3), Math.round((2 * t) / 3)].map((s) => el('i', '', `${s} s`)), el('i', '', `${t.toFixed(1)} s`));
}

/** `work`, timed as a `steps …` measure in the Performance panel (docs/website.md §6 says what each costs). */
function timed<T>(name: string, work: () => T): T {
  const t0 = performance.now();
  const out = work();
  performance.measure(`steps ${name}`, { start: t0, duration: performance.now() - t0 });
  return out;
}

/**
 * The phone first, the words a task later, each in a task of its own after the balancing that
 * made the matchup: at 90 s on a slow phone, any two of them together were a long task.
 */
async function play(module: HeroModule, demo: Phone, cfg: Config): Promise<void> {
  steps = cfg;
  await nextTask();
  if (steps !== cfg) return;
  const outcome = timed('show', () => demo.show(cfg));
  await nextTask();
  if (steps === cfg) timed('facts', () => describeSteps(module, cfg, outcome));
}

let rolling = false;
how.roll.addEventListener('click', async () => {
  // Not disabled while the engine loads: a disabled button drops the keyboard's focus.
  if (rolling) return;
  rolling = true;
  try {
    const { module, demo } = await start();
    await play(
      module,
      demo,
      timed('roll', () => module.rollMatchup(settings())),
    );
  } finally {
    rolling = false;
  }
});

/**
 * The same matchup balanced to the new settings: its own race first, then up to eight new races
 * of it, one a frame, so a matchup that does not fit never holds the page up (a balance that
 * fails costs a few milliseconds). A newer change takes over from an older one still trying.
 */
let refits = 0;
async function refit(): Promise<void> {
  const run = ++refits;
  const { module, demo } = await start();
  const s = settings();
  for (let attempt = 0; attempt < 9 && steps; attempt++) {
    if (run !== refits) return;
    const from = steps;
    const next = timed('refit', () => module.refit(from, s, attempt));
    if (next) return play(module, demo, next);
    await new Promise(requestAnimationFrame);
  }
  if (run === refits) how.verdict.textContent = `This matchup does not fit a ${s.video} s video: roll another.`;
}

let refitTimer = 0;
/** Dragging a slider fires dozens of changes: balance once the thumb stops, as the studio does. */
function refitSoon(): void {
  window.clearTimeout(refitTimer);
  refitTimer = window.setTimeout(() => void refit(), 200);
}

/** Length and Finish gap live twice, in step 2 and on the race board: one moved moves the other. */
function setLength(video: number): void {
  for (const [range, out] of [
    [how.length, how.lengthOut],
    [board.length, board.lengthOut],
  ] as const) {
    range.value = String(video);
    range.setAttribute('aria-valuetext', `${video} seconds`);
    out.textContent = `${video} s`;
  }
  how.lengthFact.textContent = `${video.toFixed(1)} s`;
  caption(steps);
}

function setGap(gap: number): void {
  for (const [range, out] of [
    [how.gap, how.gapOut],
    [board.gap, board.gapOut],
  ] as const) {
    range.value = String(gap);
    range.setAttribute('aria-valuetext', gap > 0 ? `${gap} seconds` : 'photo finish');
    out.textContent = gapLabel(gap);
  }
}

for (const range of [how.length, board.length]) {
  range.addEventListener('input', () => {
    setLength(Number(range.value));
    refitSoon();
  });
}
for (const range of [how.gap, board.gap]) {
  range.addEventListener('input', () => {
    setGap(Number(range.value));
    refitSoon();
  });
}

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="how-look"]')) {
  input.addEventListener('change', async () => {
    caption(steps);
    const { module, demo } = await start();
    if (!steps) return;
    // A look changes only the drawing: the race in the phone goes on.
    steps = module.withLook(steps, input.value as Skin);
    demo.setLook(input.value as Skin);
    module.drawFirstFrame(how.post, steps);
  });
}

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="how-sound"]')) {
  input.addEventListener('change', () => {
    how.soundHint.textContent = SOUND_HINTS[input.value as Sound];
    // A narrator's winner line lengthens the card (pacing.ts cardSeconds), so the race is balanced again.
    void refit();
  });
}

// ── The cards on the stage ───────────────────────────────────────────────

const LOOK_WORDS: Record<Skin, string> = {
  paper: "Cream boxes in ink frames, glossy layers and glowing balls with trails, as the format's biggest channels draw it.",
  cards: "White cards with hard shadows, name pills and chips on a pastel page: BounceReel's own.",
  night: 'The same cards after dark: dark cards on a dusk-blue page.',
};
let lookShown: Skin = 'paper';
let lookPhone: Phone | null = null;

function writeLook(skin: Skin): void {
  lookShown = skin;
  $('#look-dialog-title').textContent = `The ${LOOK_LABELS[skin].toLowerCase()} look`;
  $('#look-dialog-text').textContent = LOOK_WORDS[skin];
}

/** A look larger, the steps' matchup playing in it; the phones behind wait (share). */
async function openLook(skin: Skin): Promise<void> {
  writeLook(skin);
  lookDialog.showModal();
  share();
  const { module } = await start();
  if (!steps || !lookDialog.open) return;
  const cfg = module.withLook(steps, skin);
  if (lookPhone) lookPhone.show(cfg);
  else {
    lookPhone = new module.Hero(lookCanvas, () => {}, cfg);
    phones.push([lookCanvas, lookPhone]);
  }
  share();
}

for (const tile of document.querySelectorAll<HTMLButtonElement>('.look-tile')) {
  tile.addEventListener('click', () => void openLook(tile.dataset.look as Skin));
}
for (const step of lookDialog.querySelectorAll<HTMLButtonElement>('[data-step]')) {
  step.addEventListener('click', () => {
    writeLook(LOOKS[(LOOKS.indexOf(lookShown) + Number(step.dataset.step) + LOOKS.length) % LOOKS.length]);
    lookPhone?.setLook(lookShown);
  });
}
$('#look-close').addEventListener('click', () => lookDialog.close());
lookDialog.addEventListener('close', share);
// A press on the backdrop closes it, as Escape does: outside the box, not on its padding (and not
// a key's click on a button inside, which comes at 0, 0).
lookDialog.addEventListener('click', (e) => {
  const box = lookDialog.getBoundingClientRect();
  const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
  if (e.target === lookDialog && outside) lookDialog.close();
});

const POWER_WORDS: Record<string, string> = {
  faster: 'Every floor hit makes it faster.',
  slower: 'Every floor hit makes it slower.',
  grow: 'Every floor hit makes it bigger.',
  split: 'Every floor hit splits off another ball.',
};

/**
 * What a power does, sketched: a ball in a box hits the floor again and again, and every floor hit
 * does what the picked tag says. A few circles on a small canvas, not the engine: the race engine
 * is the phones'. It runs only while the card is on screen and starts over every few seconds;
 * under reduced motion it is one still, the ball a few hits in.
 */
function powerDemo(): void {
  const canvas = $<HTMLCanvasElement>('#power-demo');
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const floor = height - 40;
  let power = checked('power');
  let balls: { x: number; y: number; vx: number; vy: number; r: number }[] = [];
  let age = 0;
  const reset = () => {
    balls = [{ x: 110, y: 70, vx: 210, vy: 260, r: 15 }];
    age = 0;
  };
  const hit = (ball: (typeof balls)[number]) => {
    const k = power === 'faster' ? 1.16 : power === 'slower' ? 0.86 : 1;
    ball.vx *= k;
    ball.vy *= k;
    if (power === 'grow') ball.r = Math.min(42, ball.r + 4);
    // A twin the other way, as a split ball's newborn leaves in its own direction.
    if (power === 'split' && balls.length < 8) balls.push({ ...ball, vx: -ball.vx * 0.9 });
  };
  const advance = (dt: number) => {
    age += dt;
    for (const ball of [...balls]) {
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      if (ball.x < ball.r || ball.x > width - ball.r) ball.vx = Math.sign(width / 2 - ball.x) * Math.abs(ball.vx);
      if (ball.y < ball.r) ball.vy = Math.abs(ball.vy);
      if (ball.y > floor - ball.r) {
        ball.vy = -Math.abs(ball.vy);
        hit(ball);
      }
      ball.x = Math.min(width - ball.r, Math.max(ball.r, ball.x));
      ball.y = Math.min(floor - ball.r, Math.max(ball.r, ball.y));
    }
    if (age > 6.5) reset();
  };
  const draw = () => {
    ctx.clearRect(0, 0, width, height);
    // The floor: a layer in the rival's sky blue, as the video draws it.
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.roundRect(18, floor, width - 36, 18, 6);
    ctx.fill();
    for (const ball of balls) {
      ctx.shadowColor = 'rgb(124 77 255 / 0.8)';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#7c4dff';
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgb(255 255 255 / 0.55)';
      ctx.beginPath();
      ctx.arc(ball.x - ball.r * 0.35, ball.y - ball.r * 0.35, ball.r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const still = () => {
    reset();
    for (let i = 0; i < 150; i++) advance(1 / 60);
    draw();
  };

  let visible = false;
  let last = 0;
  const frame = (now: number) => {
    if (!visible || document.hidden) {
      last = 0;
      return;
    }
    advance(last ? Math.min(0.05, (now - last) / 1000) : 0);
    last = now;
    draw();
    requestAnimationFrame(frame);
  };
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="power"]')) {
    input.addEventListener('change', () => {
      power = input.value;
      $('#power-hint').textContent = POWER_WORDS[power];
      if (reducedMotion) still();
      else reset();
    });
  }
  if (reducedMotion) return still();
  reset();
  draw();
  new IntersectionObserver(([entry]) => {
    const was = visible;
    visible = entry.isIntersecting;
    if (visible && !was) requestAnimationFrame(frame);
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visible) requestAnimationFrame(frame);
  });
}

/**
 * Workers Assets answer a Range request with the whole file (200), and Safari plays a video or a
 * sound only from range answers (206): served as they are, the gallery and the opening would not
 * play there at all. So the page fetches each file whole, once, when it is first wanted, and plays
 * it from a blob URL, which needs no ranges. The returned function resolves once `src` is set.
 */
function wholeFile(media: HTMLMediaElement, url: string): () => Promise<void> {
  let ready: Promise<void> | null = null;
  return () =>
    (ready ??= fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${url}: ${r.status}`))))
      .then((blob) => {
        media.src = URL.createObjectURL(blob);
      })
      .catch((err: unknown) => {
        ready = null;
        throw err;
      }));
}

/**
 * The gallery: real videos, each playing (muted, looping) only while it is half on screen, and
 * its button to pause it, after which the screen does not start it again. Without JS each keeps
 * the browser's own controls; under reduced motion nothing starts by itself, the button plays it.
 * Leaving the screen pauses a video either way. The button says what is wanted, so it answers
 * at once while the file is still on its way.
 */
function gallery(): void {
  for (const phone of document.querySelectorAll<HTMLElement>('.gallery-phone')) {
    const video = phone.querySelector('video')!;
    const press = phone.querySelector<HTMLButtonElement>('.gallery-play')!;
    const load = wholeFile(video, video.src);
    video.controls = false;
    press.hidden = false;
    let wanted = false;
    let held = false;
    const want = (on: boolean) => {
      wanted = on;
      press.setAttribute('aria-pressed', String(on));
      if (!on) video.pause();
      else
        load()
          .then(() => (wanted ? video.play() : undefined))
          .catch(() => want(false));
    };
    press.addEventListener('click', () => {
      held = wanted;
      want(!wanted);
    });
    // A pause that is not the page's (the system's media controls) shows on the button too.
    video.addEventListener('pause', () => wanted && want(false));
    // The ratio, not isIntersecting: that is already true at the first pixel on screen.
    new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio < 0.5) want(false);
        else if (!held && !reducedMotion) want(true);
      },
      { threshold: 0.5 },
    ).observe(video);
  }
}

/** The opening as Kokoro says it, a file made once (public/voice/), fetched on the first press. */
function voicePlayer(): void {
  const voice = $('#voice');
  const press = $<HTMLButtonElement>('#voice-play');
  const audio = $<HTMLAudioElement>('#voice-audio');
  const load = wholeFile(audio, audio.dataset.src!);
  let wanted = false;
  const show = (on: boolean) => {
    wanted = on;
    press.setAttribute('aria-pressed', String(on));
    voice.classList.toggle('playing', on);
  };
  press.addEventListener('click', () => {
    show(!wanted);
    if (!wanted) return audio.pause();
    // Safari lets an element play outside a press only once it was asked to inside one. Asked
    // here, before the file has arrived, it plays nothing yet, and the play() after the fetch
    // is allowed.
    if (!audio.src) audio.play().catch(() => {});
    load()
      .then(() => (wanted ? audio.play() : undefined))
      .catch(() => show(false));
  });
  // Setting `src` stops the early play() without a pause event, so a pause is always a real one.
  for (const type of ['pause', 'ended']) audio.addEventListener(type, () => show(false));
}

/**
 * What the free plan makes, written from its features, so the steps never promise it more than
 * the studio gives; the clause about the paid plans only when one of them makes everything here.
 */
function freeLine(plans: PublicPlan[]): string | null {
  const free = plans.find((p) => p.isDefault)?.features;
  if (!free) return null;
  const looks = free.looks.map((look) => LOOK_LABELS[look].toLowerCase());
  const sound = soundAllowed(free, 'narrator') ? 'a narrator, music or silence' : soundAllowed(free, 'music') ? 'music or silence' : 'no sound';
  const everything = plans.some(
    (p) => !p.isDefault && p.features.maxSeconds >= MAX_VIDEO_SECONDS && p.features.looks.length === LOOKS.length && soundAllowed(p.features, 'narrator'),
  );
  return (
    `The free plan makes up to ${free.maxSeconds} s in the ${looks.join(' and ')} look${looks.length === 1 ? '' : 's'}, with ${sound}` +
    (everything ? '; the paid plans make all of this.' : '.')
  );
}

/**
 * The drawings that tell a story (`data-story`: the race board's lanes) play
 * once, on their own clock, when their card is half in view: scrubbed by the scroll, they had
 * finished before the reader got to them. Armed only here, so without JS, an observer or motion
 * they simply stand finished (site.css, Motion).
 */
function playStories(): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-story]');
  if (reducedMotion || !('IntersectionObserver' in window) || !cards.length) return;
  document.documentElement.dataset.stories = '';
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // Half the card, or half the screen for a card taller than it.
        if (entry.intersectionRect.height < Math.min(entry.boundingClientRect.height, innerHeight) / 2) continue;
        entry.target.classList.add('played');
        observer.unobserve(entry.target);
      }
    },
    { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
  );
  for (const card of cards) observer.observe(card);
}

playStories();
powerDemo();
voicePlayer();
gallery();
void renderPlans().then((data) => {
  const line = data && freeLine(data.plans);
  if (line) how.free.textContent = line;
});
