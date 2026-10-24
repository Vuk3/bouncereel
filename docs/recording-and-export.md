# Recording and export

How a recording is made and why it ends on its exact length, the file it produces, what
YouTube Shorts, TikTok and Reels want, and the ffmpeg line for anything else.

| I need to change... | Touch |
| --- | --- |
| the file type order, bitrates | [src/record/recorder.ts](../src/record/recorder.ts) `TYPES`, `Recorder` |
| what Record puts in the sound (narrator and music, music only, silent) | the Sound field in [app.html](../app.html), `buildSoundBlock` and `narrating` in [src/app.ts](../src/app.ts), `sound.track` in [src/config.ts](../src/config.ts) |
| when a recording starts and stops, the file name, the bar and the sheet | [src/app.ts](../src/app.ts) `record`, `soundFlowing`, `startTake`, `finishRecording`, `showFinished`, the `winner` and `done` phases; [src/audio/engine.ts](../src/audio/engine.ts) `flowing` |
| the time around the race | [src/pacing.ts](../src/pacing.ts) |
| what goes into the audio | [docs/sound-and-narration.md](./sound-and-narration.md) |
| what is saved to the library after a recording | [docs/video-library.md](./video-library.md#4-what-record-saves) |

## 1. Making a recording

**Play is the preview**, free and as often as anyone likes; the race it shows is the race
Record makes, since the same seed plays the same race. **Record** does, in order: check that the
plan allows this video (its length, look, sound and powers) and that its day has a video left,
Record being off otherwise, and ask first when it is the day's last
([accounts-and-billing](./accounts-and-billing.md#6-plans-and-features)); check that the browser
can record at all; unlock audio; restart the run and hold its first frame; generate the
narrator's two lines if they are not ready (status "Generating voice 1/2…"); for a file with
sound, wait until the audio clock moves (`AudioEngine.flowing`, at most 4 s, else it says the
sound did not start and stops there); have the server take one of today's videos
(`POST /api/account/day`; a no ends it here, with nothing recorded); then start a
`MediaRecorder` on `canvas.captureStream(60)` plus the audio engine's stream (none for a silent
video), and play. The panel is locked while it records; **Stop & save** ends it early and still
saves.

⚠️ **Why Record waits for the sound.** An `AudioContext` says "running" before its device does:
on a Mac whose sound output had been idle, `currentTime` stayed at 0 for 2.3 s (measured). A
recorder started then has no sound to pair the first frames with, and Chrome's MP4 writer drops
them, so the file began 1.7 s into the race and came out short, while the toast, timing the wall
clock, said 30.0 s. A warm device moves the clock within 12–66 ms, so the wait costs nothing then.

- **While it records**, a bar over the preview (`#rec-bar`, not in the file: the recorder takes
  the canvas alone) says "Recording, 17.6 s left" and, from the first frame, "Keep this tab in
  front: a hidden tab stops drawing"; the timeline turns red. If the tab is hidden anyway, the
  bar says on return how long and that the file has a pause there, and offers Stop & save, and
  Record again (dropping this take) when the day still has a video for it; doing nothing keeps
  recording.
- **When it ends**, a sheet (`#finished`) opens once the file has downloaded and the library has
  answered: the file's name, length and size, what the library did with it (added; refused, with
  the reason and a link to the plans when the plan stood in the way; or waiting to be sent), and
  Open Videos, Close and Roll the next one (the dice). It replaces the toasts. **A superadmin also
  sees what the video is as text, with Copy** (the balls and what each does, who won and by how
  much, the lead changes, the length, look and sound, the question on the first frame, the library
  id: `postPrompt` in [src/library.ts](../src/library.ts)), for the `/bouncereel-post` skill in
  `.claude/skills/`, whose answer is pasted on the Videos page
  ([video-library §6](./video-library.md#6-the-videos-page)).
- **While it records, the frame loop's clock may jump up to 0.5 s a frame** (0.1 otherwise): the
  encoder's first stalls (150–200 ms, measured) were time the race did not run, and the file came
  out 0.15 s long.

- The canvas is always 1080×1920; the page only shows it scaled down, so the recording is
  full size whatever the window.
- ⚠️ **Keep the tab visible.** A hidden tab stops `requestAnimationFrame`, and the video
  with it: the bar says so while it records, and what happened when the tab comes back.
- **On a plan with the watermark**, the frame Record captures carries it, as the preview
  does ([look and layout](./look-and-layout.md#10-the-power-tag-and-the-watermark)).

## 2. Ending on the exact length

The race was balanced to `timing.video` minus the frame around it
([pacing](./matchups-and-balancing.md#2-the-video-length)), and the page counts real
playback time from the start of the run. The winner card stays up until that count
reaches the video length less `END_PAD` (0.5 s), it has been up at least 1.5 s, and the
winner line has ended plus 0.4 s; then `END_PAD` more, and the file downloads. With
`look.loop` (the default) those last 0.5 s fade into the run's first frame and end on it,
so the file's last frame is its first and a platform's replay has no seam
([look and layout](./look-and-layout.md#6-the-end-a-loop)). A recording comes
out within a few hundredths of a second of the requested length unless the winner line
runs longer than planned, in which case the video waits for it.

## 3. The file

The first type the browser can encode wins (`TYPES` in [recorder.ts](../src/record/recorder.ts)):

1. MP4, H.264 High@4.2 (`avc1.64002A`) + AAC: what Chrome records. 4.2 is the level that
   covers 1080×1920 at 60 fps.
2. Other MP4 H.264 variants, then MP4 with Opus.
3. WebM VP9 / VP8 + Opus (Firefox).

16 Mbps of video and 192 kbps of audio are requested; Chrome's encoder spends less on flat
graphics (measured 5–14 Mbps). The frame rate is variable, averaging just under 60. The
toolbar shows which format this browser writes.

**Which browsers record well**, as the home page, its FAQ and the terms say:

| Browser | Writes | |
| --- | --- | --- |
| Chrome, Edge (a computer) | MP4, H.264 + AAC | what the platforms take as it is; the one tested |
| Firefox | WebM, VP9 + Opus | its `MediaRecorder` has no MP4 ([Mozilla bug 1631143](https://bugzilla.mozilla.org/show_bug.cgi?id=1631143)); TikTok and Instagram want it converted (§4) |
| Safari | not tested | |

⚠️ **The studio says so before a recording, not after**: when the first type it can encode
is not MP4, `#format-warning` appears under the toolbar ("This browser records WebM, not
MP4: TikTok and Instagram want it converted first…"), and when it can encode nothing, that
it cannot record at all.

The file downloads as `<top>-vs-<bottom>-seed-<seed>.mp4`, for example
`fibonacci-ball-vs-slow-factorial-ball-seed-1.mp4`. Then the video goes into the library
(its config, the file name, the length, the prediction's winner and margin) and the toast
ends with "· added to Videos", or says why not; a recording ended with **Stop & save** is
saved too, marked as stopped early ([video library](./video-library.md#4-what-record-saves)).

### The sound

The Video section's **Sound** (`sound.track`) decides what goes into the file, and Play
follows it so the preview sounds like the file:

| Sound | In the file | The narrator |
| --- | --- | --- |
| **Narrator and music** | the narration over the notes, cracks and fanfare (one AAC track) | as picked under Voice; none if Voice is "No narration" |
| **Music only** | the notes, cracks and fanfare (one AAC track) | none, whatever Voice says |
| **Silent** | **no sound track at all**: an MP4 with the H.264 video alone | none |

Music only and silent are for a creator who adds a trending sound in TikTok, Instagram or
YouTube when posting. Without a narrator the winner card is not planned around a winner line
(`narrated` in [pacing.ts](../src/pacing.ts)), so the race gets that time.

**Why silent means no audio track rather than a silent one**, as ffprobe showed (Chrome 155):
both play and both are accepted as MP4, but the file without a track is one H.264 stream whose
format duration is the video's own (a 30 s silent recording: one stream, 29.89 s), while a
silent AAC track is a second stream that ends on its own clock (in a 6 s test, 0.024 s before
the video), the very mismatch section 5 warns about, for no sound at all. The silent track
costs nothing (about 2 kbps), so file size did not decide it. The recorder picks the same
types without their audio codec (`video/mp4;codecs=avc1.64002A`), and the library's format says
"MP4 · H.264".

## 4. For the platforms

YouTube Shorts, TikTok and Instagram Reels all take **MP4, H.264, AAC, 1080×1920**
directly; Chrome's file needs nothing done to it. Instagram may convert to 30 fps on
upload; that is expected.

If a browser wrote WebM, or a platform rejects the variable frame rate:

```sh
ffmpeg -i in.webm -vf "fps=60,format=yuv420p" -c:v libx264 -preset slow -crf 17 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart out.mp4
```

`fps=60` makes the frame rate constant, `yuv420p` is what every phone plays,
`+faststart` lets a player start before the whole file has loaded.

⚠️ **Chrome lets a page download one file on its own.** The second recording in the same
visit asks first ("Download multiple files?" in the address bar); until it is allowed the
file does not land, although the video is already in the library. Allow it once and it
stays allowed for the site.

## 5. Checking a file

```sh
ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,codec_name,duration,width,height,avg_frame_rate -of default=nw=1 video.mp4
ffmpeg -i video.mp4 -lavfi "showspectrumpic=s=1400x300:scale=log:stop=6000" spectrum.png
```

⚠️ The format's duration is its longest stream: read the video stream's own `duration`
too. In testing (Chrome 155, the automation browser), three of seven recordings came out
with the video stream shorter than the audio: once missing its first 1.75 s, twice
almost all of it. Repeated, the same recording was whole, and it could not be made to
happen on demand; a short recording of the canvas and a test tone, made without the app's
recorder, showed it once too.

The spectrum shows narration as dense vertical bands and floor-hit notes as short
horizontal marks: a quick way to see that the voice is in the file and where each line
falls.

## Changelog

- 2026-10-18 - MediaRecorder to MP4 in Chrome, recordings ending on the exact video
  length.
- 2026-10-19 - a saved recording goes into the video library.
- 2026-10-19 - the end fades into the first frame (`END_PAD` 0.5 s); the second download asks first; check the video stream's own duration.
- 2026-10-20 - the Sound choice on Record: narrator and music, music only, or silent (no audio track, decided with ffprobe); Record checks the plan first.
- 2026-10-21 - on a plan with a daily limit, Record shows what is left of the day and is off once it is used.
- 2026-10-21 - the studio warns above the preview when the browser cannot record MP4; the browsers that record well, in a table; the watermark is in the file on a plan that has it.
- 2026-10-21 - Record takes the day's video from the server once the narration is ready, before the first frame, and asks before the day's last one; Play is the free preview of the same race.
- 2026-10-23 - Record waits for the audio clock before the first frame (a cold device had cut a fresh page's first take by 1.7 s), and the clock may jump up to 0.5 s a frame while recording (the file had run 0.15 s long); a bar over the preview while recording, a hidden tab's pause said with Stop & save or Record again; a sheet after each take in place of the toasts.
- 2026-10-24 - the sheet after a take gives what the video is as text to copy (`postPrompt`), for writing its posts.
- 2026-10-24 - that text only for a superadmin, with the library id.
