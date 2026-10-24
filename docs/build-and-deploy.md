# Build and deploy

How BounceReel runs on Cloudflare: the Worker and its local D1 in dev, the settings and
secrets it needs, the headers Kokoro needs on every page, which pages search engines may
list, the production cut-over to `bouncereel.vukcvetkovic.com` and the later move to the site's
own domain, releases, and the free plan's limits.
Accounts and the session check themselves: [accounts-and-billing](./accounts-and-billing.md).

| I need to change... | Touch |
| --- | --- |
| a script | [package.json](../package.json) |
| the Worker's config: domain, D1, vars, assets, which paths reach the Worker first | [wrangler.jsonc](../wrangler.jsonc), then `npm run cf-typegen` |
| a header on the pages or their files | [public/_headers](../public/_headers) (production), [vite.config.ts](../vite.config.ts) (dev and preview), [worker/pages.ts](../worker/pages.ts) (the pages behind the sign-in) |
| what search engines may list (nothing, for now) | `INDEXED` in [shared/site.ts](../shared/site.ts), [public/robots.txt](../public/robots.txt), [public/_headers](../public/_headers) ([website](./website.md#7-search-engines)) |
| a secret | `npx wrangler secret put NAME`, declared in [worker/env.d.ts](../worker/env.d.ts) |
| the build: pages, the Worker, the version | [vite.config.ts](../vite.config.ts) |
| the release flow | [release.js](../release.js) |
| the API and the database | [video-library.md](./video-library.md), [accounts-and-billing.md](./accounts-and-billing.md) |

## 1. Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Vite + the Worker + local D1 on http://localhost:5173 (applies local migrations first, `predev`) |
| `npm run check` | `tsc` for the pages, then `tsc -p worker` for the Worker: **the gate** |
| `npm run build` | `check`, then `vite build`: the pages into `dist/client/`, the Worker into `dist/bouncereel/` |
| `npm run preview` | build, then serve the production bundle with the Worker and local D1 |
| `npm run deploy` | build, **apply pending migrations to production D1**, `wrangler deploy` |
| `npm run db:migrate:local` / `:remote` | apply migrations only |
| `npm run admin -- <email> [--remote]` | make a superadmin: prints a one-time link to set the password ([accounts-and-billing](./accounts-and-billing.md#1-accounts-and-roles)) |
| `npm run cf-typegen` | regenerate [worker-configuration.d.ts](../worker-configuration.d.ts) after changing `wrangler.jsonc` |
| `npm run release -- patch\|minor\|major` | release `develop` to `main` (section 6) |
| `npm run tune` | the balance check ([development](./development.md#2-the-balance-check)) |

`@cloudflare/vite-plugin` puts the Worker inside Vite's dev and preview servers, so one
command serves the pages, `/api` and the database together, as production does. Only what
`run_worker_first` names reaches the Worker: `/api/*`, and the pages whose answer depends on
the session (`/app`, `/app/*`, `/account`, `/admin`, `/admin/*`, `/login`, `/signup`), which it
serves through the `ASSETS` binding once it has checked ([worker/pages.ts](../worker/pages.ts)).
Everything else is a file of the build, served by Workers Assets without running the Worker;
a path that matches no file gets `404.html` (`not_found_handling: "404-page"`). There is no SPA
fallback.

## 2. Local development

```sh
npm install
npm run dev                          # http://localhost:5173; applies local migrations first
npm run admin -- you@example.com     # a local superadmin: open the printed link, set a password
```

- **Signing up locally** works without mail: the confirmation and password links go to the
  dev server's output (`Mail is off (no RESEND_API_KEY); the link it would carry`).
- **The local database** lives in `.wrangler/state` (git-ignored). Query it with
  `npx wrangler d1 execute bouncereel --local --command "SELECT …"`.
  ⚠️ It holds the owner's real videos: reset it only on purpose
  (`rm -rf .wrangler/state && npm run db:migrate:local`). The videos recorded before accounts
  belong to nobody until the first local superadmin is made, which receives them.
- ⚠️ **The local database file is keyed by `database_id`** in
  [wrangler.jsonc](../wrangler.jsonc), not by its name. The id is a placeholder of zeros
  until `wrangler d1 create` prints the real one (section 5); replacing it opens a new,
  empty local database, and the old file stays in
  `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`.
- **On localhost the Worker relaxes two things, and only there** (it tells by host name,
  which Cloudflare never routes to it): `SITE_URL` is not required (links point at the dev
  server), and a mail that cannot be sent logs its link.
- **Local secrets go in `.env`** (git-ignored); Wrangler reads it when the dev server starts:
  `RESEND_API_KEY=re_…` to send real mail from dev. ⚠️ Never add a `.dev.vars`: when one exists,
  Wrangler reads it instead and ignores `.env` altogether.
- Agents do not run the dev server: they build and serve the production bundle on port
  4199 ([development](./development.md#4-checking-it-in-a-browser)).

## 3. Settings, headers and indexing

**Settings** ([wrangler.jsonc](../wrangler.jsonc) and secrets):

| Name | Kind | Without it |
| --- | --- | --- |
| `SITE_URL` | var, `https://bouncereel.vukcvetkovic.com` (the same as in shared/site.ts) | in production every request the Worker answers is a 500 `not_configured`: **it fails closed** ([worker/site.ts](../worker/site.ts)) |
| `RESEND_API_KEY` | secret | no mail is sent; the forgot form answers 503 in production; sign-up still works, the confirmation waits for the banner's button |
| `DB` | D1 binding | nothing works |
| `ASSETS` | assets binding | the pages behind the sign-in cannot be served |

**Cross-origin isolation on every page.** Kokoro runs ONNX on every CPU core only with
`SharedArrayBuffer`, which needs `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` on the page. Vite sends them in dev and
preview (`server.headers`, `preview.headers`); in production
[public/_headers](../public/_headers) does for every page and file Workers Assets serves, and
[worker/pages.ts](../worker/pages.ts) sets them again on the pages it serves. ⚠️ Without them
nothing fails loudly: Kokoro silently drops to one thread and an opening takes minutes.
`crossOriginIsolated` in the page's console says which it is. A consequence: **no page may
embed a third-party iframe or depend on a popup**.

`_headers` never applies to a Worker's own response, so the API sets its headers itself
([worker/lib/http.ts](../worker/lib/http.ts): `no-store`, `nosniff`, `noindex`).

**Kokoro's wasm fits.** `ort-wasm-simd-threaded.jsep.wasm` is 21,596,019 bytes (20.6 MiB);
Workers Assets takes up to 25 MiB a file and 20,000 files a version. Files under `/assets/`
carry a content hash and are cached as `immutable`; the fonts, the site's images, the home
page's narrator clip (`/voice/`) and its gallery's videos (`/gallery/`) for a week.

⚠️ **Workers Assets answer a Range request with the whole file** (200, never 206), and Safari
(Mac, iPhone, iPad) plays a `<video>` or `<audio>` only from range answers. So the home page
fetches its media whole and plays it from a blob URL (`wholeFile` in
[src/site/home.ts](../src/site/home.ts), [website](./website.md#4-the-home-page)); a video or sound
linked straight from `public/` would not play in Safari.

**Nothing is indexed for now** ([website](./website.md#7-search-engines)): every page is
`noindex, nofollow` (`INDEXED` off), every file answers `X-Robots-Tag: noindex, nofollow`, and
[robots.txt](../public/robots.txt) disallows everything. On the site's own domain it opens: the
public pages listed, everything behind the sign-in and the API still noindex.

`workers_dev` and `preview_urls` stay off: a `*.workers.dev` or preview URL would be a second
copy of the site under another name.

## 4. The pages behind the sign-in

`/app`, `/account` and `/admin` are served only after the Worker has checked the session (and
the role, for `/admin`); a signed-out visitor is sent to `/login?next=…` and never sees the
page first. The API checks the session again on every request. All of it, with the cookie,
the throttling and the order of the checks:
[accounts-and-billing](./accounts-and-billing.md#5-the-session-check).

## 5. The production cut-over

The first deploy of the public site, on **`bouncereel.vukcvetkovic.com`** for now, kept out of
search engines (the move to the site's own domain is at the end of this section). **The owner runs
these steps**; agents never deploy or run anything `--remote` without asking.

1. **The database**, if production has none yet: `npx wrangler login`, then
   `npx wrangler d1 create bouncereel`, and the printed `database_id` into
   [wrangler.jsonc](../wrangler.jsonc) in place of the zeros (⚠️ the local database follows the
   id: section 2).
2. **Mail**: `vukcvetkovic.com` is verified in Resend already (Hoops sends from it), so
   `npx wrangler secret put RESEND_API_KEY` with a key of that Resend account is all. The sender
   is `MAIL_FROM` ([worker/mail/resend.ts](../worker/mail/resend.ts),
   `BounceReel <bouncereel@vukcvetkovic.com>`), replies go to `CONTACT_EMAIL`
   ([shared/site.ts](../shared/site.ts), `vuk@vukcvetkovic.com`).
3. **Deploy**: `npm run deploy`. It builds, applies the migrations to the production database
   (the accounts and plans tables, an owner column on the videos), uploads the Worker and the
   files, and attaches `bouncereel.vukcvetkovic.com` as a custom domain (DNS record and
   certificate; the zone is in the account already). `SITE_URL` is already in
   [wrangler.jsonc](../wrangler.jsonc).
4. **The superadmin**: `npm run admin -- <your address> --remote`, then open the printed
   link and set the password. Making the first superadmin gives it the videos recorded before
   accounts.
5. **Sign in** on `https://bouncereel.vukcvetkovic.com/login`, open the studio and the Videos
   page, record something short, and open `/admin`.
6. **Check from a private window**: `https://bouncereel.vukcvetkovic.com/` shows the home page,
   `/app` goes to the login page, `/api/videos` answers 401 JSON, `/admin` goes to the login
   page, and `/robots.txt` disallows everything.

**Later, the move to the site's own domain** (as the full product). The database is tied to the
Worker (`database_id`), not to the domain: every account, password, video, plan and
subscription stays, and step 1 is not done again.

1. **The domain in Cloudflare**: add it as a zone in the account (Websites → Add a domain) and
   point the registrar's nameservers at Cloudflare; wait until it is Active. A redirect rule
   from `www.` to the apex if `www` should work.
2. **The address**: `SITE_URL` in [shared/site.ts](../shared/site.ts) (canonical links, Open
   Graph, the legal pages, the watermark on free videos) and in [wrangler.jsonc](../wrangler.jsonc)
   (links in mails) with its `routes` (keep the old one beside it while both should answer),
   `PRODUCTION_URL` in [scripts/admin.mjs](../scripts/admin.mjs); then the share image made again
   on the stills page ([website](./website.md#5-the-images)).
3. **Search engines**: open the site to them ([website](./website.md#7-search-engines): `INDEXED`,
   _headers, robots.txt, a sitemap).
4. **Mail**, if it should come from the new domain: verify it in Resend (its DNS records go in
   the new zone), then `MAIL_FROM` and, with a mailbox there (Cloudflare's Email Routing can
   forward one), `CONTACT_EMAIL`.
5. **Deploy**, then check as in steps 5 and 6 on the new address.
6. **The old address**: a 301 redirect from `bouncereel.vukcvetkovic.com` to the new domain (a
   redirect rule in the vukcvetkovic.com zone), and its custom domain removed from the Worker
   (Workers → bouncereel → Settings → Domains). ⚠️ The session cookie belongs to its host
   (`__Host-`), so everyone signs in once more on the new domain, with the same password.

**Every later deploy** is `npm run deploy` from `main`, or a push to `main` once Workers
Builds is connected (below). It **applies pending migrations to production before the new
code goes live**, so a migration must work with the code still running for those seconds
([migrations/CLAUDE.md](../migrations/CLAUDE.md)). New migration:
`npx wrangler d1 migrations create bouncereel <name>`.

⚠️ Agents never run `npm run deploy`, `wrangler deploy` or anything with `--remote`
without asking the owner first.

**Deploying on every push to `main`** (optional, as Hoops does): in the dashboard, the
Worker's Settings → Build → connect the GitHub repository; production branch `main`, no
builds for other branches, no build command, `npm run deploy` as the deploy command. It
installs the dependencies on the Node in [.nvmrc](../.nvmrc), the version the app is built
with locally.

Observability (Workers Logs) is on and source maps are uploaded, so an error carries real
file names. `npx wrangler tail bouncereel --format json` follows the logs live.

## 6. Releases

`main` is production and only ever receives `develop`. From `develop`, after pushing:

```sh
npm run release -- minor     # or patch / major
```

[release.js](../release.js) runs the build (which type-checks the pages and the Worker),
bumps the version (from the higher of `package.json` and the existing tags), commits
`Release: x.y.z`, pushes `develop`, fast-forwards `main` and pushes it, tags `vx.y.z` and
pushes the tag. It refuses rather than create a merge commit. With Workers Builds
connected, pushing `main` is the deploy. The version goes into every recorded video
(`app_version`), so a release also marks which code made which file.

It needs a GitHub remote named `origin` with `develop` and `main`.

## Limits

Workers Free plan:

| Limit | Here |
| --- | --- |
| 100,000 Worker requests a day | the public pages and their files are served without running the Worker; the home and pricing pages make one request each for the plans (`/api/plans`). A page behind the sign-in is one request for the page and one or two for the API; a saved recording or a link one each |
| 10 ms CPU per request | a password hash is ~3.6 ms (40,000 PBKDF2 iterations) and no request does more than two; the admin's lists count, filter, sort and page in SQL |
| 25 MiB per file, 20,000 files a version | Kokoro's wasm is 20.6 MiB, the largest file |
| 5 cron triggers per account | **all five are Hoops'**. BounceReel has no cron, on purpose: an end date takes effect when it is read, and old throttle counters are cleared by the next write |
| D1: 5 M rows read, 100,000 written a day, 500 MB a database | a video is one row, a link one more; the Videos page reads the account's videos and links once a load; a sign-in reads and writes a handful |
| Resend free plan: 100 mails a day, 3,000 a month | a sign-up sends one; forgot and the banner are throttled per address |

## Changelog

- 2026-10-19 - page created: Cloudflare deploy like Hoops, Access with the Worker's own
  token check, the isolation headers in production, noindex, releases, free-plan limits.
- 2026-10-20 - renamed before the first deploy: Worker and D1 database `bouncereel`, `bouncereel.vukcvetkovic.com`, the Access application BounceReel.
- 2026-10-20 - a public site on `bouncereel.com`: the Worker's own sign-in replaces Access, `SITE_URL` and `RESEND_API_KEY`, the pages behind the sign-in reach the Worker first, indexing split between public and private pages, the cut-over steps, `npm run admin`.
- 2026-10-21 - `/voice/*` (the home page's narrator clip) cached for a week, as the site's images.
- 2026-10-21 - `/gallery/*` (the home page's videos) cached for a week; Workers Assets' whole-file answer to a Range request, and why the home page plays its media from blob URLs.
- 2026-10-23 - `.nvmrc` pins Node 24.22.1, the Active LTS release with the October 2026 security fixes (a Brotli decoder RCE, TLS hostname checks) that 22.23.2 does not have.
- 2026-10-24 - the site goes on `bouncereel.vukcvetkovic.com` for now, kept out of search, mail from `bouncereel@vukcvetkovic.com` (verified in Resend for Hoops); the cut-over without Access (nothing was deployed before); the later move to the site's own domain in its own steps; `.gitignore` keeps the gallery's videos and drops `.DS_Store`.
