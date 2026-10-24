// The public site's fixed facts, read by the Worker (mails), the pages and vite.config.ts (which
// writes them into the HTML). One place each, so a change of address is one line.

/**
 * The canonical address: canonical links, Open Graph, the legal pages, the watermark on free
 * videos, links in mails from production. A subdomain of vukcvetkovic.com for now; the site moves
 * to its own domain once it is the full product (docs/build-and-deploy.md §5: SITE_URL in
 * wrangler.jsonc names it too).
 */
export const SITE_URL = 'https://bouncereel.vukcvetkovic.com';

/**
 * Whether search engines may list the public pages. Off while the site is on the subdomain:
 * every page carries a robots `noindex, nofollow` (vite.config.ts), and public/_headers and
 * public/robots.txt say the same, which turning it on has to undo (docs/website.md §7).
 */
export const INDEXED = false;

/** The site's host, as text: the watermark, the legal pages. */
export const SITE_HOST = new URL(SITE_URL).host;

/** The address for questions, shown in the footer, the legal pages and every mail: Vuk's own, as on vukcvetkovic.com. */
export const CONTACT_EMAIL = 'vuk@vukcvetkovic.com';

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
