# Goal Rush

BounceReel's third game, and a game of its own: a football match of ninety minutes in one round
pitch on the black stage, two balls, each a club or a player, and one goal that spins round the
ring. A ball that flies through the goal's mouth scores, both kick off again from the middle, and
at ninety minutes the side with more goals wins. It is made in the same studio as the other two
(the switch at the top of the panel), recorded the same way and kept in the same library, and only
on a plan that makes it (`gameAllowed`: Pro and Champion). This page is the whole game.

Its id is `goal-rush` (the config, the library, `GAMES` in [shared/features.ts](../shared/features.ts)).
**Its icon** is [public/games/goal-rush.svg](../public/games/goal-rush.svg): a ring with a goal and
a net in its gap, a ball flying in. **On the site** it plays in the hero's middle phone and in its
section of /games ([src/site/pitch.ts](../src/site/pitch.ts) `SHOWCASES`: El Clásico first, then the
rivalries everyone knows, the Eternal Derby, Messi and Ronaldo, Der Klassiker, the Old Firm and the
rest; the dice deal only these, never two names from deep in the list), and has its card,
its group on the home page and a question; all of them with the drawn kits, and each says so ("no
crests or photos"): the real pictures are the superadmin's alone (§3,
[website](./website.md#4-the-home-page)).

| I need to change... | Touch |
| --- | --- |
| the rules: the goal's mouth and spin, the balls' size and speed, a goal's moment, the kick-off, half time, golden goal | [src/sim/match.ts](../src/sim/match.ts) `MatchWorld`, then `npm run tune` |
| how a match is fitted to the video, how many goals it has, the stories it asks for, a chosen winner, the dice | [src/sim/match-balance.ts](../src/sim/match-balance.ts) `searchMatch`, `randomMatch` |
| which clubs and players there are, their kits, numbers, years, groups, the search's other names, the derbies | [src/football/teams.ts](../src/football/teams.ts) |
| the classic matches | [src/football/classics.ts](../src/football/classics.ts) |
| how a kit is drawn, the sides' colours on the stage | [src/football/kits.ts](../src/football/kits.ts) |
| the superadmin's real crests and photos | [scripts/pictures.ts](../scripts/pictures.ts), [scripts/faces.swift](../scripts/faces.swift), [src/football/pictures.ts](../src/football/pictures.ts), [worker/routes/sides.ts](../worker/routes/sides.ts) (§3) |
| the pitch's geometry | `PITCH` in [src/layout.ts](../src/layout.ts) (physics: run `npm run tune`); where the picture sits, `SCALE` and `CENTRE_Y` in [src/render/match.ts](../src/render/match.ts) |
| how it looks: the title, the scoreboard, the pitch and the goal, the balls, a goal's moment, the timeline, the winner card | [src/render/match.ts](../src/render/match.ts) `MatchRenderer` |
| what it sounds like | `sonifyMatch` in [src/audio/sonify.ts](../src/audio/sonify.ts); the whistle, the crowd, the kick and the post in [engine.ts](../src/audio/engine.ts) |
| what the narrator says | `matchScript` in [src/audio/narration.ts](../src/audio/narration.ts); the title's questions `MATCH_QUESTIONS` in [opening.ts](../src/audio/opening.ts); the winner and last lines `MATCH_WINNER_LINES`, `MATCH_LAST_LINES` in [src/config.ts](../src/config.ts) |
| the studio's card: clubs or players, the pickers, the classics and how often each was made, the dice | [app.html](../app.html) `.goal-card`; [src/app.ts](../src/app.ts) "Goal Rush" (`buildMatchBlock`, `syncMatch`, `loadRecord`); the pickers [src/ui/picker.ts](../src/ui/picker.ts) |
| the site: the hero's phone, the card, /games, the home page's group | [src/site/pitch.ts](../src/site/pitch.ts) `PitchDemo`, `SHOWCASES`; [index.html](../index.html), [games.html](../games.html); the still frame `midMatch` in [scripts/stills.ts](../scripts/stills.ts) |
| what the library keeps | `match_result` on `videos` ([0012_goal_rush.sql](../migrations/0012_goal_rush.sql)), `MatchSummary` in [shared/api.ts](../shared/api.ts), [worker/validate.ts](../worker/validate.ts), [worker/videos.ts](../worker/videos.ts) |

## 1. The rules

- **The pitch** is one circle (`PITCH`: centre 540, 915, radius 485, the Arena Clash's circle as a
  constant of its own). The two balls fly straight at one speed (`SPEED`, 780 px/s), bounce off
  the ring (turned by up to `SCATTER`, 0.12 rad, and never left skimming it) and off each other
  (as equal masses, each turned by up to `CLASH`, 0.25 rad). Each is 200 px across (`BALL_R` 100):
  a face or a crest in it reads on a phone.
- **The goal** is a gap in the ring 0.64 rad wide (`MOUTH` 0.32 either side of its middle, 305 px),
  turning round the ring at `SPIN` (1.35 rad/s, once round in 4.7 s), the other way from half time,
  as the sides change ends. It stands still while a goal is celebrated.
- **A goal**: a ball that meets the ring inside the mouth, by a little over half its own width on
  the ring (`SCORE_IN`), has scored. One that meets it within as much either side of a post bounces
  off the post instead (POST!). The match stops for `CELEBRATE` (0.7 s of the clock, which runs on),
  the scorer in the net, then both balls are put on their kick-off spots (170 px either side of the
  centre spot, home on the left) and away, each heading anywhere but at the other.
- **The clock**: the match is `match.seconds` long (balancing sets it, §2), and the scoreboard shows
  them as 0' to 90'. A goal's minute is the football one (a goal at 66:12 is 67').
- **Full time** at ninety minutes whatever is happening, a goal's moment included: a winner in the
  last second is followed by the whistle, not a kick-off. Level at ninety, the next goal wins
  (golden goal, the clock 90+); a balanced match never gets there. Golden goal that runs past
  `timing.maxSeconds` gives it to the home side.
- After the whistle the goal is shut and the balls fly on, bouncing, under the winner card.

**It steps by time** (`MATCH_STEP`, 1/240 s), not by distance as an Arena Clash does: a match is
fitted to its video by its length alone, which is its clock's. **Determinism** is the race's
([simulation](./simulation.md)): `dsin`/`dcos` only, and randomness from
`createRng(\`match:${seed}\`)`. `predictMatch` runs a 60 s match in a few milliseconds; the page
replays it exactly.

## 2. Balancing

`searchMatch` ([match-balance.ts](../src/sim/match-balance.ts)):

1. Each side has a length of its own, `raceSeconds(cfg, name)`: the video less the frame around the
   match ([pacing.ts](../src/pacing.ts)), whose winner card is planned for the winner line said with
   that side's name ("Borussia Mönchengladbach wins 3 to 2!" is longer than "Lens wins 3 to 2!").
   There is no slow motion before the whistle (`leadSlow` is 0 for a match); the 1.2 s after it are
   FULL TIME.
2. A seed is run at each side's length; it lands for a side when, at that length, that side wins.
   Nothing else is chosen: the length is the clock's, so the video ends on its second.
3. Of the seeds that land, the first that is the match wanted (`fault` 0), else after 50 seeds one
   only fair, else after 160 (320 with a chosen winner) the best:
   - not a draw (golden goal never lands);
   - goals in the range `goalsWanted` gives for its length: 2 to 5 in a 30 s video, 3 to 7 in 40 s,
     5 to 10 in a minute;
   - won by three or fewer;
   - no goal in the first 2.5 s, and the first one by a quarter of the match;
   - no stretch without a goal longer than 40 % of it;
   - the story its seed asks for (`story:<seed>`): four in ten a **comeback** (the winner was behind
     at some point), four **decided late** (the winning goal in the last 30 %), two whatever comes.

Seeds are the config's own first, then `<seed>.1`, `<seed>.2`…, so a balanced match lands again at
once. `npm run tune` checks twelve matches of every pool of clubs and of players at 30, 40 and
60 s, with and without a chosen winner: all land, none off its length, none in golden goal.

## 3. The sides and their pictures

[teams.ts](../src/football/teams.ts) has 157 clubs (the 2025/26 Premier League, La Liga, Serie A,
Bundesliga and Ligue 1, that season's Champions League, Serbia and the old Yugoslavia's big clubs,
and the rest of Europe's, the Americas' and Asia's best known) and 453 players (today's stars by
country, and some 140 legends), and the derbies and rivalries their pairs make ("El Clásico", "the
Eternal Derby", "the GOAT debate"). Each has the name a commentator says, the short name the
scoreboard writes, the letters on its ball (a club) or the number he is known by for his country
(a player; none where he has worn several), its kit (two colours and a pattern), its country, and
its founding or birth year, which is all the narrator's facts are made of: years and names, which
never go out of date. A club's league only groups the dice and the search.

**Everyone's balls are kits**, drawn from colours ([kits.ts](../src/football/kits.ts)): a club's
shirt with its letters on a roundel, a player's national shirt and number (or the name, when there is none).
Nothing on them is a crest or a photo. Each side's colour on the stage is its kit's, made legible on
black; an away side whose colour is too near the home side's takes its other colour.

**The superadmin's are real**: every club's crest and every player's photo, the owner's decision
(2026-11-23) for his own videos, none shipped to customers, whom a site that shared crests and
photos would expose to the clubs' and photographers' claims.

- `npm run pictures -- fetch` downloads each club's crest from its English Wikipedia page into
  `pictures/` (never in git, never in the site's public files); `photos` picks each player's best
  photo of up to six (the player's page's and Wikimedia Commons' first with the name): macOS's face
  detection ([faces.swift](../scripts/faces.swift), built once with `swiftc`) rates each, the one
  with one clear, big, sharp face looking at the camera wins (a photo where another face is nearly
  as big, or whose face is too near its edge to be centred, loses), and a square round the head and
  shoulders is cut out of it with `sips`. `pictures/manifest.json` keeps where each came from: its
  page and its file's page, for the author and licence.
  ⚠️ Look at the photos before uploading: a statue, a mural, a fan's painting, a billboard or a
  namesake can have the clearest face. `PAGES` in [pictures.ts](../scripts/pictures.ts) names a
  player's Wikipedia page where the name is several people's ("Adriano" was the singer), and
  `PHOTOS` the file to take instead (on Commons, or `it:` for one the Italian Wikipedia keeps
  itself, as its old Serie A photos), then `photos --only=<id>` again. A file chosen by hand is
  taken whatever its face (only found in it, to cut round), and asked for at one of Wikimedia's
  standard thumbnail widths: an original file is throttled for minutes. Every player and every
  club has its picture.
- `npm run pictures -- upload` puts them into the local bucket, `upload --remote` into
  production's (asking first, as everything remote does), under `sides/` with `sides/manifest.json`.
  Only the crests and the photos cut round a face go.
- `GET /api/admin/sides` lists them and `GET /api/admin/sides/:file` serves one: under `/api/admin`,
  so the router has checked the superadmin role before either runs
  ([worker/routes/sides.ts](../worker/routes/sides.ts)). A file's name carries its content's hash,
  so the browser keeps it for good and a new picture is a new address.
- The studio of a superadmin loads the list and a match's two pictures before its first frame
  ([pictures.ts](../src/football/pictures.ts)); a crest is trimmed to its shield (the margin and the
  parts standing clear of it, like the stars over Red Star's and Partizan's, go) and drawn big on
  white going to its kit's colour at the edge, a photo fills the ball with the player's number on a
  small badge of the shirt. A side with no picture is its kit.

## 4. The look

One look, the Arena Clash's black stage with a pitch on it ([render/match.ts](../src/render/match.ts)):

- **The title**: the derby or rivalry in gold when the two make one (EL CLÁSICO), else the format's
  line, 90 MINUTES · ONE SPINNING GOAL, in grey (y 300); the video's question in big white type
  (y 362, up to 80 px, fitted to 920 px).
- **The scoreboard** (y 414–518), a broadcast's: a dark bar, each side's ball and name at its end
  over a line of its colour, the score on a deeper block in the middle with the clock under it (a
  breathing red dot and the minute, gold in golden goal, FT at the end). A side that scores has its
  number pop in its colour and its half of the bar flash.
- **The pitch**, drawn at 82 % round its centre at y 985 (`SCALE`, `CENTRE_Y`): the ring of light
  from y 587 to 1383, the net and the crowd out to 44 px past it, 98 px from the frame's sides at its
  widest, so the crowd, the goals on the timeline and the chip under it each have room. Inside, a
  floodlit green turf (`TURF`), mown in twelve stripes, its grass a seeded scatter of blades, in
  shade toward the ring, with its halfway line, centre circle and spot in soft chalk. The goal,
  turning with its end of the pitch: the mouth floodlit, the goal area an arc round it (`GOAL_AREA`,
  200 px, as futsal's: boxes do not sit on a round pitch) and a spot; the ring open across the
  mouth, the goal line dashed, two white posts, the net behind, dark inside, with its mesh.
- **The crowd**, in a stand round the pitch between the ring and the net's reach (`STAND_IN` to
  `STAND_OUT`): dark terraces, a line between the rows, sixteen blocks with a stair between each
  (`paintStand`), and three rows of fans (`CROWD_ROWS`), the home side's on the left half (where home
  kicks off) and the away side's on the right. Each fan is seen from above as a broadcast's roof
  camera sees one: shoulders in the side's colour, its shirt's other colour or white, and a head of
  hair (`HAIR`), dim at rest (`FAN_IDLE`). The scorer's half jumps for `CHEER` (2.4 s), lit full,
  hands up (`SKIN`), scarves held out and flags waved in its two colours, phones flashing, its colour
  glowing over its stand, while the other half sits dimmer; at the whistle the winner's half never
  stops.
- **The balls**: each its kit (or picture) in a ring of its colour, glowing, with a comet trail; a
  player's name under his ball. A bounce ripples in its colour, the two meeting ripple white with a
  spark, a post rings white with POST!.
- **A goal's moment**: the net bulges where the ball went in and wobbles, tinted in the scorer's
  colour; a flash and a shockwave from the goal; GOAL! over the pitch, white edged in the colour,
  leaning forward, with rays turning behind it and the scorer and minute under it (VINÍCIUS 67'),
  holding until the kick-off and fading over the play's first 0.3 s (`GOAL_FADE`); paper bursting
  from the goal; the scorer's half of the crowd on its feet; the frame shakes; at the kick-off both
  balls pop onto their spots.
- **The timeline** (y 1463, 30 px under the crowd's glow at its lowest): the ninety minutes as a
  line filling with the clock, a tick at half time, each goal its scorer's small ball on the line
  at its minute (one too close to the goal before sits just after it, so each shows whole).
- **Under it** (y 1535): HALF TIME · THE GOAL TURNS BACK for 1.8 s at half time, GOLDEN GOAL ·
  NEXT GOAL WINS while it lasts, and once in the match the follow button (`matchFollowAt`, near 45 %
  of it, clear of goals and half time). The free plan's watermark at y 1591, its bottom (y 1612) over TikTok's caption (from y 1620).
- **Full time**: FULL TIME over the pitch in the second before the card; then the winner card: the
  winner's ball big over a dark card framed in its colour, FULL TIME · WINNER, its name, the score
  with the loser's ball and name, both sides' goals by minute, the last line; confetti; the follow
  button under it.

## 5. Sound and narrator

**Sound**: a bounce off the ring plays the melody, the two balls meeting thud, a post clangs. A goal
is a real referee's whistle, a long blast, with a thud as the net takes the ball and a real stadium
going up, two seconds of it ([sound and narration](./sound-and-narration.md#1-the-engine): CC0
recordings in public/sounds/, loaded before a match plays); the crowd on screen jumps as long
(`CHEER`, 1.6 s). The match's first kick-off is a short blast (after a goal its long blast has
said it), half time two, full time three (the last long) and the fanfare; golden goal stings.

**The narrator** says two lines, as in the other games: the opening (`matchScript`): the two sides,
and the derby when they make one ("It's the Eternal Derby: Red Star Belgrade against Partizan!"),
the rule in one sentence ("Fly through the spinning goal to score."), one fact from the years and
countries ("Both clubs were founded in 1945.", "Lionel Messi was born 2 years after Cristiano
Ronaldo."), and the question; and the winner line at the whistle, with the score ("Real Madrid wins
3 to 2!").

## 6. In the studio

- **The switch** at the top of the panel has the three games.
- **The match card**: Clubs or Players; the match as a fixture, both sides' balls big with their
  names and, between them, how many times this account has made the match and who won how many
  ("3× · 2–1", from its library); **Classic matches**, 201 pairs in groups (derbies, Europe's great
  nights, the big leagues, Serbia and the Balkans, the GOAT debate, today's rivals, then and now,
  legends), each with the same numbers; the two sides, each a picker you type into (`srb`, `zvezda`,
  `cr7`, `modric` all find theirs: [picker.ts](../src/ui/picker.ts)) and a die; where the dice picks
  from (`MATCH_POOLS`, kept with the dice's other settings); the winner; the verdict ("Real Madrid
  wins 3–2 · The video runs 40 s · 5 goals").
- Every change balances a new match between frames, as a battle does; Record waits for it.

The same pickers are Arena Clash's flags: every country by its English name, its own name, its name
in Serbian and short forms (`ALSO_CALLED` in [countries.ts](../src/battle/countries.ts)).

## 7. In the library

`videos.game` is `goal-rush`; `match_result` holds `MatchSummary` as JSON (clubs or players, the two
ids, the score, the winner, every goal with its side and minute), the other games' columns stay NULL
([0012_goal_rush.sql](../migrations/0012_goal_rush.sql); not `match`, an operator in SQLite). The
Worker checks the game against the plan, two different ids of one kind and a goal for every point of
the score. The Videos page shows "Goal Rush, clubs", "Real Madrid wins 3–2", the winner's kit as
the thumbnail, and its own totals (home and away wins, matches won by one goal, every side played
and won). The superadmin's text for posts starts `BounceReel goal rush:` ([library.ts](../src/library.ts)
`matchPrompt`).

## Changelog

- 2026-11-23 - Goal Rush: a match of ninety minutes with a spinning goal, clubs (157) or players (464), balanced by seed to the video and to a story; the scoreboard, the timeline of goals, a goal's moment; whistles and the crowd; the match card with typed pickers, 202 classic matches and how often each was made; the same pickers for Arena Clash's flags; the superadmin's real crests and photos (`npm run pictures`); `videos.match_result` (0012).
- 2026-11-23 - on the site: the hero's third phone and a section of /games playing it (pitch.ts), its card, a group on the home page's stage and a question, all with the drawn kits and saying there are no crests or photos; its frames public/games/goal-rush.webp and -270.webp.
- 2026-11-23 - every player photo looked over on contact sheets: statues, a mural, a fan's painting, a billboard and namesakes replaced through `PHOTOS` (a file chosen by hand is now the one rated) and `PAGES`; the picks still poor taken out, those players keep their kits.
- 2026-11-23 - a livelier match, at the owner's asking: the balls faster (`SPEED` 780), the goal turning faster (`SPIN` 1.35) and a little narrower (`MOUTH` 0.32, so the goals stay about six a 40 s video), a goal stopping it for 0.7 s (`CELEBRATE`), GOAL! fading into the play; a green, mown, floodlit turf; the goal with its end of the pitch (goal area, spot, lit mouth), a dark net and white posts; the crowd, half each side's, the scorer's half jumping; the site's phone dealing only the big rivalries; eleven little-known Serbia players taken out (453 players, 201 classics); every player's photo found, Maradona's in Argentina's shirt.
- 2026-11-24 - room under the pitch, at the owner's asking (the crowd, the timeline's goals and HALF TIME touched): the pitch at 82 % round y 985, the goals as balls on the timeline, the chip and the mark lower; the crowd as people in a stand (terraces and stairs, shoulders and heads from above, hands, scarves and flags on a goal); Goal Rush's own page on the site (website.md).
- 2026-11-24 - a goal sounds like one, at the owner's asking (synthesised, the crowd was a hiss and the whistle a toy): a real referee's whistle and a real stadium's roar (CC0 recordings), 2 s, with a thud; the crowd on screen jumps 1.6 s; no second whistle at the kick-off after a goal.
