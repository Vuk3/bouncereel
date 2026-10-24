# AGENTS.md

This file orients Claude Code (and any AI agent) working in this repository:
**BounceReel**, a public website (`https://bouncereel.vukcvetkovic.com` for now, kept out of search) where creators make game videos
for Shorts, TikTok and Reels, vertical (1080×1920, 60 fps) and recorded in the browser straight
to MP4 with synthesised sound and a narrator. People sign up, a plan decides what they may
make, and each account keeps its recordings in a video library (D1) with their links to the
platforms. Vuk runs it from an admin area (users, plans, subscriptions) and uses the studio
like everyone else. It runs on Cloudflare: Workers Assets for the pages, a Worker for the
API and the sign-in.
Its first game is ball races: two balls, each in its own card, break layers with the
numbers of a sequence (Fibonacci, factorial…).

> **`CLAUDE.md` is a symlink to this file**, so the two names can never drift and there
> is only ever one file to edit. Do not replace the symlink with a copy.

## Start here

Documentation is layered, so you only pay for what the task needs:

1. **This file** - the working rules below. Always loaded.
2. **[AI_CONTEXT.md](./AI_CONTEXT.md)** - the map: what the app is, the glossary, the
   architecture and the end-to-end flows, the gotchas that cut across areas, and where each
   kind of change lives.
3. **A nested `CLAUDE.md`** in the directory you are editing, loaded on top of this one:
   [src/sim](./src/sim/CLAUDE.md) (simulation, balancing) ·
   [src/audio](./src/audio/CLAUDE.md) (sound, narration, voices) ·
   [src/render](./src/render/CLAUDE.md) (the video's look) ·
   [worker](./worker/CLAUDE.md) (the API, the sign-in) ·
   [migrations](./migrations/CLAUDE.md) (the database schema).
4. **[docs/](./docs/)** - the detail. Ten deep-dives, each written to be self-sufficient:
   paste one link into a prompt and start working. [docs/README.md](./docs/README.md)
   indexes them. Accounts, plans and the admin area are
   [accounts-and-billing](./docs/accounts-and-billing.md); the public site is
   [website](./docs/website.md).

**If you already know which area you are in, go straight to its deep-dive.**

## Working rules

- **`npm run check` (`tsc` for the pages, then for the Worker) is the gate**, and
  **`npm run tune`** after any change to the simulation, the balancer, the layout
  geometry or the presets: it balances every built-in matchup and a hundred random ones
  at 30, 40 and 60 s and says what failed.
  There is no test runner and no linter; do not add Vitest, ESLint or Prettier without
  asking.
- **Do not start the dev server.** Vuk runs `npm run dev` himself. To see a change
  running, build it (`npx vite build`), serve the bundle with the Worker and the local
  database (`npx vite preview --port 4199 --strictPort`), check it, and stop the server
  afterwards.
- **One browser tab, and close the browser when done.** Quit the automation Chrome
  itself, not just its tab. [docs/development.md](./docs/development.md#4-checking-it-in-a-browser)
  has the steps.
- **A test recording lands in `~/Downloads`** and as a row in the local database. Check
  the file (ffprobe, frames, spectrogram), then delete it, and the row from the Videos
  page. **Test accounts are data too**: delete them when done. ⚠️ The first local superadmin
  receives Vuk's videos from before accounts, so back up `.wrangler/state/v3/d1` before making
  one and put it back afterwards. Leave nothing you made in his folders or his data.
- **Nothing `--remote`, and no deploy, without asking.** `npm run deploy`,
  `wrangler deploy`, `wrangler secret put`, `npm run admin -- … --remote` and every
  `wrangler d1 … --remote` touch production; local migrations and
  `wrangler d1 execute --local` are fine. [docs/build-and-deploy.md](./docs/build-and-deploy.md)
  has the steps.
- **The API is closed unless a route says otherwise.** The session is checked before route
  matching (and the role for `/api/admin/*`); a public route goes on the explicit `PUBLIC` list
  in [worker/router.ts](./worker/router.ts) with its reason. Every video query names the
  account; nothing over HTTP grants `superadmin`.
  [docs/accounts-and-billing.md](./docs/accounts-and-billing.md#5-the-session-check) says why.
- **The simulation is deterministic, and stays so.** Nothing in [src/sim](./src/sim/)
  may use `Math.random`, `Math.sin`, `Math.cos`, `Math.atan2`, `Math.pow` on non-integers
  or `Date`; it uses [rng.ts](./src/sim/rng.ts) and [detmath.ts](./src/sim/detmath.ts).
  [src/sim/CLAUDE.md](./src/sim/CLAUDE.md) says why.
- **Update the doc that owns what you changed**, in the same change, and add a dated line
  to that page's changelog. [AI_CONTEXT.md](./AI_CONTEXT.md#maintaining-this-document)
  says which page owns what.
- **Describe the present.** Dates and "changed from X" belong in git and on a changelog
  line, never in a behavioural claim.
- **Verify against the code.** Prose can lag; the files it links to are the authority.

## Code conventions

### Comments

- This codebase comments **why**, generously: the reason behind a number, the failure a
  guard prevents, the trap a layout avoids. Match that density. A new magic value without
  a note on how it was arrived at does not belong here.
- **When you touch a file, delete comments that no longer earn their place.**
- Prefer deleting dead code to commenting it out.

### Abstractions and dependencies

- **Do not add a dependency or a new abstraction without asking.** The app runs on
  TypeScript, Vite and the DOM; the only runtime dependency is `kokoro-js` (the free
  voice), loaded lazily. The Worker has none (WebCrypto, `fetch`, D1); `wrangler` and
  `@cloudflare/vite-plugin` are dev dependencies.
- Keep it concrete and local. Two similar blocks are not duplication worth abstracting.
- Match the shape of the surrounding code rather than importing a pattern from elsewhere.

### Words

- **The app speaks English**: panel labels, the video, the narration. The narration is
  written from the rules in [src/audio/narration.ts](./src/audio/narration.ts).
- **The opening never explains the floor, the layers or the finish line.** It names the
  two balls, says in one clause what each does, adds one fact and asks a question. Viewers
  understand the rest from the picture within a second.
- **Numbers on screen are whole, every digit**, with a thousands separator. Never
  scientific notation: generated layers stay at or under 10^18 so they always fit.

### Uncertainty

- **When a choice would change the result and the answer is not in the code or the docs,
  ask rather than guess**: above all for what the video looks like, what the narrator
  says, and anything that costs money (API voices).
- If part of a task is blocked on an answer, do everything that is not, then ask.

## Commit messages

Conventional commits, **one line**: `type: description`. No scope, no body, no trailer.

- Types in use: `feat`, `fix`, `perf`, `chore`, `docs`.
- Lowercase after the prefix, imperative, about 50 characters.
- **Never add a `Co-Authored-By` trailer.** Vuk commits himself; write the message, do
  not run `git commit`.
