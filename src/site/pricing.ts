import type { AccountResponse, PlanTone, PlansResponse, Price, PublicPlan } from '../../shared/api.ts';
import { GAME_LABELS, GAMES, LOOK_LABELS, LOOKS, describeFeatures, gameAllowed, gamePlans, soundAllowed, type Features, type Game } from '../../shared/features.ts';
import { SIGNUPS_OPEN } from '../../shared/site.ts';
import { api } from '../api.ts';

// The plans, read from GET /api/plans: on the home page's pricing section and on /pricing.
// What each plan includes is written from its features (shared/features.ts), so the page always
// says what the studio and the server enforce. A plan without a price says "Coming soon". A plan
// sold by the year too shows either price as the switch over the cards says (`#plans-period`),
// the year by default: the year's price as a month ("$7 / month"), what it is billed and saves
// under it.

/** "$9", "$9.50" */
export function formatPrice(price: Price): string {
  const money = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: price.currency,
    minimumFractionDigits: price.amount % 100 ? 2 : 0,
  }).format(price.amount / 100);
  return money;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * The drawing at the top of a plan's card, by its tone, so the plans climb as a race does: a ball
 * on its first layer for the free plan, the BounceReel mark itself (the ball breaking through) on
 * a white tile on the violet, the winner's trophy on the top plan. Each gradient gets an id of its
 * own: the admin area can show one tone twice on a page.
 */
const EMBLEMS: Record<PlanTone, (id: string) => string> = {
  plain: () => `<svg viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="11.8" r="6.6" fill="#7c4dff" />
    <ellipse cx="13.7" cy="9.6" rx="2.2" ry="1.4" transform="rotate(-38 13.7 9.6)" fill="#fff" opacity=".6" />
    <rect x="4.5" y="22" width="23" height="4.6" rx="2.3" fill="#0ea5e9" />
  </svg>`,
  bold: (id) => `<svg viewBox="0 0 32 32" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="4" y1="2.6" x2="18.4" y2="12.4" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7c4dff" stop-opacity="0" /><stop offset="1" stop-color="#7c4dff" stop-opacity=".55" /></linearGradient></defs>
    <path d="M4 2.6 15.09 17.27 21.71 7.53Z" fill="url(#${id})" />
    <circle cx="18.4" cy="12.4" r="6.4" fill="#7c4dff" />
    <ellipse cx="16.2" cy="10.3" rx="2.1" ry="1.35" transform="rotate(-38 16.2 10.3)" fill="#fff" opacity=".6" />
    <rect x="3" y="21.2" width="14.6" height="4.2" rx="2.1" fill="#0ea5e9" />
    <rect x="20.6" y="21.2" width="8.4" height="4.2" rx="2.1" fill="#0ea5e9" opacity=".4" />
    <rect x="3" y="27.2" width="26" height="4.2" rx="2.1" fill="#0ea5e9" opacity=".72" />
  </svg>`,
  dark: (id) => `<svg viewBox="0 0 32 32" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="6" y1="4" x2="26" y2="28" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#a78bff" /><stop offset="1" stop-color="#38bdf8" /></linearGradient></defs>
    <path d="M9.5 7.5H7.2a1.2 1.2 0 0 0-1.2 1.2v.6a4.6 4.6 0 0 0 4.4 4.6M22.5 7.5h2.3a1.2 1.2 0 0 1 1.2 1.2v.6a4.6 4.6 0 0 1-4.4 4.6" fill="none" stroke="url(#${id})" stroke-width="2.2" stroke-linecap="round" />
    <path d="M9.5 5h13v6.4a6.5 6.5 0 0 1-13 0Z" fill="url(#${id})" />
    <path d="M14.5 17.4h3l.5 4.6h-4Z" fill="url(#${id})" />
    <rect x="10" y="22" width="12" height="5.4" rx="1.7" fill="url(#${id})" />
    <ellipse cx="13" cy="8.6" rx="1.2" ry="2" fill="#fff" opacity=".45" />
  </svg>`,
};
let emblems = 0;

/** A plan's drawing (`EMBLEMS`), in the rounded square that holds it; the admin's plan tiles use it too. */
export function planEmblem(tone: PlanTone): HTMLSpanElement {
  const emblem = el('span', 'plan-emblem');
  emblem.innerHTML = (EMBLEMS[tone] ?? EMBLEMS.plain)(`plan-emblem-${++emblems}`);
  return emblem;
}

/** Which price the cards show: by the year (the default) or by the month. */
export type Period = 'year' | 'month';

