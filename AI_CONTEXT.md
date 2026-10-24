# BounceReel - AI Context

## What this is

**BounceReel** is a public website, `https://bouncereel.vukcvetkovic.com` for now and kept out of
search engines (`SITE_URL`, `INDEXED` in shared/site.ts), where creators make short
vertical game videos for YouTube Shorts, TikTok and Instagram Reels: 1080×1920, 60 fps,
recorded in the browser straight to MP4, with synthesised sound and a narrator. Anyone can
sign up; a **plan** decides what the account may make (the free plan's videos carry a small
watermark), and the owner manages users, plans and subscriptions in an **admin area**, while using
the studio like anyone else.

Its first game, and the only one so far, is **ball races**. Two balls race, one in each
card, top and bottom. A ball flies in a straight line and bounces off the walls and the
ceiling for nothing; **only a hit on the floor counts**. The floor is the top **layer**, and
each floor hit takes the next **term** of the ball's **sequence** off it (Fibonacci 1, 1, 2,
3, 5…; factorial 1, 2, 6, 24…). Damage left over when a layer breaks is lost, and the box grows
down to the next layer. With every layer gone the floor is the checkered **finish line**; the
first ball to touch it wins.

The dice makes a new **matchup** every click, and every matchup is **balanced**: ball speeds
are set so the race fits the chosen video length to a tenth of a second and ends as close as
asked: a near photo finish by default, or a chosen **finish gap** of 1–10 s. A narrator
(Kokoro, a free voice that runs in the browser) introduces the balls and names the winner,
and says nothing in between; the **sound** of a recording is narrator and music, music only,
or silent. The whole thing is recorded to MP4 with `MediaRecorder`.

Every finished recording goes into the account's **video library**: a Cloudflare D1 database
that keeps the video's config (enough to make it again, the simulation being deterministic),
its facts and its links to YouTube, TikTok and Instagram. The **Videos page**
(`/app/videos`) lists them, takes the links and loads a video back into the studio.

Vite + TypeScript pages, no framework: the public site (home, pricing, sign-in pages, legal
pages), the studio (`/app`), the Videos page, the account page and the admin area. They are
served by Cloudflare Workers Assets; a small Worker answers `/api/*` and checks the session
before serving the pages behind the sign-in. The only runtime dependency is `kokoro-js`,
loaded the first time the narrator speaks.

## Maintaining this document

**This file is a map, not the territory.** It answers *where do I look?*. Keep it short
enough to read whole before the real work starts.

