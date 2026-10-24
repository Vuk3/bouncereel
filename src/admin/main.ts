import {
  PLAN_TONES,
  PRICE_INTERVALS,
  SUBSCRIPTION_STATUSES,
  type AdminOverview,
  type AdminPlan,
  type AdminPlansResponse,
  type AdminUser,
  type AdminUserResponse,
  type AdminUsersResponse,
  type LogEntry,
  type LogResponse,
  type MailResult,
  type PlanBody,
  type PlanTone,
  type Price,
  type PriceInterval,
  type UserSort,
  type UserStatus,
} from '../../shared/api.ts';
import { LOOK_LABELS, LOOKS, MAX_VIDEO_SECONDS, MIN_VIDEO_SECONDS, SOUND_LABELS, SOUNDS, describeFeatures, type Features } from '../../shared/features.ts';
import { api } from '../api.ts';
import { loadAccount } from '../session.ts';
import { formatPrice, planEmblem } from '../site/pricing.ts';
import { bindThemeToggle } from '../ui/theme.ts';

// The admin area (/admin, superadmins only: the Worker serves these pages to nobody else, and
// checks the role again on every /api/admin request). One script for its five pages, told apart
// by <body data-view>: the overview, the users and one user, the plans, the log. Lists are
// filtered, sorted and paged by the server; this page only draws what it gets. The look is
// src/console.css; the sidebar is the admin:nav partial.

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
const root = $('#view');
const view = document.body.dataset.view ?? 'overview';

// An end date is the end of a day in UTC (endOfDay), so it is shown in UTC; a moment (joined, last
// sign-in, a change) is shown in the viewer's own time.
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

type Child = string | Node | null | undefined | false;

/** An element with a class, and its children (strings become text). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.filter((c): c is string | Node => c !== null && c !== undefined && c !== false));
  return node;
}

/** Line icons on a 24 px grid; console.css sets their size, stroke and colour. */
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4',
  left: 'm15 18-6-6 6-6',
  right: 'm9 18 6-6-6-6',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  archive: 'M3 4h18v4H3ZM5 8v12h14V8M10 12h4',
  restore: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 3.5v5h5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  mail: 'M3 6h18v12H3ZM3 7l9 6 9-6',
  pause: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM10 9v6M14 9v6',
  play: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM10 8.5l5 3.5-5 3.5Z',
} as const;

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

function button(label: Child | Child[], className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `button small ${className}`.trim(), ...(Array.isArray(label) ? label : [label]));
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** A round button with only an icon: what it does is its label, read out and shown on hover. */
function iconButton(name: keyof typeof ICONS, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'icon-button small', icon(name));
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function link(href: string, text: Child | Child[], className = ''): HTMLAnchorElement {
  return Object.assign(el('a', className, ...(Array.isArray(text) ? text : [text])), { href });
}

let toastTimer = 0;
function flash(message: string): void {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 6000);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs a change; says how it went. Resolves false when it failed (the message is already shown). */
async function act(work: () => Promise<unknown>, done: string): Promise<boolean> {
  try {
    await work();
    flash(done);
    return true;
  } catch (err) {
    flash(errorText(err));
    return false;
  }
}

const day = (iso: string | null) => (iso ? dayFormat.format(new Date(iso)) : '—');
const date = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : '—');
const when = (iso: string | null) => (iso ? timeFormat.format(new Date(iso)) : 'never');
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const STATUS_LABELS: Record<UserStatus, string> = { active: 'Active', canceled: 'Canceled', expired: 'Ended', suspended: 'Suspended' };

function statusPill(status: UserStatus): HTMLElement {
  return el('span', `pill ${status}`, STATUS_LABELS[status]);
}

function tag(text: string, accent = false): HTMLElement {
  return el('span', accent ? 'tag accent' : 'tag', text);
}

/**
 * The account's initial on one of the two balls' colours, by its id, so a list of accounts has
 * the video's two teams in it. Both deepened until white on them reads (4.9:1 and 5.1:1).
 */
