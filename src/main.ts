import type { PlansResponse } from '../shared/api.ts';
import { api } from './api.ts';
import { App } from './app.ts';
import { loadAccount } from './session.ts';

// The studio starts once it knows the account: its plan decides what is enabled. The plans the
// pricing page lists come alongside, so what the plan holds back can say what the paid ones add;
// without them it only says what is not in the plan.
const plans = api<PlansResponse>('GET', '/api/plans').then(
  (r) => r.plans,
  () => null,
);
void Promise.all([loadAccount(), plans]).then(([account, list]) => new App(account, list));
