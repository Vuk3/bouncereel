import {
  PLATFORM_LABELS,
  PLATFORMS,
  type AccountResponse,
  type Day,
  type Platform,
  type Post,
  type PostResponse,
  type PostTexts,
  type TextsResponse,
  type VideoDetail,
  type VideoResponse,
  type VideoSummary,
  type VideosResponse,
  type VideoTexts,
} from '../shared/api.ts';
import { parsePostLink } from '../shared/links.ts';
import { parseTexts, readPasted, textsTarget } from '../shared/texts.ts';
import { api, ApiError } from './api.ts';
import { savedConfig } from './config.ts';
import { postPrompt, retryPending } from './library.ts';
import { loadAccount, toLogin } from './session.ts';
import { SEQUENCES, type SequenceId } from './sim/sequences.ts';
import { bindAccountChrome, dayLine, upgradeLink } from './ui/plan.ts';
import { bindThemeToggle } from './ui/theme.ts';

// The Videos page (/app/videos): every recording in the account's library and where each went up.
// The look is src/console.css, as on the account page. A row ticks the platforms a video is
// posted on (a post needs no link); the video's drawer adds the links, its facts, deleting it and
// the way back into the studio, and for a superadmin the texts for posting it
// (docs/video-library.md §6). One request loads the list; a tick or a link saves on its own and
// redraws only its row, so the list does not jump while working down it.

type SortKey = 'recorded' | 'title' | 'length' | 'margin';
type Show = 'all' | 'unposted' | `no-${Platform}`;

const SPECIALS: Record<string, string> = { faster: 'speeds up', slower: 'slows down', grow: 'grows', split: 'splits' };

/** A glyph per platform that reads as it without being its logo: a play button, a note, a camera. */
const ICONS: Record<Platform, string> = {
  youtube: '<rect x="3" y="5.5" width="18" height="13" rx="4" /><path d="m10.5 9.5 4 2.5-4 2.5Z" />',
  tiktok: '<path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5" /><path d="M14 4c.6 2.4 2.4 4 5 4.2" />',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="12" cy="12" r="3.6" /><path d="M16.8 7.2h.01" />',
};

/** What the skill leaves to be set by hand on each platform: the same for every video, so it is written here once. */
const SETTINGS: Record<Platform, string> = {
  youtube: 'Thumbnail: the first frame (0:00), the title with both names. Audience: not made for kids. Altered content: no. Category: Entertainment.',
  tiktok: 'Cover: the first frame (0:00). Sound: the video’s own.',
  instagram: 'Cover: the first frame (0:00).',
};
const SHOWN_AS: Record<Platform, string> = { youtube: 'YouTube Shorts', tiktok: 'TikTok', instagram: 'Instagram Reels' };

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

let videos: VideoSummary[] = [];
/** The plan's library size; null is no limit. */
let limit: number | null = null;
/** The plan's day as the page loaded (shared/api.ts Day). */
let day: Day | null = null;
/** A superadmin: what each video is about to copy, and its texts for posting. */
let admin = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function icon(paths: string, className = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  svg.innerHTML = paths;
  return svg;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let toastTimer = 0;
function flash(message: string): void {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 6000);
}

/** What went wrong, where it is seen: the open drawer covers the page's toast, so it says it in its foot. */
function report(message: string): void {
  if (drawer.open && !$('#video-foot').hidden) $('#video-error').textContent = message;
  else flash(message);
}

function sequenceLabel(id: string): string {
  return SEQUENCES[id as SequenceId]?.label ?? id;
}

/** "Fibonacci vs Factorial (speeds up)", the line under a video's title. */
function matchupLine(video: VideoSummary): string {
  const race = video.race;
  if (!race) return video.game;
  const side = (s: { sequence: string; special: string }) => sequenceLabel(s.sequence) + (SPECIALS[s.special] ? ` (${SPECIALS[s.special]})` : '');
  return `${side(race.a)} vs ${side(race.b)}`;
}

/** "Fibonacci Ball by 0.3 s", or null for a game that is not a race. */
function finishLine(video: VideoSummary): string | null {
  const race = video.race;
  if (!race) return null;
  const winner = race.winner === 'a' ? race.a.name : race.winner === 'b' ? race.b.name : 'Nobody';
  return `${winner} ${race.margin === null ? 'by a mile' : `by ${race.margin.toFixed(1)} s`}`;
}

