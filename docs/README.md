# BounceReel - documentation

**This is where the detail lives.** [AGENTS.md](../AGENTS.md) carries the working rules
and always loads; [AI_CONTEXT.md](../AI_CONTEXT.md) is the map. This page indexes the
deep-dives and sets the rules for writing them.

Each deep-dive is **self-sufficient**: paste its link into a prompt and an agent has the
mechanism, the numbers, the failure modes and the paths to the code without reading
anything else.

## The deep-dives

- **[Simulation](./simulation.md)** - the rules of a race (floor hits, layers, overkill,
  the finish), the physics (straight lines, mirrored bounces, sub-steps), specials,
  events, prediction and finish times, and why every bit of it is deterministic.

- **[Matchups and balancing](./matchups-and-balancing.md)** - how any matchup is made a
  close race of an exact video length, the frame of time around the race, the random
  matchup generator (and how often it adds a power), the sequences, specials and the
  seven built-in matchups, and how to add more.

- **[Look and layout](./look-and-layout.md)** - the 1080×1920 frame and the two cards
  built from one template, the three looks (paper, night and cards; night is the cards
  after dark) drawn over it, layers, the finish strip, balls and their trails, the power
  tag, the winner card, the loop at the end, effects, the font, the platforms' UI zones, and
  the free plan's watermark.

- **[Sound and narration](./sound-and-narration.md)** - the synthesiser and its mixing,
  melodies, which event sounds like what, the opening and the winner line, Kokoro's
  voices and how they load, and how the narrator is timed so it never talks over itself.

- **[Recording and export](./recording-and-export.md)** - how a recording is made and
  ends on its exact length, the file it produces, what the platforms want, and the
  ffmpeg line for anything else.

- **[Development](./development.md)** - setup, scripts, `npm run tune`, the control panel,
  checking a change in one browser tab, test recordings, and storage.

- **[Build and deploy](./build-and-deploy.md)** - Cloudflare: the Worker and local D1 in
  dev, the settings and secrets (`SITE_URL`, `RESEND_API_KEY`), the isolation headers on every
  page, which pages search engines may list (none, for now), the production cut-over to
  `bouncereel.vukcvetkovic.com` and the later move to the site's own domain, releases, free-plan limits.

- **[Video library](./video-library.md)** - each account's database of recordings: why a
  config is enough, the schema, the `/api` routes, what the plan allows on save, what Record
  saves (and retries), links to YouTube, TikTok and Instagram, the Videos page, and how
  statistics or another game would be added.

- **[Accounts and billing](./accounts-and-billing.md)** - who can sign in and what each
  account may do: roles and the terminal-made superadmin, sessions and cookies, passwords and
  one-time links, throttling, the session check for the API and the pages, the three plans
  and their features (the daily allowance, the watermark), subscriptions without a cron, the
  change log, the admin area, and where a payment provider plugs in.

- **[Website](./website.md)** - the public site: its pages and addresses, the parts they
  share, its look, the home page and its live hero, the images drawn by the renderer, speed
  and Lighthouse, search engines, the words, the legal pages.

## Rules for these pages

1. **Verify every claim against the code.** The linked file is the authority, never the
   prose. A sentence that contradicts a file is worse than no sentence.
2. **Describe the present tense.** No "changed from X" in a behavioural claim. Dates live
   on changelog lines only.
3. **Link with relative paths** so a reader can click through, and check they resolve.
4. **Record the surprising, not the obvious.** The reason a page exists is the thing that
   would cost an hour to rediscover: an engine rounding sines differently, a library bug,
   a recording that runs long.
5. **Say what fails and how.** For each guard: does it throw, warn in the page, or fall
   back silently? Silent is the one worth a ⚠️.
6. **Every deep-dive opens with a "what I need to change → what to touch" table** and
   ends with a changelog: one dated line per change, appended at the bottom.
7. **Do not document what the code or git already records.** A new deep-dive needs an
   area the existing ones do not cover.
