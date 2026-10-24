import type { PlansResponse } from '../../shared/api.ts';
import { json } from '../lib/http.ts';
import { selectPublicPlans } from '../plans.ts';
import { BILLING } from './billing.ts';
import type { RouteContext } from './context.ts';

/** GET /api/plans: the pricing page's plans. Public. */
export async function listPlans({ env }: RouteContext): Promise<Response> {
  const body: PlansResponse = { plans: await selectPublicPlans(env.DB), billing: BILLING };
  return json(body);
}
