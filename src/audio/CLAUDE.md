# src/audio

Everything the video sounds like: synthesised notes and cracks, melodies, the narrator's
words and the voices that say them. Deep-dive:
[sound and narration](../../docs/sound-and-narration.md).

## Where code goes

| Kind | Place |
| --- | --- |
| an instrument, a sound effect, mixing, ducking under the narrator | [engine.ts](./engine.ts) |
| which note a floor hit plays, a new melody | [music.ts](./music.ts) |
| which event makes which sound | [sonify.ts](./sonify.ts) |
| the opening, the winner line, the voices, loading Kokoro, the clip cache | [narration.ts](./narration.ts) |
| the opening's question, also on screen over the first frame | [opening.ts](./opening.ts): kept apart, since the renderer (on the home page too) must not load narration.ts |

## Rules

- **Everything audible goes through `AudioEngine`.** Its master feeds the speakers and
  the recorder's stream; a sound made anywhere else is not in the video.
- **The opening names the balls, says what each does, adds one fact and asks a
  question.** It never explains floors, layers or the finish line. About 10–12 seconds.
- **Every line must be knowable before the race.** A recording generates all lines from
  the prediction first ([plannedLines](./narration.ts)); a line built from something the
  prediction does not know would be silent in the video.
- **Two lines, and nothing in between.** The narrator says the opening and the winner line
  (none when that field is empty; "Follow for more!" is part of it, `spokenOutro`); a line
  per layer break piled up and talked over itself. The winner line waits for the opening to
  end ([app.ts](../app.ts)).
- **Kokoro is the only voice.** It is free, runs in the browser and is recorded with the
  rest; do not add a paid voice or the browser's `speechSynthesis` (which never reaches
  the file) without asking. Its ONNX Runtime is served from this site (`ORT`), not from
  jsDelivr.
- **Melodies are public domain only**, so a video is never claimed.
