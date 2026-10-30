---
name: bouncereel-post
description: Writes the posts for one BounceReel video on YouTube Shorts, TikTok and Instagram Reels (title, description, tags, captions, pinned comments) as one JSON block to paste on the Videos page, and saves the video's thumbnail (its first frame) next to the clip, from the "BounceReel ball race:" text the studio gives a superadmin after a recording (Copy on the sheet after a take, or "Copy what it is about" in the video's drawer on the Videos page). Use when the user pastes that text, asks for titles, captions, tags or a thumbnail for a BounceReel video, or asks to redo or change them.
---

# Posts for a BounceReel video

The user pastes a block that starts with `BounceReel ball race:`. Write the three posts from it,
save the video's thumbnail next to the clip (*The thumbnail* below), and answer with **one JSON
block in a ```json fence, then the thumbnail's path on a line of its own, and nothing else**: no
greeting, no notes, no alternatives. The user copies the answer whole and pastes it on the Videos
page (**Paste texts**, or the box at the foot of the video's drawer), which reads the JSON, checks
every field and keeps the texts with the video; the path after it is ignored there.

- No block pasted: ask for it, in the language the user writes in. It is on the sheet after a
  take (**Copy**) and in the video's drawer on the Videos page (**Copy what it is about**).
- A change to one text afterwards ("shorter title", "another Instagram caption"): answer with
  the whole JSON again, only that text changed, and the thumbnail's path again under it (it is
  made once; make it again only when its file is gone). The page takes whole answers, never
  pieces.

## Reading the block

| Line | What it is for |
| --- | --- |
| `BounceReel ball race: A vs B` | the two names, as written |
| `Top ball: Name (#hex). Label numbers, what it does (1, 1, 2…)` | the ball's name, its colour, its sequence, what it does in plain words and its first numbers |
| `…; power: it speeds up` (or `slows down`, `grows`, `splits`) | the ball has a power: every floor hit it makes, it gets faster, slower, bigger, or adds a ball |
| `Bottom ball: …` | the same, for the other ball |
| `Winner: …` | **for you only**: the story, never told (see *No spoilers*) |
| `Lead changes: N` | a fact you may use, within the spoiler rules |
| `Video: 45 s, paper look, narrator and music` | the length is a fact you may use; the look and the sound are not for viewers |
| `First frame: the two names, VS and "…"` | the question the video opens on, which the narrator asks too: the posts pose the same choice |
| `Last line on the winner card: "…"` | what the video ends on: the posts' closing question agrees with it, without copying it |
| `Asks viewers to follow: …` | the video asks for a follow itself, with a button and the narrator's "Follow for more!": the posts need not ask again |
| `Seed`, `File`, `Library id` | for the JSON only (`file`, `video`), never in a text |

A block can lack lines. A video saved before configs were kept has no colours, look, first frame
or last line; a recording not in the library yet has no `Library id`. Do without them: no
colours means names only (never guess a colour), no first frame means you word the choice
yourself, no library id means the `video` key is left out.

## Rules

### No spoilers

The format lives on people watching to the end to find out. The winner and the margin are in the
block so you know the story; they appear in no title, description, tag, caption or comment, and
nothing points at them.

- **No leaning.** No "underdog", "comeback", "never stood a chance", "can X catch up?", no
  question worded in one ball's favour. The two balls get equal billing: if one is named, so is
  the other.
- **How close**, only when it is close: a margin under 0.5 s, or `a photo finish` on the
  `Winner:` line, may be told ("down to the last hit", "a photo finish"). At 0.5 s or more, or
  `far ahead`, say nothing about the gap. On `nobody reached the line in time`, promise no
  finish either ("who crosses first?"): ask who wins.
- **Lead changes**, only when there are enough that they give nothing away. With 0–2 do not
  mention the lead: a viewer who sees who leads in the first seconds would know the winner. With
  3–9 say that the lead keeps changing, without the number: an exact small number gives away
  whether the first leader wins (odd: no, even: yes). From 10 the exact number is fine, and a
  good hook: nobody follows the parity of 31 swaps.
- **No maths that predicts the result** ("doubling grows faster", "tribonacci always catches
  up"). The balancer makes every race close whatever the sequences, so it misleads, and it hints.

### One angle, all three platforms

Choose one angle for the video and carry it through the YouTube title and description, the
TikTok caption and the Instagram caption: the same idea, cut to each platform's length. The
owner reads the three side by side on the Videos page, and texts that each tell a different
story read as random. Only the pinned comments are worded differently on purpose.

Choose the angle from what this block has most of:

- **The duel**: the two behaviours side by side ("adds up its last three hits vs doubles every
  hit"). It always works and is the default.
- **The power**: when a ball has one, it is the hook ("one doubles, the other speeds up with
  every hit").
- **The lead changes**: from 10, the number is the hook.
- **The finish**: only when it is close (above).
- **The numbers**: each ball's first numbers side by side, always with what they are and whose
  they are. A bare row of numbers ("1, 1, 2, 4, 7…") says nothing to someone scrolling.
- **The question**: the choice itself, in colours ("green or purple?").

Vary the angle and the title's shape from video to video. When earlier answers are in this
conversation, take a different angle and title shape from the last one; otherwise take the angle
that suits this block best.

### Hook first

The feed shows only the start of a text, and that start is all most people read. How much
shows depends on the screen; these are the working figures (creators' measurements, not
published by the platforms):

- **YouTube Shorts**: the title, cut at about 40 characters.
- **TikTok**: about one line of the caption, some 90 characters.
- **Instagram Reels**: about 55 characters before "more", far less than a feed post's 125.

That start makes sense on its own and poses the choice: both balls, by name, colour or
sequence. What follows it is for search and for the few who open "more". No lead-ins ("Watch
this", "Wait for it", "You won't believe"), no promises the video does not keep.

### Words people search

Search on all three reads the words of the title and captions, and hashtags weigh less than
they did. So each text says once, in a sentence that reads naturally, what the video is: a
ball race (or marble race) and each ball's sequence by its usual name ("Catalan numbers vs
powers of two"). Never a list of keywords: a caption that reads as written for a machine is
treated as one.

### Ask, do not instruct

The description and the captions end on a question between the two (before their hashtags),
made concrete with the colours when they can be told apart: "green or purple?" rather than
"who will win?". No text gives an instruction:
no "Comment green below", "drop a 🟢", "like if", "tag a friend", "follow for more". Meta
demotes posts that ask for a comment with a given word or emoji (comment bait), TikTok keeps
engagement bait off the For You feed, and a real question draws the same comments. The pinned
comments ask for a pick the same way.

### Only facts from the block

No invented numbers, records or superlatives ("the fastest race ever", "99% get this wrong"),
and no arithmetic on the block's numbers ("a lead change every 1.5 s"). The usual name of the
same numbers is fine: doubling is powers of two.

### Names and colours

- **Ball names exactly as the block writes them**, capitals included: they are names, so a
  sentence-case title keeps them. When both full names do not fit, refer to the balls by colour
  or by sequence ("tribonacci vs doubling"), never by a shortened name.
- **A colour in one plain word from its hex**, by hue: red, orange, yellow, green, teal, blue,
  purple, pink. Light or dark shades take the plain word too (`#0ea5e9` is blue, `#65a30d` is
  green, `#7c4dff` is purple). When both balls read as the same colour, use names only.
- **A coloured circle can stand for a ball** in a pinned comment or a title (🔴 🟠 🟡 🟢 🔵
  🟣 🟤 ⚫ ⚪). There is none for pink or teal: write the word.

### Everything else

- **English**, all of it.
- **Not AI-generated**: it is a simulation recorded in the browser. No AI hashtags, labels or
  claims.

## Each platform

**YouTube Shorts**

- `title`: up to 60 characters, sentence case, at most one emoji, no hashtags. It carries the
  angle alone, since outside the Shorts feed the title is all people see, and its first 40
  characters carry it even when the rest is cut: the balls first, then the hook. When the two
  names leave no room for the hook in those 40, name the balls by sequence or colour.
- `description`: the Shorts feed does not show it; search reads it. One or two sentences that
  say what the video is (*Words people search*) and end on the question, then one line of 3–5
  hashtags: the matchup's first, since only the first three show above the title on the watch
  page, and `#shorts` last (YouTube files a vertical clip under Shorts by itself, so the tag
  only costs a place).
- `tags`: 5–10, lowercase, no `#`, under 500 characters together. YouTube says tags play a
  minimal role in finding a video and help mostly when people misspell what they search for,
  so keep them few: the sequences' usual names, the two ball names, "ball race", "marble race",
  and a misspelling people type for a sequence when there is a common one ("fibonnaci",
  "tribonaci").

**TikTok**

- `caption`: under 250 characters with its hashtags. The hook in the first line, within 90
  characters; then, if the hook did not already say it, what the video is (*Words people
  search*) and the question; then 3–5 hashtags.

**Instagram Reels**

- `caption`: three lines. The hook, within 55 characters, so it shows before "more" on a reel;
  then one or two sentences that say what the video is and end on the question; then 3–5
  hashtags (Instagram takes five at most).

**Pinned comments** (one per platform): a short question that asks for a pick, no spoiler. The
three are three different questions, not one sentence with a word swapped. They may lean on the
first frame's question without copying it.

## Hashtags and tags

| Sequence | Hashtag | Tags |
| --- | --- | --- |
| Fibonacci | `#fibonacci` | fibonacci, fibonacci sequence |
| Factorial | `#factorial` | factorial |
| Doubling | `#powersoftwo` | doubling numbers, powers of two |
| Tripling | `#powersofthree` | tripling numbers, powers of three |
| Squares | `#squarenumbers` | square numbers |
| Cubes | `#cubenumbers` | cube numbers |
| Primes | `#primenumbers` | prime numbers |
| Triangular | `#triangularnumbers` | triangular numbers |
| Tribonacci | `#tribonacci` | tribonacci, tribonacci numbers |
| Lucas | `#lucasnumbers` | lucas numbers |
| Catalan | `#catalannumbers` | catalan numbers |
| Tenfold | `#powersoften` | powers of ten, tenfold |
| Collatz | `#collatz` | collatz conjecture, 3n+1 |
| Digits of pi | `#pi` | pi, digits of pi |
| Counting | none | counting numbers |
| Always 1 | none | none |

A ball with a power adds `#powerup`. Each text's hashtags: the matchup's first, then
`#ballrace` or `#marblerace` or both, then at most one broad one of `#satisfying`, `#math`,
`#numbers`, `#simulation`. Narrow tags reach the people who look for this; broad ones bury it
among millions. Nothing outside these lists: no `#fyp`, `#foryou` or `#viral`, which describe
nothing.

## Format

Exactly these keys, valid JSON: double quotes, a line break inside a text is `\n`, a quote inside
a text is `\"`, no trailing commas.

```json
{
  "video": 12,
  "file": "nova-vs-blaze-seed-k3x9.mp4",
  "youtube": {
    "title": "…",
    "description": "…\n#ballrace … #shorts",
    "tags": ["ball race", "…"],
    "pinnedComment": "…"
  },
  "tiktok": {
    "caption": "… #ballrace …",
    "pinnedComment": "…"
  },
  "instagram": {
    "caption": "…\n… green or purple?\n#ballrace …",
    "pinnedComment": "…"
  }
}
```

- `video`: the number on the block's `Library id:` line, as a number. Leave the key out when
  there is no such line; the page then finds the video by `file`.
- `file`: the block's `File:` line, as written.

The settings that are the same for every video (the cover and thumbnail, the audience, altered
content, the category, the sound) are shown on the Videos page beside the texts, so they are not
in the JSON. Every cover is the first frame (0:00): the video opens on a title (both names large,
a big VS, the question) made to be the frame people decide on, and loops back to it at the end.

Under the JSON, after an empty line, the thumbnail's absolute path in backticks and nothing
else:

````
```json
{ … }
```

`/Users/…/Bounce Reel/factorial-ball-vs-tribonacci-ball-seed-914567-thumbnail.jpg`
````

## The thumbnail

The video's first frame (0:00) as a JPEG, saved beside the clip as `<file name>-thumbnail.jpg`:
the frame every platform uses as the cover, as a file to upload where one is asked for (a custom
YouTube thumbnail, an Instagram cover from the camera roll). A JPEG at `-q:v 2` is about
0.2–0.5 MB, under YouTube's 2 MB limit for a thumbnail.

Find the clip by the block's `File:` line. A take lands in Downloads, and the user may have moved
it (to a folder on the Desktop, say); a browser saves a second file of the same name as
`name (1).mp4`, so take the newest match:

```sh
FILE='factorial-ball-vs-tribonacci-ball-seed-914567.mp4'   # the block's File: line
STEM="${FILE%.mp4}"
CLIP=$(find ~/Downloads ~/Desktop ~/Movies ~/Documents -maxdepth 3 -type f \( -name "$FILE" -o -name "$STEM (*).mp4" \) -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
OUT="$(dirname "$CLIP")/$STEM-thumbnail.jpg"
[ -n "$CLIP" ] && ffmpeg -v error -y -i "$CLIP" -frames:v 1 -q:v 2 "$OUT" && ls -l "$OUT"
```

Then look at it once (Read the image): it must be the title frame, both names large, VS and the
question. A black or empty frame, or a file over 2 MB, is not a thumbnail: say so on the path's
line instead of the path.

No clip found: in the path's place, one line in the user's language saying it is not in
Downloads, Desktop, Movies or Documents, and asking where it is. The JSON does not wait for it.

## Before answering

Run the draft through this; it counts what is easy to miscount (the JSON goes between the `EOF`
lines as it is):

```sh
node -e '
const t = JSON.parse(require("fs").readFileSync(0, "utf8"));
const n = (s) => [...s].length;
const h = (s) => (s.match(/#\w+/g) || []).length;
const first = (s, k) => [...s.split("\n")[0]].slice(0, k).join("");
const check = (name, ok, got) => console.log(ok ? "ok  " : "FIX ", name, got);
const texts = [t.youtube.title, t.youtube.description, t.youtube.pinnedComment, t.tiktok.caption, t.tiktok.pinnedComment, t.instagram.caption, t.instagram.pinnedComment];
check("title <= 60", n(t.youtube.title) <= 60, n(t.youtube.title));
check("youtube hashtags 3-5", h(t.youtube.description) >= 3 && h(t.youtube.description) <= 5, h(t.youtube.description));
check("#shorts last", (t.youtube.description.match(/#\w+/g) || []).pop() === "#shorts", "");
check("tags 5-10", t.youtube.tags.length >= 5 && t.youtube.tags.length <= 10, t.youtube.tags.length);
check("tags lowercase, < 500", t.youtube.tags.every((x) => x === x.toLowerCase()) && t.youtube.tags.join(",").length < 500, t.youtube.tags.join(",").length);
check("tiktok < 250", n(t.tiktok.caption) < 250, n(t.tiktok.caption));
check("tiktok line 1 <= 90", n(t.tiktok.caption.split("\n")[0]) <= 90, n(t.tiktok.caption.split("\n")[0]));
check("tiktok hashtags 3-5", h(t.tiktok.caption) >= 3 && h(t.tiktok.caption) <= 5, h(t.tiktok.caption));
check("instagram line 1 <= 55", n(t.instagram.caption.split("\n")[0]) <= 55, n(t.instagram.caption.split("\n")[0]));
check("instagram hashtags 3-5", h(t.instagram.caption) >= 3 && h(t.instagram.caption) <= 5, h(t.instagram.caption));
check("no comment bait", !texts.some((s) => /\b(comment\b[^?\n]*\b(below|down)|drop (a|an|your)|tag a friend|like if|follow for)\b/i.test(s)), "");
check("no #fyp, #foryou, #viral", !texts.some((s) => /#(fyp|foryou\w*|viral)\b/i.test(s)), "");
console.log("\nWhat the feed shows:");
console.log("  youtube   ", first(t.youtube.title, 40));
console.log("  tiktok    ", first(t.tiktok.caption, 90));
console.log("  instagram ", first(t.instagram.caption, 55));
' <<'EOF'
{ … }
EOF
```

Then read it once more for what no script sees:

- what the feed shows (the script's last three lines) makes sense alone and poses the choice;
- the winner and the margin are nowhere, and no wording leans to one ball;
- the title and the three captions tell the same angle, and it is not the last video's;
- the description and both captions say in words that it is a ball race and name the
  sequences, without reading as a keyword list;
- every fact is in the block;
- the description and the captions end on a question, and no text tells people what to do;
- the three pinned comments are three different questions.
