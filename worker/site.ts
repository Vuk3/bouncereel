import { HttpError } from './lib/http.ts';
import { log } from './lib/log.ts';

// The one setting the Worker needs in production: the site's own address, SITE_URL in
// wrangler.jsonc ("https://bouncereel.vukcvetkovic.com"). Links in mails are built from it, never from the
// request, so nothing a caller sends can point a password link at another site.
//
// It fails closed: without SITE_URL, every request the Worker answers in production is a 500,
// never a half-configured site.

/**
 * Dev and preview run on these. Cloudflare routes requests to the Worker by host name, and
 * production requests never carry them, so they cannot be used to change how it behaves.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocal(url: URL): boolean {
  return LOCAL_HOSTS.has(url.hostname);
}

/** The site's origin, for links that leave it (mails). Locally, wherever the dev server runs. */
export function siteOrigin(env: Env, url: URL): string {
  if (isLocal(url)) return url.origin;
  const site = env.SITE_URL.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(site)) {
    log('error', 'SITE_URL is not configured', { site: Boolean(site) });
    throw new HttpError(500, 'not_configured', 'The site stays closed until SITE_URL is set (docs/build-and-deploy.md).');
  }
  return site;
}
