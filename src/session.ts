import type { AccountResponse } from '../shared/api.ts';
import { api, ApiError } from './api.ts';

// The signed-in account, for the pages behind the sign-in (the studio, Videos, the account page,
// the admin area). The Worker only serves those pages to a signed-in browser (worker/pages.ts);
// a session that ends while one is open (expired, signed out elsewhere, suspended) lands here.

/** Sends the visitor to the login page, which brings them back here afterwards. */
export function toLogin(): never {
  location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  throw new ApiError(401, 'unauthenticated', 'Sign in first');
}

/** GET /api/account; a page whose session has ended goes to the login page instead. */
export async function loadAccount(): Promise<AccountResponse> {
  try {
    return await api<AccountResponse>('GET', '/api/account');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) toLogin();
    throw err;
  }
}

/**
 * Saved settings that belong to one account and leave this browser with it: the studio's
 * config and whether its first-visit hint was seen. The theme and the dice's switch stay; they
 * are the device's.
 */
export function forgetAccount(id: number): void {
  try {
    localStorage.removeItem(`bouncereel:config:v1:${id}`);
    localStorage.removeItem(`bouncereel:hints:v1:${id}`);
  } catch {
    // Storage unavailable: there is nothing saved to forget.
  }
}

/** Signs out of this browser and goes to the home page. */
export async function logout(id: number): Promise<void> {
  forgetAccount(id);
  await api('POST', '/api/auth/logout').catch(() => undefined);
  location.assign('/');
}
