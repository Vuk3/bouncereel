# Development

Setup, scripts, the balance check, the control panel, checking a change in one browser
tab, test recordings, and what the pages store. The Worker, the database and deploying:
[build and deploy](./build-and-deploy.md).

| I need to change... | Touch |
| --- | --- |
| a script | [package.json](../package.json) |
| dev and preview headers, the pages in the build, the Worker in Vite | [vite.config.ts](../vite.config.ts) |
| the TypeScript settings | [tsconfig.json](../tsconfig.json) (pages, scripts, shared/), [worker/tsconfig.json](../worker/tsconfig.json) (the Worker) |
| a panel field, a tab | [src/ui/fields.ts](../src/ui/fields.ts) (one line per field) |
| the matchup card, the dice block, the Video settings, the toolbar | [app.html](../app.html), [src/app.ts](../src/app.ts) |
| what the plan disables in the studio | `applyPlan`, `fitPlan`, `planProblem` in [src/app.ts](../src/app.ts), [src/ui/plan.ts](../src/ui/plan.ts) ([accounts-and-billing](./accounts-and-billing.md#6-plans-and-features)) |
| the tabs, how a field is built (swatches, chips) | [src/ui/panel.ts](../src/ui/panel.ts) |
| the panel's look, the two themes | [src/style.css](../src/style.css) (tokens at the top) |
| the theme toggle | [src/ui/theme.ts](../src/ui/theme.ts), the boot script in each page's head |
| the Videos page | [docs/video-library.md](./video-library.md) |
| the public site, the account page, the admin area | [docs/website.md](./website.md), [docs/accounts-and-billing.md](./accounts-and-billing.md) |
| the balance check | [scripts/tune.ts](../scripts/tune.ts) |

## 1. Setup and scripts

```sh
npm install
npm run dev        # http://localhost:5173 (the owner runs this)
```

| Script | Does |
| --- | --- |
| `npm run dev` | Vite dev server with the cross-origin-isolation headers Kokoro needs, the Worker (`/api`) and the local database; applies local migrations first |
| `npm run check` | `tsc` for the pages, then `tsc -p worker` for the Worker: **the gate** |
| `npm run build` | `check`, then `vite build` into `dist/client/` (pages) and `dist/bouncereel/` (Worker) |
| `npm run preview` | build, then serve it with the same headers, the Worker and the local database |
| `npm run tune` | balance every built-in matchup and 100 random ones at 30, 40 and 60 s, in Node |
| `npm run admin -- <email>` | a local superadmin: prints a link to set its password |

The deploy, migration, type and release scripts are in
[build and deploy](./build-and-deploy.md#1-scripts).

There is no test runner and no linter. Chrome is the target browser (MP4 recording,
WebGPU for Kokoro).

**TypeScript runs the simulation in plain Node.** Node strips types itself, so imports
carry their `.ts` extension, type-only imports say `import type`, and nothing may need
emitting (no enums, namespaces or parameter properties): `allowImportingTsExtensions`,
`verbatimModuleSyntax` and `erasableSyntaxOnly` in [tsconfig.json](../tsconfig.json)
enforce it.

## 2. The balance check

`npm run tune` (or `npm run tune -- 45` for one length) prints, per video length, every
built-in matchup's balanced length, winner and speeds, then a line for 100 random
matchups as the dice makes them and one with powers off (then the finish gaps):

```
── 40 s videos
  Fibonacci vs Slow Factorial      40.0 s  Slow Factorial Ball wins  speeds 2103/483
  …
  100 random matchups: 3.1 ms each (worst 8 ms), 31 with a power, 84 photo finishes, 0 more than 1 s off length
  100 random, no powers: 2.9 ms each (worst 12 ms), 0 with a power, 85 photo finishes, 0 more than 1 s off length
```

Run it after any change to [src/sim/](../src/sim/), [layout.ts](../src/layout.ts) or the
presets. "cannot fit" for a preset, or anything but 0 off-length random matchups, is a
regression.

## 3. The control panel

One column, in the order the work goes: what the matchup is, a new one, the video's
settings, then everything else in tabs. Fields in the tabs are generated from
[fields.ts](../src/ui/fields.ts) (`TABS`): each names a path into `Config`. Fields marked
`live` (looks, sound, words) apply to the running video; any other change restarts the run,
and a run that was playing holds its first frame until the narrator's lines for it are
generated (`startOver` in [app.ts](../src/app.ts)).

- **The matchup card** ([app.html](../app.html), `syncMatchup` and `showPrediction` in
  [app.ts](../src/app.ts)) reads like the home page's race board: both balls as the video
  stacks them, each with its colour, name, numbers (and power), its starting speed against
  the slower one ("4.4×") and its lane to a checkered line, the winner's full and the
  loser's as far as it had got when the winner finished (`outcome.runnerUp`), so a photo
  finish is two bars almost level (a race nobody finishes has no lanes). Under them, on a
  strip of finish-line squares, how it ends ("X wins by 0.3 s", "The video runs 40 s"), with
  **Make it close** or **Rebalance** when a hand edit made the race uneven, off the gap or the
  wrong length, and, when a matchup cannot be balanced, which ball is in the way and what to
  change, until the matchup changes ([balancing](./matchups-and-balancing.md#1-balancing)).
- **The dice** and what goes with it: Random matchup (the tallest button, with the site's
  dice; violet while nothing is ready to record, see below); the **Play with the narrator**
  switch (on, the default: Play and Restart have the narrator; off: they start at once with
  all the other sounds and nothing to generate; flipping it starts the run over in the new mode;
  greyed out when Sound is not Narrator and music; Record follows Sound either way, not this
  switch; not kept between visits); New race; the **Powers in random matchups** switch
  (on: about every other roll gives a ball a power; off, the default: never; the one-line hint
  under it says so; kept under `bouncereel:dice`, not in the config); **Classics…**, the built-in
  matchups, a select drawn as a ghost pill.
- **Video**: Length; Finish gap (photo finish, or 1–10 s between winner and loser); Sound:
  Narrator and music, Music only or Silent, what Record puts in the file and Play plays
  ([recording and export](./recording-and-export.md#the-sound)); a change balances the race
  again. Look: Paper, Cards or Night, each a thumbnail of this matchup's first frame in it,
  without the opening title, whose wash would hide the look
  ([look and layout](./look-and-layout.md) §6). A look changes only the drawing, so the run
  goes on. **Ask viewers to follow**: the follow button in the race and under the winner card,
  and "Follow for more!" from the narrator ([look and layout](./look-and-layout.md) §14); off by
  default, locked with a Paid plans tag on a plan without `follow`; a change balances the race
  again, since the winner card stays up longer with it.
- **Tabs** (arrow keys move between them):
  - **Balls**: top ball and bottom ball (name, colour from the dice's palette or any other,
    the numbers it hits with, its power and how much), and the layers, top first, with
    how they will read on screen.
  - **Voice**: Kokoro's eight voices as a list, each with its accent, its grade and a play
    button that says this matchup's names in it; the opening (empty for the automatic one, shown
    as the placeholder); the winner line (empty for none); **Hear the opening**, in the
    picked voice ([sound and narration](./sound-and-narration.md#4-the-voice)).
  - **Sound**: melody, instrument, volume, and **Hear the music**: the melody's first notes on
    the instrument, without a race ([sound and narration](./sound-and-narration.md#2-what-sounds-when)).
  - **More**: Video (the last line on the winner card, the loop ending, hold before the
    start, winner card minimum, number separator, platform UI zones); Physics (both
    speeds, which balancing sets, ball sizes, gravity, speed limit); Seed and files (the
    seed, Export and Import of the config as JSON).

The panel keeps one spacing scale (16 px between blocks and fields, 10 inside a block, 6 from a
label to its control); a section's title (Video, Top ball, Physics…) is a small uppercase label
under a hairline, so the fields are what the eye reads.

Keyboard: Space plays and pauses, R restarts (not while recording, and not while a field or
a tab has the focus).

**The stage** (`main.stage`, beside the panel) is the site's ink stage, `#0b0e16` (`#0f131d` at
night), with the preview as its hero: as tall as the screen allows, in the two balls' light
(the top ball's colour high on the left, the bottom one's low on the right, from `--team-a` and
`--team-b`). It re-declares the colour tokens (`color-scheme: dark`), so the buttons, status,
timeline and toast on it need no rules of their own. From 1200 px wide the toolbar (Play,
Restart, Record, the day's allowance, the status, the format at its foot) is a 200 px column on
the preview's right (`row-reverse`, so it stays first in the tab order); narrower it is a row
above, always one line: the status and the format give way with an ellipsis, the format first.
The screen is `calc(100vh - 76px)` tall from 1200 px and `calc(100vh - 128px)` below (the row),
464×824 at 1440×900 and 362×644 at 1280×720, and the page does not scroll (in a browser that
writes WebM the format warning above the screen adds its height, and then it does); on a phone
(900 px and less) the stage comes first and the width sets the size. ⚠️ The light behind the
preview spreads sideways only, and the stage clips its sides alone (`overflow-x`): light above or
below made the page taller than the screen, and a clip on all sides would hide whatever ran past
the bottom. A message (`#toast`) shows over the video's foot, above the timeline. The column is
`.stage-preview`, not `.preview`: the admin area's plan drawer already has a `.preview`, and
both load style.css.

**The timeline** under the preview (`buildTimeline` and `syncTimeline` in
[app.ts](../src/app.ts)) is this run's phases at their real lengths, from the prediction and
[pacing.ts](../src/pacing.ts): the hold (`startDelay`), the race up to the slow-down
(`T − SLOWMO_LEAD`), slow motion into and out of the win (`SLOWMO_LEAD / SLOWMO + SLOWMO_TAIL`,
2.0 + 1.2 s), the winner card up to the video's length less `END_PAD`, then Loop (the fade into
the first frame) or End (a held end without `look.loop`); a race nobody finishes has no slow
motion, and a card stays at least 1.5 s, so a late finish pushes the end past the length. Each
segment names itself only where the whole word fits (container queries); its tooltip gives the
seconds. It is built on every restart and on a live change of the hold or the loop. Each frame
moves the played part by `translate` alone (a layer as wide as the track: no layout) and
writes the clock ("12.4 / 30.0 s", the video's own seconds against its length) when the tenth
changes; the clock stops at the run's end and turns amber if that end came after the length,
as when a long winner line held the card. The status's and the clock's text cost a small layout
each change (in Chrome a flex or grid item is never a layout boundary); 10 s of play measured
14–19 a second, none over 0.6 ms, and no long task.

The panel's header holds the **Videos** page (a play sign in a box,
[video library](./video-library.md#6-the-videos-page)), the **admin area** (a shield, for a
superadmin), the **account** page and the theme. Under it, until the address is confirmed, a
banner asks for it with a button that sends the mail again.

**The plan card**, under the header on a plan that holds anything back: "Your plan: Rookie",
a tick for each thing it makes and a dash for each it leaves out, and Compare plans.

**What the plan does not include reads as an invitation, not an error** (`applyPlan`): it stays
in view at full contrast, off, with a small **Paid plans** tag on it (the looks it lacks, a sound,
the Powers switch), and under it, in the accent, what upgrading brings and a See plans link to
`/pricing`: "Up to 90 s on the paid plans", "Cards and Night on the paid plans", "Narrator and
music on the paid plans", "Powers on the paid plans; the dice gives none on yours", the watermark
"the paid plans have none", and in the Voice tab "The narrator comes with the paid plans; you can
hear each voice here". The words come from the plans (`GET /api/plans`, loaded beside the account
in [src/main.ts](../src/main.ts)): a line says "on the paid plans" only when every paid plan has
it, and a plan's name never; without the plans, or when one paid plan lacks it, the plain "not in
your plan" stays. The Length slider stops at the plan's longest; the classics with a power and
the Power fields are off; the Voice tab's fields, out of reach (inert), are the one thing dimmed.
Record refuses a config the plan cannot record and says why (a library video in a look the plan
lacks, say) ([accounts-and-billing](./accounts-and-billing.md#6-plans-and-features)). The studio
starts only once it has the account (`GET /api/account`).

**Play and Record on a plan with a daily limit**: the Play with sound button over the preview
says that previews are free and only Record counts; beside Record, what is left of the day;
before the day's last video, a question (`#record-confirm`) that says it is the last and when
the next one is. Record has the server take the video as it starts. While it records, a bar over
the preview says what is left, to keep the tab in front and the headphones as they are, and
when the sound stalls; when it ends, a sheet gives the file
and what the library did with it, with Open Videos and Roll the next one
([recording and export](./recording-and-export.md#1-making-a-recording)).

**A first visit** (the account has no saved config: `load` sets `fresh`) opens on the balanced
classic, ready, and one hint in the toolbar, "Play to watch this race, Record to make the MP4"
(`showHint`): under Record in the column from 1200 px, hanging under the row below that. It goes
at the first Play or Record and is remembered for the account (`bouncereel:hints:v1:<id>`).

Over the preview, a browser that cannot write MP4 gets a warning before anything is recorded
(`#format-warning`, [recording and export](./recording-and-export.md#3-the-file)).

**Rubik** is the panel's font as well as the video's, so a name in the matchup card looks
the way it will on screen. **The look is the public site's** (its tokens are the site's:
cool grey ground, white tiles, hairlines, 12 and 22 px corners), so the studio reads as the
same product. **Colour has a meaning**: the two balls' colours (`--team-a`, `--team-b`, set
from the matchup; the logo takes them too); violet for the one action that matters on
screen and for keyboard focus; red only while recording; a selection (the picked look,
swatch, tab, voice) is ink; everything else grey and white.

- **One violet action** (`syncPrimary` in [app.ts](../src/app.ts), called from
  `showPrediction` and `syncDay`): Record, when the race can be recorded as it is (it ends as
  asked, the plan records it, a video is left today, the browser writes a file); the dice
  otherwise, so a race that needs Make it close, a plan's limit or a used day points at a new
  matchup. Every other button is a ghost pill (a hairline outline); while recording Record is
  red and pulses, and a button that is off is grey.
- **Icons** are inline SVG in the site's style (24 viewBox, a 2 px round stroke in
  `currentColor`, `aria-hidden`), always beside their word; play, pause, record and stop are
  solid shapes, as on the site's players. Play and Record each hold both of their icons, and
  `updateStatus` sets the label and `data-state`, which shows one. While recording, the status
  reads "REC 12.3 s" after a red dot drawn in CSS. The video's own marks (the bolt tag, the
  trophy on the winner card) are the renderer's and stay.
- **One focus ring**: 2 px of violet, 2–3 px out, on every button, link, tab, swatch, range and
  switch; a text field or select turns its border violet with a soft violet ring instead.
  Ranges, checkboxes and an on switch are violet too (`accent-color`).

**Two themes** for the page around the video; the video keeps its own colours. Light is
the default; the moon/sun button in the panel's header switches, saves the choice, and
spreads the new theme from the button as a circle (a view transition; instant with
reduced motion). Every colour is a token in [style.css](../src/style.css) written with
`light-dark()`, resolved by `color-scheme`: `light` on `:root`, `dark` under
`html[data-theme='dark']`, which a script in [app.html](../app.html) sets from the saved
choice before first paint so a dark page never flashes light (the pages behind the sign-in
have the same script, the `app:head` partial, and share the toggle, [src/ui/theme.ts](../src/ui/theme.ts)). No raw colours
in a rule below the tokens. Selects draw their own chevron (the native arrow painted over the border).

⚠️ **Rules for a field's label are `.field > label`**, children only: a looser
`.field label` also catches the look tiles (labels inside the Look field) and lays them
out as a row.

## 4. Checking it in a browser

Do not start the dev server; the owner runs it. To see a change:

```sh
npx vite build
npx vite preview --port 4199 --strictPort   # in the background
```

- The preview runs the Worker and the local database too: `/api` answers, the studio is
  http://localhost:4199/app and the Videos page http://localhost:4199/app/videos.
- **Sign in first**: the studio, the account page and the admin area need a session. Sign up
  on http://localhost:4199/signup (the confirmation link is in the preview's output), or make
  a superadmin with `npm run admin -- you@example.com` and open the printed path on port 4199.
  ⚠️ The first local superadmin receives the videos recorded before accounts (the owner's): for a
  throwaway check, back up `.wrangler/state/v3/d1` first and put it back afterwards, or delete
  only the accounts you made.
- **One tab.** Open the page in one tab of the automation browser and do everything there;
  resize it rather than opening another.
- Start playback through the page (`#start`, `#play`), set fields by changing the
  `select`/`input` named after the config path and dispatching `change`/`input`.
- **Afterwards**: stop the preview server, and quit the automation Chrome itself (the
  process with `--enable-automation` and the `chrome-devtools-mcp` profile), not just
  its tab. Never touch the owner's own Chrome.

## 5. Test recordings

A recording downloads to `~/Downloads`. Check it with the commands in
[recording and export](./recording-and-export.md#5-checking-a-file) (length, codecs,
spectrum for the voice), look at a few frames
(`ffmpeg -ss 20 -i video.mp4 -frames:v 1 frame.png`), then **delete it**. The recording
is also a row in the local database, under the account that recorded it: delete it on the
Videos page (or `npx wrangler d1 execute bouncereel --local --command "DELETE FROM videos WHERE id = …"`),
and delete the test account when done (the admin area, or the account page).
The voice model stays in the automation browser's cache, so later runs skip the download.

## 6. What the pages store

| Key (`localStorage`) | Holds |
| --- | --- |
| `bouncereel:config:v1:<account id>` | the whole config, saved on every change, **per account**; merged into the defaults on load, so missing keys are filled and unknown ones dropped. Removed when the account signs out of this browser. One saved before accounts, under the bare `bouncereel:config:v1`, is taken over by the first account that opens the studio here |
| `bouncereel:dice` | `{ "powers": true }`: whether the dice may give a ball a power; apart from the config, so loading a matchup keeps it |
| `bouncereel:hints:v1:<account id>` | `seen` once the first visit's hint has been acted on (the first Play or Record), so it shows once; removed with the config when the account signs out of this browser |
| `bouncereel:theme` | `light` or `dark`; read by every page's head before first paint, the public site's too |
| `bouncereel:pending-videos` | recordings whose save to the library failed, each with the account that recorded it, sent again on the next load into that account only ([video library](./video-library.md#4-what-record-saves)) |

Two cookies come from the Worker, not the pages: the session (HttpOnly) and `br_hint`, which
only tells the public pages to offer "Open studio"
([accounts-and-billing](./accounts-and-billing.md#2-sessions-and-cookies)).

Keys saved under the project's earlier name (`arcade:…`) move to these once, in the boot
script at the top of the studio, before anything reads them; a key that
already exists under the new name wins. `bouncereel:keys`, where paid voices' API keys were
kept, is removed when the studio starts: the narrator needs none, and a key left in a browser
is a secret with no use.

Generated voice clips live in memory only, for the session. Kokoro's model sits in the
browser's Cache Storage. The videos themselves live in D1, locally in `.wrangler/state`.

## Changelog

- 2026-10-18 - scripts, the balance check, the panel, browser checks, test recordings.
- 2026-10-18 - Play without voice; light (default) and dark themes; selects with their own chevron.
- 2026-10-18 - the project is Arcade: folder, package and storage keys renamed.
- 2026-10-19 - the Worker and local D1 in dev and preview, the split type check, the Videos button, the pending-videos key.
- 2026-10-19 - the Finish gap slider in the top block.
- 2026-10-19 - the panel in one column: matchup card, dice with the Powers switch and Classics, Video with the look thumbnails, then tabs (Balls, Voice, Sound, More); Rubik for the panel; the `arcade:dice` key.
- 2026-10-20 - the project is BounceReel: folder, package, Worker, D1 database, domain and storage keys renamed; old `arcade:` keys move over once.
- 2026-10-20 - the studio at `/app` behind the sign-in: the Sound field, the plan's limits shown disabled, the account and admin buttons, the confirmation banner; the config saved per account; `npm run admin`.
- 2026-10-21 - the Voice tab lists Kokoro's voices with a ▶ preview each, no keys or call-outs; the switch is Powers in random matchups, with a hint; the matchup card explains a matchup that cannot balance; the MP4 warning over the preview; `bouncereel:keys` removed.
- 2026-10-21 - the plan card at the top of the panel; previews are free, said on the Play with sound button; a question before the day's last video.
- 2026-10-21 - the studio in the site's identity: the site's tokens, pill buttons with one violet action (Record when the race is ready, the dice otherwise), inline SVG icons instead of glyphs and emoji, one violet focus ring, violet ranges, checkboxes and switch; the yellow dice and play disc gone; the voice in use marked in the Voice tab on load.
- 2026-10-23 - the preview on an ink stage in the balls' light, the toolbar a column beside it from 1200 px (one row below), a timeline of the run's phases with a playhead and the video's clock under it, the matchup card's lanes as on the home page's race board, the panel on one spacing scale with small section titles and Classics as a ghost pill; red buttons keep one red in both themes (`--rec-fill`).
- 2026-10-23 - what the plan holds back at full contrast with a Paid plans tag and, in the accent, what the paid plans add (worded from `GET /api/plans`); a first visit's one hint (`bouncereel:hints:v1:<id>`); the recording bar and the sheet after a take, pointed to.
- 2026-10-23 - the look thumbnails are drawn without the video's opening title.
- 2026-10-24 - the Videos page has the console pages' head (`app:head`): no `arcade:` boot of its own, the studio's does it.
- 2026-10-27 - the Play with the narrator switch replaces Play without voice; Hear the music in the Sound tab.
- 2026-10-27 - the recording bar asks to leave the headphones as they are and says when the sound stalls.
- 2026-10-30 - the Ask viewers to follow switch under the looks; a run restarted while it plays generates its narration first.