| What changed | What to update |
| --- | --- |
| the rules of a race, the physics, determinism, events, prediction | [docs/simulation.md](docs/simulation.md) |
| balancing, video length and pacing, random matchups, sequences, specials, presets | [docs/matchups-and-balancing.md](docs/matchups-and-balancing.md) |
| the video's look: the three looks, layout, layers, stats and chips, the power tag, winner card, the loop, the watermark, effects, fonts, the opening title, the meters and LEAD CHANGE, the last layer | [docs/look-and-layout.md](docs/look-and-layout.md) |
| sound, melodies, the narrator's two lines, the voices and loading Kokoro, the Sound field | [docs/sound-and-narration.md](docs/sound-and-narration.md) |
| recording, formats, the sound in the file, export for the platforms | [docs/recording-and-export.md](docs/recording-and-export.md) |
| scripts, the studio's panel, checking in a browser, storage, conventions for working here | [docs/development.md](docs/development.md) |
| Cloudflare, the Worker's config and settings, headers, indexing, deploy and the cut-over, releases, limits | [docs/build-and-deploy.md](docs/build-and-deploy.md) |
| the video library: schema, API routes, links, saving after Record, the Videos page | [docs/video-library.md](docs/video-library.md) |
| accounts, sessions, roles, plans and features, subscriptions, the change log, the admin area, payments | [docs/accounts-and-billing.md](docs/accounts-and-billing.md) |
| the public site: pages, shared parts, its look, the home page and hero, images, speed, SEO, legal pages | [docs/website.md](docs/website.md) |
| a rule that cuts across areas | **here**, under [Conventions and gotchas](#conventions-and-gotchas) |

**Describe only the present.** History lives in git and on each deep-dive's changelog.

## Where things are

| I need... | Go to |
| --- | --- |
| the vocabulary | [Glossary](#glossary) |
| the shape of the whole app | [Architecture](#architecture) · [End-to-end flows](#end-to-end-flows) |
| why a ball bounces where it does, why a seed replays exactly | [docs/simulation.md](docs/simulation.md) |
| how a matchup comes out close and exactly 40 s long | [docs/matchups-and-balancing.md](docs/matchups-and-balancing.md) |
| where a pill, chip or bar is drawn and why it is that size | [docs/look-and-layout.md](docs/look-and-layout.md) |
| what the narrator says and how the audio is made | [docs/sound-and-narration.md](docs/sound-and-narration.md) |
| what the file is and how to convert it | [docs/recording-and-export.md](docs/recording-and-export.md) |
| running, tuning, checking, the panel's fields | [docs/development.md](docs/development.md) |
| how it is deployed, its settings, what search engines see | [docs/build-and-deploy.md](docs/build-and-deploy.md) |
| what is stored for a video, its API, the Videos page | [docs/video-library.md](docs/video-library.md) |
| who can sign in, what a plan unlocks, the admin area | [docs/accounts-and-billing.md](docs/accounts-and-billing.md) |
| the home page, the pricing page, the sign-in pages | [docs/website.md](docs/website.md) |

| Code | What lives there |
| --- | --- |
| [src/app.ts](src/app.ts), [src/main.ts](src/main.ts) | the studio: frame loop and phases, matchups, the matchup card and look thumbnails, narration timing, recording, the plan's gates |
| [src/config.ts](src/config.ts) | the `Config` type, defaults, the seven built-in matchups, `mergeConfig` |
| [src/pacing.ts](src/pacing.ts) | the frame around the race (hold, slow motion, winner card) and the race length it leaves |
| [src/layout.ts](src/layout.ts) | frame geometry: the two cards, built from one template |
| [src/sim/](src/sim/) | the deterministic simulation, prediction, balancing, random matchups, sequences |
| [src/render/](src/render/) | Canvas drawing in three looks, and visual-only effects |
| [src/audio/](src/audio/) | synth, melodies, the narrator's opening and winner line, Kokoro and its voices |
| [src/record/recorder.ts](src/record/recorder.ts) | `MediaRecorder`: format choice, start, stop, download |
| [src/ui/](src/ui/) | the panel's tabs, generated from [fields.ts](src/ui/fields.ts); the theme toggle every page shares; the plan's notes and the account's banner ([plan.ts](src/ui/plan.ts)) |
| [src/library.ts](src/library.ts), [src/api.ts](src/api.ts), [src/session.ts](src/session.ts) | saving a recording to the library (and the per-account retry queue); the pages' one way to `/api`; the signed-in account, signing out |
| [app.html](app.html), [app/videos.html](app/videos.html), [src/dashboard.ts](src/dashboard.ts) | the studio's page; the Videos page |
| [account.html](account.html), [src/account.ts](src/account.ts) | the account page |
| [admin.html](admin.html), [admin/](admin/), [src/admin/main.ts](src/admin/main.ts) | the admin area |
| [src/console.css](src/console.css) | how the account page and the admin area look: the public site's identity as a console |
| [index.html](index.html) and the other root HTML files, [src/site/](src/site/) | the public site: pages, shared partials, the hero, pricing, the sign-in forms, its stylesheet |
| [worker/](worker/) | the Cloudflare Worker: `/api` routes, the session check, D1 queries, mail, the page gate |
| [shared/](shared/) | what the pages and the Worker both use: API shapes, plan features, site constants, reading post links |
| [migrations/](migrations/) | the D1 schema |
| [wrangler.jsonc](wrangler.jsonc), [public/_headers](public/_headers) | the Worker's config (domain, D1, `SITE_URL`, which paths reach the Worker); the production headers (isolation, indexing) |
| [scripts/tune.ts](scripts/tune.ts), [scripts/admin.mjs](scripts/admin.mjs), [scripts/stills.ts](scripts/stills.ts) | `npm run tune`; `npm run admin` (make a superadmin); the page that draws the site's images |
| [public/fonts/](public/fonts/) | Rubik, the video's lettering (SIL OFL) |

## Glossary

| Term | Meaning |
| --- | --- |
| **matchup** | the two balls (name, colour, sequence, speed, special, size), the layers and the melody: everything but voice and timing |
| **team**, `a` / `b` | one side of the race: the top card is `a`, team 0; the bottom card is `b`, team 1. A team is one ball, or many after splitting |
| **sequence**, **term** | the numbers a team hits with; `term(n)` is the damage of its (n+1)-th floor hit, a BigInt |
| **floor hit** | a ball touching the floor of its box; the only thing that scores |
| **layer** | a bar of health under the box; the top one standing is the floor. Health is a BigInt |
| **finish line** | the checkered strip under the last layer; touching it ends a team's race |
| **special**, **power** | what else a floor hit does to the hitting ball: `faster`, `slower` (% per hit), `grow` (px of radius), `split` (new balls, up to 64). The panel calls it a power, and the video tags the ball with it: a gold ⚡ `SPEEDS UP` beside its name |
| **look** | `look.skin`, how the video is drawn: `paper` (the default), `cards`, or `night` (the cards after dark); only the drawing, never the race ([look and layout](docs/look-and-layout.md)) |
| **sound** | `sound.track`, what Record puts in the file and Play plays: `narrator` (and music), `music` only, `silent` (no audio track) |
| **seed** | the text all randomness comes from: start positions, angles, who wins a balanced race, the opening's fact |
| **balance** | setting both speeds so the race fits the video length and ends close ([balance.ts](src/sim/balance.ts)) |
| **video length** | `timing.video`, seconds; the race gets what is left after the frame around it ([pacing.ts](src/pacing.ts)) |
| **margin** | seconds between the winner and the loser touching the line; "wins by 0.3 s" |
| **finish gap** | `timing.gap`, the margin balancing aims for: 0 is a photo finish (0.15–1.1 s, by the seed), else 1–10 s |
| **prediction**, `Outcome` | a whole run simulated without drawing, to the win: winner, time, the loser's progress, lead changes, and the ones the video marks (`leads`) |
| **opening title** | the names, a big VS and the opening's question over the first frame, through the hold and the race's first second: what a viewer sees before swiping |
| **LEAD CHANGE** | the flash (and the sting) when the lead changes hands for good, from the prediction's `leads`, beside a meter per ball |
| **opening**, **winner line** | the narrator's two lines: before the race, and at the end (none when the winner line is empty) |
| **voice** | one of Kokoro's English voices (`VOICES` in [narration.ts](src/audio/narration.ts)), `voice.voice` in the config; Heart by default |
| **watermark** | the BounceReel mark and the site's host (`SITE_HOST`) that a plan with the `watermark` feature puts between the two cards, in the preview and the file |
| **video**, **library** | a finished recording as the database keeps it: config, facts, file name, owner; the library is an account's videos ([video-library](docs/video-library.md)) |
| **post** | a video's link on one platform (`youtube`, `tiktok`, `instagram`), at most one each |
| **account** | a user who signed up: email, password hash, role, confirmed or not, suspended or not; signed in by a session cookie ([accounts-and-billing](docs/accounts-and-billing.md)) |
| **superadmin** | the role with every feature and the admin area; made only by `npm run admin` from the terminal, never over HTTP. Everyone else is `user` |
| **plan** | a set of feature values with a name, an optional price, an order, visibility and a card on the pricing page (a tone and a badge), stored in D1 and edited in the admin area; Rookie (the free, default plan), Pro and Champion are seeded |
| **feature** | one thing a plan can unlock, defined in [shared/features.ts](shared/features.ts): the sounds, the narrator, the longest video, the looks, powers, videos a day, the library size, no watermark, every game |
| **day** | the daily allowance's window: the UTC calendar day, so it comes back at midnight UTC; what it has used is kept on the account ([accounts-and-billing](docs/accounts-and-billing.md#6-plans-and-features)) |
| **subscription** | an account's one row naming its plan, status (`active`, `canceled`), source (`manual` or a provider), optional end date; in force or not is worked out on every request, and an ended one falls back to the default plan |
| **change log** | the append-only record of every subscription, plan and account-standing change: who, when, before, after |

## Architecture

```
 panel (ui/) ─edits─▶ Config ◀─ dice: randomMatchup() / presets / "Make it close": balance()
     ▲                  │
 the plan's features    ├─▶ predict()  ─▶ Outcome: winner, time ─┬─▶ when slow motion starts, the lead changes to mark
 (GET /api/account)     │                                        └─▶ plannedLines() ─▶ VoiceCache ─▶ Kokoro (in the browser)
                        └─▶ createWorld() ─▶ DuelWorld.step(1/240 s) ─▶ events ─┬─▶ Renderer (canvas 1080×1920; the watermark on its plan)
                                                                                └─▶ Sonifier ─▶ AudioEngine
 AudioEngine: notes + cracks + narration ─▶ master ─┬─▶ speakers
                                                    └─▶ MediaStream ─┐ (none when silent)
 canvas.captureStream(60) ───────────────────────────────────────────┴─▶ Recorder ─▶ .mp4 in Downloads
                                                                                 └─▶ POST /api/videos

 SITE_URL host  ─┬─▶ Workers Assets: the public pages and every file (public/_headers)
                 ├─▶ Worker, pages first: /app, /account, /admin, /login, /signup ─ session? ─▶ the page, or /login?next=
                 └─▶ Worker, /api/* ─ SITE_URL ─ same origin ─ session ─ role ─▶ routes ─▶ D1: users, sessions, tokens,
                                                                                     throttle, plans, subscriptions,
                                                                                     change_log, videos, posts
                                                            └─▶ Resend (verify and reset mails)
```

- The simulation never touches the DOM, so the same code runs in the page and in Node
  (`npm run tune`), and a prediction made before the race is the race. The home page's hero
  runs it too, muted.
- A frame advances the world by whole 1/240 s steps; slow motion only means fewer steps
  per frame, so it can never change the outcome.

## End-to-end flows

**Someone signs up.** `/signup` posts the address and password; the Worker (throttled per IP)
hashes the password, creates a `user` account with a subscription to the default plan (Rookie)
and a `created` line in the change log, stores a confirmation link and mails it after the
answer, and starts a session: the page goes on to `/app`. The studio loads the account
(`GET /api/account`: plan in force, features, library count; the plans from `GET /api/plans`
beside it) before it starts, and turns off what the plan lacks, at full contrast with a Paid plans
tag and a line on what the paid plans add. Until the link in the mail is opened, a banner asks
for it.

**The dice is clicked.** `randomMatchup(seed, cfg, powers)` picks two different
sequences, a power for about one matchup in four (never, with the panel's Powers in random
matchups switch off or a plan without powers), layers both can break in 14–80 hits, two colours far apart and
a melody, names the balls, and calls `balance()`. Balancing measures when each team
touches the line (`finishTimes`), scales its speed so the winner lands on the race length
and the loser the finish gap after it, repeats a few times, and rejects anything off by
more than 0.6 s or slower than 140 / faster than 3200 px/s; the generator then tries the
next combination. The result replaces the config, the run restarts and the matchup card at
the top of the panel shows "X wins by 0.3 s".

**Play is pressed.** Audio unlocks (a click is required), the run restarts, and, if the run
has a narrator (the Sound set to Narrator and music, a plan that includes it), its two lines
are generated first (the opening, and the winner line for the predicted winner), from the
session cache when it can. Then the frame loop runs the phases: hold → race → slow motion from
0.6 s of race before the predicted win → winner card → done. The first frame carries the
opening title (the names, the VS, the question), which fades out a second into the race; a
lead change the prediction marked flashes LEAD CHANGE with a sting; the card says the margin
("Won by 0.3 s"). The opening plays as the run starts and the race runs without a word; at the
win every ball stops, the loser's too, and the winner line plays once the opening has ended.
Silent plays nothing.

**Play without voice is pressed.** The run restarts and plays at once with its notes,
cracks and fanfare, but no narrator: nothing has to be generated. Play or Record starts a
run with the narrator again.

**Record is pressed.** Play is the free preview, and the race it shows is the race Record makes.
The studio first checks the plan (length, look, sound, powers, the day's videos), warns if the
library is full, and asks before the day's last video. Then the same as Play, except that once
the narration is ready the server takes one of today's videos (`POST /api/account/day`; a no
stops it there), and a `MediaRecorder` on the canvas and the audio engine's stream (none for a
silent video) starts with the first frame. The winner card
stays until the video reaches its length (and the winner line has ended); the last half second
fades into the run's first frame, so the video loops without a cut; then the file downloads,
and the video (its config, the prediction's winner and margin, the file name) is posted to the
account's library, where the Worker checks the length, the sound, the look, powers and the
library size against the plan. A save that cannot get through waits in the browser, tagged with the account, and is
sent on its next load.

**The Videos page is opened** (`/app/videos`, the button in the panel header). It loads the
account's videos and their links in one request; a link box saves on its own, **Open in
studio** goes to `/app?video=<id>`, and the studio loads that config exactly as recorded.

**A superadmin changes a plan or a subscription.** In `/admin`, the Worker has checked the
session and the role before serving the page and checks them again before matching any
`/api/admin/*` route. Saving a user's subscription (plan, end date, status) or a plan's fields
writes the change and its `change_log` line (before and after) in one batch. The user's next
request works out the new plan in force: the studio follows on its next load. An end date
takes effect when it passes, with nothing scheduled.

## Conventions and gotchas

- **Determinism is load-bearing.** Balancing, slow motion and the narration plan all
  assume the page replays the prediction exactly. No engine-rounded maths in the
  simulation: `Math.sin`/`cos`/`atan2` gave Node and Chrome different winners in testing.
  [src/sim/CLAUDE.md](src/sim/CLAUDE.md).
- **Balancing relies on zero gravity and mirrored bounces.** A ball k times faster then
  runs the same path k times sooner. `balance()` sets gravity to 0; a clamped bounce (or
  gravity) would break the scaling.
- **The race stops at the win.** Every ball stops, the loser's too, so nothing races on under
  the winner card; only `finishTimes` lets a world run on (`runOn`), to measure the margin.
- **Kokoro is the only voice.** Its lines are audio buffers that go through the engine and
  into the file; the browser's `speechSynthesis` plays outside Web Audio and never would. No
  voice needs a key or costs money.
- **Kokoro needs cross-origin isolation to be fast.** `vite.config.ts` sends COOP/COEP
  (`credentialless`) on dev and preview, [public/_headers](public/_headers) on every page in
  production, and [worker/pages.ts](worker/pages.ts) on the pages it serves; without them ONNX
  silently runs on one CPU thread (`crossOriginIsolated` in the console tells). On a GPU it uses
  the full-precision model (~330 MB, downloaded once). **So no page embeds a third-party iframe
  or depends on a popup.**
- **ONNX Runtime comes from this site**, not jsDelivr (`ORT` in
  [narration.ts](src/audio/narration.ts)): the voice model from Hugging Face is the only thing a
  visitor's browser fetches from another company, as the privacy page says. A new outside
  request belongs on that page too.
- **A canvas never loads a web font by itself.** [app.ts](src/app.ts) and the home page's hero
  call `document.fonts.load` for Rubik before drawing; without it the video falls back to the
  system font.
- **The tab must stay visible while recording.** A hidden tab stops
  `requestAnimationFrame`, and the recording with it.
- **The session is checked before route matching**, the role too for `/api/admin/*`, and
  **public routes are an explicit list** (signing up and in, the links in mails, the plans,
  the payment webhook). Without `SITE_URL` in production every request is a 500: it fails
  closed. Only localhost relaxes it. [accounts-and-billing](docs/accounts-and-billing.md#5-the-session-check).
- **Every video and link query names the account.** Another account's video is a 404, like a
  missing one.
- **Nothing reachable over HTTP grants `superadmin`.** Only `npm run admin`.
- **The local database follows `database_id`** in `wrangler.jsonc`: changing the id opens
  an empty local database. It holds the owner's real videos; the first local superadmin receives
  the ones recorded before accounts.
- **No cron.** The account's five cron triggers are all Hoops'; nothing in BounceReel runs on
  a schedule. A subscription's end date takes effect when a request reads it.
- **Saved settings are versioned** (`bouncereel:config:v1:<account>`), one per account, and
  cleared when the account signs out of the browser. `mergeConfig` drops unknown keys and fills
  missing ones from the defaults, so an old save never breaks the page; a change of meaning
  (not just shape) needs a new key. A config from the library or a file goes through
  `savedConfig`, which reads one from before the looks as the cards look it was recorded with,
  not the new default.
- **The dice's Powers in random matchups switch is not in the config** (`bouncereel:dice`): loading a classic, a
  file or a video replaces the config and must not change what the next roll may do. It is off
  until someone turns it on.
- **The daily allowance counts recordings, not previews or the library** (`users.day_started_at`,
  `users.day_videos`): deleting a video never gives the day back. A day is the UTC calendar
  day, the same for everyone. The server takes the video as Record starts
  (`POST /api/account/day`, `claimDay`), before the first frame; the save does not count
  again, and the studio's Record button only mirrors the count.
- **The watermark is drawn by the studio** from the plan's `watermark` feature: the server
  never sees the pixels, so it cannot check it, and the terms ask that it stays on.
- **The logo is one drawing in three places**: [public/mark.svg](public/mark.svg),
  [public/favicon.svg](public/favicon.svg) (on an ink tile) and `drawMark` in
  [renderer.ts](src/render/renderer.ts), which draws it on canvases (the watermark, the share
  image). Change all three together.
- **The site's images are drawn by the renderer** ([scripts/stills.ts](scripts/stills.ts)):
  remake them after a change to the renderer, the layout or the first built-in matchup, or the
  hero's still frame no longer matches its first live frame ([website](docs/website.md#5-the-images)).
