# BounceReel

Game videos for YouTube Shorts, TikTok and Reels: vertical (1080×1920, 60 fps), recorded in
the browser straight to MP4 with sound and a narrator. A public site on
[bouncereel.vukcvetkovic.com](https://bouncereel.vukcvetkovic.com) for now: sign up, make videos on your plan, keep them in a
library with their links.

The first game is **ball races**. Two balls, one card each. Only a hit on the floor
counts: it takes the next number of the ball's sequence (Fibonacci, factorial, doubling…)
off the layer under it. Break every layer, touch the line first, win.

```sh
npm install
npm run dev                          # http://localhost:5173, in Chrome
npm run admin -- you@example.com     # a local superadmin: open the printed link, set a password
```

In the studio (`/app`):

1. Set the **video length**, and the **finish gap**: a photo finish, or the loser 1–10 s
   behind the winner.
2. Click **🎲 Random matchup** until you like one, and **▶ Play without voice** to watch
   it at once (bounce sounds, no narrator to wait for). Every matchup comes balanced: it
   fills the length exactly and ends as close as the finish gap asks. Most are sequence
   against sequence; with **Powers in random matchups** on, about one in four gives a ball
   a power (it speeds up, slows down, grows or splits), and the video tags that ball.
3. Pick the **sound** (narrator and music, music only, or silent) and a **look**: Paper,
   Cards or Night. Each video ends by fading into its first frame, so it loops without a cut.
4. Pick a **voice** (the Voice tab, ▶ to hear each): Kokoro, free, runs in the browser. It
   says the opening and the winner, nothing in between.
5. **Record**. The MP4 lands in Downloads, ready to upload, and the video goes into
   **Videos**: paste its YouTube, TikTok and Instagram links there, or open it in the studio
   again to remake or change it.

What a plan includes (length, looks, sound, the narrator, powers, videos a day, how many
are kept, the watermark) is set in the admin area (`/admin`); Rookie (free), Pro and Champion
are seeded. Record in Chrome or Edge: they write the MP4 the platforms take. It runs on Cloudflare (Workers Assets, a Worker, D1);
`npm run dev` runs the same thing locally, the API and its database included.

## Documentation

- [AGENTS.md](./AGENTS.md) - working rules for anyone (or any agent) changing the code
- [AI_CONTEXT.md](./AI_CONTEXT.md) - the map: glossary, architecture, flows, gotchas
- [docs/](./docs/README.md) - the deep-dives:
  [simulation](./docs/simulation.md) ·
  [matchups and balancing](./docs/matchups-and-balancing.md) ·
  [look and layout](./docs/look-and-layout.md) ·
  [sound and narration](./docs/sound-and-narration.md) ·
  [recording and export](./docs/recording-and-export.md) ·
  [development](./docs/development.md) ·
  [build and deploy](./docs/build-and-deploy.md) ·
  [video library](./docs/video-library.md) ·
  [accounts and billing](./docs/accounts-and-billing.md) ·
  [website](./docs/website.md)

Rubik (the video's font) is © The Rubik Project Authors, under the SIL Open Font License.