/** What a year by the month would cost that the year's price does not, in whole percent: 22 for $84 against $9 a month. */
export function yearSaving(price: Price): number {
  return price.yearly === null || price.amount === 0 ? 0 : Math.round((1 - price.yearly / (price.amount * 12)) * 100);
}

/**
 * A plan's price as its card says it. By the year: the month's price struck through beside the
 * year's as a month ("~~$9~~ $7 / month"), what is billed once a year, and what that saves ("Save
 * $24"). By the month: "$9 / month" and what the year would make it. "$0" for a free plan.
 */
export function priceLines(price: Price, period: Period): { amount: string; per: string | null; was: string | null; note: string | null; save: string | null } {
  const money = (amount: number) => formatPrice({ ...price, amount });
  if (price.yearly !== null && price.interval === 'month') {
    const monthly = Math.round(price.yearly / 12);
    if (period === 'year') {
      return { amount: money(monthly), per: '/ month', was: money(price.amount), note: `${money(price.yearly)} billed once a year`, save: `Save ${money(price.amount * 12 - price.yearly)}` };
    }
    return { amount: money(price.amount), per: '/ month', was: null, note: `or ${money(monthly)} a month, billed yearly`, save: null };
  }
  return { amount: money(price.amount), per: price.interval ? `/ ${price.interval}` : null, was: null, note: null, save: null };
}