function avatar(id: number, email: string, large = false): HTMLElement {
  const node = el('span', large ? 'avatar large' : 'avatar', email.slice(0, 1));
  node.style.setProperty('--avatar', id % 2 ? '#6a46ff' : '#0277b6');
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/** A page's head: its title, a line on what it is for, and its actions on the right. */
function viewHead(title: Child | Child[], text: string | null, ...actions: Child[]): HTMLElement {
  return el(
    'header',
    'view-head',
    el('div', 'titles', el('h1', '', ...(Array.isArray(title) ? title : [title])), text ? el('p', '', text) : null),
    actions.some(Boolean) ? el('div', 'row-actions', ...actions) : null,
  );
}

function cardHead(title: Child | Child[], ...extra: Child[]): HTMLElement {
  return el('div', 'card-head', el('h2', '', ...(Array.isArray(title) ? title : [title])), ...extra);
}

function table(head: (string | HTMLTableCellElement)[], rows: HTMLTableRowElement[], empty: string, className = ''): HTMLElement {
  if (!rows.length) return el('p', 'empty', empty);
  const thead = el('thead', '', el('tr', '', ...head.map((h) => (typeof h === 'string' ? el('th', '', h) : h))));
  return el('div', 'table-scroll', el('table', `data ${className}`.trim(), thead, el('tbody', '', ...rows)));
}

function row(...cells: Child[]): HTMLTableRowElement {
  return el('tr', '', ...cells.map((c) => (c instanceof HTMLTableCellElement ? c : el('td', '', c))));
}

function cell(className: string, ...children: Child[]): HTMLTableCellElement {
  return el('td', className, ...children);
}

function pager(page: number, pageSize: number, total: number, go: (page: number) => void): HTMLElement {
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  const prev = iconButton('left', 'Previous page', () => go(page - 1));
  const next = iconButton('right', 'Next page', () => go(page + 1));
  prev.disabled = page <= 1;
  next.disabled = to >= total;
  return el('div', 'pager', el('span', '', `${from}–${to} of ${total.toLocaleString('en-US')}`), prev, next);
}

/** How much of `of` is used, as a bar: a plan's accounts, on the overview. */
function meter(label: Child[], value: string, used: number, of: number, note: string | null = null): HTMLElement {
  const bar = el('div', 'meter-bar', el('i'));
  bar.style.setProperty('--fill', `${of > 0 ? Math.min(100, (used / of) * 100) : 0}%`);
  bar.setAttribute('aria-hidden', 'true');
  return el('div', 'meter', el('div', 'meter-label', el('span', '', ...label), el('strong', '', value)), bar, note ? el('small', '', note) : null);
}

function person(u: { id: number; email: string | null }): HTMLElement {
  const email = u.email ?? `account ${u.id} (deleted)`;
  return el('div', 'person', avatar(u.id, email), u.email ? link(`/admin/user?id=${u.id}`, u.email) : el('span', '', email));
}

// ── Overview ──────────────────────────────────────────────────────────────

async function overview(): Promise<void> {
  const [o, recent, newest] = await Promise.all([
    api<AdminOverview>('GET', '/api/admin/overview'),
    api<LogResponse>('GET', '/api/admin/log?page=1'),
    api<AdminUsersResponse>('GET', '/api/admin/users?sort=joined&dir=desc'),
  ]);
  const kpi = (label: string, value: number, alert = false) => el('div', alert && value > 0 ? 'kpi alert' : 'kpi', el('span', '', label), el('strong', '', value.toLocaleString('en-US')));

  const plans = el(
    'section',
    'card',
    cardHead('Plans', link('/admin/plans', 'Edit the plans', 'card-link')),
    el(
      'div',
      'meters',
      ...o.plans.map((p) =>
        meter(
          [p.name, p.archived ? ' ' : null, p.archived ? tag('archived') : null],
          `${count(p.inForce, 'account')} now`,
          p.inForce,
          o.users.total,
          p.subscribers === p.inForce ? null : `${count(p.subscribers, 'subscription')} name it, ended ones included`,
        ),
      ),
    ),
    el('p', 'card-text', 'A subscription stops being in force when its end date passes, or at once when it is canceled without one; the account is then on the default plan.'),
  );

  const changes = el(
    'section',
    'card flush',
    cardHead('Latest changes', link('/admin/log', 'The whole log', 'card-link')),
    table(['When', 'What'], recent.entries.slice(0, 6).map((e) => row(cell('quiet', when(e.at)), what(e))), 'Nothing has changed yet.'),
  );

  const accounts = el(
    'section',
    'card flush',
    cardHead('Newest accounts', link('/admin/users', 'Every account', 'card-link')),
    table(
      ['Account', 'Plan', 'Status', 'Joined'],
      newest.users.slice(0, 6).map((u) => row(person(u), u.planName ?? '—', statusPill(u.status), cell('quiet', date(u.createdAt)))),
      'Nobody has signed up yet.',
    ),
  );

  root.replaceChildren(
    viewHead('Overview', 'Who has signed up, which plans they are on, and what changed last.'),
    el(
      'section',
      'kpis',
      kpi('Accounts', o.users.total),
      kpi('New in 7 days', o.users.last7),
      kpi('New in 30 days', o.users.last30),
      kpi('Suspended', o.users.suspended, true),
      kpi('Videos saved', o.videos),
    ),
    el('div', 'columns', plans, changes),
    accounts,
  );
}

// ── Users ─────────────────────────────────────────────────────────────────

async function users(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const state = {
    q: params.get('q') ?? '',
    plan: params.get('plan') ?? '',
    status: params.get('status') ?? '',
    sort: (params.get('sort') as UserSort | null) ?? 'joined',
    dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, Number(params.get('page')) || 1),
  };
  const { plans } = await api<AdminPlansResponse>('GET', '/api/admin/plans');

  const search = Object.assign(el('input'), { type: 'search', name: 'q', placeholder: 'Search by email', value: state.q, spellcheck: false });
  search.setAttribute('aria-label', 'Search by email');
  const plan = el('select', '', Object.assign(el('option', '', 'Every plan'), { value: '' }), ...plans.map((p) => Object.assign(el('option', '', p.name), { value: String(p.id) })));
  plan.setAttribute('aria-label', 'Plan');
  plan.value = state.plan;
  const status = el('select', '', Object.assign(el('option', '', 'Any status'), { value: '' }), ...(Object.keys(STATUS_LABELS) as UserStatus[]).map((s) => Object.assign(el('option', '', STATUS_LABELS[s]), { value: s })));
  status.setAttribute('aria-label', 'Status');
  status.value = state.status;
  const results = el('section', 'card flush results');
  const total = el('p', '', '\u00a0');
  const head = viewHead('Users', null);
  head.querySelector('.titles')!.append(total);
  root.replaceChildren(head, el('div', 'filters', el('label', 'search', icon('search'), search), plan, status), results);

  const load = async () => {
    const query = new URLSearchParams();
    // Only what differs from the defaults goes in the address, so it stays short to share.
    const defaults: Record<string, unknown> = { q: '', plan: '', status: '', sort: 'joined', dir: 'desc', page: 1 };
    for (const [key, value] of Object.entries(state)) if (value !== defaults[key]) query.set(key, String(value));
    history.replaceState(null, '', `${location.pathname}${query.size ? `?${query}` : ''}`);
    results.setAttribute('aria-busy', 'true');
    try {
      const data = await api<AdminUsersResponse>('GET', `/api/admin/users?${query}`);
      const filtered = state.q || state.plan || state.status;
      total.textContent = filtered ? `${count(data.total, 'account')} match.` : `${count(data.total, 'account')} in all.`;
      results.replaceChildren(usersTable(data, state, load), pager(data.page, data.pageSize, data.total, (page) => ((state.page = page), void load())));
    } catch (err) {
      results.replaceChildren(el('p', 'empty', `Users could not be loaded: ${errorText(err)}.`));
    } finally {
      results.removeAttribute('aria-busy');
    }
  };
  let typing = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(typing);
    typing = window.setTimeout(() => ((state.q = search.value.trim()), (state.page = 1), void load()), 250);
  });
  plan.addEventListener('change', () => ((state.plan = plan.value), (state.page = 1), void load()));
  status.addEventListener('change', () => ((state.status = status.value), (state.page = 1), void load()));
  await load();
}

