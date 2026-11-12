import type { PlansResponse } from '../../shared/api.ts';
import { api } from '../api.ts';
import './chrome.ts';
import { fillGamePlans } from './pricing.ts';

// /games: each game's card says which plans make it, from the plans the site lists (GET /api/plans),
// so it follows what the admin area sets. Until they load, or if they do not, a card keeps the
// words written in games.html.
void api<PlansResponse>('GET', '/api/plans')
  .then(fillGamePlans)
  .catch(() => undefined);
