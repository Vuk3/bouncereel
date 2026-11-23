import type { PlansResponse } from '../../shared/api.ts';
import { api } from '../api.ts';
import './chrome.ts';
import { gallery } from './gallery.ts';
import { fillGamePlans } from './pricing.ts';

// A game's own page (games/ball-race.html, arena-clash.html, goal-rush.html; docs/website.md §4).
// Which plans make the game comes from the plans the site lists (GET /api/plans), as on /games.
// Every element with `data-play` is a phone playing the game in the studio's own engine (hero.ts,
// arena.ts, pitch.ts; the kits everyone's videos have), `data-first` the showcase it opens on, so
// two phones on a page never play the same match; what it plays goes in its figure's caption.
// Each runs only while it is on screen, loads only after the page has, and never under
// prefers-reduced-motion, where the still frames stay. The recorded clips play as the home page's.

void api<PlansResponse>('GET', '/api/plans')
  .then(fillGamePlans)
  .catch(() => undefined);

gallery();

async function play(): Promise<void> {
  // A canvas never loads a web font by itself: without this the games would draw in the fallback font.
  await Promise.all([600, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px Rubik`)));
  for (const phone of document.querySelectorAll<HTMLElement>('[data-play]')) {
    const canvas = phone.querySelector('canvas')!;
    const note = phone.closest('figure')?.querySelector('.game-demo-note');
    const say = (text: string) => {
      if (note) note.textContent = text;
    };
    const first = Number(phone.dataset.first ?? 0);
    if (phone.dataset.play === 'race') {
      const race = await import('./hero.ts');
      new race.Hero(canvas, (cfg) => say(race.describeRace(cfg)));
    } else if (phone.dataset.play === 'battle') {
      const arena = await import('./arena.ts');
      new arena.ArenaDemo(canvas, (cfg) => say(arena.describeBattle(cfg)), first);
    } else if (phone.dataset.play === 'match') {
      const pitch = await import('./pitch.ts');
      new pitch.PitchDemo(canvas, (cfg) => say(pitch.describeMatch(cfg)), first);
    }
  }
}

if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const later = () => ('requestIdleCallback' in window ? requestIdleCallback(() => void play(), { timeout: 2000 }) : setTimeout(() => void play(), 200));
  if (document.readyState === 'complete') later();
  else addEventListener('load', later, { once: true });
}