function usersTable(data: AdminUsersResponse, state: { sort: UserSort; dir: string; page: number }, reload: () => Promise<void>): HTMLElement {
  if (!data.users.length) return el('p', 'empty', 'No account matches.');
  const header = (key: UserSort | null, label: string, className = '') => {
    const th = el('th', className);
    if (!key) {
      th.textContent = label;
      return th;
    }
    const b = el('button', '', label);
    b.type = 'button';
    b.addEventListener('click', () => {
      // A new column starts the way it is most often wanted: A to Z, newest, most.
      state.dir = state.sort === key ? (state.dir === 'asc' ? 'desc' : 'asc') : key === 'email' || key === 'plan' || key === 'endsAt' ? 'asc' : 'desc';
      state.sort = key;
      state.page = 1;
      void reload();
    });
    if (state.sort === key) th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
    th.append(b);
    return th;
  };
  const head = [
    header('email', 'Account'),
    header('plan', 'Plan'),
    header(null, 'Status'),
    header('endsAt', 'Ends'),
    header('joined', 'Joined'),
    header('lastLogin', 'Last sign-in'),
    header('videos', 'Videos', 'num'),
    header(null, 'Email'),
  ];
  const rows = data.users.map((u: AdminUser) =>
    row(
      el('td', '', el('div', 'person', avatar(u.id, u.email), link(`/admin/user?id=${u.id}`, u.email), u.role === 'superadmin' ? tag('superadmin', true) : null)),
      u.planName ?? '—',
      statusPill(u.status),
      cell('quiet', day(u.endsAt)),
      cell('quiet', date(u.createdAt)),
      cell('quiet', u.lastLoginAt ? date(u.lastLoginAt) : 'never'),
      cell('num', String(u.videos)),
      cell('quiet', u.verified ? 'Confirmed' : 'Not yet'),
    ),
  );
  return table(head, rows, 'No account matches.', 'wide');
}

// ── One user ──────────────────────────────────────────────────────────────

