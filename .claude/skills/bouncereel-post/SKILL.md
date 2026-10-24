---
name: bouncereel-post
description: Writes the posts for one BounceReel video on YouTube Shorts, TikTok and Instagram Reels (title, description, tags, captions, pinned comments) as one JSON block to paste on the Videos page, from the "BounceReel ball race:" text the studio gives a superadmin after a recording (Copy on the sheet after a take, or the copy icon on the Videos page). Use when the user pastes that text or asks for titles, captions or tags for a BounceReel video.
---

# Posts for a BounceReel video

The user pastes a block that starts with `BounceReel ball race:`. It says what the video is: the two
balls and what each does, the winner and by how much, the lead changes, the length, the look and
the sound, the question on the first frame, the file and the library id. Write the three posts
from it and answer with **one JSON block and nothing else**: the user copies it whole and pastes
it on the Videos page (**Paste texts**, or the texts icon on the video's row), which keeps it with
the video. If no block was pasted, ask for it (in the studio: **Copy** on the sheet after a take;
on the Videos page: the copy icon on the video's row).

## Rules

- **No spoilers.** The winner and the margin are there so you know the story, never to tell it:
  they appear in no title, description, tag, caption or comment. Viewers watch to the end to
  find out, and that is what the format lives on. You may say how close it is ("down to the
  last hit") when the margin is under half a second, or that the lead changes hands when there
  are lead changes, without saying who.
- **Only facts from the block.** No invented numbers, records or claims ("the fastest race
  ever"). Ball names as the block writes them.
- **Make people pick a side.** The hook is the contrast between the two balls (one adds its last
  two hits, the other multiplies; huge hits slowly against small hits fast; a power that speeds
  one up) and the question on the first frame. Name the balls by colour too when it helps
  ("purple or blue?"): read the colour from its hex code, in plain words.
- **English**, all of it.
- **Not AI-generated.** It is a simulation recorded in the browser: no AI hashtags, labels or
  claims.
- **Vary the wording** from video to video: a new angle each time (the numbers, the duel, the
  question, the comeback), never the same title pattern twice in a row.

Lengths: a YouTube title up to 60 characters, sentence case, at most one emoji; a YouTube
description of one or two lines, then a line of 3–6 hashtags, `#shorts` first; 10–15 YouTube
tags, lowercase; a TikTok caption under 150 characters with 3–5 hashtags; an Instagram caption of
one or two lines, a call to comment, and 3–5 hashtags. Each pinned comment is a question that
makes people pick, no spoiler, worded differently on each platform.

Hashtags: from the matchup (the sequences: `#fibonacci`, `#factorial`, `#primenumbers`,
`#squarenumbers`…; a power: `#powerup`), plus a few of `#ballrace`, `#marblerace`,
`#satisfying`, `#math`, `#numbers`, `#simulation`. Tags: the sequences, "ball race", "marble
race", "number race", "who will win", "satisfying", "math", "simulation", and the ball names.

## Format

Exactly these keys, valid JSON (escape quotes; a line break inside a text is `\n`):

```json
{
  "video": 12,
  "file": "nova-vs-blaze-seed-k3x9.mp4",
  "youtube": {
    "title": "…",
    "description": "…\n#shorts #ballrace …",
    "tags": ["ball race", "…"],
    "pinnedComment": "…"
  },
  "tiktok": {
    "caption": "… #ballrace …",
    "pinnedComment": "…"
  },
  "instagram": {
    "caption": "…\nComment … below.\n#ballrace …",
    "pinnedComment": "…"
  }
}
```

- `video`: the number on the block's `Library id:` line. Leave the key out when the block has no
  such line (the recording was not in the library yet); the page then finds the video by `file`.
- `file`: the block's `File:` line, as written.

The settings that are the same for every video (the cover and thumbnail, the audience, altered
content, the category, the sound) are written on the Videos page beside the texts, so they are not
in the JSON. Every cover is the first frame (0:00): a BounceReel video opens on a title (both
names large, a big VS, the question) made to be the frame people decide on, and it loops back to
it at the end.
