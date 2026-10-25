# Website

The public site on `https://bouncereel.vukcvetkovic.com` (`SITE_URL`; its own domain once it is the full product), kept out of search engines for now: which page is where, the parts the pages share,
the look, the home page and its live race, the images, speed, search engines, the words, and
the legal pages. Accounts, plans and the admin area are in
[accounts-and-billing](./accounts-and-billing.md); the studio is everywhere else.

| I need to change... | Touch |
| --- | --- |
| a page's words | its HTML file at the root: [index.html](../index.html), [pricing.html](../pricing.html), [signup.html](../signup.html), [login.html](../login.html), [forgot.html](../forgot.html), [reset.html](../reset.html), [verify.html](../verify.html), [terms.html](../terms.html), [privacy.html](../privacy.html), [refunds.html](../refunds.html), [404.html](../404.html) |
| the header, the footer, the shared head | [src/site/partials/](../src/site/partials/) (`header.html`, `footer.html`, `head.html`) |
| a new page | its HTML file, its line in `PAGES` in [vite.config.ts](../vite.config.ts) (and in the sitemap, once there is one: §7) |
| the look: colours, type, components | [src/site/site.css](../src/site/site.css) (tokens at the top) |
| the live race in the hero | [src/site/hero.ts](../src/site/hero.ts); when it loads: [src/site/home.ts](../src/site/home.ts) |
| the pricing cards | [src/site/pricing.ts](../src/site/pricing.ts); what a plan includes, in words: `describeFeatures` in [shared/features.ts](../shared/features.ts) |
| the sign-in forms | [src/site/auth.ts](../src/site/auth.ts) |
| the hero's still frame, the looks, the share image | [scripts/stills.ts](../scripts/stills.ts) (section 5) |
| indexing: robots, noindex (and a sitemap, once listed) | `INDEXED` in [shared/site.ts](../shared/site.ts), [public/robots.txt](../public/robots.txt), [public/_headers](../public/_headers), `noindex` in a page's `site:head` line (§7) |
| an old address that moved | [public/_redirects](../public/_redirects) |
| the contact address, the canonical origin, who runs the site (the legal pages) | [shared/site.ts](../shared/site.ts) `CONTACT_EMAIL`, `SITE_URL`, `OPERATOR_NAME`, `OPERATOR_PLACE` |
| the logo | [public/mark.svg](../public/mark.svg) (`.mark` in site.css, `.logo` in src/style.css), [public/favicon.svg](../public/favicon.svg); on a canvas `drawMark` in [src/render/renderer.ts](../src/render/renderer.ts) |

## 1. Pages and addresses

A multi-page site with no framework and no SPA fallback: every page is one HTML file built by
Vite, and its address is the file's path without `.html` (Workers Assets'
`auto-trailing-slash`: `/pricing` is `pricing.html`, `/app/videos` is `app/videos.html`).
**Tokens go in the query string**, never in a path segment (`/reset?token=…`).

| Address | Who | File |
| --- | --- | --- |
| `/` | everyone | [index.html](../index.html) |
| `/pricing` | everyone | [pricing.html](../pricing.html) |
| `/signup`, `/login` | signed out (the Worker sends a signed-in visitor on) | [signup.html](../signup.html), [login.html](../login.html) |
| `/forgot`, `/reset?token=`, `/verify?token=` | everyone | [forgot.html](../forgot.html), [reset.html](../reset.html), [verify.html](../verify.html) |
| `/terms`, `/privacy`, `/refunds` | everyone | the three legal pages |
| `/app` | signed in | [app.html](../app.html), the studio |
| `/app/videos` | signed in | [app/videos.html](../app/videos.html), the Videos page |
| `/account` | signed in | [account.html](../account.html) |
| `/admin`, `/admin/users`, `/admin/user?id=`, `/admin/plans`, `/admin/log` | superadmins | [admin.html](../admin.html), [admin/](../admin/) |

