# Sound and narration

Everything the video sounds like: synthesised notes and cracks, the melodies floor hits
play, the narrator's two lines (the opening and the winner), the voices that say them, and
the timing that keeps the narrator from talking over itself.

| I need to change... | Touch |
| --- | --- |
| an instrument, an effect sound, the mix | [src/audio/engine.ts](../src/audio/engine.ts) |
| a melody, which note a hit plays | [src/audio/music.ts](../src/audio/music.ts) |
| which event makes which sound | [src/audio/sonify.ts](../src/audio/sonify.ts) |
| the opening, the winner line, the line a voice says when tried | [src/audio/narration.ts](../src/audio/narration.ts) `autoScript`, `outroLine`, `previewLine`; facts and briefs in [sequences.ts](../src/sim/sequences.ts) |
| the opening's question (also on screen in the video's first second) | [src/audio/opening.ts](../src/audio/opening.ts) `QUESTIONS`, `openingDraws`, `configQuestion`, `openingQuestion` |
| the winner lines the dice deals | [src/config.ts](../src/config.ts) `WINNER_LINES` |
| the voices, loading Kokoro, the clip cache | [src/audio/narration.ts](../src/audio/narration.ts) `VOICES`, `loadKokoro`, `synthesize`, `VoiceCache` |
| when lines are said, trying a voice | [src/app.ts](../src/app.ts) `playIntro`, `sayOutroWhenFree`, `hear` |
| the voice list and its buttons in the Voice tab | [src/app.ts](../src/app.ts) `buildVoiceBlock` |

## 1. The engine

Every sound is made on the spot with Web Audio; nothing is a sample. All of it ends in
one master that feeds both the speakers and a `MediaStream` the recorder takes, so what
you hear is what the video gets.

```
notes, ticks   ─┐
cracks          ┼─▶ sfx ─▶ glue compressor ─┐
fanfare, sting ─┘                           ├─▶ master ─▶ limiter ─┬─▶ speakers
narration ─────────────────▶ voice ─────────┘                      └─▶ stream (recorder)
```

- **Instruments** (`sound.timbre`): marimba (sine plus a short 4th partial), bell (FM, a
  3.5× modulator dying away), pluck (triangle and saw through a closing low-pass), chip
  (square, at a third of the level).