function joinWords(words: string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * What a plan adds to the one under it, for its card's list after "Everything in Pro, plus": its
 * other games, more videos, longer ones, the looks, powers, no watermark, the narrator, the follow
 * button, picking the winner, words of your own, a bigger library. Only what it does better.
 */
export function planGains(below: Features, f: Features): string[] {
  const out: string[] = [];
  const had = GAMES.filter((g) => gameAllowed(below, g));
  const added = GAMES.filter((g) => gameAllowed(f, g) && !had.includes(g)).map((g) => GAME_LABELS[g]);
  if (f.allGames && !below.allGames) out.push(added.length ? `${joinWords(added)}, and every new game first` : 'Every new game, the day it comes out');
  else if (added.length) out.push(joinWords(added));
  const more = (x: number | null, y: number | null) => (y === null ? x !== null : x !== null && y > x);
  if (more(below.perDay, f.perDay)) out.push(f.perDay === null ? 'Unlimited videos' : `${f.perDay} videos a day`);
  if (f.maxSeconds > below.maxSeconds) out.push(`Videos up to ${f.maxSeconds} seconds`);
  if (f.looks.length > below.looks.length) out.push(f.looks.length === LOOKS.length ? 'All three looks' : `The ${joinWords(f.looks.map((l) => LOOK_LABELS[l].toLowerCase()))} looks`);
  if (f.powers && !below.powers) out.push('Powers: balls that speed up, grow or split');
  if (!f.watermark && below.watermark) out.push('No watermark');
  if (soundAllowed(f, 'narrator') && !soundAllowed(below, 'narrator')) out.push('A narrator: the opening and the winner');
  if (f.follow && !below.follow) out.push('A follow button that asks viewers to follow you');
  if (f.chooseWinner && !below.chooseWinner) out.push('Pick who wins');
  if (f.customText && !below.customText) out.push('Your own words: the question, the narrator, the last line');
  if (more(below.library, f.library)) out.push(f.library === null ? 'Every video kept in your library' : `${f.library} videos kept in your library`);
  return out;
}

function planCard(
  plan: PublicPlan,
  below: PublicPlan | null,
  data: PlansResponse,
  current: number | null,
  member: boolean,
  heading: 'h2' | 'h3',
  period: Period,
): HTMLLIElement {
  // The plan's tone, set in the admin area: plain, bold (the violet, the plan the page points at) or dark (site.css).
  const li = el('li', plan.tone === 'plain' ? 'plan' : `plan tone-${plan.tone}`);
  const price = el('p', 'plan-price');
  // Under the price, always there so the cards' buttons line up: what it is billed and saves, or a space.
  const billed = el('p', 'plan-billed', '\u00a0');
  if (plan.price) {
    const lines = priceLines(plan.price, period);
    if (lines.was) {
      const was = el('s', 'plan-was', lines.was);
      was.setAttribute('aria-label', `was ${lines.was}`);
      price.append(was);
    }
    price.append(lines.amount);
    if (lines.per) price.append(el('small', '', lines.per));
    if (lines.note) {
      billed.textContent = lines.note;
      if (lines.save) billed.append(' ', el('span', 'plan-save', lines.save));
    } else if (plan.price.amount === 0) billed.textContent = 'Free, no card needed';
  } else {
    price.classList.add('soon');
    price.textContent = 'Coming soon';
  }
  // The free plan lists what it makes and its watermark; each plan above it what it adds to the one under it.
  const list = el('ul');
  list.setAttribute('aria-label', `What ${plan.name} includes`);
  const gains = below ? planGains(below.features, plan.features) : [];
  if (below && gains.length) {
    for (const gain of gains) list.append(el('li', '', gain));
  } else {
    // Its games (a tick: they are what it makes), what it includes, and its watermark.
    describeFeatures(plan.features).forEach((feature, i) => {
      if (i === 0 || feature.included || feature.text.includes('watermark')) list.append(el('li', i === 0 || feature.included ? '' : 'no', feature.text));
    });
  }
  const plus = below && gains.length ? el('p', 'plan-plus', `Everything in ${below.name}, plus`) : null;
  const top = el('div', 'plan-top');
  top.append(planEmblem(plan.tone), el(heading, 'plan-name', plan.name));
  if (plan.badge) top.append(el('span', 'plan-badge', plan.badge));

  // The action sits under the price and the line, above the list: at the same height on every
  // card, and on a phone before a screen of ticks.
  let action: HTMLElement;
  if (current === plan.id) {
    action = el('p', 'current', 'Your plan');
  } else if (!member && !SIGNUPS_OPEN) {
    // Sign-ups closed (shared/site.ts): no plan can be had yet, the free one neither, so every
    // card waits alike. A signed-in visitor (the owner) still sees the cards as they work.
    const soon = el('button', 'btn btn-primary btn-wide', 'Coming soon');
    soon.type = 'button';
    soon.disabled = true;
    action = soon;
  } else if (plan.isDefault) {
    // The free plan stays quiet: an outline button, so the eye goes to the plan the page points at.
    const start = el('a', 'btn btn-ghost btn-wide', member ? 'Open studio' : 'Start free');
    start.href = member ? '/app' : '/signup';
    action = start;
  } else {
    // No payment provider yet: every upgrade waits (worker/routes/billing.ts).
    const upgrade = el('button', 'btn btn-primary btn-wide', data.billing ? `Choose ${plan.name}` : 'Upgrades open soon');
    upgrade.type = 'button';
    upgrade.disabled = !data.billing;
    action = upgrade;
  }
  const lists = el('div', 'plan-lists');
  if (plus) lists.append(plus);
  lists.append(list);
  li.append(top, price, billed, el('p', 'plan-desc', plan.description), action, lists);
  return li;
}

/**
 * Writes which plans make each game into every `[data-game-plans]` on the page, the Games cards on
 * the home page, /games and the game pages: "Every plan", or "Pro and Champion, from $7 a month"
 * (by the year, the least of them). A game no plan makes keeps the words its card was written with.
 */
export function fillGamePlans(data: PlansResponse): void {
  for (const tag of document.querySelectorAll<HTMLElement>('[data-game-plans]')) {
    const game = tag.dataset.gamePlans as Game;
    if (!GAMES.includes(game)) continue;
    const which = gamePlans(game, data.plans);
    if (!which) continue;
    // From what a month, paid by the year where a plan is sold so: the least of the plans that make it.
    const monthly = data.plans
      .filter((p) => p.price && gameAllowed(p.features, game))
      .map((p) => (p.price!.yearly !== null ? { ...p.price!, amount: Math.round(p.price!.yearly / 12) } : p.price!))
      .filter((p) => p.amount > 0 && (p.interval === 'month' || p.yearly !== null))
      .sort((x, y) => x.amount - y.amount)[0];
    tag.textContent = which === 'Every plan' ? which : monthly ? `${which}, from ${formatPrice(monthly)} a month` : `With ${which}`;
  }
}

/**
 * Fills `#plans` (and `#plans-note`); a signed-in visitor sees which plan is theirs. Returns the
 * plans for whatever else the page says about them, or null when they could not be had.
 */
export async function renderPlans(): Promise<PlansResponse | null> {
  const list = document.querySelector<HTMLElement>('#plans');
  if (!list) return null;
  try {
    const member = document.documentElement.hasAttribute('data-member');
    const [data, account] = await Promise.all([
      api<PlansResponse>('GET', '/api/plans'),
      member ? api<AccountResponse>('GET', '/api/account').catch(() => null) : Promise.resolve(null),
    ]);
    // A superadmin has every feature whatever its plan, so no card is its own.
    const current = account && account.account.role !== 'superadmin' ? account.plan.id : null;
    // A plan's name is one level under the heading above the list: h2 on /pricing, h3 in the home page's section.
    const heading = list.dataset.heading === 'h2' ? 'h2' : 'h3';
    const compare = document.querySelector<HTMLElement>('#plans-compare');
    const draw = (period: Period) => {
      list.replaceChildren(...data.plans.map((plan, i) => planCard(plan, i ? data.plans[i - 1] : null, data, current, account !== null, heading, period)));
      if (compare) compare.replaceChildren(compareTable(data.plans, period));
    };
    draw('year');
    // The switch over the cards, once a plan is sold by the year: Yearly first, with what it saves at most.
    const switcher = document.querySelector<HTMLElement>('#plans-period');
    const best = Math.max(0, ...data.plans.map((p) => (p.price ? yearSaving(p.price) : 0)));
    if (switcher && best > 0) {
      switcher.hidden = false;
      const save = switcher.querySelector<HTMLElement>('.plans-save');
      if (save) save.textContent = `Save up to ${best}%`;
      for (const input of switcher.querySelectorAll<HTMLInputElement>('input[name="plans-period"]')) {
        input.addEventListener('change', () => draw(input.value as Period));
      }
    }
    const note = document.querySelector<HTMLElement>('#plans-note');
    const free = data.plans.find((p) => p.isDefault);
    if (note && !SIGNUPS_OPEN && account === null) {
      note.textContent = 'BounceReel opens soon. These are the plans it will open with.';
      note.hidden = false;
    } else if (note && !data.billing && data.plans.some((p) => !p.isDefault)) {
      note.textContent = `Paid plans cannot be bought yet: upgrades open soon. Everything ${free?.name ?? 'the free plan'} includes works today.`;
      note.hidden = false;
    }
    return data;
  } catch (err) {
    list.replaceChildren(el('li', 'plans-note', `The plans could not be loaded (${err instanceof Error ? err.message : String(err)}). Try reloading the page.`));
    return null;
  } finally {
    list.classList.remove('plans-loading');
    list.removeAttribute('aria-busy');
  }
}

/**
 * Every plan side by side, a row a thing a plan decides (on /pricing, under the cards): the
 * price by the period the switch says, then the games, the limits and each feature, a tick or a
 * dash where it is one or the other. The cards say what each adds; this says all of it.
 */
function compareTable(plans: PublicPlan[], period: Period): HTMLTableElement {
  const table = el('table', 'compare');
  const yes = () => {
    const tick = el('span', 'compare-yes');
    tick.setAttribute('aria-label', 'Yes');
    return tick;
  };
  const no = () => {
    const dash = el('span', 'compare-no');
    dash.setAttribute('aria-label', 'No');
    return dash;
  };
  const head = el('thead');
  const top = el('tr');
  top.append(el('th', '', ''));
  for (const plan of plans) {
    const th = el('th');
    th.scope = 'col';
    const lines = plan.price ? priceLines(plan.price, period) : null;
    th.append(el('b', '', plan.name), el('span', '', lines ? `${lines.amount}${lines.per ? ` ${lines.per}` : ''}` : 'Coming soon'));
    top.append(th);
  }
  head.append(top);
  const rows: [string, (f: Features) => string | boolean][] = [
    ['Games', (f) => (f.allGames ? 'Every game, new ones first' : joinWords(GAMES.filter((g) => gameAllowed(f, g)).map((g) => GAME_LABELS[g])))],
    ['Videos a day', (f) => (f.perDay === null ? 'Unlimited' : String(f.perDay))],
    ['Longest video', (f) => `${f.maxSeconds} s`],
    ['Looks', (f) => (f.looks.length === LOOKS.length ? 'All three' : joinWords(f.looks.map((l) => LOOK_LABELS[l])))],
    ['Powers', (f) => f.powers],
    ['Music or silent', (f) => soundAllowed(f, 'music') || soundAllowed(f, 'silent')],
    ['Narrator', (f) => soundAllowed(f, 'narrator')],
    ['Follow button', (f) => f.follow],
    ['Pick who wins', (f) => f.chooseWinner],
    ['Your own words', (f) => f.customText],
    ['No watermark', (f) => !f.watermark],
    ['Videos kept', (f) => (f.library === null ? 'All' : String(f.library))],
  ];
  const body = el('tbody');
  for (const [label, value] of rows) {
    const tr = el('tr');
    const th = el('th', '', label);
    th.scope = 'row';
    tr.append(th);
    for (const plan of plans) {
      const v = value(plan.features);
      const td = el('td');
      if (typeof v === 'boolean') td.append(v ? yes() : no());
      else td.textContent = v;
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(head, body);
  return table;
}
