# worker

The Cloudflare Worker: the JSON API under `/api` (accounts, plans, the video library, the
admin area, the payment skeleton), and the check in front of the pages behind the sign-in.
No runtime dependencies; `fetch`, WebCrypto and D1 are all it uses. It serves no page of its
own: Workers Assets does, from the Vite build, and the Worker only decides whether a page
behind the sign-in may be shown. Deep-dives:
[accounts-and-billing](../docs/accounts-and-billing.md) (sessions, roles, plans, the admin
API, payments) · [video-library](../docs/video-library.md) (schema, routes, links) ·
[build-and-deploy](../docs/build-and-deploy.md) (config, secrets, deploy, limits).

## Where code goes

| Kind | Place |
| --- | --- |
| a route | its line in `ROUTES` in [router.ts](./router.ts) and a handler in [routes/](./routes/) (`auth`, `account`, `videos`, `plans`, `admin`, `billing`) |
| who may call it | public only if it is on `PUBLIC` in [router.ts](./router.ts); `/api/admin/*` is superadmin |
| a page that needs a session | [pages.ts](./pages.ts) and `run_worker_first` in [wrangler.jsonc](../wrangler.jsonc) |
| a D1 query | [videos.ts](./videos.ts), [plans.ts](./plans.ts), [admin.ts](./admin.ts), [auth/store.ts](./auth/store.ts), with its row type and mapper; never inline in a handler |
| a body or path check | [validate.ts](./validate.ts), throwing `HttpError(400, 'invalid_<field>')` |
| cookies, sessions, the role and origin checks | [auth/session.ts](./auth/session.ts) |
| password hashing, tokens | [auth/crypto.ts](./auth/crypto.ts) |
| a mail | [mail/templates.ts](./mail/templates.ts) (words), [mail/resend.ts](./mail/resend.ts) (sending) |
| an API shape | [shared/api.ts](../shared/api.ts), imported by the pages too |
| what a plan can unlock | [shared/features.ts](../shared/features.ts) |
| reading a post link | [shared/links.ts](../shared/links.ts), run by the page before sending and here before storing |
| a secret | `npx wrangler secret put NAME`, declared in [env.d.ts](./env.d.ts) (`wrangler types` cannot see secrets); locally in `.env` |
| a var or binding | [wrangler.jsonc](../wrangler.jsonc), then `npm run cf-typegen` |

## Rules

- **The session is checked before route matching**, and the role for `/api/admin/*`, so a
  caller cannot probe which routes exist. **A route is public only if it is on `PUBLIC`**:
  signing up and in, the links in mails, the plans, the payment webhook. Do not widen it
  without a reason written next to it.
- **Fail closed.** Without `SITE_URL` in production every request is a 500
  ([site.ts](./site.ts)); without `RESEND_API_KEY` a one-time link is never logged outside
  localhost. Localhost (dev, preview) is told apart by host name, which Cloudflare never routes
  here.
- **Every query that reads or changes a video or a link names the account** (`user_id`).
  Another account's video is a 404 exactly like a missing one; never answer 403 for it.
- **Nothing reachable over HTTP grants `superadmin`.** Only [scripts/admin.mjs](../scripts/admin.mjs)
  makes one. No route changes a role.
- **Every change to a subscription, a plan or an account's standing writes a `change_log` line
  in the same batch** ([plans.ts](./plans.ts) `logChange`). The log is append-only.
- **What an account may do is worked out per request** (`entitlements` in [plans.ts](./plans.ts));
  there is no cron, and nothing may rely on one.
- **Handlers stay thin**: validate, query, map, `json(body)`. Throw
  `HttpError(status, code, message)` for anything the caller can act on; the code is a
  contract with the pages, the message is English and says what to do.
- **Use the request's `now`** from the route context, so one request sees one time.
- **Log JSON** with [lib/log.ts](./lib/log.ts) (`log(level, message, fields)`), with fields that
  can be filtered on, never string-built messages. Never log a password, a token or a link
  outside localhost.
- **No DOM types here.** The Worker compiles against
  [worker-configuration.d.ts](../worker-configuration.d.ts) with its own
  [tsconfig.json](./tsconfig.json); `npm run check` runs both configs. Code in
  [shared/](../shared/) must compile in both.
- **10 ms of CPU per request** on the free plan. A password hash is ~3.6 ms; two is the most any
  request does. Count, filter, sort and page in SQL; a route that loops over every row in JS,
  or parses every config, does not stay inside it.

## Trying things

`npx vite build && npx vite preview --port 4199 --strictPort` runs this Worker with the local
D1. Sign up on http://localhost:4199/signup (the confirmation link is in the preview's log), or
make a superadmin with `npm run admin -- you@example.com` (use the printed path on port 4199).
With curl, keep the cookie and send an `Origin` on writes:
`curl -c jar -H 'Content-Type: application/json' -H 'Origin: http://localhost:4199' -d '{"email":…,"password":…}' http://localhost:4199/api/auth/login`.
The local database: `npx wrangler d1 execute bouncereel --local --command "SELECT …"`.
⚠️ Never `--remote` without asking Vuk.