function postOn(video: VideoSummary, platform: Platform): Post | undefined {
  return video.posts.find((p) => p.platform === platform);
}

/** A ball's colour from the saved config, put in a style only when it is one. */
function color(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

/** The two balls on the dark stage, top then bottom: the video's two cards in small. */
function paintThumb(thumb: HTMLElement, video: VideoSummary): void {
  thumb.style.setProperty('--a', color(video.colors?.a, 'var(--team-a)'));
  thumb.style.setProperty('--b', color(video.colors?.b, 'var(--team-b)'));
}

function thumb(video: VideoSummary): HTMLElement {
  const box = el('span', 'thumb');
  box.setAttribute('aria-hidden', 'true');
  box.append(el('i'), el('i'));
  paintThumb(box, video);
  return box;
}

// ── Totals ──────────────────────────────────────────────────────────────

function meter(platform: Platform, used: number, total: number): HTMLElement {
  const box = el('div', 'meter');
  const head = el('div', 'meter-label');
  const name = el('span', 'platform-name');
  name.append(icon(ICONS[platform]), PLATFORM_LABELS[platform]);
  head.append(name, el('strong', '', `${used} of ${total}`));
  const bar = el('div', 'meter-bar');
  bar.append(el('i'));
  bar.style.setProperty('--fill', `${total ? (used / total) * 100 : 0}%`);
  bar.setAttribute('aria-hidden', 'true');
  box.append(head, bar);
  return box;
}

function renderSummary(): void {
  const total = videos.length;
  const waiting = videos.filter((v) => !v.posts.length).length;
  $('#kpi-videos').textContent = total.toLocaleString('en-US');
  $('#kpi-waiting').textContent = waiting.toLocaleString('en-US');
  $('#kpi-waiting-tile').classList.toggle('waiting', waiting > 0);
  $('#kpi-waiting-note').textContent = !total ? 'Record one and it appears here' : waiting ? 'Tick where each one went up' : 'Every video is up somewhere';
  // The plan's limits, when it has them: how full the library is, what is left of the day, the way to more.
  const room = $('#kpi-room');
  const full = limit !== null && total >= limit;
  const dayUsed = day !== null && day.limit !== null && day.used >= day.limit;
  const today = day ? dayLine(day) : null;
  const parts = [limit === null ? null : full ? `Library full: ${limit} kept on your plan` : `${limit - total} more fit on your plan`, today].filter(Boolean);
  room.replaceChildren(parts.join(' · '), ...(parts.length ? [' ', upgradeLink(full || dayUsed ? 'Upgrade' : 'Upgrade for more')] : []));
  room.classList.toggle('full', full || dayUsed);
  $('#coverage').replaceChildren(...PLATFORMS.map((p) => meter(p, videos.filter((v) => postOn(v, p)).length, total)));
  renderBalls();
}

/**
 * Who won, top ball or bottom; then every sequence, how many of the races it was in and how many
 * it won, most raced first, a bar for its share of the races with the share it won in full
 * colour. A video with the same one on both sides counts once. The ones not used yet stay at the
 * end, as what the next roll could try. Counted from the list the page has: the winner is kept
 * with each video since the first recording.
 */
function renderBalls(): void {
  const raced = new Map<string, number>(Object.keys(SEQUENCES).map((id) => [id, 0]));
  const won = new Map<string, number>();
  const races = videos.flatMap((v) => (v.race ? [v.race] : []));
  for (const race of races) {
    for (const id of new Set([race.a.sequence, race.b.sequence])) if (id) raced.set(id, (raced.get(id) ?? 0) + 1);
    const winner = race.winner && race[race.winner].sequence;
    if (winner) won.set(winner, (won.get(winner) ?? 0) + 1);
  }
  $('#race-stats').hidden = !races.length;
  const sides = [winMeter('Top ball', races.filter((r) => r.winner === 'a').length, races.length), winMeter('Bottom ball', races.filter((r) => r.winner === 'b').length, races.length)];
  const nobody = races.filter((r) => r.winner === null).length;
  $('#wins').replaceChildren(...sides, ...(nobody ? [winMeter('Nobody finished', nobody, races.length)] : []));
  // Sorting is stable: a tie keeps SEQUENCES' own order.
  const order = [...raced].sort((a, b) => b[1] - a[1] || (won.get(b[0]) ?? 0) - (won.get(a[0]) ?? 0));
  $('#balls').replaceChildren(...order.map(([id, count]) => ballMeter(sequenceLabel(id), count, won.get(id) ?? 0, races.length)));
}

function winMeter(label: string, wins: number, races: number): HTMLElement {
  const box = el('div', 'meter');
  const head = el('div', 'meter-label');
  head.append(el('span', '', label), el('strong', '', `${wins} of ${races}`));
  const bar = el('div', 'meter-bar');
  bar.append(el('i'));
  bar.style.setProperty('--fill', `${races ? (wins / races) * 100 : 0}%`);
  bar.setAttribute('aria-hidden', 'true');
  box.append(head, bar);
  return box;
}

function ballMeter(label: string, count: number, wins: number, races: number): HTMLElement {
  const box = el('div', count ? 'meter' : 'meter unused');
  const head = el('div', 'meter-label');
  head.append(el('span', '', label), el('strong', '', count ? `${count} ${count === 1 ? 'video' : 'videos'} · ${wins} won` : 'not yet'));
  const bar = el('div', 'meter-bar');
  bar.append(el('i'), el('i', 'won'));
  bar.style.setProperty('--fill', `${races ? (count / races) * 100 : 0}%`);
  bar.style.setProperty('--won', `${races ? (wins / races) * 100 : 0}%`);
  bar.setAttribute('aria-hidden', 'true');
  box.append(head, bar);
  return box;
}

// ── The list ────────────────────────────────────────────────────────────

function shown(): VideoSummary[] {
  const show = $<HTMLSelectElement>('#show').value as Show;
  const [key, dir] = $<HTMLSelectElement>('#sort').value.split(':') as [SortKey, string];
  const words = $<HTMLInputElement>('#search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const list = videos.filter((v) => {
    if (show === 'unposted' && v.posts.length) return false;
    if (show.startsWith('no-') && postOn(v, show.slice(3) as Platform)) return false;
    if (!words.length) return true;
    const haystack = [v.title, matchupLine(v), v.seed, v.fileName, `${v.videoLength} s`].join(' ').toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
  const value = (v: VideoSummary): number | string => {
    switch (key) {
      case 'recorded':
        return v.recordedAt;
      case 'title':
        return v.title.toLowerCase();
      case 'length':
        return v.videoLength;
      case 'margin':
        return v.race?.margin ?? Infinity;
    }
  };
  // Ties keep the newest first, whatever the order.
  return list.sort((x, y) => {
    const a = value(x);
    const b = value(y);
    return (a < b ? -1 : a > b ? 1 : 0) * Number(dir) || y.recordedAt.localeCompare(x.recordedAt);
  });
}

function renderList(): void {
  const list = shown();
  $('#rows').replaceChildren(...list.map(row));
  $('#count').textContent = list.length === videos.length ? '' : `${list.length} of ${videos.length}`;
  const empty = $('#empty');
  empty.hidden = list.length > 0;
  empty.textContent = videos.length ? 'No video matches.' : 'No videos yet. Record one in the studio and it appears here.';
}

function row(video: VideoSummary): HTMLLIElement {
  const li = el('li', 'video-row');
  li.dataset.id = String(video.id);
  const recorded = new Date(video.recordedAt);

  const main = el('div', 'video-main');
  const title = el('button', 'video-title', video.title);
  title.type = 'button';
  title.addEventListener('click', () => void openVideo(video));
  const meta = el('p', 'video-meta');
  const finish = finishLine(video);
  for (const part of [`${dateFormat.format(recorded)}, ${timeFormat.format(recorded)}`, `${video.videoLength} s`, finish]) {
    if (part) meta.append(el('span', '', part));
  }
  if (video.stoppedEarly) meta.append(el('span', 'tag', 'Stopped early'));
  if (admin && video.hasTexts) meta.append(el('span', 'tag accent', 'Texts ready'));
  main.append(title, el('p', 'video-sub', matchupLine(video)), meta);

  const posted = el('div', 'posted');
  posted.setAttribute('role', 'group');
  posted.setAttribute('aria-label', `Where ${video.title} is posted`);
  posted.append(...PLATFORMS.map((p) => postCheck(video, p)));

  const actions = el('div', 'video-actions');
  const open = el('a', 'button small ghost', 'Open in studio');
  open.href = `/app?video=${video.id}`;
  open.title = 'Loads this video’s config into the studio: the same race, ready to record again or change';
  const more = el('button', 'icon-button small');
  more.type = 'button';
  more.title = 'Links, details and more';
  more.setAttribute('aria-label', `More about ${video.title}`);
  more.append(icon('<path d="m9 6 6 6-6 6" />'));
  more.addEventListener('click', () => void openVideo(video));
  actions.append(open, more);

  li.append(thumb(video), main, posted, actions);
  return li;
}

/**
 * Redraws a video's row where it is (the filter applies again on the next search, filter or sort),
 * the totals, and the drawer's line for the platform that changed when it shows that video. Only
 * that line: a link half typed in another stays as it is.
 */
function refresh(video: VideoSummary, changed?: Platform): { row: HTMLElement | null; line: HTMLElement | null } {
  const old = document.querySelector(`.video-row[data-id="${video.id}"]`);
  const fresh = old ? row(video) : null;
  if (old && fresh) old.replaceWith(fresh);
  renderSummary();
  const oldLine = current === video && changed ? document.querySelector(`#video-platforms [data-platform="${changed}"]`) : null;
  const line = oldLine && changed ? platformLine(video, changed) : null;
  if (oldLine && line) oldLine.replaceWith(line);
  return { row: fresh, line };
}

/** A platform's tick: posted there or not. The link, when there is one, is in the video's drawer. */
function postCheck(video: VideoSummary, platform: Platform): HTMLElement {
  const post = postOn(video, platform);
  const label = el('label', 'post-check');
  const input = el('input');
  input.type = 'checkbox';
  input.name = platform;
  input.checked = Boolean(post);
  input.setAttribute('aria-label', `Posted on ${PLATFORM_LABELS[platform]}`);
  label.append(input, el('span', '', PLATFORM_LABELS[platform]));
  label.title = post ? (post.url ? `Posted on ${PLATFORM_LABELS[platform]}` : `Posted on ${PLATFORM_LABELS[platform]}; no link yet`) : `Not on ${PLATFORM_LABELS[platform]} yet`;
  input.addEventListener('change', () => void setPosted(video, platform, input));
  return label;
}

/** Ticked: posted there, without a link. Unticked: the post goes, and its link with it (asked first). */
async function setPosted(video: VideoSummary, platform: Platform, input: HTMLInputElement): Promise<void> {
  const on = input.checked;
  const had = postOn(video, platform);
  if (!on && had?.url && !confirm(`Untick ${PLATFORM_LABELS[platform]}? Its link is removed too.`)) {
    input.checked = true;
    return;
  }
  input.disabled = true;
  try {
    if (on) {
      const { post } = await api<PostResponse>('PUT', `/api/videos/${video.id}/posts/${platform}`, {});
      video.posts = [...video.posts.filter((p) => p.platform !== platform), post];
    } else {
      await api('DELETE', `/api/videos/${video.id}/posts/${platform}`);
      video.posts = video.posts.filter((p) => p.platform !== platform);
    }
    // The box was disabled while it saved, which took the focus from it: it goes back to the new one.
    const redrawn = refresh(video, platform);
    (drawer.open ? redrawn.line : redrawn.row)?.querySelector<HTMLInputElement>(`input[name="${platform}"]`)?.focus();
  } catch (err) {
    input.checked = !on;
    input.disabled = false;
    report(`${PLATFORM_LABELS[platform]} not saved: ${errorText(err)}`);
  }
}

// ── A video's drawer ────────────────────────────────────────────────────

const drawer = $<HTMLDialogElement>('#video');
/** The video the drawer shows; null on a paste that is still to say which. */
let current: VideoSummary | null = null;

/** Opens the drawer on a video, or (null) on a paste of texts that names its video itself. */
async function openVideo(video: VideoSummary | null): Promise<void> {
  current = video;
  $('#video-error').textContent = '';
  $('#video-foot').hidden = !video;
  $('#video-thumb').hidden = !video;
  const body = $('#video-body');
  if (!drawer.open) drawer.showModal();
  body.scrollTop = 0;
  if (!video) {
    $('#video-title').textContent = 'Paste texts';
    $('#video-what').textContent = 'The answer says which video it is for: its library id, else its file name.';
    body.replaceChildren(textsSection(null, null, null));
    return;
  }
  $('#video-title').textContent = video.title;
  $('#video-what').textContent = matchupLine(video);
  paintThumb($('#video-thumb'), video);
  $<HTMLAnchorElement>('#video-open').href = `/app?video=${video.id}`;

  const platforms = el('section', 'drawer-section');
  platforms.id = 'video-platforms';
  body.replaceChildren(platforms, factsSection(video));
  renderPlatforms(video);
  if (!admin) return;
  const texts = el('section', 'drawer-section');
  texts.append(el('h3', '', 'Texts for posting'), el('p', 'drawer-note', 'Loading…'));
  body.append(texts);
  try {
    const { video: detail } = await api<VideoResponse>('GET', `/api/videos/${video.id}`);
    if (current === video) texts.replaceWith(textsSection(video, detail.texts, detail));
  } catch (err) {
    if (current === video) texts.replaceWith(el('p', 'drawer-note', `The texts could not be loaded: ${errorText(err)}.`));
  }
}

/** Where it went up: each platform's tick, and its link, which saves on leaving the box or on Enter. */
function renderPlatforms(video: VideoSummary): void {
  const box = document.querySelector<HTMLElement>('#video-platforms');
  if (!box) return;
  const head = el('div', 'section-head');
  head.append(el('h3', '', 'Where it went up'), el('small', '', 'A link is optional'));
  box.replaceChildren(head, ...PLATFORMS.map((platform) => platformLine(video, platform)));
}

function platformLine(video: VideoSummary, platform: Platform): HTMLElement {
  const line = el('div', 'platform-line');
  line.dataset.platform = platform;
  const input = el('input');
  input.type = 'url';
  input.name = `${platform}-link`;
  input.placeholder = `${PLATFORM_LABELS[platform]} link`;
  input.spellcheck = false;
  input.value = postOn(video, platform)?.url ?? '';
  input.setAttribute('aria-label', `${PLATFORM_LABELS[platform]} link`);
  input.addEventListener('change', () => void saveLink(video, platform, input));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });
  line.append(postCheck(video, platform), input);
  const url = postOn(video, platform)?.url;
  if (url) {
    const link = el('a', 'post-link');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = `Open it on ${PLATFORM_LABELS[platform]}`;
    link.setAttribute('aria-label', link.title);
    link.append(icon('<path d="M7 17 17 7M8.5 7H17v8.5" />'));
    line.append(link);
  }
  return line;
}

