// The public site's fixed facts, read by the Worker (mails), the pages and vite.config.ts (which
// writes them into the HTML). One place each, so a change of address is one line.

/**
 * The canonical address: canonical links, Open Graph, the legal pages, the watermark on free
 * videos, links in mails from production. SITE_URL in wrangler.jsonc names it too, and
 * PRODUCTION_URL in scripts/admin.mjs (docs/build-and-deploy.md §5).
 */
export const SITE_URL = 'https://bouncereel.com';

/**
 * Whether search engines may list the public pages. Off, every page would carry a robots
 * `noindex, nofollow` (vite.config.ts); public/_headers, public/robots.txt and
 * public/sitemap.xml have to agree with it (docs/website.md §7).
 */
export const INDEXED = true;

/**
 * Whether anyone may create an account. Off while the site is being finished: the Worker refuses
 * POST /api/auth/signup (403 signups_closed), the build keeps the "Coming soon" side of every
 * `data-signups` pair in the HTML (vite.config.ts), and the pricing cards say "Coming soon" to a
 * guest (src/site/pricing.ts). Signing in, the studio, the admin area and the accounts there are
 * untouched. Opening is this line, then the checks and the deploy in
 * docs/accounts-and-billing.md §1 ("Sign-ups closed").
 */
export const SIGNUPS_OPEN = false;

/** The site's host, as text: the watermark, the legal pages. */
export const SITE_HOST = new URL(SITE_URL).host;

/**
 * The address for questions, shown in the footer, the legal pages and every mail (as Reply-To).
 * Cloudflare Email Routing forwards it to Vuk's own mailbox; there is no mailbox on the domain.
 */
export const CONTACT_EMAIL = 'hello@bouncereel.com';

/**
 * Who runs BounceReel: the controller the privacy page names and the party the terms are with.
 * TODO(owner): confirm both. If BounceReel is run by a registered business (a preduzetnik or a
 * company), its registered name, address and registration number (matični broj, PIB) go here
 * instead.
 */
export const OPERATOR_NAME = 'Vuk Cvetković';
export const OPERATOR_PLACE = 'Niš, Serbia';

/**
 * Where to go after signing in: `next` if it is a path on this site, else null. Only a path
 * that resolves to the same origin passes, so `?next=//evil.example` or `?next=https://…`
 * cannot send someone off the site after they typed their password.
 */
export function safeNext(next: string | null, origin: string): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  try {
    const target = new URL(next, origin);
    return target.origin === origin ? target.pathname + target.search + target.hash : null;
  } catch {
    return null;
  }
}
