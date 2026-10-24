import {
  PLATFORM_LABELS,
  PLATFORMS,
  type AccountResponse,
  type Day,
  type Platform,
  type PostResponse,
  type PostTexts,
  type TextsResponse,
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
import { bindAccountChrome, dayLine, upgradeLink } from './ui/plan.ts';
import { SEQUENCES, type SequenceId } from './sim/sequences.ts';
import { bindThemeToggle } from './ui/theme.ts';

// The Videos page (/app/videos): every recording in the account's library, where each went up,
// a link box per platform, and a way back into the studio with the video's config. One request
// loads it all; a link is saved on its own, without redrawing the table (so Tab moves on to the
// next box while the last one saves). A superadmin also gets the texts for posting each video
// (docs/video-library.md §6).

type SortKey = 'recorded' | 'title' | 'length' | 'margin';
type Show = 'all' | 'unposted' | `no-${Platform}`;

const SPECIALS: Record<string, string> = { faster: 'speeds up', slower: 'slows down', grow: 'grows', split: 'splits' };

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

let videos: VideoSummary[] = [];
/** The plan's library size; null is no limit. */
let limit: number | null = null;
/** The plan's day as the page loaded (shared/api.ts Day). */
let day: Day | null = null;
let sort: { key: SortKey; dir: 1 | -1 } = { key: 'recorded', dir: -1 };
/** A superadmin: what each video is about to copy, and its texts for posting. */
let admin = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
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

function sequenceLabel(id: string): string {
  return SEQUENCES[id as SequenceId]?.label ?? id;
}

/** "Fibonacci vs Factorial · speeds up", the line under a video's title. */
function matchupLine(video: VideoSummary): string {
  const race = video.race;
  if (!race) return video.game;
  const side = (s: { sequence: string; special: string }) => sequenceLabel(s.sequence) + (SPECIALS[s.special] ? ` (${SPECIALS[s.special]})` : '');
  return `${side(race.a)} vs ${side(race.b)}`;
}

function postOn(video: VideoSummary, platform: Platform) {
  return video.posts.find((p) => p.platform === platform);
}

// ── Totals ──────────────────────────────────────────────────────────────

function renderTiles(): void {
  const tiles: [string, number][] = [
    ['Videos', videos.length],
    ...PLATFORMS.map((p): [string, number] => [`On ${PLATFORM_LABELS[p]}`, videos.filter((v) => postOn(v, p)).length]),
    ['Not posted yet', videos.filter((v) => !v.posts.length).length],
  ];
  $('#tiles').replaceChildren(
    ...tiles.map(([label, value]) => {
      const tile = el('div', 'tile');
      tile.append(el('strong', '', value.toLocaleString('en-US')), el('span', '', label));
      return tile;
    }),
  );
  // The plan's limits, when it has them: how full the library is, what is left of the day, and the way to more.
  const room = $('#room');
  const full = limit !== null && videos.length >= limit;
  const dayUsed = day !== null && day.limit !== null && day.used >= day.limit;
  const today = day ? dayLine(day) : null;
  room.hidden = limit === null && !today;
  room.replaceChildren(
    limit === null ? '' : full ? `${videos.length} of ${limit} videos kept on your plan: delete one to make room for the next recording. ` : `${videos.length} of ${limit} videos kept on your plan. `,
    today ? `${today}. ` : '',
    upgradeLink(full || dayUsed ? 'Upgrade' : 'Upgrade for more'),
  );
  room.classList.toggle('full', full || dayUsed);
}

// ── The table ───────────────────────────────────────────────────────────

function shown(): VideoSummary[] {
  const show = $<HTMLSelectElement>('#show').value as Show;
  const words = $<HTMLInputElement>('#search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const list = videos.filter((v) => {
    if (show === 'unposted' && v.posts.length) return false;
    if (show.startsWith('no-') && postOn(v, show.slice(3) as Platform)) return false;
    if (!words.length) return true;
    const haystack = [v.title, matchupLine(v), v.seed, v.fileName, `${v.videoLength} s`].join(' ').toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
  const value = (v: VideoSummary): number | string => {
    switch (sort.key) {
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
  // Ties keep the newest first, whatever the column.
  return list.sort((x, y) => {
    const a = value(x);
    const b = value(y);
    return (a < b ? -1 : a > b ? 1 : 0) * sort.dir || y.recordedAt.localeCompare(x.recordedAt);
  });
}

function renderTable(): void {
  const list = shown();
  $('#rows').replaceChildren(...list.map(row));
  for (const th of document.querySelectorAll<HTMLElement>('th[data-sort]')) {
    if (th.dataset.sort === sort.key) th.setAttribute('aria-sort', sort.dir === 1 ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }
  $('#count').textContent = list.length === videos.length ? '' : `${list.length} of ${videos.length}`;
  const empty = $('#empty');
  empty.hidden = list.length > 0;
  empty.textContent = videos.length ? 'No video matches.' : 'No videos yet. Record one in the studio and it appears here.';
}

function row(video: VideoSummary): HTMLTableRowElement {
  const tr = el('tr');
  const recorded = new Date(video.recordedAt);

  const when = el('td', 'when');
  when.append(el('span', '', dateFormat.format(recorded)), el('small', '', timeFormat.format(recorded)));

  const what = el('td', 'what');
  what.append(el('strong', '', video.title), el('small', '', matchupLine(video)));
  const file = el('small', 'file', video.fileName);
  file.title = `Seed ${video.seed} · ${video.format} · BounceReel ${video.appVersion}`;
  what.append(file);

  const length = el('td', 'length');
  length.append(el('span', '', `${video.videoLength} s`));
  length.title = `The file is ${video.seconds.toFixed(1)} s`;
  if (video.stoppedEarly) length.append(el('small', 'badge', 'stopped early'));

  const finish = el('td', 'finish');
  const race = video.race;
  if (race) {
    const winner = race.winner === 'a' ? race.a.name : race.winner === 'b' ? race.b.name : 'Nobody';
    const margin = race.margin === null ? 'by a mile' : `by ${race.margin.toFixed(1)} s`;
    const changes = race.leadChanges === 1 ? '1 lead change' : `${race.leadChanges} lead changes`;
    finish.append(el('span', '', winner), el('small', '', `${margin} · ${changes}`));
  }

  const actions = el('td', 'actions');
  if (admin) {
    const about = el('button', 'icon-button small');
    about.type = 'button';
    about.title = 'Copy what this video is about (the balls, who won and by how much, the look), for /bouncereel-post';
    about.setAttribute('aria-label', `Copy what ${video.title} is about`);
    about.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>';
    about.addEventListener('click', () => void copyAbout(video));
    const texts = el('button', `icon-button small${video.hasTexts ? ' has-texts' : ''}`);
    texts.type = 'button';
    texts.title = video.hasTexts ? 'Texts for posting: titles, captions, tags' : 'Texts for posting: none yet';
    texts.setAttribute('aria-label', `Texts for posting ${video.title}`);
    texts.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v5h5M9 13h6M9 17h4" /></svg>';
    texts.addEventListener('click', () => void openTexts(video));
    actions.append(about, texts);
  }
  const open = el('a', 'button small ghost', 'Open in studio');
  open.href = `/app?video=${video.id}`;
  open.title = 'Loads this video’s config into the studio: the same race, ready to record again or change';
  const remove = el('button', 'icon-button small danger');
  remove.type = 'button';
  remove.title = 'Delete from Videos';
  remove.setAttribute('aria-label', `Delete ${video.title}`);
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>';
  remove.addEventListener('click', () => void deleteVideo(video));
  actions.append(open, remove);

  tr.append(when, what, length, finish, ...PLATFORMS.map((p) => linkCell(video, p)), actions);
  return tr;
}

/** A link box: paste and leave it (or Enter) to save, empty it to remove. */
function linkCell(video: VideoSummary, platform: Platform): HTMLTableCellElement {
  const td = el('td', 'link');
  const input = el('input');
  input.type = 'url';
  input.name = `${platform}-${video.id}`;
  input.placeholder = 'Paste link';
  input.spellcheck = false;
  input.setAttribute('aria-label', `${PLATFORM_LABELS[platform]} link for ${video.title}`);
  const open = el('a', 'icon-button small');
  open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8.5 7H17v8.5" /></svg>';
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.title = `Open on ${PLATFORM_LABELS[platform]}`;
  open.setAttribute('aria-label', open.title);

  const show = () => {
    const post = postOn(video, platform);
    input.value = post?.url ?? '';
    input.classList.remove('invalid');
    open.hidden = !post;
    if (post) open.href = post.url;
  };
  show();

  input.addEventListener('change', async () => {
    const value = input.value.trim();
    const had = postOn(video, platform);
    if (value === (had?.url ?? '')) return show();
    if (value && !parsePostLink(platform, value)) {
      input.classList.add('invalid');
      flash(`That is not a link to a post on ${PLATFORM_LABELS[platform]}.`);
      return;
    }
    input.disabled = true;
    try {
      if (value) {
        const { post } = await api<PostResponse>('PUT', `/api/videos/${video.id}/posts/${platform}`, { url: value });
        video.posts = [...video.posts.filter((p) => p.platform !== platform), post];
      } else {
        await api('DELETE', `/api/videos/${video.id}/posts/${platform}`);
        video.posts = video.posts.filter((p) => p.platform !== platform);
      }
      show();
      renderTiles();
    } catch (err) {
      input.classList.add('invalid');
      flash(`${PLATFORM_LABELS[platform]} link not saved: ${errorText(err)}`);
    } finally {
      input.disabled = false;
    }
  });
  const box = el('div', 'link-box');
  box.append(input, open);
  td.append(box);
  return td;
}

/** The video's facts as text (library.ts postPrompt), with its config for the colours, look and question, onto the clipboard. */
async function copyAbout(video: VideoSummary): Promise<void> {
  try {
    const { video: detail } = await api<VideoResponse>('GET', `/api/videos/${video.id}`);
    await navigator.clipboard.writeText(postPrompt(detail, savedConfig(detail.config)));
    flash(`Copied what “${video.title}” is about.`);
  } catch (err) {
    flash(`Not copied: ${errorText(err)}`);
  }
}

// ── Texts for posting (a superadmin's) ──────────────────────────────────

/** What the skill leaves to be set by hand on each platform: the same for every video, so it is written here once. */
const SETTINGS: Record<Platform, string> = {
  youtube: 'Thumbnail: the first frame (0:00), the title with both names. Audience: not made for kids. Altered content: no. Category: Entertainment.',
  tiktok: 'Cover: the first frame (0:00). Sound: the video’s own.',
  instagram: 'Cover: the first frame (0:00).',
};
const SHOWN_AS: Record<Platform, string> = { youtube: 'YouTube Shorts', tiktok: 'TikTok', instagram: 'Instagram Reels' };

/** The video the drawer is about; null while a paste is still to say which. */
let textsFor: VideoSummary | null = null;

/** Opens the drawer on a video's texts, or (null) on a paste that names its video itself. */
async function openTexts(video: VideoSummary | null): Promise<void> {
  textsFor = video;
  pasteError('');
  $<HTMLTextAreaElement>('#texts-paste').value = '';
  const drawer = $<HTMLDialogElement>('#texts');
  if (!drawer.open) drawer.showModal();
  if (!video) return showTexts(null, null, null);
  $('#texts-title').textContent = video.title;
  $('#texts-what').textContent = matchupLine(video);
  $('#texts-body').replaceChildren(el('p', 'drawer-note', 'Loading…'));
  try {
    const { video: detail } = await api<VideoResponse>('GET', `/api/videos/${video.id}`);
    if (textsFor === video) showTexts(video, detail.texts, postPrompt(detail, savedConfig(detail.config)));
  } catch (err) {
    if (textsFor === video) $('#texts-body').replaceChildren(el('p', 'drawer-note', `The texts could not be loaded: ${errorText(err)}.`));
  }
}

/** The drawer's content: a video's texts, or the steps to them (`about` is what the video is about, to copy in the first). */
function showTexts(video: VideoSummary | null, texts: VideoTexts | null, about: string | null): void {
  $('#texts-title').textContent = video ? video.title : 'Paste texts';
  $('#texts-what').textContent = video ? matchupLine(video) : 'The answer says which video it is for: its library id, else its file name.';
  $('#texts-paste-label').textContent = texts ? 'Paste new texts to replace these' : 'Paste the bouncereel-post answer';
  // Small once there are texts, so they have the drawer's height; a paste scrolls inside it.
  $<HTMLTextAreaElement>('#texts-paste').rows = texts ? 2 : 5;
  const body = $('#texts-body');
  if (!video || !texts) return body.replaceChildren(howTo(about));
  const saved = new Date(texts.savedAt);
  body.replaceChildren(
    textsSection(video, 'youtube', [
      ['Title', texts.youtube.title],
      ['Description', texts.youtube.description],
      ['Tags', texts.youtube.tags.join(', ')],
      ['Pinned comment', texts.youtube.pinnedComment],
    ]),
    textsSection(video, 'tiktok', [
      ['Caption', texts.tiktok.caption],
      ['Pinned comment', texts.tiktok.pinnedComment],
    ]),
    textsSection(video, 'instagram', [
      ['Caption', texts.instagram.caption],
      ['Pinned comment', texts.instagram.pinnedComment],
    ]),
    el('p', 'drawer-note', `Saved ${dateFormat.format(saved)}, ${timeFormat.format(saved)}`),
  );
}

/** The three steps, while a video has no texts yet. */
function howTo(about: string | null): HTMLElement {
  const steps = el('ol', 'drawer-steps');
  const first = el('li', '', 'Copy what the video is about');
  if (about) {
    const copy = el('button', 'text-copy', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', () => void copyText(copy, about));
    first.append(': ', copy);
  } else first.append(': the copy icon on its row, or Copy on the sheet after a take.');
  steps.append(first, el('li', '', 'Paste it to /bouncereel-post in Claude Code.'), el('li', '', 'Paste its answer below, and save.'));
  return steps;
}

function textsSection(video: VideoSummary, platform: Platform, fields: [string, string][]): HTMLElement {
  const section = el('section', 'text-section');
  const head = el('h3', '', SHOWN_AS[platform]);
  const post = postOn(video, platform);
  if (post) {
    const link = el('a', 'text-posted', 'Posted');
    link.href = post.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    head.append(link);
  }
  section.append(head);
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
    section.append(field);
  }
  section.append(el('p', 'text-settings', SETTINGS[platform]));
  return section;
}

/** Onto the clipboard, the button saying so; the drawer covers the page's toast, so the button is the answer. */
async function copyText(button: HTMLButtonElement, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Not copied';
  }
  window.setTimeout(() => (button.textContent = 'Copy'), 2000);
}

function pasteError(message: string): void {
  const error = $('#texts-error');
  error.textContent = message;
  error.hidden = !message;
}

/**
 * A pasted answer, checked here as the Worker will check it (shared/texts.ts), then stored with
 * its video: the drawer's, else the one the answer names, which must then be in the library.
 */
async function saveTexts(): Promise<void> {
  let pasted: unknown;
  let texts: PostTexts;
  try {
    pasted = readPasted($<HTMLTextAreaElement>('#texts-paste').value);
    texts = parseTexts(pasted);
  } catch (err) {
    return pasteError(errorText(err));
  }
  const target = textsTarget(pasted);
  const named = target.id !== null ? `video ${target.id}` : target.file;
  const video = textsFor ?? (target.id !== null ? videos.find((v) => v.id === target.id) : videos.find((v) => v.fileName === target.file));
  if (!video) return pasteError(named ? `There is no ${named} in your library.` : 'The answer does not say which video it is for: open the video’s texts from its row and paste it there.');
  const fits = target.id !== null ? target.id === video.id : !target.file || target.file === video.fileName;
  if (!fits) return pasteError(`These texts are for ${named}, not “${video.title}”.`);
  const submit = $<HTMLButtonElement>('#texts-form button[type=submit]');
  submit.disabled = true;
  try {
    const { texts: stored } = await api<TextsResponse>('PUT', `/api/admin/videos/${video.id}/texts`, texts);
    video.hasTexts = true;
    renderTable();
    textsFor = video;
    $<HTMLTextAreaElement>('#texts-paste').value = '';
    pasteError('');
    showTexts(video, stored, null);
  } catch (err) {
    pasteError(`Not saved: ${errorText(err)}`);
  } finally {
    submit.disabled = false;
  }
}

async function deleteVideo(video: VideoSummary): Promise<void> {
  if (!confirm(`Delete “${video.title}” from Videos? Its links go with it; the file in your Downloads stays.`)) return;
  try {
    await api('DELETE', `/api/videos/${video.id}`);
    videos = videos.filter((v) => v !== video);
    renderTiles();
    renderTable();
  } catch (err) {
    flash(`Not deleted: ${errorText(err)}`);
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
  renderTiles();
  renderTable();
}

bindThemeToggle($('#theme'));
const drawer = $<HTMLDialogElement>('#texts');
$('#paste-texts').addEventListener('click', () => void openTexts(null));
$('#texts-close').addEventListener('click', () => drawer.close());
// Its parts fill it edge to edge, so a click on the drawer itself is one on the backdrop.
drawer.addEventListener('click', (event) => {
  if (event.target === drawer) drawer.close();
});
$('#texts-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void saveTexts();
});
$('#search').addEventListener('input', renderTable);
$('#show').addEventListener('change', renderTable);
for (const th of document.querySelectorAll<HTMLElement>('th[data-sort]')) {
  th.querySelector('button')!.addEventListener('click', () => {
    const key = th.dataset.sort as SortKey;
    // A new column starts the way it is most often wanted: newest, A to Z, shortest, closest.
    sort = { key, dir: sort.key === key ? (-sort.dir as 1 | -1) : key === 'recorded' ? -1 : 1 };
    renderTable();
  });
}
void loadAccount().then((account) => {
  bindAccountChrome(account);
  return load(account);
});