/** A date input's value as the end of that day, UTC: "until 31 Dec" includes 31 Dec. */
function endOfDay(value: string): string | null {
  return value ? `${value}T23:59:59.999Z` : null;
}

async function user(): Promise<void> {
  const id = Number(new URLSearchParams(location.search).get('id'));
  if (!Number.isSafeInteger(id) || id < 1) {
    root.replaceChildren(viewHead('No account named', 'Pick one on the Users page.'), link('/admin/users', 'Every account', 'card-link'));
    return;
  }
  const [data, { plans }] = await Promise.all([api<AdminUserResponse>('GET', `/api/admin/users/${id}`), api<AdminPlansResponse>('GET', '/api/admin/plans')]);
  const u = data.user;
  const sub = data.subscription;
  document.title = `${u.email} · Admin · BounceReel`;
  const reload = () => void user();

  // The subscription: plan, end date, status, all saved together.
  const planSelect = el(
    'select',
    '',
    ...plans
      .filter((p) => !p.archivedAt || p.id === sub?.planId)
      .map((p) => Object.assign(el('option', '', `${p.name}${p.archivedAt ? ' (archived)' : ''}`), { value: String(p.id) })),
  );
  planSelect.value = String(sub?.planId ?? '');
  const ends = el('input');
  ends.setAttribute('type', 'date');
  ends.value = sub?.endsAt ? sub.endsAt.slice(0, 10) : '';
  const statusSelect = el('select', '', ...SUBSCRIPTION_STATUSES.map((s) => Object.assign(el('option', '', s === 'active' ? 'Active' : 'Canceled'), { value: s })));
  statusSelect.value = sub?.status ?? 'active';
  const save = button('Save the subscription', '', () =>
    void act(
      () => api('PUT', `/api/admin/users/${id}/subscription`, { planId: Number(planSelect.value), endsAt: endOfDay(ends.value), status: statusSelect.value }),
      'Subscription saved',
    ).then((ok) => ok && reload()),
  );
  const subscription = el(
    'section',
    'card',
    cardHead('Subscription', sub ? statusPill(sub.status) : null),
    el(
      'p',
      'card-text',
      sub
        ? `${sub.planName}${sub.endsAt ? `, until ${day(sub.endsAt)}` : ', with no end date'}. Set ${sub.source === 'manual' ? 'by hand' : `by ${sub.source}`}, last changed ${when(sub.updatedAt)}.`
        : 'No subscription.',
    ),
    el(
      'div',
      'form-row',
      el('label', 'field', el('span', '', 'Plan'), planSelect),
      el('label', 'field', el('span', '', 'Ends'), ends, el('small', '', 'Empty: no end date')),
      el('label', 'field', el('span', '', 'Status'), statusSelect),
    ),
    el(
      'div',
      'row-actions',
      save,
      button('Clear the end date', 'ghost', () => ((ends.value = ''), save.click())),
      sub?.status === 'active'
        ? button('Cancel the subscription', 'ghost', () => {
            if (confirm(sub.endsAt ? `Cancel? ${u.email} keeps ${sub.planName} until ${day(sub.endsAt)}.` : `Cancel? ${u.email} moves to the default plan now.`)) {
              statusSelect.value = 'canceled';
              save.click();
            }
          })
        : button('Make it active again', 'ghost', () => ((statusSelect.value = 'active'), save.click())),
    ),
  );

  // The account: what it is, suspend, a password mail.
  const account = el(
    'section',
    'card',
    cardHead('Account'),
    el(
      'dl',
      'facts',
      el('dt', '', 'Joined'),
      el('dd', '', when(u.createdAt)),
      el('dt', '', 'Last sign-in'),
      el('dd', '', when(u.lastLoginAt)),
      el('dt', '', 'Email'),
      el('dd', '', u.verified ? 'Confirmed' : 'Not confirmed yet'),
      el('dt', '', 'Videos'),
      el('dd', '', String(u.videos)),
      el('dt', '', 'Role'),
      el('dd', '', u.role === 'superadmin' ? 'Superadmin: every feature, whatever the plan' : 'User'),
      u.suspendedAt ? el('dt', '', 'Suspended') : null,
      u.suspendedAt ? el('dd', '', `Since ${when(u.suspendedAt)}`) : null,
    ),
    el(
      'div',
      'row-actions',
      u.suspendedAt
        ? button([icon('play'), 'Unsuspend'], 'ghost', () => void act(() => api('POST', `/api/admin/users/${id}/unsuspend`), 'Unsuspended').then((ok) => ok && reload()))
        : button([icon('pause'), 'Suspend'], 'ghost', () => {
            if (confirm(`Suspend ${u.email}? It is signed out everywhere and cannot sign in until unsuspended.`)) void act(() => api('POST', `/api/admin/users/${id}/suspend`), 'Suspended').then((ok) => ok && reload());
          }),
      button([icon('mail'), 'Send a password reset'], 'ghost', async () => {
        try {
          const { mail } = await api<{ mail: MailResult }>('POST', `/api/admin/users/${id}/reset`);
          flash(mail === 'sent' ? `A password link is on its way to ${u.email}` : mail === 'off' ? 'Mail is off (no RESEND_API_KEY): locally, the link is in the server log' : 'The mail could not be sent: see the log');
        } catch (err) {
          flash(errorText(err));
        }
      }),
    ),
  );

  // Deleting, with the address typed out.
  const confirmInput = Object.assign(el('input'), { type: 'text', placeholder: u.email, spellcheck: false, autocomplete: 'off' });
  const remove = button([icon('trash'), 'Delete the account'], 'danger', async () => {
    if (!confirm(`Delete ${u.email}, its videos and links? This cannot be undone.`)) return;
    if (await act(() => api('DELETE', `/api/admin/users/${id}`, { confirm: confirmInput.value }), `${u.email} deleted`)) location.assign('/admin/users');
  });
  remove.disabled = true;
  confirmInput.addEventListener('input', () => (remove.disabled = confirmInput.value.trim().toLowerCase() !== u.email.toLowerCase()));
  const danger = el(
    'section',
    'card danger-zone',
    cardHead('Delete the account'),
    el('p', 'card-text', 'The account, its videos and their links go at once; the change log keeps its lines. This cannot be undone.'),
    el('div', 'danger-inline', el('label', 'field', el('span', '', `Type ${u.email} to confirm`), confirmInput), remove),
  );

  const changes = el(
    'section',
    'card flush',
    cardHead('History'),
    table(['When', 'Who', 'What', 'Change'], data.history.map((e) => row(cell('quiet', when(e.at)), who(e), what(e), change(e))), 'No changes yet.'),
  );
  const videos = el(
    'section',
    'card flush',
    cardHead(['Videos ', tag('read only')]),
    table(
      ['Recorded', 'Video', 'Length', 'Links'],
      data.videos.map((v) => row(cell('quiet', when(v.recordedAt)), v.title, cell('quiet', `${v.videoLength} s`), v.posts.map((p) => p.platform).join(', ') || '—')),
      'No videos.',
    ),
  );

  root.replaceChildren(
    link('/admin/users', [icon('left'), 'Users'], 'back'),
    el(
      'header',
      'view-head',
      el(
        'div',
        'person',
        avatar(u.id, u.email, true),
        el('div', 'titles', el('h1', '', u.email, statusPill(u.status), u.role === 'superadmin' ? tag('superadmin', true) : null), el('p', '', `On ${u.planName ?? 'no plan'}, joined ${date(u.createdAt)}`)),
      ),
    ),
    el('div', 'columns wide-first', subscription, account),
    danger,
    changes,
    videos,
  );
}

