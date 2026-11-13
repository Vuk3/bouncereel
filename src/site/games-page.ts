import type { PlansResponse } from '../../shared/api.ts';
import { api } from '../api.ts';
import './chrome.ts';
import { fillGamePlans } from './pricing.ts';

// /games: each game's section says which plans make it, from the plans the site lists (GET
// /api/plans), so it follows what the admin area sets; until they load, or if they do not, it keeps
// the words written in games.html. Each section's phone plays its game, the studio's own engine as
// on the home page: the race (hero.ts, the built-in matchups through the three looks) and the
// Arena Clash (arena.ts). Each runs only while it is on screen, loads only after the page has, and
// never under prefers-reduced-motion, where the still frames stay.
void api<PlansResponse>('GET', '/api/plans')
  .then(fillGamePlans)
  .catch(() => undefined);

async function play(): Promise<void> {
  // A canvas never loads a web font by itself: without this the games would draw in the fallback font.
  await Promise.all([600, 700, 800, 900].map((w) => document.fonts.load(`${w} 40px Rubik`)));
  const [race, arena] = await Promise.all([import('./hero.ts'), import('./arena.ts')]);
  const raceCanvas = document.querySelector('#race-phone canvas') as HTMLCanvasElement;
  const arenaCanvas = document.querySelector('#arena-phone canvas') as HTMLCanvasElement;
  new race.Hero(raceCanvas, (cfg) => (document.querySelector('#race-note')!.textContent = race.describeRace(cfg)));
  new arena.ArenaDemo(arenaCanvas, (cfg) => (document.querySelector('#arena-note')!.textContent = arena.describeBattle(cfg)));
}

if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const later = () => ('requestIdleCallback' in window ? requestIdleCallback(() => void play(), { timeout: 2000 }) : setTimeout(() => void play(), 200));
  if (document.readyState === 'complete') later();
  else addEventListener('load', later, { once: true });
}
