import { safeNext } from '../shared/site.ts';
import { clearSessionCookies, currentUser, hasHint } from './auth/session.ts';
import { siteOrigin } from './site.ts';

// The pages behind the sign-in, checked before Workers Assets serves them (`run_worker_first` in
// wrangler.jsonc), so a signed-out visitor is sent to the login page and never sees the studio,
// the account page or the admin area flash first. The API checks the session again on every
// request: this only decides which page to show.
//
//   /app, /app/*, /account   any signed-in account; otherwise /login?next=<where they were going>
//   /admin, /admin/*         a superadmin; anyone else gets the 404 page, as if it were not there
//   /login, /signup          signed out only; a signed-in visitor goes on to `next` or the studio

const GUARDED = /^\/(app|account|admin)(\/|$)/;
const ADMIN = /^\/admin(\/|$)/;
const GUEST_ONLY = /^\/(login|signup)\/?$/;

/** The headers a page behind the sign-in carries, whatever public/_headers says. */
function privatePage(response: Response, status = response.status): Response {
  const page = new Response(response.body, { status, headers: response.headers });
  // Personal: never kept by a shared cache, never shown by one to someone signed out.
  page.headers.set('Cache-Control', 'private, no-store');
  page.headers.set('X-Robots-Tag', 'noindex, nofollow');
  // The studio runs Kokoro, which needs cross-origin isolation (docs/build-and-deploy.md).
  page.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  page.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return page;
}

function redirect(url: URL, to: string, cookies: [string, string][] = []): Response {
  const headers = new Headers([['Location', new URL(to, url.origin).href], ['Cache-Control', 'no-store'], ...cookies]);
  return new Response(null, { status: 302, headers });
}

export function isPage(url: URL): boolean {
  return GUARDED.test(url.pathname) || GUEST_ONLY.test(url.pathname);
}

export async function handlePage(request: Request, env: Env, url: URL): Promise<Response> {
  siteOrigin(env, url);
  const user = await currentUser(request, env.DB, new Date());
  // A hint cookie left by a session that has ended is cleared on the way, so the home page stops
  // offering "Open studio".
  const stale = !user && hasHint(request) ? clearSessionCookies(url) : [];

  if (GUEST_ONLY.test(url.pathname)) {
    if (user) return redirect(url, safeNext(url.searchParams.get('next'), url.origin) ?? '/app');
    const page = await env.ASSETS.fetch(request);
    if (!stale.length) return page;
    const response = new Response(page.body, page);
    for (const [name, value] of stale) response.headers.append(name, value);
    return response;
  }

  if (!user) return redirect(url, `/login?next=${encodeURIComponent(url.pathname + url.search)}`, stale);
  if (ADMIN.test(url.pathname) && user.role !== 'superadmin') {
    return privatePage(await env.ASSETS.fetch(new Request(new URL('/404', url.origin), request)), 404);
  }
  return privatePage(await env.ASSETS.fetch(request));
}