// ── Plans ─────────────────────────────────────────────────────────────────

/** What the pricing page shows of a plan: its name, price, line and what it includes. */
interface Face {
  name: string;
  description: string;
  price: Price | null;
  features: Features;
  tone: PlanTone;
  badge: string | null;
}

/** The pricing page's tones, as the editor offers them. */
const TONE_LABELS: Record<PlanTone, string> = { plain: 'Plain: white, for the free plan', bold: 'Bold: violet, the plan to point at', dark: 'Dark: the top plan' };

/** A plan tile's classes: its tone, as src/site/pricing.ts gives the pricing page's card. */
function toneClass(tone: PlanTone): string {
  return tone === 'plain' ? '' : ` tone-${tone}`;
}

/** A plan as src/site/pricing.ts draws it: the same drawing, price, list, tone and badge. */
function planFace(plan: Face, heading: 'h2' | 'h3', tags: Child[] = []): HTMLElement[] {
  const price = el('p', 'plan-price');
  if (plan.price) {
    price.append(formatPrice(plan.price));
    if (plan.price.interval) price.append(el('small', '', `/ ${plan.price.interval}`));
  } else {
    price.classList.add('soon');
    price.textContent = 'Coming soon';
  }
  const list = el('ul', 'ticks', ...describeFeatures(plan.features).map((f) => el('li', f.included ? '' : 'no', f.text)));
  list.setAttribute('aria-label', `What ${plan.name || 'the plan'} includes`);
  const badge = plan.badge ? el('span', 'plan-badge', plan.badge) : null;
  return [el('div', 'plan-top', planEmblem(plan.tone), el(heading, '', plan.name || 'Untitled plan'), badge, ...tags), price, el('p', 'plan-desc', plan.description || '\u00a0'), list];
}