/** A link saved for a platform marks it posted; an emptied box keeps the tick and drops the link. */
async function saveLink(video: VideoSummary, platform: Platform, input: HTMLInputElement): Promise<void> {
  const value = input.value.trim();
  const had = postOn(video, platform);
  if (value === (had?.url ?? '')) return;
  if (value && !parsePostLink(platform, value)) {
    input.classList.add('invalid');
    report(`That is not a link to a post on ${PLATFORM_LABELS[platform]}.`);
    return;
  }
  input.disabled = true;
  try {
    const { post } = await api<PostResponse>('PUT', `/api/videos/${video.id}/posts/${platform}`, { url: value || null });
    video.posts = [...video.posts.filter((p) => p.platform !== platform), post];
    $('#video-error').textContent = '';
    refresh(video, platform);
  } catch (err) {
    input.disabled = false;
    input.classList.add('invalid');
    report(`${PLATFORM_LABELS[platform]} link not saved: ${errorText(err)}`);
  }
}

function factsSection(video: VideoSummary): HTMLElement {
  const section = el('section', 'drawer-section');
  const facts = el('dl', 'facts');
  const recorded = new Date(video.recordedAt);
  const race = video.race;
  const pairs: [string, string][] = [
    ['Recorded', `${dateFormat.format(recorded)}, ${timeFormat.format(recorded)}`],
    ['Length', `${video.videoLength} s${video.stoppedEarly ? `, stopped early at ${video.seconds.toFixed(1)} s` : ` (the file is ${video.seconds.toFixed(1)} s)`}`],
  ];
  if (race) pairs.push(['Finish', `${finishLine(video)}, ${race.leadChanges === 1 ? '1 lead change' : `${race.leadChanges} lead changes`}`]);
  pairs.push(['Seed', video.seed], ['File', video.fileName], ['Format', `${video.format}, BounceReel ${video.appVersion}`]);
  for (const [term, value] of pairs) facts.append(el('dt', '', term), el('dd', '', value));
  section.append(el('h3', '', 'Details'), facts);
  return section;
}

