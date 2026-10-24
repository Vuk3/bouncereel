# Video library

The database of recorded videos, each account its own: what Record writes when a file is
saved, why a config is enough to make a video again, the schema, the `/api` routes, links to
YouTube, TikTok and Instagram, the Videos page (`/app/videos`), and how statistics or another
game would be added.

| I need to change... | Touch |
| --- | --- |
| what is stored for a recording | [src/app.ts](../src/app.ts) `libraryEntry`, [shared/api.ts](../shared/api.ts) `NewVideo`, [worker/validate.ts](../worker/validate.ts), [worker/videos.ts](../worker/videos.ts), a migration |
| a table or column | a new file in [migrations/](../migrations/) ([rules](../migrations/CLAUDE.md)), then [worker/videos.ts](../worker/videos.ts) and [shared/api.ts](../shared/api.ts) |
| a route | `ROUTES` in [worker/router.ts](../worker/router.ts), a handler in [worker/routes/videos.ts](../worker/routes/videos.ts) |
| what a plan allows on save (length, sound, look, powers, library size) | `checkPlan` in [worker/routes/videos.ts](../worker/routes/videos.ts), the limit inside `insertVideo` in [worker/videos.ts](../worker/videos.ts); the day is taken earlier, as Record starts; the plans themselves: [accounts-and-billing](./accounts-and-billing.md#6-plans-and-features) |
| which links are accepted | [shared/links.ts](../shared/links.ts) |
| a platform | `PLATFORMS` in [shared/api.ts](../shared/api.ts), [shared/links.ts](../shared/links.ts), the `CHECK` on `posts.platform` (a migration), the page's filter in [app/videos.html](../app/videos.html) |
| saving after Record, the retry queue | [src/library.ts](../src/library.ts) |
| loading a video back into BounceReel | [src/app.ts](../src/app.ts) `openFromLibrary` |
| the Videos page | [app/videos.html](../app/videos.html), [src/dashboard.ts](../src/dashboard.ts), the "Videos page" part of [src/style.css](../src/style.css) |
| how the page talks to the API | [src/api.ts](../src/api.ts) |
| who is signed in, sessions | [accounts-and-billing.md](./accounts-and-billing.md) |
| deploy, limits | [build-and-deploy.md](./build-and-deploy.md) |

## 1. A video is its config

The MP4 is never stored. A video's row holds its whole `Config`
([config.ts](../src/config.ts)), and the simulation is deterministic
([simulation](./simulation.md)): the same config replays the same race, the same
narration lines and the same notes. Loading it back makes the same video, ready to record
again or to change.

The row also stores `app_version`, `package.json`'s version when it was recorded
([vite.config.ts](../vite.config.ts) defines `__APP_VERSION__`). ⚠️ A later change to the
simulation, the balancer's output, the narration rules or the look can make the same
config play differently; the version says which code made the file. The narrator is
generated again on each take, by Kokoro on that computer (the full model on a GPU, the
8-bit one without), so it can differ slightly between takes. A video saved with a voice
the studio no longer has opens with the default voice, and one saved without a narrator,
or with the browser's voice, opens as Music only (`savedConfig`,
[sound and narration](./sound-and-narration.md#4-the-voice)).

## 2. The schema

[migrations/0001_initial.sql](../migrations/0001_initial.sql),
[0002_accounts.sql](../migrations/0002_accounts.sql):

**`videos`**, one row per finished recording.

| Column | Holds |
| --- | --- |
| `user_id` | the account it belongs to; deleting the account deletes its videos. NULL only for the videos recorded before accounts, until the first superadmin is made and receives them ([accounts-and-billing](./accounts-and-billing.md#1-accounts-and-roles)) |
| `game` | `ball-race` for every video so far |
| `recorded_at` | when the recording finished, ISO UTC, as the browser saw it (a save retried later keeps its own time) |
| `title` | "Fibonacci Ball vs Doubling Ball" |
| `file_name`, `format` | the downloaded file's name, and "MP4 · H.264 · AAC" |
| `seconds` | the measured length of the recording; `video_length` is the length it was balanced for |
| `stopped_early` | 1 when **Stop & save** ended it before the winner card had its time |
| `seed`, `config` | the seed, and the whole config as JSON |
| `app_version` | section 1 |
| `a_*`, `b_*` | name, sequence and special of the top (`a`) and bottom (`b`) ball, copied out of the config so sorting and grouping never parse JSON |
| `winner`, `margin`, `lead_changes` | `'a'`/`'b'` (NULL only if nobody finished), seconds between the two at the line, how often the lead changed: from the prediction, which is the race |

**`posts`**, where a video went up: at most one per platform (`UNIQUE (video_id, platform)`).
`platform` is `youtube`, `tiktok` or `instagram`; `url` is the link as given, made absolute;
`external_id` is the post's id read from the link (section 5), NULL when the link does not
carry one; `user_id` copies the video's owner. A partial unique index on
`(user_id, platform, external_id)` keeps one published video from being linked to two of an
account's recordings; two accounts may link the same public post. Deleting a video deletes
its posts (`ON DELETE CASCADE`; D1 always enforces foreign keys).

## 3. The API

Every route needs a session, and anything but GET must come from the site's own origin
([accounts-and-billing](./accounts-and-billing.md#5-the-session-check)). **Every query names
the signed-in account**: another account's video, link or id answers exactly like one that
does not exist (404 `video_not_found`), never 403, so nothing tells them apart. Shapes are in
[shared/api.ts](../shared/api.ts); errors are `{ "error": { "code", "message" } }`.

| Method | Route | Does |
| --- | --- | --- |
| GET | `/api/videos` | the account's videos, newest first, each with its posts; no configs. Two queries, whatever the count |
| POST | `/api/videos` | a recording (`NewVideo`) → `201 { id }`, if the plan allows it (below) |
| GET | `/api/videos/:id` | one video with its config and posts |
| DELETE | `/api/videos/:id` | the video and its posts → 204 |
| PUT | `/api/videos/:id/posts/:platform` | set or replace a link: `{ url }` → `{ post }` |
| DELETE | `/api/videos/:id/posts/:platform` | remove a link → 204 |

| Code | When |
| --- | --- |
| `invalid_<field>` (400) | a body field is missing or out of range; the message names it. The page never sends one |
| `invalid_url` (400) | not a link to a post on that platform |
| `video_not_found`, `post_not_found`, `not_found` (404) | no such video, link, platform or route |
| `post_taken` (409) | that post is already linked to another of the account's videos |
| `not_in_plan` (403) | the video is longer than the plan's longest, or made with a sound, a look or a power the plan does not include |
| `library_full` (403) | the account's library holds as many videos as its plan keeps |
| `unauthenticated` (401) | no session ([accounts-and-billing](./accounts-and-billing.md#5-the-session-check)) |
| `method_not_allowed` (405), `cross_origin` (403), `unsupported_media_type` (415) | as named |

**What the server checks on save**, in this order. `checkPlan`: the length the video was
balanced for (`videoLength` and the config's `timing.video`) against the plan's `maxSeconds`;
the sound it was recorded with (`config.sound.track`, `narrator` when a config predates the
choice) against the plan's sounds; its look (`config.look.skin`) against the plan's looks; a
ball with a power against `powers`. Then the library limit, counted inside the `INSERT`, so two
saves at once cannot both take the last place. The day is not counted here: Record took the
day's video from the server as it started (`POST /api/account/day`), so a save never uses one,
and deleting a video never gives one back. The studio disables what the plan lacks, so it only
meets these from a second tab or a stale page
([accounts-and-billing](./accounts-and-billing.md#6-plans-and-features)).

A config may be up to 64 KB of JSON (a few KB is usual).

## 4. What Record saves

When a recording ends, `finishRecording` in [app.ts](../src/app.ts) downloads the file,
then sends `libraryEntry(…)` to `POST /api/videos`. The sheet that opens after a take
(`showFinished`) gives the file ("…-seed-1.mp4", "30.0 s, 9.1 MB, in your browser's downloads")
and the library's answer from `addToLibrary` in [library.ts](../src/library.ts): "Added to
Videos, where you paste its links once it is posted."; "Not added to Videos." and the server's
reason, with a See plans link when the plan stood in the way; or "Not in Videos yet (…): it goes
in the next time the studio or the Videos page opens." Both endings are saved: the recording
that stops by itself, and
**Stop & save** (`stopped_early`). Record warns first when the library is already full: the
file still downloads. On a plan with a daily limit Record says beside it what is left of the
day, asks before the day's last video, takes it from the server as the recording starts, and
turns off once the day's videos are made, saying when the next one can be.

A save that fails for a reason that could pass later (offline, a session that ended,
throttling, a 5xx) **waits in the browser** under `bouncereel:pending-videos` and is sent again
when the studio or the Videos page next loads ("1 earlier recording added to Videos"). Any
other refusal (invalid, not in the plan, the day used, the library full) is dropped with a console warning
instead of failing on every load. **A waiting save carries the account that recorded it** and
goes only into that account, so two people signing in on one computer never post into each
other's library; one saved before accounts existed goes only to a superadmin (they were
Vuk's). ⚠️ The queue lives in that browser's `localStorage`: a private window, or clearing
site data, loses it.

The entry is built from a copy of the config taken as the file is saved: the panel edits
the live config in place, and a save that has to wait is sent later.

## 5. Links

[shared/links.ts](../shared/links.ts) `parsePostLink(platform, text)` runs in the page
before a link is sent and in the Worker before it is stored. It takes a link with or
without `https://`, accepts only `http(s)`, compares host names exactly (so
`youtube.com.example.net` is not YouTube; `www.` and `m.` are dropped) and reads the id:

| Platform | Accepted | `external_id` |
| --- | --- | --- |
| YouTube | `youtube.com/shorts/ID`, `youtu.be/ID`, `youtube.com/watch?v=ID`, `/embed/ID`, `/live/ID`, `music.youtube.com` | the 11-character video id |
| TikTok | `tiktok.com/@user/video/ID` (or `/photo/ID`) | the numeric id |
| TikTok | `vm.tiktok.com/…`, `vt.tiktok.com/…`, `tiktok.com/t/…` | NULL: a short link only redirects, and following it would need a request |
| Instagram | `instagram.com/reel/CODE`, `/reels/`, `/p/`, `/tv/`, with or without the account's name in front | the shortcode |

## 6. The Videos page

`/app/videos` ([app/videos.html](../app/videos.html), [src/dashboard.ts](../src/dashboard.ts)),
linked from the ▶-in-a-box button in the studio's panel header and back with **← Studio**.
Same tokens, buttons and two themes as the studio ([development](./development.md#3-the-control-panel)).
`/dashboard`, its old address, redirects here. It shows the signed-in account's videos only.

- **How full the library is, and the day**, on a plan with limits: "3 of 5 videos kept on
  your plan. 1 video left today", with an Upgrade link; in the warning colour once the library
  is full or the day is used ("Next video tomorrow at 09:05").

- **Totals**: videos, how many are on each platform, how many are not posted yet.
- **Search** across title, sequences, seed, file name and length; **Show**: all, not posted
  anywhere, not on YouTube / TikTok / Instagram.
- **The table**: recorded (date and time), the video (title, sequences with specials, file
  name; hover for seed, format and version), length (and **stopped early**), finish
  (winner, margin, lead changes), a link box per platform, **Open in BounceReel**, delete.
  Recorded, Video, Length and Finish sort on click (again to reverse); ties stay newest
  first. Below about 1,200 px the table scrolls sideways inside its card.
- **A link box** saves when it loses focus or on Enter, and an emptied box removes the
  link. A bad link is refused in the page (red box and a toast) without a request. A save
  updates only its own box and the totals, so Tab moves straight on to the next box; the
  filter applies again on the next search, filter or sort.
- **Delete** asks first and removes the video and its links; the file in Downloads stays.
- **Open in studio** goes to `/app?video=<id>`: the studio loads that config through
  `savedConfig` without balancing it again (so the speeds are the recorded ones), clears the
  address, and says "Loaded “…” from Videos". A config recorded before the looks existed has no
  `look.skin` and opens as it was made: the cards look, no last line on the winner card,
  no loop ([look and layout](./look-and-layout.md#6-the-end-a-loop)). One whose last line is
  still the earlier default, "Follow for more!", opens with today's ("Did you call it? Comment
  below!"); a line the creator wrote stays. One recorded on a plan the account no longer has
  opens all the same; Record says what the plan lacks.

## 7. Adding statistics later

Nothing fetches numbers yet: links only. The schema leaves room without a change to what
exists. Statistics hang off `posts.id` in a table of their own, a row each time numbers are
taken, so history is kept and not just the latest value:

```sql
CREATE TABLE post_stats (
  post_id  INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  taken_at TEXT    NOT NULL,
  source   TEXT    NOT NULL CHECK (source IN ('api', 'manual', 'browser')),
  views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER,
  PRIMARY KEY (post_id, taken_at)
);
```

`source` says where the numbers came from: typed in on the Videos page, a button that reads
them in the browser, or an API. For the list, copy the latest numbers onto `posts` as well,
so the page does not read the whole history on every load (D1's 5 M rows read a day). For
an API on a schedule, note that the account's five cron triggers are all Hoops'
([limits](./build-and-deploy.md#limits)).

## 8. Another game

`videos.game` names the game. A new one stores its own config in `config`, leaves the
`a_*`/`b_*`/`winner`/`margin`/`lead_changes` columns NULL, and adds the columns it sorts
by in a migration; `NewVideo` gets a variant per game, and `toSummary` in
[worker/videos.ts](../worker/videos.ts) returns `race: null` for anything but `ball-race`.

## Changelog

- 2026-10-19 - page created: the library in D1, saving after Record with a retry queue,
  links for YouTube, TikTok and Instagram, the Videos page, loading a video back.
- 2026-10-19 - an older video opens in the cards look it was recorded with (`savedConfig`).
- 2026-10-20 - each account its own library: `user_id` on videos and posts, every query scoped (another account's video is a 404), one post per account, the plan checked on save (`not_in_plan`, `library_full`), the retry queue per account, the Videos page at `/app/videos`.
- 2026-10-21 - the daily allowance on save (`day_used`; deleting a video does not give the day back) and on the Videos page; the look and powers checked on save too.
- 2026-10-21 - a video saved with a voice the studio no longer has (ElevenLabs, OpenAI, the browser's) opens with Kokoro's default voice, or as Music only.
- 2026-10-21 - a save no longer counts the day (`day_used` is gone from `POST /api/videos`): Record takes the day's video as it starts.
- 2026-10-23 - the library's answer after a recording is said in the sheet after the take (in sentences), not in a toast.
- 2026-10-23 - a video whose last line is still the earlier default opens with today's comment line.