/** The editor's checkbox and the line beside it. */
function choice(name: string, label: string, checked: boolean): HTMLLabelElement {
  return el('label', 'choice', Object.assign(el('input'), { type: 'checkbox', name, checked }), el('span', '', label));
}

function toggle(name: string, label: string, note: string, checked: boolean): HTMLLabelElement {
  const input = Object.assign(el('input'), { type: 'checkbox', name, checked });
  input.setAttribute('role', 'switch');
  return el('label', 'toggle-row', el('span', '', label, el('small', '', note)), el('span', 'switch', input));
}

/** A new plan starts as the free plan does: the smallest that still makes a video, with the watermark. */
const NEW_PLAN: Features = { sounds: ['music', 'silent'], narrator: false, maxSeconds: 30, looks: ['paper'], powers: false, perDay: 1, library: 5, watermark: true, allGames: false };

/** The editor's fields for one plan (or a new one), prices in the currency's major unit. */
function planForm(plan: AdminPlan | null): { form: HTMLFormElement; read: () => PlanBody } {
  const f = plan?.features ?? NEW_PLAN;
  const input = (name: string, value: string, attrs: Record<string, string | number | boolean> = {}): HTMLInputElement => {
    const node = el('input');
    // The type as an attribute, which the stylesheets' input[type='…'] rules look for.
    node.setAttribute('type', String(attrs.type ?? 'text'));
    Object.assign(node, attrs);
    node.name = name;
    node.value = value;
    return node;
  };
  const interval = el(
    'select',
    '',
    ...[...PRICE_INTERVALS, ''].map((i) => Object.assign(el('option', '', i ? `per ${i}` : 'once'), { value: i })),
  );
  interval.name = 'interval';
  interval.value = plan?.price ? (plan.price.interval ?? '') : 'month';
  const tone = el('select', '', ...PLAN_TONES.map((t) => Object.assign(el('option', '', TONE_LABELS[t]), { value: t })));
  tone.name = 'tone';
  tone.value = plan?.tone ?? 'plain';
  const field = (label: string, control: HTMLElement, hint = '') => el('label', 'field', el('span', '', label), control, hint ? el('small', '', hint) : null);
  const limit = (value: number | null) => (value === null ? '' : String(value));
  const form = el(
    'form',
    '',
    el(
      'fieldset',
      'form-section',
      el('legend', '', 'The plan'),
      field('Name', input('name', plan?.name ?? '', { required: true, maxLength: 60 })),
      field('Description', input('description', plan?.description ?? '', { maxLength: 300 }), 'One line under the price on the pricing page.'),
      el(
        'div',
        'form-row',
        field('Card', tone),
        field('Badge', input('badge', plan?.badge ?? '', { maxLength: 24, placeholder: 'Recommended' }), 'On the card’s corner; empty for none'),
      ),
      el('div', 'toggles', toggle('visible', 'On the pricing page', 'Hidden, it can still be given to someone on their page.', plan?.visible ?? true)),
    ),
    el(
      'fieldset',
      'form-section',
      el('legend', '', 'Price'),
      el(
        'div',
        'form-row',
        field('Amount', input('amount', plan?.price ? (plan.price.amount / 100).toFixed(2) : '', { inputMode: 'decimal', placeholder: '9.00' }), 'Empty: “Coming soon”'),
        field('Currency', input('currency', plan?.price?.currency ?? 'EUR', { maxLength: 3 })),
        field('Billed', interval),
      ),
    ),
    el(
      'fieldset',
      'form-section',
      el('legend', '', 'Limits'),
      el(
        'div',
        'form-row',
        field('Videos a day', input('perDay', limit(f.perDay), { type: 'number', min: '1', placeholder: 'No limit' }), 'A new day starts at midnight UTC'),
        field('Longest video', input('maxSeconds', String(f.maxSeconds), { type: 'number', min: String(MIN_VIDEO_SECONDS), max: String(MAX_VIDEO_SECONDS), step: '5' }), `${MIN_VIDEO_SECONDS} to ${MAX_VIDEO_SECONDS} seconds`),
        field('Videos kept', input('library', limit(f.library), { type: 'number', min: '0', placeholder: 'No limit' }), 'In the library at once'),
      ),
    ),
    el(
      'fieldset',
      'form-section',
      el('legend', '', 'What it includes'),
      el('div', 'field', el('span', '', 'Sounds a recording may have'), el('div', 'choices', ...SOUNDS.map((s) => choice(`sound-${s}`, SOUND_LABELS[s], f.sounds.includes(s))))),
      el('div', 'field', el('span', '', 'Looks'), el('div', 'choices', ...LOOKS.map((l) => choice(`look-${l}`, LOOK_LABELS[l], f.looks.includes(l))))),
      el(
        'div',
        'toggles',
        toggle('narrator', 'The narrator', 'The Voice tab, and a voice in the video. Needs the narrator sound too.', f.narrator),
        toggle('powers', 'Powers', 'Balls that speed up, slow down, grow or split.', f.powers),
        toggle('watermark', 'Watermark', 'A small BounceReel watermark between the two cards of every video.', f.watermark),
        toggle('allGames', 'Every game', 'Each game BounceReel adds, as it comes out. Ball races are the one game today.', f.allGames),
      ),
    ),
  );
  form.noValidate = true;
  const read = (): PlanBody => {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const amount = text('amount');
    const optional = (name: string) => (text(name) === '' ? null : Number(text(name)));
    return {
      name: text('name'),
      description: text('description'),
      price: amount ? { amount: Math.round(Number(amount.replace(',', '.')) * 100), currency: text('currency').toUpperCase(), interval: (text('interval') || null) as PriceInterval | null } : null,
      visible: data.has('visible'),
      tone: text('tone') as PlanTone,
      badge: text('badge') || null,
      features: {
        sounds: SOUNDS.filter((s) => data.has(`sound-${s}`)),
        narrator: data.has('narrator'),
        maxSeconds: Number(text('maxSeconds')),
        looks: LOOKS.filter((l) => data.has(`look-${l}`)),
        powers: data.has('powers'),
        perDay: optional('perDay'),
        library: optional('library'),
        watermark: data.has('watermark'),
        allGames: data.has('allGames'),
      },
    };
  };
  return { form, read };
}