// ── Texts for posting (a superadmin's) ──────────────────────────────────

/**
 * The drawer's texts: the video's, platform by platform, or the steps to them; then the box their
 * answer is pasted in. `detail` gives what the video is about, to copy for the skill.
 */
function textsSection(video: VideoSummary | null, texts: VideoTexts | null, detail: VideoDetail | null): HTMLElement {
  const section = el('section', 'drawer-section');
  const head = el('div', 'section-head');
  head.append(el('h3', '', 'Texts for posting'));
  if (detail) {
    const about = postPrompt(detail, savedConfig(detail.config));
    const copy = el('button', 'text-copy', 'Copy what it is about');
    copy.type = 'button';
    copy.title = 'The balls, who won and by how much, the look: for /bouncereel-post';
    copy.addEventListener('click', () => void copyText(copy, about));
    head.append(copy);
  }
  section.append(head);
  if (video && texts) {
    section.append(
      textsGroup(video, 'youtube', [
        ['Title', texts.youtube.title],
        ['Description', texts.youtube.description],
        ['Tags', texts.youtube.tags.join(', ')],
        ['Pinned comment', texts.youtube.pinnedComment],
      ]),
      textsGroup(video, 'tiktok', [
        ['Caption', texts.tiktok.caption],
        ['Pinned comment', texts.tiktok.pinnedComment],
      ]),
      textsGroup(video, 'instagram', [
        ['Caption', texts.instagram.caption],
        ['Pinned comment', texts.instagram.pinnedComment],
      ]),
    );
    const saved = new Date(texts.savedAt);
    section.append(el('p', 'drawer-note', `Saved ${dateFormat.format(saved)}, ${timeFormat.format(saved)}`));
  } else {
    const steps = el('ol', 'steps');
    steps.append(
      el('li', '', video ? 'Copy what the video is about (above).' : 'Copy what the video is about: in its drawer, or on the sheet after a take.'),
      el('li', '', 'Paste it to /bouncereel-post in Claude Code.'),
      el('li', '', 'Paste its answer below, and save.'),
    );
    section.append(steps);
  }
  section.append(pasteForm(video, Boolean(texts)));
  return section;
}

