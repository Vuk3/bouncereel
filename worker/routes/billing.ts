import { HttpError } from '../lib/http.ts';
import type { RouteContext } from './context.ts';

// The payment skeleton: the three routes a provider needs, answering that billing is not
// configured. docs/accounts-and-billing.md says exactly where a provider plugs in. Until then
// the admin area's manual plan changes are the only way a plan changes.

/**
 * TODO(vuk): true once a payment provider is connected (and the three routes below do their
 * job). GET /api/plans and GET /api/account send it, and every Upgrade button reads
 * "Upgrades open soon" and stays disabled while it is false.
 */
export const BILLING = false;

function notConfigured(): HttpError {
  return new HttpError(501, 'billing_not_configured', 'Payments are not set up yet: upgrades open soon.');
}

/**
 * POST /api/billing/checkout { planId }: will create the provider's checkout session for the
 * signed-in account and answer { url } to redirect to.
 */
export async function checkout(_: RouteContext): Promise<Response> {
  throw notConfigured();
}

/** POST /api/billing/portal: will answer { url } of the provider's page for managing the subscription. */
export async function portal(_: RouteContext): Promise<Response> {
  throw notConfigured();
}

/**
 * POST /api/billing/webhook: the provider's events. Outside the session check and the
 * same-origin check (router.ts): the provider is neither signed in nor on this origin. Its
 * signature, checked with WebCrypto, will be the only thing it is trusted by.
 */
export async function webhook(_: RouteContext): Promise<Response> {
  throw notConfigured();
}