/**
 * The editor, a drawer over the plans: the plan as the pricing page will show it on top, redrawn
 * as the fields change, then the fields. Saving closes it and draws the plans again.
 */
function openEditor(plan: AdminPlan | null, saved: () => void): void {
  const dialog = el('dialog', 'drawer');
  dialog.setAttribute('aria-labelledby', 'editor-title');
  const { form, read } = planForm(plan);
  const preview = el('div', 'plan-tile');
  const redraw = () => {
    const body = read();
    // A number field left half-typed reads as NaN; the preview shows what is there so far.
    const features = { ...body.features, maxSeconds: Number.isFinite(body.features.maxSeconds) ? body.features.maxSeconds : 0 };
    preview.className = `plan-tile${toneClass(body.tone)}`;
    preview.replaceChildren(...planFace({ ...body, features }, 'h3'));
  };
  form.addEventListener('input', redraw);
  form.addEventListener('change', redraw);
  redraw();

  const error = el('p', 'drawer-error');
  error.setAttribute('role', 'alert');
  const close = () => dialog.close();
  const submit = button(plan ? 'Save the plan' : 'Create the plan', '', async () => {
    submit.disabled = true;
    error.textContent = '';
    try {
      await (plan ? api('PUT', `/api/admin/plans/${plan.id}`, read()) : api('POST', '/api/admin/plans', read()));
      flash(plan ? `${read().name} saved` : 'Plan created');
      close();
      saved();
    } catch (err) {
      error.textContent = errorText(err);
      submit.disabled = false;
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.click();
  });

  const title = el('h2', '', plan ? `Edit ${plan.name}` : 'New plan');
  title.id = 'editor-title';
  // The dialog opens on the name rather than on its close button, the first thing in it.
  (form.elements.namedItem('name') as HTMLInputElement).autofocus = true;
  dialog.append(
    el('header', 'drawer-head', title, iconButton('close', 'Close', close)),
    el('div', 'drawer-body', el('div', 'preview', el('span', '', 'On the pricing page'), preview), form),
    el('footer', 'drawer-foot', error, button('Cancel', 'ghost', close), submit),
  );
  // A click on the dimmed page beside the drawer closes it, as Escape does.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

async function plansView(): Promise<void> {
  const { plans } = await api<AdminPlansResponse>('GET', '/api/admin/plans');
  const reload = () => void plansView();
  const order = (from: number, to: number) => {
    const ids = plans.map((p) => p.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    void act(() => api('POST', '/api/admin/plans/order', { ids }), 'Order saved').then((ok) => ok && reload());
  };

  const tiles = plans.map((plan, i) => {
    const tags = [plan.isDefault ? tag('Default', true) : null, plan.visible ? null : tag('Hidden'), plan.archivedAt ? tag('Archived') : null];
    const earlier = iconButton('left', 'Earlier on the pricing page', () => order(i, i - 1));
    const later = iconButton('right', 'Later on the pricing page', () => order(i, i + 1));
    earlier.disabled = i === 0;
    later.disabled = i === plans.length - 1;
    const actions = el(
      'div',
      'plan-actions',
      button([icon('edit'), 'Edit'], '', () => openEditor(plan, reload)),
      earlier,
      later,
      el('span', 'spacer'),
      plan.isDefault
        ? null
        : plan.archivedAt
          ? iconButton('restore', `Restore ${plan.name}`, () => void act(() => api('POST', `/api/admin/plans/${plan.id}/restore`), `${plan.name} restored`).then((ok) => ok && reload()))
          : iconButton('archive', `Archive ${plan.name}`, () => {
              if (confirm(`Archive ${plan.name}? It leaves the pricing page and cannot be given to anyone new${plan.subscribers ? `; its ${count(plan.subscribers, 'subscriber')} keep it` : ''}.`)) {
                void act(() => api('POST', `/api/admin/plans/${plan.id}/archive`), `${plan.name} archived`).then((ok) => ok && reload());
              }
            }),
      plan.isDefault || plan.subscribers > 0
        ? null
        : iconButton('trash', `Delete ${plan.name}`, () => {
            if (confirm(`Delete ${plan.name}? Nobody has it.`)) void act(() => api('DELETE', `/api/admin/plans/${plan.id}`), `${plan.name} deleted`).then((ok) => ok && reload());
          }),
    );
    const meta = el(
      'p',
      'plan-meta',
      icon('users'),
      `${count(plan.subscribers, 'subscription')}. ${plan.isDefault ? 'Every new account gets it.' : plan.subscribers ? 'It can be archived, not deleted.' : 'Nobody has it.'}`,
    );
    const classes = `plan-tile${toneClass(plan.tone)}${plan.archivedAt ? ' archived' : ''}`;
    return el('article', classes, ...planFace(plan, 'h2', tags), meta, actions);
  });

  const fresh = el('button', 'plan-new', icon('plus'), 'New plan');
  fresh.type = 'button';
  fresh.addEventListener('click', () => openEditor(null, reload));

  root.replaceChildren(
    viewHead(
      'Plans',
      'What each plan gives and costs, in the order of the pricing page. A change applies to everyone on the plan at once.',
      button([icon('plus'), 'New plan'], '', () => openEditor(null, reload)),
    ),
    el('div', 'plan-grid', ...tiles, fresh),
  );
}

// ── The log ───────────────────────────────────────────────────────────────

function who(e: LogEntry): string {
  if (!e.actor) return 'the server';
  if (e.user && e.actor.id === e.user.id) return 'the account itself';
  return e.actor.email ?? `account ${e.actor.id} (deleted)`;
}

function what(e: LogEntry): HTMLElement {
  // The order of the plans is about all of them: "plans reordered".
  if (!e.user && !e.plan) return el('td', '', `${e.subject}s ${e.action}`);
  const subject = e.user ? (e.user.email ? link(`/admin/user?id=${e.user.id}`, e.user.email) : `account ${e.user.id} (deleted)`) : `plan ${e.plan!.name ?? `${e.plan!.id} (deleted)`}`;
  return el('td', '', `${e.subject} ${e.action}: `, subject);
}

/** Before and after, only what changed: "plan Rookie → Pro, endsAt — → 31 Dec 2026". */
function change(e: LogEntry): string {
  const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? day(v) : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const before = (e.before ?? {}) as Record<string, unknown>;
  const after = (e.after ?? {}) as Record<string, unknown>;
  if (Array.isArray(e.before) || Array.isArray(e.after)) return `${show(e.before)} → ${show(e.after)}`;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return keys.map((k) => `${k} ${show(before[k])} → ${show(after[k])}`).join(', ') || '—';
}

async function log(page = Math.max(1, Number(new URLSearchParams(location.search).get('page')) || 1)): Promise<void> {
  const data = await api<LogResponse>('GET', `/api/admin/log?page=${page}`);
  history.replaceState(null, '', page > 1 ? `?page=${page}` : location.pathname);
  root.replaceChildren(
    viewHead('Log', 'Every change to a subscription, a plan or an account’s standing, newest first. Lines are never edited or removed.'),
    el(
      'section',
      'card flush',
      table(['When', 'Who', 'What', 'Change'], data.entries.map((e) => row(cell('quiet', when(e.at)), who(e), what(e), change(e))), 'Nothing has changed yet.'),
      data.total ? pager(data.page, data.pageSize, data.total, (p) => void log(p)) : null,
    ),
  );
}

// ── Start ─────────────────────────────────────────────────────────────────

bindThemeToggle($('#theme'));
const current = view === 'user' ? 'users' : view;
for (const a of document.querySelectorAll<HTMLAnchorElement>('.side-nav a')) if (a.dataset.view === current) a.setAttribute('aria-current', 'page');

const VIEWS: Record<string, () => Promise<void>> = { overview, users, user, plans: plansView, log: () => log() };
void loadAccount()
  .then((account) => {
    $('#me').textContent = account.account.email;
    return (VIEWS[view] ?? overview)();
  })
  .catch((err) => root.replaceChildren(el('p', 'empty', `This page could not be loaded: ${errorText(err)}.`)))
  .finally(() => root.removeAttribute('aria-busy'));