function textsGroup(video: VideoSummary, platform: Platform, fields: [string, string][]): HTMLElement {
  const group = el('div', 'text-group');
  const head = el('div', 'text-group-head');
  const name = el('span', 'platform-name');
  name.append(icon(ICONS[platform]), SHOWN_AS[platform]);
  head.append(name);
  if (postOn(video, platform)) head.append(el('span', 'tag accent', 'Posted'));
  group.append(head);
  for (const [label, value] of fields) {
    if (!value) continue;
    const field = el('div', 'text-field');
    const top = el('div', 'text-field-head');
    const copy = el('button', 'text-copy', 'Copy');
    copy.type = 'button';
    copy.setAttribute('aria-label', `Copy the ${SHOWN_AS[platform]} ${label.toLowerCase()}`);
    copy.addEventListener('click', () => void copyText(copy, value));
    top.append(el('span', '', label), copy);
    field.append(top, el('p', '', value));
    group.append(field);
  }
  group.append(el('p', 'text-settings', SETTINGS[platform]));
  return group;
}

/** Onto the clipboard, the button saying so: the drawer covers the page's toast. */
async function copyText(button: HTMLButtonElement, text: string): Promise<void> {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Not copied';
  }
  window.setTimeout(() => (button.textContent = label), 2000);
}

