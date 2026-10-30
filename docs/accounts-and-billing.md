# Accounts and billing

Who can sign in and how, what each account may do, and how that changes: accounts and
their roles, sessions and cookies, passwords and the one-time links in mails, throttling,
the session check in front of the API and the pages, plans and their features,
subscriptions, the change log, the admin area, and the payment skeleton waiting for a
provider.

| I need to change... | Touch |
| --- | --- |
| what a plan can unlock (a new feature) | `Features`, `EVERYTHING`, `readFeatures`, `featuresProblem`, `describeFeatures` in [shared/features.ts](../shared/features.ts); then where it is enforced: [src/app.ts](../src/app.ts) `applyPlan`, `planProblem`, `fitPlan`, and [worker/routes/videos.ts](../worker/routes/videos.ts) `checkPlan` if the server can check it; the admin's plan form in [src/admin/main.ts](../src/admin/main.ts) `planForm` |
| a plan's values (name, price, limits, its card on the pricing page) | the admin area, `/admin/plans`; no code |
| the cards a plan can have on the pricing page (`tone`) | `PLAN_TONES` in [shared/api.ts](../shared/api.ts); `.tone-bold`, `.tone-dark` in [src/site/site.css](../src/site/site.css) (the pricing page) and [src/console.css](../src/console.css) (the admin's tiles) |
| who may call a route | `PUBLIC` and `isAdmin` in [worker/router.ts](../worker/router.ts) |
| which pages need a session | `GUARDED`, `ADMIN`, `GUEST_ONLY` in [worker/pages.ts](../worker/pages.ts) and `run_worker_first` in [wrangler.jsonc](../wrangler.jsonc) |
| cookies, the session length, the origin check | [worker/auth/session.ts](../worker/auth/session.ts) |
| password hashing | [worker/auth/crypto.ts](../worker/auth/crypto.ts) |
| account, session, link and throttling queries | [worker/auth/store.ts](../worker/auth/store.ts) |
| sign-up, login, forgot, reset, verify; throttle limits; link lifetimes | [worker/routes/auth.ts](../worker/routes/auth.ts) |
| the account page's API | [worker/routes/account.ts](../worker/routes/account.ts), the page [account.html](../account.html), [src/account.ts](../src/account.ts) |
| plans, subscriptions, what is in force, the log | [worker/plans.ts](../worker/plans.ts), [migrations/0003_plans.sql](../migrations/0003_plans.sql) |
| the daily allowance (`perDay`): how a day is counted | `utcDay`, `selectDay`, `claimDay` in [worker/plans.ts](../worker/plans.ts), `takeVideo` in [worker/routes/account.ts](../worker/routes/account.ts), [migrations/0004_daily_videos.sql](../migrations/0004_daily_videos.sql); in the studio `takeVideo`, `confirmRecord`, `syncDay` in [src/app.ts](../src/app.ts); the words `dayLine` in [src/ui/plan.ts](../src/ui/plan.ts) |
| how the studio tells a plan's limits (the plan card, the note on the preview) | `buildPlanCard`, `applyPlan` in [src/app.ts](../src/app.ts); `planChips`, `planHoldsBack` in [src/ui/plan.ts](../src/ui/plan.ts) |
| the admin area | [worker/routes/admin.ts](../worker/routes/admin.ts), [worker/admin.ts](../worker/admin.ts) (SQL), [admin.html](../admin.html), [admin/](../admin/), [src/admin/main.ts](../src/admin/main.ts); its sidebar is the `admin:nav` partial, [src/site/partials/admin-nav.html](../src/site/partials/admin-nav.html) |
| how the admin area, the account page and the Videos page look | [src/console.css](../src/console.css) |
| the mails | [worker/mail/templates.ts](../worker/mail/templates.ts) (words), [worker/mail/resend.ts](../worker/mail/resend.ts) (sending, `MAIL_FROM`) |
| the contact address | `CONTACT_EMAIL` in [shared/site.ts](../shared/site.ts) |
| making a superadmin | [scripts/admin.mjs](../scripts/admin.mjs) |
| payments | [worker/routes/billing.ts](../worker/routes/billing.ts), [section 11](#11-payments-where-a-provider-plugs-in) |
| the sign-in pages | [docs/website.md](./website.md) |

## 1. Accounts and roles

Anyone can sign up with an email and a password (`/signup`) and gets a `user` account on
the default plan, signed in at once. **Confirming the address is not needed to use the
plan**: the sign-up mail carries a link (`/verify?token=…`), and until it is opened the
studio, the Videos page and the account page show a banner asking for it, with a button that
sends it again (three an hour).

| Role | Can |
| --- | --- |
| `user` | the studio, its own library and account; what its plan includes |
| `superadmin` | the same with **every feature, whatever its plan** (`EVERYTHING`), and the admin area |

**A superadmin is made only from the terminal**, so nobody can claim the role first:

```sh
npm run admin -- you@example.com              # the local database
npm run admin -- you@example.com --remote     # production (the owner runs this)
```

[scripts/admin.mjs](../scripts/admin.mjs) (modelled on Hoops' `scripts/invite.mjs`) prints a
one-time link to set the password, valid 24 hours: `/reset?token=…`. Setting it creates the
account as a superadmin, or promotes the existing one. An address that already has an account
is promoted at once by the script too, and **nothing is lowered**: a suspended account is let
back in, a confirmed address stays confirmed. Sign-up and the API never write the role:
`insertUser` writes `'user'` in its SQL, and no route changes a role at all.

**The first superadmin receives every video and link without an owner**: the ones recorded
before accounts existed (the owner's), which [0002_accounts.sql](../migrations/0002_accounts.sql)
could not give to anyone (no account existed). Both ways of making a superadmin run
`claimOrphans`; after the first, there is nothing left to claim, and every new row names its
account. ⚠️ Until then those videos are invisible to everyone: a query scoped to an account
never returns a row whose `user_id` is NULL.

**The last superadmin** (one that can still sign in) cannot be deleted, by the admin area or
by itself, and cannot be suspended. Nobody can demote one: no route changes a role.

**Suspended** accounts cannot sign in (`account_suspended`, said only after the right
password), their sessions are deleted at once, and a session check refuses them anyway.

## 2. Sessions and cookies

Ported from Hoops ([worker/auth/session.ts](../worker/auth/session.ts)):

- A session is a random 256-bit token in an **HttpOnly** cookie, `__Host-br_session` on https
  (Secure, Path=/, no Domain, **SameSite=Lax**) and `br_session` on plain http (dev and
  preview, which cannot use the prefix). It lasts **30 days**.
- The database stores only the token's **SHA-256** (`sessions.token_hash`), so a leaked
  database holds no usable session. Expired rows are purged whenever someone signs in.
- Beside it, **`br_hint=1`**, a plain cookie with nothing in it, readable by the pages: the
  head of every public page reads it before first paint and swaps "Sign in / Start free" for
  "Open studio". Nothing on the server trusts it. A hint left by an ended session is cleared
  the next time the Worker sees it on a page it guards.
- **Signing out** deletes the session row and both cookies. **Sign out everywhere** (the
  account page) deletes every session of the account. A **password change** keeps the
  current session and deletes the others; a **password reset** deletes them all and starts a
  new one.

On signing out, the page also removes the studio's saved config for that account from the
browser ([src/session.ts](../src/session.ts) `forgetAccount`). The theme and the dice's switch
stay: they belong to the device ([development](./development.md#6-what-the-pages-store)).

## 3. Passwords and one-time links

**Passwords** are PBKDF2-SHA256 with a random salt per password, written as
`pbkdf2_sha256$40000$<salt>$<hash>` ([worker/auth/crypto.ts](../worker/auth/crypto.ts)). The
iteration count is in the hash, so it can be raised later while old hashes keep verifying.
**40,000 iterations, ~3.6 ms** of CPU (measured; 60,000 take 5.3 ms, and workerd refuses more
than 100,000): the password change checks the current password and hashes the new one in
one request, and two hashes must stay inside the free plan's 10 ms of CPU with the queries
around them. Hoops uses 60,000 because it never hashes twice in a request. A login for an
unknown address still runs one hash check (`DUMMY_PASSWORD_HASH`), so its timing does not
tell which addresses exist. Passwords are 8 to 200 characters.

**One-time links** live in `tokens`, as SHA-256 only, each with a purpose:

| Purpose | Made by | Valid | Opening it |
| --- | --- | --- | --- |
| `verify` | sign-up, the banner's button | 7 days | `/verify` posts the token; the address is confirmed (signed in or not: a phone's mail app works) |
| `reset` | the forgot form, the admin's "Send a password reset" | 1 hour | `/reset` asks for a new password, sets it, confirms the address, ends every session and signs in |
| `superadmin` | `npm run admin` | 24 hours | `/reset` too: creates or promotes the account (section 1) |

A link works once (`claimToken` marks it used in the same statement that checks it, so two
clicks at once cannot both use it), and a new link of the same purpose for an account voids
the older ones. Expired links are deleted whenever a new one is made. The pages take the
token out of the address bar as soon as they have read it.

**Forgot password** answers the same whether the address has an account or not ("If … has an
account, a link is on its way"), and sends the mail after the answer (`ctx.waitUntil`), so
neither the words nor the timing tell. **Sign-up does tell**: an address already taken is a
409 `email_taken`, because sign-up signs in at once and cannot pretend. The per-IP throttle
below is what slows a script testing addresses.

**Mail** goes through Resend ([worker/mail/resend.ts](../worker/mail/resend.ts), one `fetch`,
no SDK), from `MAIL_FROM` (`BounceReel <bouncereel@vukcvetkovic.com>`, a domain verified in
Resend for Hoops), replies to `CONTACT_EMAIL` (`vuk@vukcvetkovic.com`). **Without `RESEND_API_KEY` nothing is
sent**: on localhost the link goes to the Worker's log instead (`Mail is off (no
RESEND_API_KEY); the link it would carry`), so dev works; in production it is never logged
(a link is a password), and the forgot form answers 503 `mail_unavailable` to everyone. The
mails are light-only HTML in the paper look, with a plain-text part
([worker/mail/templates.ts](../worker/mail/templates.ts)).

## 4. Throttling

Counters in `throttle`, one per key in a sliding window (`throttleHit`, the same SQL as
Hoops' `login_failures`). Over a limit is a 429 `too_many_attempts` with `Retry-After`.

| What | Key | Limit |
| --- | --- | --- |
| failed logins | `login:email:<address>`, `login:ip:<ip>` | 5 per address, 20 per IP, in 15 minutes; a successful login clears the address's |
| sign-ups | `signup:ip:<ip>` | 5 per IP an hour, every attempt counting (taken addresses too) |
| password mails | `forgot:email:<address>`, `forgot:ip:<ip>` | 3 per address, 10 per IP, an hour |
| confirmation mails again | `verify:user:<id>` | 3 an hour |

The IP is `CF-Connecting-IP`. Counters older than a day are deleted by every write that counts
an attempt: there is no cron, so this is what keeps IP addresses from piling up. For more, a
Cloudflare rate-limiting rule on `/api/auth/*` (one rule is free).

## 5. The session check

**The API** ([worker/router.ts](../worker/router.ts) `handleApi`) checks, in this order and
**before any route is matched**, so a caller who may not use a route cannot learn whether it
exists:

1. **`SITE_URL`** ([worker/site.ts](../worker/site.ts)): missing or not https in production,
   every request is a 500 `not_configured`. **It fails closed.** Links in mails are built from
   it, never from the request. Localhost skips it.
2. **Same origin**: anything but GET and HEAD must come from the site's own pages (`Origin`,
   `Sec-Fetch-Site`), else 403 `cross_origin`. With SameSite=Lax this is the CSRF protection.
   The **one exception is `POST /api/billing/webhook`**: a payment provider's server is not on
   this origin.
3. **The session**: every path that is not on the explicit public list (`PUBLIC`:
   `/api/auth/<word>`, `/api/plans`, `/api/billing/webhook`) needs one, else 401
   `unauthenticated`.
4. **The role**: every `/api/admin/*` path needs a superadmin, else 403 `forbidden`. So
   `GET /api/admin/anything` answers 401 or 403, never 404, to a caller who may not see it.

**The pages behind the sign-in** reach the Worker first (`run_worker_first` in
[wrangler.jsonc](../wrangler.jsonc)), and [worker/pages.ts](../worker/pages.ts) decides before
Workers Assets serves them, so nothing flashes first:

| Path | Signed out | Signed in |
| --- | --- | --- |
| `/app`, `/app/*`, `/account` | 302 to `/login?next=<path>` | the page |
| `/admin`, `/admin/*` | 302 to `/login?next=<path>` | a superadmin gets the page; anyone else the 404 page, as if it were not there |
| `/login`, `/signup` | the page | 302 to `next`, or `/app` |

A page served this way gets `Cache-Control: private, no-store`, `X-Robots-Tag: noindex,
nofollow` and the cross-origin isolation headers. `next` passes only if it resolves to a path
on the same origin ([shared/site.ts](../shared/site.ts) `safeNext`): `//evil.example` or a full
URL is dropped. ⚠️ The page check only decides which page to show; the API checks the session
again on every request, which is what protects the data.

## 6. Plans and features

**What a plan can unlock is defined in code**, [shared/features.ts](../shared/features.ts);
**each plan's values live in D1** (`plans.features`, JSON), edited in the admin area:

| Key | Meaning | Who enforces it |
| --- | --- | --- |
| `sounds` | what Record may put in the file: `narrator` (and music), `music` only, `silent` | the studio's Sound field; the server on save (`sound.track` in the config) |
| `narrator` | the narrator in the video: Play with voice, the opening and the winner line. The `narrator` sound also needs it (`soundAllowed`) | the studio (the Voice tab's fields are locked; its voices can still be heard) |
| `maxSeconds` | the longest video, 20–90 s | the studio's Length slider stops there; the server on save (`videoLength` and `timing.video`) |
| `looks` | `paper`, `cards`, `night` | the studio's Look tiles; the server on save (`look.skin`) |
| `powers` | a ball with a power: the dice's switch, the Power field, the classics with one | the studio; Record refuses a matchup with one; the server on save |
| `perDay` | videos a day, 1 or more; null is no limit. A day is the UTC calendar day: a new one starts at midnight UTC | the server as Record starts (`POST /api/account/day`, `claimDay`); the studio's Record button shows it |
| `library` | videos kept; null is no limit | the server on save (inside the INSERT) |
| `watermark` | a small BounceReel watermark (the mark and the site's host) between the two cards of every video ([look and layout](./look-and-layout.md#10-the-power-tag-and-the-watermark)) | the studio: it draws the video, in the preview as in the file. The server cannot see the pixels; the [terms](../terms.html#licence) ask that it stays on |
| `follow` | the follow button: the studio's Ask viewers to follow switch (`look.follow`), a follow button once in the race and under the winner card, and "Follow for more!" after the winner line ([look and layout](./look-and-layout.md#14-the-follow-button)). On every plan but Rookie (0009_follow_button.sql) | the studio (the switch is locked; a config made with it, from the library or a file, loads with it off); the server on save (`look.follow`) |
| `allGames` | every game BounceReel makes, each new one as it comes out | nothing yet: ball races are the one game, and every plan makes it. A second game checks it before it opens |

**The studio says what the plan makes, and shows what it lacks instead of hiding it.** At the
top of the panel, a plan that holds anything back gets a card: "Your plan: Rookie" and a few
words for each feature, a tick for what it makes and a dash for what it leaves out ("1 video a
day", "Up to 30 s", "Paper look", "5 videos kept"; "No narrator", "No powers", "With
watermark", "No follow button"), with Compare plans (`buildPlanCard`, `planChips`). A plan with nothing held back
has none. What the plan lacks stays in view, disabled, with a line saying so and an **Upgrade**
link to `/pricing` (`applyPlan` in [src/app.ts](../src/app.ts), `planNote` in
[src/ui/plan.ts](../src/ui/plan.ts)). A saved config is fitted on load where that
changes nothing about the matchup (`fitPlan`: the look and sound fall back to ones the plan
has; a longer video is balanced again to the plan's longest); a ball with a power stays, and
Record says why it cannot record it (`planProblem`). A video opened from the library is loaded
exactly as recorded, and Record checks it the same way.

**The server checks what passes through it**: Record when the day's videos are made is a 403
`day_used`, before anything is recorded; a save of a video longer than the plan allows, with a
sound, a look, a power or the follow button it lacks is a 403 `not_in_plan`; a save into a full library is a 403
`library_full` (counted inside the `INSERT`, so two saves at once cannot both take the last
place). A refused save still has its file, downloaded first; the sheet after the take says why
it is not in Videos, with a See plans link.

**The daily allowance** (`perDay`) counts recordings, not previews and not what the library
holds. **Play is free**: a preview, as often as anyone likes, and the race it shows is the race
Record makes (the same seed plays the same race), so the way to work is to watch until one is
worth posting, then record it. **Record takes the day's video from the server as it starts**
(`POST /api/account/day`), once the narration is ready and before the first frame: `claimDay`
takes one in a single conditional `UPDATE`, or answers `day_used` and nothing is recorded. So a
second tab, a page left open since the last count, or a save that never arrives cannot make one
more. Recording the screen still can, and gets the plan's look and watermark, which the
preview carries too; nothing in a browser stops someone who changes the page's own code, since
the video is made there. The save that follows does not count
again, and deleting a video does not give the day's video back, since its MP4 was made. Before
the day's last video the studio asks first ("Record this race? This uses your video for today…",
`confirmRecord`), since it cannot be had back until tomorrow; on a plan with a daily limit the
preview's Play button says, before anything plays, that previews are free and only Record
counts. What a day has used is kept on the account (`users.day_started_at`, the time of the
day's first video, and `users.day_videos`). **A day is the UTC calendar day** (`utcDay`):
everyone's day turns at midnight UTC, whenever their first video was made, so the allowance
comes back at a fixed hour instead of drifting with each day's first recording. A row whose
`day_started_at` is before today's midnight UTC is a day that has passed. A plan without a
limit counts too, so a change of plan mid-day finds the day as it is (and its recording starts
even if that count cannot be sent). A video the library has no room for was still made, and
used the day. `GET /api/account` says where the day stands (`day`:
used, limit, when it ends). The studio shows what is left of it beside Record, turns Record
off once it is used, says when the next video can be made (midnight UTC in the viewer's own
time: "Next video tomorrow at 02:00" in Belgrade's summer, "at 20:00" in New York's) and gives
it back when the day ends with the page open; the Videos page
and the account page say the same.

A stored plan missing a key, or with one that no longer reads, gets **the least** for it
(`readFeatures`): a feature added to the code later is off on every plan until the owner turns it on.
The admin's form is checked strictly (`featuresProblem`).

**Plan fields**: name, short description, price (amount in minor units, currency, interval
`month`/`year`/one-off; all optional: no price shows "Coming soon"), sort order, visible on the
pricing page, archived, the features, and how its card looks on the pricing page: **`tone`**
(`plain`, white, for the free plan; `bold`, violet, the plan the page points at; `dark`, the
ink stage, for the top plan) and an optional **`badge`** on the card's corner (up to 24
characters, such as "Recommended"). A tone the code no longer knows reads as plain. **The default plan** (`is_default`, one at most) is
the one every new account gets and every ended subscription falls back to; it cannot be
hidden, archived or deleted. **A plan with subscribers can only be archived**: off the pricing
page and out of reach for new subscriptions, kept by those who have it. Only a plan nobody has
can be deleted (409 `plan_has_subscribers` otherwise).

Seeded by [0003_plans.sql](../migrations/0003_plans.sql), with the free plan's day set by
[0004_daily_videos.sql](../migrations/0004_daily_videos.sql) and the three plans, their cards
and the two newest features by [0005_three_plans.sql](../migrations/0005_three_plans.sql), and
Pro's five a day and the one-line descriptions by
[0006_pro_five_a_day.sql](../migrations/0006_pro_five_a_day.sql).
Names, words, badges and prices are placeholders (`TODO(owner)`):

| Plan | Card | Price | A day | Sounds | Narrator | Longest | Looks | Powers | Library | Watermark | Every game |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Rookie** (default) | plain | €0 | 1 video | music, silent | no | 30 s | paper | no | 5 | yes | no |
| **Pro** | bold, "Recommended" | none ("Coming soon") | 5 videos | all three | yes | 90 s | all three | yes | no limit | no | no |
| **Champion** | dark, "Every game" | none ("Coming soon") | no limit | all three | yes | 90 s | all three | yes | no limit | no | yes |

The plans climb in three steps: Rookie makes one video a day, Pro five, Champion as many as
you like, and only Champion has every game, which matters once there is a second game.

## 7. Subscriptions

One row per account (`subscriptions`, made at sign-up on the default plan): plan, `status`,
`source` (`manual`, or the provider's name later), an optional `ends_at`, the provider's
customer and subscription ids (NULL until there is one), who changed it last and when.

**What an account may do is worked out on every request** from that row and the clock
(`entitlements` in [worker/plans.ts](../worker/plans.ts), two reads in one round trip). There
is **no cron** (the account's five cron triggers are all Hoops'), so nothing has to run for an
end date to take effect:

| Status | `ends_at` | In force |
| --- | --- | --- |
| `active` | none | always |
| `active` | a time | until then, then the default plan |
| `canceled` | a time | until then (canceled at the end of the period), then the default plan |
| `canceled` | none | never: the default plan at once |

`IN_FORCE` in [worker/plans.ts](../worker/plans.ts) is that table as SQL, used by the account's
plan, the overview's "in force now" and the users list. **A superadmin has every feature
whatever the row says**: the owner's account always has everything. So in the admin area it is
on no plan: its Plan reads "Everything", it is active unless suspended, no plan's count or
filter includes it (`ACCOUNTS` in [worker/admin.ts](../worker/admin.ts), `SUBSCRIBERS` in
[worker/plans.ts](../worker/plans.ts)), its page has no subscription form, and the pricing page
marks no card as its own. Its row still names a plan (the default, from sign-up), and the
foreign key keeps a plan a row names, so deleting that plan moves the row to the default plan
in the same batch, with its log line.

The admin sets a subscription by hand on a user's page: the plan (archived plans only for
whoever has one already), the end date (a day; it ends at that day's last moment, UTC), the
status (Cancel / Make it active again). Each save is `PUT /api/admin/users/:id/subscription`
and is logged.

## 8. The change log

`change_log` is **append-only**: no route updates or deletes a line. Each line is when, who
(`actor_id`: a superadmin, the account itself, or NULL for the server), what (`subject`
`subscription`, `plan` or `account`, and `action`), whose (`user_id`, `plan_id`) and the state
before and after as JSON. Every change is written **in the same batch** as the change itself,
so neither lands without the other:

| Subject | Actions |
| --- | --- |
| subscription | `created` (sign-up), `changed` (the admin) |
| plan | `created`, `edited`, `archived`, `restored`, `deleted`, `reordered` |
| account | `suspended`, `unsuspended`, `deleted by a superadmin`, `deleted by its owner`, `superadmin created`, `promoted to superadmin` |

Ids have no `REFERENCES`, and `users` and `plans` use AUTOINCREMENT, so a line outlives the
account or plan it names and an id never comes back as someone else. **No address is copied
into the log**: a deleted account leaves only its number ("account 12 (deleted)").

## 9. The admin area

`/admin`, superadmins only (section 5). The public site's look as a console
([src/console.css](../src/console.css)): a sidebar on the site's dark stage with the four
pages, the studio and the theme (a bar across the top on a narrow screen), white tiles on the
cool grey, violet only for the action that matters. The account page uses the same sheet,
with a bar of its own instead of the sidebar.

- **Overview**: accounts, new in the last 7 and 30 days, suspended; each plan's accounts in
  force as a bar against every account; videos saved; the latest changes and the newest
  accounts. Three aggregate queries, then a page of the log and of the users.
- **Users** (`/admin/users`): search by address, filter by plan and status (`active`,
  `canceled`, `expired` for a passed end date, `suspended`), sort by address, plan, end date,
  joined, last sign-in or videos, 50 a page. **Filtering, sorting, counting and paging are all
  SQL** (`selectUsers` in [worker/admin.ts](../worker/admin.ts)): a request has 10 ms of CPU. The
  address bar keeps the filters, so a view can be shared and reloaded.
- **One user** (`/admin/user?id=`): details, the subscription with its form (a superadmin's
  page says it has everything instead, section 7), Suspend /
  Unsuspend, Send a password reset (the mail only; the link is never shown), Delete (the
  address typed out, `confirm` on the server), the history from the log, the videos read-only.
- **Plans** (`/admin/plans`): each plan as the pricing page draws it (its card's tone and
  badge, the price, the line, what it includes), with its tags (Default, Hidden, Archived), its
  subscriptions, and Edit, earlier and later on the pricing page, Archive / Restore, Delete when
  nobody has it; New plan. **Edit and New plan open a drawer**: the plan as the pricing page
  will show it, redrawn on every change (beside the fields on a wide screen, after them on a
  narrow one), then the fields in four groups: the plan (name, description, its card, its
  badge, on the pricing page), the price, the limits (videos a day, longest video, videos
  kept) and what it includes (sounds, looks, the narrator, powers, the watermark, the follow
  button, every game). A save the server refuses keeps the drawer open with its reason.
- **Log** (`/admin/log`): every line, newest first, 50 a page, with only what changed between
  before and after.

## 10. The API

Shapes in [shared/api.ts](../shared/api.ts); errors are `{ "error": { "code", "message" } }`.
The video routes (signed in, each account its own) are in
[video-library](./video-library.md#3-the-api).

| Method | Route | Access | Does |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | public | `{ email, password }` → the account, signed in; 409 `email_taken` |
| POST | `/api/auth/login` | public | `{ email, password }` → the account, signed in; 401 `invalid_credentials`, 403 `account_suspended` |
| POST | `/api/auth/logout` | public | ends this browser's session |
| POST | `/api/auth/forgot` | public | `{ email }` → `{ ok }` whatever the address; 503 `mail_unavailable` in production without a mail key |
| GET | `/api/auth/reset?token=` | public | who a password link is for: `{ email, purpose, existing }` |
| POST | `/api/auth/reset` | public | `{ token, password }` → the account, signed in |
| POST | `/api/auth/verify` | public | `{ token }` → `{ email }` confirmed |
| GET | `/api/plans` | public | the visible plans that are not archived, and `billing` |
| POST | `/api/billing/webhook` | public, any origin | 501 until a provider is connected |
| GET | `/api/account` | signed in | the account, its plan in force, subscription, features, library count and limit, the day (`day`: used, limit, `endsAt`), `billing` |
| POST | `/api/account/day` | signed in | takes one of today's videos as a recording starts → `{ day }`; 403 `day_used` |
| DELETE | `/api/account` | signed in | `{ password }`: the account and everything it made; 409 `last_superadmin` |
| POST | `/api/account/password` | signed in | `{ current, password }`; 403 `wrong_password` |
| POST | `/api/account/verify` | signed in | the confirmation mail again |
| POST | `/api/account/logout-everywhere` | signed in | ends every session of the account |
| POST | `/api/billing/checkout`, `/api/billing/portal` | signed in | 501 `billing_not_configured` |
| GET | `/api/admin/overview` | superadmin | the overview's numbers |
| GET | `/api/admin/users?q=&plan=&status=&sort=&dir=&page=` | superadmin | one page of accounts and the total |
| GET | `/api/admin/users/:id` | superadmin | the account, subscription, history, videos |
| PUT | `/api/admin/users/:id/subscription` | superadmin | `{ planId?, endsAt?, status? }`; 409 `plan_archived` |
| POST | `/api/admin/users/:id/suspend`, `/unsuspend` | superadmin | 409 `cannot_change_self`, `last_superadmin` |
| POST | `/api/admin/users/:id/reset` | superadmin | mails a password link → `{ mail: 'sent' \| 'failed' \| 'off' }` |
| DELETE | `/api/admin/users/:id` | superadmin | `{ confirm: <the address> }` |
| GET, POST | `/api/admin/plans` | superadmin | every plan with its subscriber count; a new plan |
| PUT, DELETE | `/api/admin/plans/:id` | superadmin | edit; delete (409 `plan_has_subscribers`, `default_plan`) |
| POST | `/api/admin/plans/:id/archive`, `/restore` | superadmin | 409 `default_plan` |
| POST | `/api/admin/plans/order` | superadmin | `{ ids }`, every plan once |
| GET | `/api/admin/log?page=` | superadmin | the change log, newest first |
| PUT | `/api/admin/videos/:id/texts` | superadmin | texts for posting one of the superadmin's own videos ([video-library §6](./video-library.md#6-the-videos-page)); 400 `invalid_texts` |

| Status | Codes |
| --- | --- |
| 400 | `invalid_email`, `invalid_password`, `invalid_<field>`, `invalid_json`, `invalid_body` |
| 401 | `unauthenticated`, `invalid_credentials` |
| 403 | `forbidden`, `cross_origin`, `account_suspended`, `wrong_password`, `not_in_plan`, `day_used`, `library_full` |
| 404 | `not_found`, `link_invalid`, `user_not_found`, `plan_not_found`, `video_not_found`, `post_not_found` |
| 405 | `method_not_allowed` |
| 409 | `email_taken`, `last_superadmin`, `cannot_change_self`, `plan_archived`, `plan_has_subscribers`, `default_plan`, `post_taken` |
| 415 | `unsupported_media_type` |
| 429 | `too_many_attempts` |
| 500 | `not_configured`, `internal_error` |
| 501 | `billing_not_configured` |
| 503 | `mail_unavailable` |

## 11. Payments: where a provider plugs in

There is **no payment provider yet**; the skeleton is in place so adding one touches known
places ([worker/routes/billing.ts](../worker/routes/billing.ts)):

- `POST /api/billing/checkout`, `POST /api/billing/portal` and `POST /api/billing/webhook`
  exist and answer **501 `billing_not_configured`**. The webhook is outside the session check
  and the same-origin check (section 5).
- `BILLING = false` goes out with `GET /api/plans` and `GET /api/account` as `billing`; while
  it is false every upgrade button reads **"Upgrades open soon"** and stays disabled (the
  pricing page, the account page). The admin's manual changes are the only way a plan changes.
- The schema already has `subscriptions.source`, `provider_customer_id` and
  `provider_subscription_id`, and `status` has no CHECK, so a provider's statuses fit.

`TODO(owner)`: choose a provider, then:

1. **Checkout**: `POST /api/billing/checkout { planId }` creates the provider's checkout
   session for the signed-in account (the account id in the session's metadata, the customer
   id reused from `provider_customer_id` if there is one) and answers `{ url }`; the account
   page and the pricing page `location.assign` it. Prices live with the provider; a plan row
   then needs the provider's price id (a migration adding `plans.provider_price_id`).
2. **Portal**: `POST /api/billing/portal` answers `{ url }` of the provider's page for the
   account's customer, for cancelling and card changes.
3. **Webhook signature, with WebCrypto**: read the raw body as text *before* parsing it; the
   provider signs `timestamp + "." + body` with HMAC-SHA256 under the webhook secret (a Worker
   secret, declared in [worker/env.d.ts](../worker/env.d.ts)). Import the secret with
   `crypto.subtle.importKey('raw', …, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])`,
   check with `crypto.subtle.verify` (constant time), and refuse a timestamp older than five
   minutes. Anything that fails is a 400 and changes nothing.
4. **Idempotent events**: the provider retries; keep its event ids in a table of their own
   (`billing_events (id TEXT PRIMARY KEY, received_at, type)`) and
   `INSERT … ON CONFLICT DO NOTHING` it in the **same batch** as the subscription update, so an
   event applied twice changes nothing the second time. Answer 2xx once it is stored.
5. **Applying an event**: map the provider's subscription to the account (customer id or
   metadata), then write `plan_id`, `status`, `ends_at` (the period end when it cancels at the
   end), `source` (the provider's name) and both ids, and a `change_log` line with
   `actor_id` NULL.
6. **An admin change and a webhook that disagree**: the subscription's `source` says who owns
   it. While it is the provider's, the provider is the truth: its next event overwrites a hand
   edit, so the admin area should say so and the admin should change it at the provider
   (refund, cancel) instead. A manual change (a gift, a comp) sets `source` back to `manual`,
   and events for that account's old provider subscription are then logged and ignored unless
   they start a new one. Decide this rule with the provider's semantics in front of you; until
   then every subscription is `manual`.

## Changelog

- 2026-10-20 - page created: accounts and roles, sessions and the hint cookie, passwords and one-time links, throttling, the session check for the API and the pages, plans and features, subscriptions without a cron, the change log, the admin area, the payment skeleton.
- 2026-10-21 - the daily allowance (`perDay`, `day_used`, 0004_daily_videos.sql) with Free at one video a day; the server also checks the look and powers on save; the admin area and the account page in the site's look (src/console.css), plans drawn as on the pricing page and edited in a drawer with a live preview.
- 2026-10-21 - three plans (Rookie, Pro, Champion; 0005_three_plans.sql) with a card tone and a badge each; the `watermark` (on Rookie) and `allGames` (on Champion) features; the daily allowance is the UTC calendar day, back at midnight UTC.
- 2026-10-21 - Pro makes five videos a day, so only Champion is unlimited (0006_pro_five_a_day.sql); each plan's description is one line on who it is for.
- 2026-10-21 - Record takes the day's video from the server as it starts (`POST /api/account/day`), not on save; a question before the day's last video; the studio's plan card and the note that previews are free.
- 2026-10-23 - a refused save is explained in the studio's sheet after the take, with See plans; the studio loads the public plans beside the account to word what the paid plans add.
- 2026-10-24 - mail from `bouncereel@vukcvetkovic.com`, replies to `vuk@vukcvetkovic.com`; the watermark named without the address in the plans' lists and the admin.
- 2026-10-24 - `PUT /api/admin/videos/:id/texts`, a superadmin's texts for posting a video.
- 2026-10-24 - the Videos page in the console look (src/console.css), with the account page's top bar; the console's selects keep their chevron; a page under the top bar is centred.
- 2026-10-29 - a superadmin is on no plan in the admin area ("Everything", in no plan's count or filter, no subscription form) nor on the pricing page; deleting the plan its row names moves the row to the default plan.
- 2026-10-30 - the `follow` feature (0009_follow_button.sql: on every plan but the default one): the studio's Ask viewers to follow switch, locked on a plan without it, and checked on save.