- **Effects**: a dry tick for a wall, a noise crack and low thump for a broken layer, an
  arpeggio into a held chord over a noise swell for the win, and the **sting** (`sting`) for
  a lead change: two glassy pings a fifth apart, C6 and then G6 85 ms later, each sliding up
  into its pitch over 30 ms, with an inharmonic partial (2.76×). The melodies reach those
  pitches (the scale runs to C7, the last layer's climb lifts a tune an octave), but no note of
  theirs slides or rings like that, in any instrument, so it stands apart from the tune. Like
  the fanfare it is never skipped for the voice cap below: a box of split balls holds the cap
  for long stretches, and the picture flashes either way.
- **Mixing**: the glue compressor (−18 dB, 4:1) evens out piles of notes; the limiter
  (−2 dB, 20:1) stops clipping. At most 48 sounds ring at once; past that new ones are
  skipped. While the narrator speaks, the effects drop to 40 % and come back after.

## 2. What sounds when

[sonify.ts](../src/audio/sonify.ts), once per frame with that frame's events and the world
they came from (every frame, events or not):

| Event | Sound |
| --- | --- |
| floor hit | the next note of the melody, at most 3 per frame (a box of split balls can hit a hundred times a second; more is a smear). The bottom box plays an octave lower, so the two voices of one tune can be told apart. On a team's last layer the note **climbs** a semitone for every whole twelfth of that layer gone, so the octave only for the hit that breaks it (`climb`), and the tune rises as the end nears; most of it comes in the last few hits, a sequence's last terms being its biggest |
| layer broken | crack |
| wall | a quiet tick, at most 2 per frame |
| first finish, timeout | fanfare |
| a lead change the video marks | the sting, on the frame the race reaches it: the prediction's `leads` (handed to `Sonifier` with each run), the same ones the picture shows as LEAD CHANGE ([look and layout](./look-and-layout.md) §12) |

**Melodies** (`sound.melody`), public domain only so a video is never claimed: Ode to Joy,
Für Elise (the right hand of the A section), Twinkle Twinkle, or a pentatonic scale up two
octaves and back (no two notes clash, so overlapping hits still sound like music). Every
floor hit, from either box, advances one shared position in the tune.

**The Sound field** (`sound.track`, the Video section) decides what plays, in the preview as
in the file ([recording and export](./recording-and-export.md#the-sound)): **Narrator and
music** is all of the above and the narrator; **Music only** is all of the above without the
narrator; **Silent** plays nothing (the sonifier is not called) and the file has no sound
track. A run has a narrator only when all three hold (`narrating` in [app.ts](../src/app.ts)):
it was not started with Play without voice, the Sound is Narrator and music, and the
account's plan includes the narrator. Without it nothing is generated, so Kokoro is never
loaded.

## 3. What the narrator says

**The opening** (`autoScript`), unless one is typed in the panel: who is racing (said one
of five ways, `STARTS`: "X versus Y!", "It's X against Y!"…), one clause on what each ball
does, one fact, a question. It never explains the floor, the
layers or the finish line; viewers get that from the picture within a second. About 10–12
seconds:

> Fibonacci Ball versus Slow Factorial Ball! Fibonacci adds up its last two hits. Slow
> Factorial multiplies by the next number. By its twentieth hit, Factorial deals over two
> quintillion. Which one are you betting on?

- Each ball's clause is its sequence's `brief`, plus "but slower" / "but it's much slower"
  when its speed is under 1/1.4 or 1/2.5 of the other's (not when the name already says
  Slow or Fast, nor for a ball that slows down), plus its special ("and it speeds up").
- When both share a sequence: "Both hit with Fibonacci numbers. Growing gets bigger,
  Speeding gets faster."
- The fact is one of a sequence's `facts` (two or three each), from a ball whose name shows
  its sequence; the question is one of twenty (`QUESTIONS`), none leaning to a ball. How it
  starts, the fact and the question are picked by the seed (`opening:<seed>`,
  `openingDraws`), so a new race of the same matchup sounds a little different and a run of
  videos does not keep asking the same thing.
- **The question is on screen too**, over the video's first frame, with every sound
  (`openingQuestion`; [look and layout](./look-and-layout.md) §11): a narrated video asks it
  in the picture first and in words at the end of the opening. An opening typed in the panel
  gives its own last sentence when that is a short question; else the config's question
  shows (`configQuestion`): one typed under More → Video (`look.question`), or the seed's
  pick. A config saved before `look.question` existed keeps the question its seed picked
  then, among the first four, the only ones there were (`firstQuestion`, `savedConfig`):
  its first frame, and the text its posts are written from, stay the video's.
  ⚠️ The questions live in [opening.ts](../src/audio/opening.ts), not in narration.ts: the
  renderer is on the home page too, and narration.ts there would bring the Kokoro loader,
  and the build would tie the home page's scripts to the 2 MB voice chunk.

**Nothing while the race runs.** The picture tells who broke what better than a voice can,
and a line per break piles up: two balls breaking layers a second apart left the narrator
either talking over itself or saying "too" about a break it never named.

**The winner line**: `voice.outro`, `{winner} wins! Did you guess right?` by default
(`{winner}` and `{time}` are filled in). Each roll of the dice deals another of
`WINNER_LINES` ([config.ts](../src/config.ts)), unless the creator wrote their own: the
others say who won and stop ("{winner} takes it!"), since the winner card's last line is the
question. Left empty, the narrator says nothing at the end and the video closes on the
fanfare.

## 4. The voice

The narrator is **Kokoro** ([kokoro-js](https://www.npmjs.com/package/kokoro-js), model
`onnx-community/Kokoro-82M-v1.0-ONNX`, Apache 2.0): free, it runs in the browser, and the
words never leave the computer. It is the only voice, on purpose: a paid voice needs an
API key and a bill per line, and the browser's own `speechSynthesis` plays outside Web
Audio, so it never reaches the file.

**The voices** (`VOICES`) are Kokoro's English voices with the best grades its authors
give them: Heart (A, the default), Bella (A−), Emma (B−, British), Nicole (B−, soft),
Michael, Fenrir and Puck (C+), George (C, British). The Voice tab lists them as a radio
list, each with its accent and grade and a ▶ button that says `previewLine` ("Fibonacci
Ball versus Slow Factorial Ball! Who do you think wins?") in that voice, so a voice can be
heard before it is picked. **Hear the opening** says this matchup's whole opening in the
picked voice. Both go through `hear` and the clip cache, so an opening heard there is not
generated again when the run is recorded. On a plan without the narrator the list and its
previews stay usable, so anyone can hear what the narrator sounds like; the opening and
winner line fields are locked.

A config from elsewhere (an exported JSON, a video saved from an older studio) may name a
voice that is not in the list: `voiceOf` reads it as Heart. One that named no narrator, or
the browser's voice, opens as Music only (`savedConfig` in [config.ts](../src/config.ts)),
since that is how it sounded in its file.

**Loading** (`loadKokoro`), once per page, lazily, on the first line to generate. On a GPU
(WebGPU) it takes the full-precision model (~330 MB, downloaded once, then from the
browser cache) and generates a whole run's lines in a few seconds (the first line of a
page takes longest while the GPU compiles); without one it falls back to the 8-bit model
(~90 MB) on the CPU, several times slower. While it downloads, the status line under the
Voice tab counts the percentage.

- ⚠️ **ONNX Runtime comes from this site.** transformers.js, which kokoro-js runs on,
  fetches its runtime (`ort-wasm-simd-threaded.jsep.mjs` and `.wasm`) from jsDelivr
  unless told otherwise. `ORT` in [narration.ts](../src/audio/narration.ts) points
  `env.wasmPaths` at the copies in `node_modules`, which Vite bundles into `/assets`: one
  company fewer for each visitor's browser to call (the [privacy page](../privacy.html)
  lists who does) and one fewer that can be down. The `.wasm` is 21.6 MB, under the
  25 MiB Workers Assets takes per file; a transformers.js upgrade that grows it past that
  would fail the deploy. The model itself still comes from Hugging Face (`huggingface.co`,
  which hands the files to its CDN, such as `us.aws.cdn.hf.co`).
- ⚠️ It needs cross-origin isolation to use more than one CPU thread:
  [vite.config.ts](../vite.config.ts) sends `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless` on dev and preview, and
  [public/_headers](../public/_headers) in production; without them a run's lines took 80 s
  to generate.
- ⚠️ Its `stream()` never yields the last sentence of a plain string, so lines are split
  into sentences here and generated one by one, with a 0.12 s breath between them.

**The clip cache** (`VoiceCache`) keeps every generated line for the session, keyed by
voice and text, so recording the same matchup again costs nothing. Lines are generated one
at a time: Kokoro has one model to share. A failed line warns in the page ("Voice failed:
…. Playing without it.") and the run plays on without narration.

## 5. Timing

The simulation is deterministic, so both lines a run will say are known before it
starts: `plannedLines(cfg, outcome)` builds the opening and, from the predicted winner, the
winner line (none when it is empty or the race times out without one). Play and Record
generate both first, then:

- **The opening** starts with the run.
- **The winner line** waits for the opening to end if it is still going (a short race or
  a long opening), then plays; the winner card stays until it has ended, plus 0.4 s
  (`AFTER_OUTRO` in [pacing.ts](../src/pacing.ts)), and at least until the video reaches
  its length.

## Changelog

- 2026-10-18 - synth, melodies, the narration (opening, call-outs, winner line), Kokoro on
  WebGPU, ElevenLabs and OpenAI voices; a short opening with a fact; call-outs that would
  overlap the winner line are dropped, and the winner line waits its turn.
- 2026-10-19 - a call-out is dropped once its team has broken another layer.
- 2026-10-20 - the Sound field (narrator and music, music only, silent) decides what plays and is recorded; the narrator also needs a plan that includes it.
- 2026-10-21 - Kokoro is the only voice (ElevenLabs, OpenAI and the browser voice removed, and with them the API keys); no call-outs, only the opening and the winner line, which may be left empty; the Voice tab lists the voices with a ▶ preview each and Hear the opening; ONNX Runtime is served from this site instead of jsDelivr.
- 2026-10-23 - a sting when the lead changes hands for good (glassy pings, never held back by the voice cap); the last layer's notes climb to an octave at the break; the opening's question moved to opening.ts, shown on the first frame too (the openings it writes unchanged, 480 checked).
- 2026-10-26 - more variety in the words: twenty questions (`look.question`, typed under More → Video or the seed's pick; a config saved before keeps its question), two or three facts a sequence, five ways to start the opening, and the dice deals the winner line from `WINNER_LINES`.