function pasteForm(video: VideoSummary | null, replacing: boolean): HTMLFormElement {
  const form = el('form', 'paste-form');
  form.noValidate = true;
  const label = el('label', '', replacing ? 'Paste new texts to replace these' : 'Paste the bouncereel-post answer');
  const area = el('textarea');
  area.id = 'texts-paste';
  area.name = 'texts';
  area.rows = replacing ? 3 : 6;
  area.spellcheck = false;
  area.placeholder = '{ "video": 12, "youtube": { … }, "tiktok": { … }, "instagram": { … } }';
  label.htmlFor = area.id;
  const error = el('p', 'paste-error');
  error.setAttribute('role', 'alert');
  const save = el('button', 'button small', 'Save texts');
  save.type = 'submit';
  const foot = el('div', 'paste-foot');
  foot.append(error, save);
  form.append(label, area, foot);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveTexts(video, area, error, save);
  });
  return form;
}

/**
 * A pasted answer, checked here as the Worker will check it (shared/texts.ts), then stored with
 * its video: the drawer's, else the one the answer names, which must then be in the library.
 */
async function saveTexts(target: VideoSummary | null, area: HTMLTextAreaElement, error: HTMLElement, save: HTMLButtonElement): Promise<void> {
  let pasted: unknown;
  let texts: PostTexts;
  try {
    pasted = readPasted(area.value);
    texts = parseTexts(pasted);
  } catch (err) {
    error.textContent = errorText(err);
    return;
  }
  const named = textsTarget(pasted);
  const name = named.id !== null ? `video ${named.id}` : named.file;
  const video = target ?? (named.id !== null ? videos.find((v) => v.id === named.id) : videos.find((v) => v.fileName === named.file));
  if (!video) {
    error.textContent = name ? `There is no ${name} in your library.` : 'The answer does not say which video it is for: open the video and paste it there.';
    return;
  }
  const fits = named.id !== null ? named.id === video.id : !named.file || named.file === video.fileName;
  if (!fits) {
    error.textContent = `These texts are for ${name}, not “${video.title}”.`;
    return;
  }
  save.disabled = true;
  try {
    await api<TextsResponse>('PUT', `/api/admin/videos/${video.id}/texts`, texts);
    video.hasTexts = true;
    refresh(video);
    await openVideo(video);
  } catch (err) {
    error.textContent = `Not saved: ${errorText(err)}`;
    save.disabled = false;
  }
}