Who may see a page is decided by the Worker before it is served
([accounts-and-billing](./accounts-and-billing.md#5-the-session-check)). A path that matches no
file gets [404.html](../404.html) with a 404 status (`not_found_handling: "404-page"`).
`/dashboard`, the Videos page's old address, is a 301 to `/app/videos`
([public/_redirects](../public/_redirects)).

**Every page sends the cross-origin isolation headers** ([public/_headers](../public/_headers)),
the public ones too: the studio needs them for Kokoro, and with them on every page a link
between the site and the studio never needs a full reload to change context. So **no page may
embed a third-party iframe or depend on a popup**; `X-Frame-Options: DENY` keeps the site from
being framed itself.

## 2. The shared parts

The public pages are complete HTML when they leave the server, for crawlers and for the first
paint. Their shared parts are written in at build time (and on every request in dev) by a small
plugin in [vite.config.ts](../vite.config.ts), `sitePartials`, from
[src/site/partials/](../src/site/partials/):

| Placeholder | Becomes |
| --- | --- |
| `<!-- site:head /path -->` | charset, viewport, the canonical URL (`SITE_URL` + the path), Open Graph and Twitter tags built from the page's own `<title>` and `<meta name="description">`, the favicon, the font preload, the boot script, the stylesheet. `<!-- site:head /path noindex -->` adds a robots `noindex` |
| `<!-- site:header -->`, `<!-- site:footer -->` | the header (Pricing, Sign in, Start free / Open studio, the theme toggle) and the footer (the plans, the legal pages, the contact address) |
| `<!-- app:head -->`, `<!-- app:theme -->`, `<!-- admin:nav -->` | the same for the account page and the admin area, which use the studio's stylesheet |
| `%CONTACT_EMAIL%`, `%SITE_URL%`, `%SITE_HOST%`, `%OPERATOR_NAME%`, `%OPERATOR_PLACE%` | the constants in [shared/site.ts](../shared/site.ts) (`%SITE_HOST%` is the address without `https://`, as the legal pages name the site) |

**The boot script** in the head runs before first paint: a saved dark theme
(`bouncereel:theme`, shared with the studio, [src/ui/theme.ts](../src/ui/theme.ts)), and the
signed-in hint (`br_hint`, [accounts-and-billing](./accounts-and-billing.md#2-sessions-and-cookies)),
which sets `html[data-member]`: CSS then shows the elements marked `data-member` ("Open
studio") instead of those marked `data-guest`. No request is made to know it, so a visitor from
a link in a bio costs the Worker nothing.

Every public page loads [src/site/chrome.ts](../src/site/chrome.ts) (the theme toggle), and
its own script where it has one.

## 3. The look

A product site, quiet around one thing: the live race on a dark stage. The identity is its own,
modern and plain, so the videos (which have looks of their own) are what stands out:

- **The ground** is cool paper grey (`#eff1f5`) with **white tiles** (22 px corners, a 1 px
  edge, no resting shadow); a block inside a tile (the drawings) is a step back towards the
  ground. **The dark theme** is the same place at night: `#07090e`, tiles a step above it.
- **The stage** (`.stage`) is the ink (`#0b0e16`, 32 px corners): the hero, what the studio
  does, and the close of the page, so the page alternates ink and grey. It re-declares the
  colour tokens, so buttons, chips and text on it read right with no rule of their own.
- **One accent**, the violet of the Fibonacci ball (`#6a46ff`; white on it is 5.1:1), for the
  action that matters on a page (a pill button) and for links. The sky blue of its rival
  (`#0ea5e9`) appears only beside it, in the drawings, as the second team, and in the light
  behind the phone.
- **Rubik**, the video's lettering, sets everything: 700 with tight tracking (−0.035 to −0.04 em)
  for headings, 400 at 17 px for text, muted grey (5.5:1) for what is secondary.
- **Buttons are pills**: violet for the way forward, a hairline outline for the rest. Disabled
  ones (an upgrade before billing exists) go grey.
- **The mark** ([public/mark.svg](../public/mark.svg)): the violet ball with a fading comet
  trail, falling onto three sky-blue layers, the top one broken: the video's own picture in
  one shape. It sits before the name in the header, the studio and the admin area, with no
  tile behind it; the favicon is the same mark on an ink tile, so it reads on any tab.

The pieces, each used where it carries information:

- **the phones**: the live race in a dark bezel. The hero's has the two balls' light behind it
  (violet above, sky below) and two facts floating at its edges on wide screens (the length it
  is balanced to, a photo finish); the one beside How it works plays what the steps set;
- **pieces of the studio** in the step tiles, each a small screen with an edge and the accent's
  light from above, and real (section 4): the dice with the matchup it rolled and how it ends;
  Length, Finish gap, Look and Sound; the video as it will be posted, its first frame under an
  app's buttons beside its length, the loop and the file;
- **the gallery**: three real recordings in phones, one per look, each playing while it is half
  on screen, a button in its corner to pause it;
- **the cards on the stage**, under their words, and the ones that look like a control are one
  (section 4): the race board, two lanes racing to a checkered line on the race's own seconds,
  each ball glowing at the end of its bar, beside the Length and Finish gap that set it; the
  four power tags, each picking a small sketch of what it does; the narrator's real opening and a
  player that says it; the dice's fourteen sequences with their first numbers; and drawings, HTML and
  CSS with the site's own images, `aria-hidden` where the card's words say the same: the video's
  real first frame twice, first and last, around a loop arrow, under the zones the apps' buttons
  take, and in a phone with its two sizes; library rows with a thumbnail and, as a dot filled or
  not, which links are pasted;
- **the three looks** side by side, as the renderer draws them, each opening larger, playing.

Every colour is a token on `:root`, redefined under `html[data-theme='dark']` (the toggle,
[src/ui/theme.ts](../src/ui/theme.ts); light by default). Mobile first: one column, the header
keeps the name, Sign in (or Studio) and the theme below 480 px (How it works and Pricing below
720 px are in the footer, Start free is the hero's first button). Nothing scrolls sideways at
360 px. Focus is a visible 2 px outline; under `prefers-reduced-motion`, nothing moves.

**Motion** (the end of [site.css](../src/site/site.css)) is a system in four registers, as on
vukcvetkovic-web, in CSS, with one IntersectionObserver for the stories:

| Register | What moves |
| --- | --- |
| arrive | the hero's words rise in one after another at load, the phone settles into place (moved, never faded: its still frame is the LCP) |
| scroll | on `view()` and `scroll()` timelines: a line under the header fills as the page goes down and the header lifts off it; the hero steps back (smaller) as it leaves; headings, feature cards, plans, questions and the close rise in as they arrive, from their top 85 % of the way down the screen to the middle, side by side a step apart; the looks rise, library rows and the matchup's rows in step 1 slide in |
| story | a drawing that tells something plays once, on its own clock, when its card is half in view: the race lanes run to the line. Scrubbed by the scroll, a story had finished before the reader got to it. `playStories` in [home.ts](../src/site/home.ts) arms them (`data-stories` on `<html>`) and marks a card (`data-story`) `.played` |
| answer | the violet button lifts under the pointer; an answer in the questions opens to its height instead of jumping (`::details-content`) |

And the drawings at work, small and composited: a voice's wave, the loop arrow turning, the
phone and the hero's chips floating; the voice's wave moves only while the opening plays. The
gallery's videos play while half on screen, but not under reduced motion, where only their
button starts one.

- **Nothing is hidden by default.** Every rule is inside `prefers-reduced-motion:
  no-preference`, the scroll-driven ones inside `@supports (animation-timeline: view())` too,
  and a story waits on its first frame only once the script has armed it, so Firefox, a page
  without JS, or a reader who asked for less motion sees the whole page, still. (Firefox with JS
  plays the stories: they need no scroll timeline.)
- ⚠️ **`overflow: clip`, never `hidden`, around anything animated on the scroll.** `hidden` makes
  a scroll container, the element's `view()` timeline measures against that box instead of the
  page, and the animation never moves: hence `clip` on `.features`, `.piece` and `.lane`.
- Keyframes use `translate`, `scale` and `rotate`, never `transform`. A rise's range is in
  `cover` svh, so it lands at the same place on any screen and for any height: from
  `cover 15svh` (its top 85 % of the way down) to `cover min(50svh, 640px)` (its top at the
  middle). The 640 px is the foot: the least page under the close's top is 757 px (at 1920 wide),
  and a range that ends past the page leaves the element half-way. Measured at 1440×900,
  1280×720 and 1920×1200: every rise starts at 0.84–0.85 of the screen's height and ends at
  0.49–0.50, and each story plays with its card 0.50–0.53 in view. LCP 2.08 s and CLS 0 on a
  slowed phone with it all running.

## 4. The home page

In order: the hero on its stage (the headline **"Ball race videos, ready to post."**, what it
is in two sentences: two balls racing through ever bigger numbers, balanced to end close at the
length you pick, recorded as a vertical MP4 with nothing to edit; Start free, a line saying it
records in Chrome or Edge on a computer, three specs, the live race); **the browser note** right
under the stage; **how it works**, a small working studio (below): three steps (roll a matchup →
choose length, look, sound and narrator → post it as it is), each a card with its words beside
the piece of the studio it is about, and the phone that plays what they set; **the gallery**,
three recordings from the studio (below); what the studio does, **on the stage, in three groups
that say why the videos work**, each with its name and a line over one card across the width
(the group's main drawing) and two side by side under it: **watched to the end** (close to the
very end: the race board; a narrator who asks for a pick; a loop with no cut), **a new video
every day** (the three looks; fourteen sequences, 65 pairings; powers, for a twist) and **ready to
post** (the library; clear of the buttons; 1080×1920 at 60 fps); the plans (from
`GET /api/plans`); questions, under their heading in two columns of their own (one list on a
phone); the last call to action on the stage; the footer. What only a paid plan makes is said
where it comes up: the narrator's and the powers' cards say "the paid plans", never a plan's
name, and step 2's line says what the free plan makes.

**A feature card** (`.fcard` in [site.css](../src/site/site.css)) sits on the stage in the balls'
light, lit along its top edge: its title and a line or two first, then its drawing filling the
rest. Nine things in one grid read as a pile, and a group's name in a column of its own left a
hole under it; a tall card beside two short ones left one above its drawing. So every group has
the same shape, and a drawing gets the width it needs (the three looks at a third of the stage
each).

**The cards that look like controls are controls** ([src/site/home.ts](../src/site/home.ts)),
working on the steps' matchup where they share something with the steps:

- **The race board** has the steps' Length and Finish gap again, in step with them (moving one
  moves the other): the winner's lane runs to the line, the loser's as far as it had got when the
  winner touched it (`runnerUp`), "0.3 s behind", on a ruler in the race's own seconds, under
  "22.9 s of a 30 s video" (the rest of the video is the hold, slow motion, the winner card and
  the loop). New lanes replay the lanes' story once the card has played it.
- **The three looks** are buttons: one opens a dialog (`#look-dialog`, under the sections) with a
  phone playing the steps' matchup in that look, and the next or previous look; only that phone
  plays while it is open. Escape, Close or a press outside closes it.
- **The powers** are a radio group of the four tags; the picked one plays in a small box, a ball
  hitting a floor and doing what the tag says (`powerDemo`): a sketch on a canvas, not the
  engine, running only while the card is on screen; a still under reduced motion.
- **The narrator** card quotes the classic's real opening (`autoScript`) and plays it as Kokoro
  says it in Heart, a file made once (section 5) and fetched whole on the first press (see the
  gallery for why); the press pauses it again, and the wave moves only while it plays.

**The gallery** (`gallery` in [home.ts](../src/site/home.ts)) shows three recordings from the
studio, one per look, made smaller and silent (section 5), each in a phone with its matchup and
look under it. A video plays, muted and looping, only while it is half on screen, and pauses when
it leaves; its button pauses it, and the screen then leaves it paused until the button plays it
again. Under reduced motion nothing starts by itself: the button plays it. Without JS each keeps
the browser's own controls and its poster.

⚠️ **The page fetches its media whole and plays it from a blob URL** (`wholeFile` in home.ts):
the gallery's videos when one is first wanted, the narrator's opening on the first press.
Workers Assets answer a Range request with the whole file (200), and Safari (Mac, iPhone, iPad)
plays a video or a sound only from range answers (206), so a file linked straight from `public/`
would not play there at all. A blob URL needs no ranges. The opening's first press also calls
`play()` before the file has arrived: Safari lets an element play outside a press only once it
was asked to inside one.

**The format is "ball race videos"**, in every heading and description: two balls racing
through layers of numbers. The numbers (Fibonacci, factorial…) are what each ball deals, said
in the lede, not a word in the name of the format.

⚠️ **The browser note** (`.browser-note`, "Record in Chrome or Edge, on a computer") stays
where every visitor sees it before signing up: only those two write the MP4 the platforms take
as it is ([recording and export](./recording-and-export.md#3-the-file)). The hero's line links
to it, the first question repeats it, and the studio warns again in a browser that cannot
write MP4.

**The hero is the real engine, not a video file.** [src/site/hero.ts](../src/site/hero.ts) runs
the studio's own simulation and renderer, muted, in the phone, and plays a race the way a
recorded video goes: the hold, the race, slow motion into the win, the winner card, the fade
into the first frame; then it fades into the next built-in matchup **in the next look**
(`HERO_LOOKS`: night, paper, cards). **Roll a new matchup** calls the studio's dice
(`randomMatchup`, balanced like any roll). Both stay without powers: the hero plays only the
built-in matchups that have none, and rolls with powers off, so it shows the format itself,
sequence against sequence, with nothing the opening would have to explain. Under the phone,
the two names and the look.

- **The first paint is a still frame** ([public/hero/first-frame-3.webp](../public/hero/first-frame-3.webp),
  540×960, 31 KB, the night look, the video's opening title over it), an `<img>` with `fetchpriority="high"`: the LCP. The engine loads after the
  page has (`requestIdleCallback`), waits for Rubik (a canvas never loads a web font itself),
  draws the same first frame over the still and fades it in, so the swap does not show.
- It draws **at half the video's size** (540×960 under a 0.5 scale): the phone shows it at most
  300 px wide (less on a short screen), and a quarter of the pixels is a quarter of the fill work. Nothing in
  [src/render](../src/render/) or [src/sim](../src/sim/) changes for it; nothing had to be
  extracted from the studio's [app.ts](../src/app.ts), which drives the same renderer.
- It runs **only while the phone is on screen and the tab is visible** (an
  `IntersectionObserver` and `visibilitychange`), and **under `prefers-reduced-motion` it never
  moves**: the engine is not loaded at all until the dice is rolled, and a roll then draws that
  matchup's first frame and stops.
- **It never loads Kokoro**, nor any audio: nothing from [src/audio](../src/audio/) is imported.
  The hero plays the free plan's longest video, 30 s, with no narrator and no watermark.
- **A roll's cost** (randomMatchup + balance, on the main thread; each is a `hero roll` measure
  in the Performance panel): 2.5–23 ms on an M-series Mac; with the CPU slowed 4× (Lighthouse's
  phone), median 9 ms, worst 43 ms over 30 rolls. Under 50 ms, it is not a long task and no
  pause shows, so the hero rolls the dice rather than cycling the built-in matchups. A frame of
  the race at 4× stayed under 9 ms.

**How it works is a working studio, not pictures of one** ([src/site/home.ts](../src/site/home.ts),
the engine's side in [src/site/hero.ts](../src/site/hero.ts)). The steps set a matchup and the
phone beside them plays it, replaying it until the steps change it:

- **Step 1** rolls the studio's dice with powers off, as the hero does, and shows each ball's
  colour, name and first numbers and how the race ends, worded as the studio's matchup card
  ("Slow Factorial Ball wins by 0.3 s", the margin measured as `measureMargin` does).
- **Step 2**: Length (30 to 90 s here: at 20 and 25 s most matchups cannot fit, and a roll can
  take a slow phone hundreds of milliseconds; the studio goes down to 20 s and says so), Finish
  gap, Look and Sound, native ranges and radio groups. A length or gap balances the same matchup
  again 200 ms after the thumb stops; one that does not fit tries eight new races of it, one a
  frame, then asks for a roll. A sound balances it again too (a narrator's winner line lengthens
  the card); a look only redraws. The phone plays muted. A line under the controls says what the
  free plan makes, written from the default plan's features (`GET /api/plans`), with "the paid
  plans make all of this" only when one of them does.
- **Step 3** is the video as it will be posted: this matchup's first frame (drawn by the engine
  once it has loaded; the hero's still before) under the buttons an app lays over a video, drawn
  generically with no app's logo or colours, switched between Shorts, TikTok and Reels by CSS
  alone (`:has()` on the radios). The zones are the studio's (`.zone` in
  [src/style.css](../src/style.css)), so the drawing is honest about what sits under them.
- **One race at a time**: of the two phones on screen, the more visible plays and the other holds
  its frame (`share` in home.ts). Under reduced motion the engine loads on the first roll or
  change, draws that first frame and stops; every control still works.
- From 64rem wide the phone is sticky beside the steps; narrower it comes after step 2, under
  the controls that change it, which is why the steps are two lists. The cards follow each
  other: a deck that slid each card over the one before hid the covered card's controls.

**The facts are the code's**: 1080×1920 at 60 fps, MP4 with H.264 and AAC; balanced to the
length to a tenth of a second; a photo finish (0.15–1.1 s between the two) or a 1–10 s gap; the
dice's fourteen sequences and 65 pairings (`SEQUENCES` has sixteen: "Always 1" and "Digits of pi" only by hand); the
narrator, on the paid plans, ending on a call to pick a winner (`QUESTIONS`); three looks; the
loop; music only or silence; the library and its links (the settings, not the file); any video
replayed exactly. Check a claim against [recording and export](./recording-and-export.md) and
[matchups and balancing](./matchups-and-balancing.md) before changing it.

**The plans** come from `GET /api/plans` ([src/site/pricing.ts](../src/site/pricing.ts)), so the
page always says what the studio and the server enforce. **Each card has its plan's tone**
(set in the admin area, [accounts and billing](./accounts-and-billing.md#6-plans-and-features)),
and the tone brings the card's drawing (`planEmblem` in
[src/site/pricing.ts](../src/site/pricing.ts)), so the plans climb as a race does:

- `plain`, for the free plan: a quiet white card, an outline button, a ball on its first layer;
- `bold`, the plan the page points at: the violet card in a violet glow, a white button, the
  BounceReel mark on a white tile; on a wide screen it stands 14 px taller at both ends, its
  contents level with its neighbours';
- `dark`, the top plan: the ink stage in the two balls' light, with their colours as its ring,
  and the winner's trophy.

A card reads top to bottom: the drawing, the name and the badge ("Recommended", "Every game"),
the price, one line on who the plan is for, **the button**, then what it includes. The button
comes before the list, so it is level on every card and, on a phone, before a screen of ticks.
A plan without a price says "Coming soon" in the price's place, quieter than a price. The
default plan's button is Start free (or Open studio); every other one reads "Upgrades open
soon", disabled, while billing is off. A signed-in visitor sees "Your plan" on theirs. The
admin area draws each plan with the same drawing, price, list, tone and badge. Until the plans
arrive the list keeps 80 % of a screen, so what follows starts below the fold and does not jump
(layout shift). Without JavaScript they never arrive: under `@media (scripting: none)` that space
goes, and a `<noscript>` line under the list says the plans need it (here and on /pricing).

## 5. The images

All drawn by the studio's renderer, so they are what a video looks like, by
[scripts/stills.ts](../scripts/stills.ts):

| File | What | Size |
| --- | --- | --- |
| [public/hero/first-frame-3.webp](../public/hero/first-frame-3.webp) | the hero's first frame, its opening title and all: Fibonacci vs Slow Factorial balanced to 30 s, night; also the first paint of the steps' phone and of step 3, whose defaults are that race. The `-3` is a new name for a frame that changed in a way that shows (the title, then its lighter wash): a browser keeps `/hero` a week, and the old name would show the old still under the new first frame | 540×960, ~31 KB |
| [public/looks/](../public/looks/) `paper.webp`, `cards.webp`, `night.webp` | the same race 55 % of the way, the top box as the studio's look picker crops it | 480×416, 15–17 KB each |
| [public/og.png](../public/og.png) | the Open Graph and Twitter image, as the hero: the ink, the mark and the name, the headline, one line on what it makes, and at the bottom the address (`SITE_HOST`, narrowed if it would reach the phones), then a violet rule and "Free to start"; two phones (night, paper) in the balls' light. Made again when the address changes | 1200×630, ~300 KB |
| [brand/profile.png](../brand/profile.png) | not for the site: the profile picture for Instagram, YouTube and TikTok, the mark on the ink in the balls' light, sized to stay inside the circle each shows it in (offered at `./brand/profile.png` on the stills page) | 1080×1080, ~940 KB |
| [public/voice/opening-heart.m4a](../public/voice/opening-heart.m4a) | not an image: the narrator card's opening, the classic's `introLine` said by Kokoro in Heart, the studio's own narrator (the page's "Make the opening" button; a WAV, then `ffmpeg -i opening-heart.wav -ac 1 -c:a aac -b:a 48k -movflags +faststart opening-heart.m4a`) | 16.8 s, AAC 48 kb/s mono, ~95 KB |
| [public/gallery/](../public/gallery/) `primes-vs-squares-2`, `doubling-vs-fibonacci-2`, `tribonacci-vs-tripling-2`, each `.mp4` and `.webp` (`-2` for the same reason as the still: recorded again when the first frame changed) | not from the stills page: the gallery, three takes made with Record on an account with every look (the built-in matchup of that name, 30 s, music only; paper, cards and night), then `ffmpeg -i take.mp4 -an -vf fps=30,scale=540:960:flags=lanczos -c:v libx264 -profile:v high -preset veryslow -tune animation -crf 30 -pix_fmt yuv420p -movflags +faststart <name>.mp4`; the poster is the take's first frame as a WebP at 0.86, made through a canvas in the browser (this ffmpeg has no WebP encoder). Check a take's frame 0 before using it: it must be the race's first, the opening title over it | 540×960, 30 fps, no sound, 0.84–1.02 MB; posters 22–28 KB |

⚠️ **Remake them after a change to the renderer, the layout, the first built-in matchup, the
balancer, `HERO_SECONDS` or `HERO_LOOKS`**: the still frame must be the first frame the hero
draws, or the swap shows. Browsers keep `/hero` and `/looks` for a week (public/_headers), so
a returning visitor can see the old still under the fade for that long; a change big enough to
show (a new look) is worth a new file name. **Make the opening again** when its words change
(the classic's names, `autoScript` in [src/audio/narration.ts](../src/audio/narration.ts),
`QUESTIONS` in [opening.ts](../src/audio/opening.ts) or a sequence's `brief` and `fact` in
[sequences.ts](../src/sim/sequences.ts)),
and the quote in index.html with it. **Record the gallery again** when a change shows in a video
(the renderer, the layout, a look, a built-in matchup it uses); `/gallery` is kept a week too.
The page that draws the images is only built on request:

```sh
STILLS=1 npx vite build && npx vite preview --port 4199 --strictPort
# open http://localhost:4199/scripts/stills, download each image into public/ at the path under it
```

## 6. Speed

No framework; the home page's own scripts are about 20 kB (9.4 kB compressed: the steps and the
cards, the plans, the theme toggle), and the engine (the simulation and the renderer, ~45 kB,
17.5 kB compressed) loads only after the page. Measured on the preview (mobile emulation at
390×844, CPU 4× slower, DevTools' "Slow 4G": 562.5 ms round trip, 1.44 Mb/s down; http/1.1 with
no compression), from a PerformanceObserver set before the page's scripts:

| | FCP | LCP (the hero's still) | CLS | long tasks |
| --- | --- | --- | --- | --- |
| a returning visitor (assets cached) | 0.7 s | 0.7 s | 0 | none, through load and the engine starting |
| a first visit (no cache) | 1.8 s | 2.1 s | 0 | none, through load and the engine starting |
| then 12 rolls, both sliders by keyboard, the sound changed 4 times | | | 0 | a roll, now and then (below) |

The chrome-devtools MCP's `lighthouse_audit` scores everything but performance, or Lighthouse's
own CLI against a Chrome started with a debugging port (`lighthouse <url> --port=<port>
--only-categories=accessibility,best-practices,seo`); the numbers above come from the observer
and the `steps …` measures. The gallery's three posters (77 KB) load with the page, behind the
still, and a video (0.84–1.02 MB) only once it is half on screen.

⚠️ **A roll can be a long task on a slow phone.** `randomMatchup` tries candidates until one
balances, so a roll costs one balance or several: in Node on this Mac, 300 rolls at 30 s took 2.1 ms
at the median, 16 ms at the 99th percentile and 23 ms at worst, and 11 of them over 12.5 ms, which
is 50 ms at 4×. In the browser at 4×, 24 rolls took 9–16 ms at the median and 34–54 ms at worst,
one of them a 54 ms long task. Splitting a roll's candidates over tasks would end it (a change to
`randomMatchup` in src/sim/balance.ts); until then, about one roll in 25 on such a phone runs
just past the budget.

- **No grid track is sized by its content** in How it works (`minmax(0, 1fr)`): an `auto` track
  measured every step's content first, which made the page's first frame a long task at 4× and,
  with a long ball name, pushed the cards past a phone's screen.
- ⚠️ **No `content-visibility: auto` on the sections**: it made the first frame cheaper, but a
  section not drawn yet had no headings or text in the accessibility tree, so a screen reader
  could not reach the questions by heading.
- **The steps never do two heavy things in one task**: the engine's start (the hero's phone, the
  steps' first matchup, their phone, step 1's words), a roll or a balance, the phone's restart and
  the words each have their own (`nextTask` in home.ts). At 4×: `steps hero` 29–34 ms, `steps
  first` 7–12, `steps roll` median 9–16 ms (worst 34–54, above), `steps refit` 12 (13.6),
  `steps show` 5.1 (7.2), `steps facts` 4.8 (11.5 for the first), measures in the Performance panel.

| Lighthouse, mobile | Accessibility | Best practices | SEO |
| --- | --- | --- | --- |
| `/`, `/pricing`, `/signup`, `/login`, `/forgot`, `/terms`, `/privacy`, `/refunds` | 100 | 100 | 100 when listed; while the site is kept out (§7) the "page is blocked from indexing" audit fails on purpose |

To keep it there: the still frame stays the LCP (no web font or script in its way), the engine
stays lazy, nothing above the fold waits for the API, and nothing that loads late changes the
height of what is already on screen.

## 7. Search engines

**Nothing is listed while the site is on `bouncereel.vukcvetkovic.com`** (`INDEXED` off in
[shared/site.ts](../shared/site.ts)); it opens to search engines on its own domain, as the full
product:

- every page's head has `<meta name="robots" content="noindex, nofollow">` (the `site:head`
  partial, [vite.config.ts](../vite.config.ts), from `INDEXED`);
- every page and file Workers Assets serves answers `X-Robots-Tag: noindex, nofollow` (the `/*`
  rule in [public/_headers](../public/_headers)), so images and videos stay out of image search
  too; the Worker's own answers (the API, the pages behind the sign-in) send it always
  ([worker/lib/http.ts](../worker/lib/http.ts), [worker/pages.ts](../worker/pages.ts));
- [robots.txt](../public/robots.txt) disallows everything, and there is no sitemap.

⚠️ A crawler that obeys robots.txt never fetches a page, so it never reads its noindex either: a
page linked from elsewhere can still show up as a bare address with no text. The noindex is for
crawlers that ignore robots.txt.

**Going public** (with the move to the domain, docs/build-and-deploy.md §5): `INDEXED` on; the
`X-Robots-Tag` line out of the `/*` rule in _headers (the rules for `/app`, `/account`, `/admin`,
`/reset` and `/verify` stay); robots.txt back to disallowing only `/app`, `/account`, `/admin` and
`/api`, with a `Sitemap:` line; and `public/sitemap.xml` listing `/`, `/pricing`, `/signup`,
`/login`, `/forgot`, `/terms`, `/privacy` and `/refunds`. Then, as before: each public page has a
title, a description, a canonical URL on `SITE_URL` and an Open Graph image; `/reset`, `/verify`
and the 404 page stay noindex (their `site:head` line says so: a one-time link indexed would be a
page saying the link is invalid).

## 8. The words

English, short and concrete, written from what the visitor does. **Never invented**:
no testimonials, user counts, ratings, press logos or results; a number on the site is one the
code produces, or none. The browser claim is honest: the studio runs on a computer, in Chrome or
Edge, which record the MP4 the apps take ([recording and export](./recording-and-export.md#3-the-file));
Firefox records WebM, and Safari is not tested. No emoji in the copy.

## 9. The legal pages

[terms.html](../terms.html), [privacy.html](../privacy.html) and [refunds.html](../refunds.html)
are written to match what the code does, each opening with **the short version**, then a list
of contents and numbered sections. `TODO(owner)` comments in each mark the decisions that are
his: who runs the site (`OPERATOR_NAME`, `OPERATOR_PLACE` in [shared/site.ts](../shared/site.ts),
the controller and the party to the terms), the governing law and court (Serbia, Niš proposed),
the payment terms before paid plans open, and a lawyer's reading before taking payments.

- **Terms**: who may use it (16 and over), the account, the plans and the UTC day, payments as
  they will be, the videos and what is typed into them, the licence to use BounceReel's parts
  of a video anywhere and to earn with it, **the free plan's watermark, which must stay on**,
  acceptable use, the platforms' trademarks, suspension and leaving, warranty and liability
  within what consumer law allows, changes with 30 days' notice.
- **Privacy**: written for the GDPR and Serbia's Law on Personal Data Protection (ZZPL). What is
  stored and why, each with its legal basis: the email, the password hash, the videos' configs
  and links, the plan and its history, sign-in times, IP addresses only while throttling counts
  them, the session cookie and the hint cookie; what stays in the browser (the theme, the
  studio's settings); who processes it (Cloudflare, Resend) and who else the browser talks to
  (Hugging Face, for the voice model); data outside Serbia and the EU; how long each is kept; the
  rights, and the Commissioner (Poverenik) and EU authorities to complain to. No tracking
  cookies, no analytics, no ads, nothing sold.

⚠️ **Update them when the code changes what they describe**: something new stored, a new
company the browser or the Worker talks to, a plan feature that changes what a video may be
used for.

## Changelog

- 2026-10-20 - page created: the public site on bouncereel.com, its pages and shared parts, the paper and night look, the home page's live hero, the images and how to remake them, speed and Lighthouse results, indexing, the words, the legal drafts.
- 2026-10-20 - a modern look: cool grey and white with the hero and the close on a dark stage, one violet accent, pill buttons, drawings of the studio in the tiles, the hero cycling the three looks with the night look first, a new share image.
- 2026-10-21 - the hero without powers (only the classics that have none, the dice with powers off); night is the cards after dark, so the first frame, the look images and the share image are remade; the sign-up, pricing and privacy words say Free makes one video a day.
- 2026-10-21 - the format is "ball race videos" (headline "Ball race videos, ready to post."); the browser note under the hero and in the FAQ; a powers tile and the watermark question; plan cards by tone, with badges; the new mark, favicon and share image with the address at the bottom; the terms and privacy pages written out in full, with the operator's details from shared/site.ts.
- 2026-10-21 - plan cards: a drawing per tone (ball, mark, trophy), the button above the list, the violet card standing taller in its glow, the dark one in the balls' light, a quieter "Coming soon"; the pricing page no longer says no plan has a watermark.
- 2026-10-21 - the features in three named groups (the race, look and sound, ready to post), one wide card and two in each, with drawings from the product: the real first frame in a phone with its spec sheet and as the loop, film strips for the seed, all four power tags, library rows with thumbnails.
- 2026-10-21 - what the studio does moves onto the stage: each group's main card across the width and two under it, cards lit along their top edge, the race board with glowing balls beside its two controls, the phone in its own light; the step drawings get an edge and the accent's light.
- 2026-10-21 - motion, in CSS alone: the steps as a deck that stacks while scrolling, a progress line under the header, the hero stepping back, things rising in as they arrive, the race lanes racing in, the drawings at work (wave, playhead, loop, floating phone), answers opening smoothly; all off under reduced motion and where scroll-driven animation is missing.
- 2026-10-21 - less air: sections 48–80 px apart (were 72–128), tighter heads, step cards as tall as their content, the stage and its cards tighter; the questions in two columns under their heading instead of beside an empty column.
- 2026-10-21 - motion on the screen's measure: a rise runs from its top 85 % down the screen to the middle (svh ranges, capped at 640 px for the foot of the page); the race lanes, the recording bar and the seed's playhead are stories that play once on their own clock when their card is half in view (one IntersectionObserver in home.ts), no longer scrubbed by the scroll.
- 2026-10-21 - how it works is a working studio: the dice, Length (30–90 s), Finish gap, Look and Sound are real and drive a phone beside the steps (sticky on a desktop, after step 2 on a phone; one race runs at a time), step 3 shows the video as it will be posted under an app's buttons, drawn generically; the deck of stacking steps is gone; the sections under the hero use `content-visibility: auto`.
- 2026-10-21 - the feature cards respond: the race board's Length and Finish gap (in step with the steps') re-run its lanes to the real result, the looks open larger and playing, the power tags pick a sketch of what each does, the narrator card plays the real opening (Kokoro, Heart; a file made on the stills page), the sound card is the steps' Sound again, link pills became dots; `content-visibility` taken out again (a section not drawn yet had no headings for a screen reader), the first frame kept short by `minmax(0, 1fr)` tracks.
- 2026-10-21 - the home page says why the videos work: a lede on the race, its length and nothing to edit; the features regrouped as watched to the end, a new video every day and ready to post (the ten sequences and the buttons' zones in, the seed and sound cards out, the library said to keep settings, not files); a gallery of three real recordings that play while half on screen; questions on how close a race is and making a video again; the narrator said to be on the paid plans; media played from blob URLs for Safari; a noscript line for the plans.
- 2026-10-23 - the privacy page lists whether the studio's first hint was seen among the studio's settings kept in the browser (last updated 23 October 2026).
- 2026-10-23 - the video's first frame carries its opening title, so the still, the looks, the share image and the gallery were made again: the still as `hero/first-frame-2.webp` (was `first-frame.webp`) and the gallery as `<name>-2` (0.84–1.02 MB now, with the bigger numbers and the meters).
- 2026-10-24 - the speed measured again after the overhaul: cold and warm loads apart (FCP and LCP 0.7 s warm, 2.1 s cold, CLS 0), the engine now 45 kB, the steps' costs; a roll can be a long task on a 4× phone (about one in 25), said; Lighthouse 100/100/100 on the eight public pages.
- 2026-10-24 - on `bouncereel.vukcvetkovic.com` for now and kept out of search: `INDEXED` off (every page `noindex, nofollow`), `X-Robots-Tag` on every file, robots.txt disallowing everything, the sitemap gone; the legal pages and the share image name the site from `SITE_URL` (`%SITE_HOST%`); the watermark answer in the questions without the address; the profile picture for the platforms on the stills page (`brand/profile.png`).
- 2026-10-25 - the opening title made for the cover (a lighter wash, the balls and a ball's power over it, the race's labels held back; the meters 40 px further in), so the still (`hero/first-frame-3.webp`), the looks and the share image were made again. The gallery is still the 2026-10-23 recordings.
- 2026-10-25 - the sequences card lists fourteen sequences and 65 pairings (Lucas, Catalan, Tenfold and Collatz added).
