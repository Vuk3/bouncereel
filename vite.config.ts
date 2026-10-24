import { cloudflare } from '@cloudflare/vite-plugin';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { CONTACT_EMAIL, INDEXED, OPERATOR_NAME, OPERATOR_PLACE, SITE_HOST, SITE_URL } from './shared/site.ts';

// Cross-origin isolation lets the Kokoro voice model run ONNX on all CPU cores
// (it needs SharedArrayBuffer); without it, it runs on one and a 20-second
// opening takes minutes to generate. "credentialless" keeps the CORS fetches
// (the voice model, from Hugging Face) working without them sending CORP headers.
// These cover the Vite servers; in production public/_headers sends the same two
// (and worker/pages.ts on the pages behind the sign-in).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Every page, one HTML file each: the file's path is its URL without `.html` (Workers Assets). */
const PAGES = {
  // The public site (src/site/).
  home: 'index.html',
  pricing: 'pricing.html',
  login: 'login.html',
  signup: 'signup.html',
  forgot: 'forgot.html',
  reset: 'reset.html',
  verify: 'verify.html',
  terms: 'terms.html',
  privacy: 'privacy.html',
  refunds: 'refunds.html',
  notFound: '404.html',
  // Behind the sign-in (worker/pages.ts checks it before serving them).
  studio: 'app.html',
  videos: 'app/videos.html',
  account: 'account.html',
  admin: 'admin.html',
  adminUsers: 'admin/users.html',
  adminUser: 'admin/user.html',
  adminPlans: 'admin/plans.html',
  adminLog: 'admin/log.html',
};

function partial(name: string): string {
  return readFileSync(new URL(`./src/site/partials/${name}.html`, import.meta.url), 'utf8');
}

const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The pages' shared parts, written in at build time (and on every request in dev), so a page
 * is complete HTML for a crawler and the first paint, with no framework:
 *
 *   <!-- site:head /pricing -->   the head every public page shares: canonical URL, Open Graph
 *                                 and Twitter tags built from its own <title> and description,
 *                                 the font, the theme boot, the stylesheet. Add `noindex` after
 *                                 the path for a page search engines should not list; while
 *                                 INDEXED is off, every page is `noindex, nofollow`.
 *   <!-- site:header -->, <!-- site:footer -->   the public site's header and footer
 *   <!-- app:head -->, <!-- app:theme -->, <!-- admin:nav -->   the same for the pages behind
 *                                 the sign-in (account, admin), which use the studio's styles
 *
 * `order: 'pre'` runs it before Vite reads the HTML, so the stylesheet and scripts the partials
 * name are bundled like any other.
 */
function sitePartials(): Plugin {
  return {
    name: 'bouncereel-site-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? 'BounceReel';
        const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
        return html
          .replace(/<!-- site:head (\/\S*)( noindex)? -->/, (_, path: string, noindex?: string) =>
            partial('head')
              .replaceAll('%URL%', `${SITE_URL}${path === '/' ? '/' : path}`)
              .replaceAll('%TITLE%', escapeAttr(title))
              .replaceAll('%DESCRIPTION%', escapeAttr(description))
              .replace('%ROBOTS%', !INDEXED ? '<meta name="robots" content="noindex, nofollow" />' : noindex ? '<meta name="robots" content="noindex" />' : ''),
          )
          .replace('<!-- site:header -->', partial('header'))
          .replace('<!-- site:footer -->', partial('footer'))
          .replace('<!-- app:head -->', partial('app-head'))
          .replace('<!-- admin:nav -->', partial('admin-nav'))
          .replace('<!-- app:theme -->', partial('theme-button'))
          .replaceAll('%SITE_URL%', SITE_URL)
          .replaceAll('%SITE_HOST%', SITE_HOST)
          .replaceAll('%CONTACT_EMAIL%', CONTACT_EMAIL)
          .replaceAll('%OPERATOR_NAME%', OPERATOR_NAME)
          .replaceAll('%OPERATOR_PLACE%', OPERATOR_PLACE);
      },
    },
  };
}

export default defineConfig({
  // Many pages and no SPA fallback, as in production: /pricing is pricing.html.
  appType: 'mpa',
  // The Worker (/api, the pages behind the sign-in) and its local D1 run inside the dev and preview servers.
  plugins: [sitePartials(), cloudflare()],
  server: { headers: isolation },
  preview: { headers: isolation },
  // Stored with every recorded video (src/library.ts).
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    // The Kokoro voice chunk (~2 MB, plus its ONNX wasm) is loaded only when
    // Kokoro is picked as the narrator; the app itself is ~70 kB.
    chunkSizeWarningLimit: 2500,
  },
  environments: {
    // The pages only: a top-level `build.rolldownOptions.input` is inherited by the
    // Worker's environment too, which then fails to build the HTML as a module.
    client: {
      // STILLS=1 adds the page that draws the site's images (scripts/stills.html, docs/website.md).
      build: {
        rolldownOptions: { input: process.env.STILLS ? { ...PAGES, stills: 'scripts/stills.html' } : PAGES },
      },
    },
  },
});