async function deleteVideo(video: VideoSummary): Promise<void> {
  if (!confirm(`Delete “${video.title}” from Videos? Its ticks and links go with it; the file in your Downloads stays.`)) return;
  try {
    await api('DELETE', `/api/videos/${video.id}`);
    videos = videos.filter((v) => v !== video);
    drawer.close();
    renderSummary();
    renderList();
    flash(`Deleted “${video.title}”.`);
  } catch (err) {
    report(`Not deleted: ${errorText(err)}`);
  }
}

// ── Start ───────────────────────────────────────────────────────────────

async function load(account: AccountResponse): Promise<void> {
  limit = account.library.limit;
  day = account.day;
  admin = account.account.role === 'superadmin';
  $('#paste-texts').hidden = !admin;
  // Recordings whose save failed earlier go in first, so the list has them.
  const added = await retryPending(account);
  if (added) flash(`${added} earlier recording${added === 1 ? '' : 's'} added to Videos`);
  try {
    videos = (await api<VideosResponse>('GET', '/api/videos')).videos;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) toLogin();
    const empty = $('#empty');
    empty.hidden = false;
    empty.textContent = `Videos could not be loaded: ${errorText(err)}.`;
    return;
  }
  renderSummary();
  renderList();
}

bindThemeToggle($('#theme'));
$('#paste-texts').addEventListener('click', () => void openVideo(null));
$('#video-close').addEventListener('click', () => drawer.close());
$('#video-delete').addEventListener('click', () => current && void deleteVideo(current));
// Its parts fill it edge to edge, so a click on the drawer itself is one on the backdrop.
drawer.addEventListener('click', (event) => {
  if (event.target === drawer) drawer.close();
});
drawer.addEventListener('close', () => (current = null));
$('#search').addEventListener('input', renderList);
$('#show').addEventListener('change', renderList);
$('#sort').addEventListener('change', renderList);
void loadAccount().then((account) => {
  bindAccountChrome(account);
  return load(account);
});
