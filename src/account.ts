import type { AccountResponse } from '../shared/api.ts';
import { describeFeatures } from '../shared/features.ts';
import { api, ApiError } from './api.ts';
import { forgetAccount, loadAccount, logout } from './session.ts';
import { bindAccountChrome, dayLine } from './ui/plan.ts';
import { bindThemeToggle } from './ui/theme.ts';

// The account page (/account): the plan, how much of its day and its library is used, what it
// includes, the way to billing (waiting for a payment provider), the password, signing out (here
// or everywhere), deleting the account. The look is src/console.css.

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
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

/** How much of a limit is used, as a bar under its label: the day's videos, the library. */
function meter(label: string, used: number, limit: number, note: string | null): HTMLElement {
  const box = el('div', used >= limit ? 'meter full' : 'meter');
  const head = el('div', 'meter-label');
  head.append(el('span', '', label), el('strong', '', `${used} of ${limit}`));
  const bar = el('div', 'meter-bar');
  bar.append(el('i'));
  bar.style.setProperty('--fill', `${limit > 0 ? Math.min(100, (used / limit) * 100) : 100}%`);
  bar.setAttribute('aria-hidden', 'true');
  box.append(head, bar);
  if (note) box.append(el('small', '', note));
  return box;
}

function renderPlan(a: AccountResponse): void {
  const box = $('#plan');
  const superadmin = a.account.role === 'superadmin';
  const name = el('p', 'plan-name', superadmin ? 'Everything (superadmin)' : a.plan.name);
  const lines: string[] = [];
  const sub = a.subscription;
  if (superadmin) lines.push('A superadmin account has every feature, whatever its plan.');
  else if (sub && sub.planId !== a.plan.id) lines.push(`Your ${sub.planName} plan has ended; you are on ${a.plan.name}.`);
  else if (sub?.endsAt) lines.push(`${sub.status === 'canceled' ? 'Canceled: it ends' : 'It runs until'} ${dateFormat.format(new Date(sub.endsAt))}, then your account moves to the free plan.`);

  // The limits the plan has, as bars; one without a limit is a line.
  const meters = el('div', 'meters');
  const { day, library } = a;
  if (day.limit !== null) meters.append(meter('Videos today', Math.min(day.used, day.limit), day.limit, day.used >= day.limit ? `${dayLine(day)}.` : null));
  if (library.limit !== null) {
    meters.append(meter('Videos kept in your library', library.count, library.limit, library.count >= library.limit ? 'Full: delete one on the Videos page to keep the next recording.' : null));
  } else {
    lines.push(`${library.count} video${library.count === 1 ? '' : 's'} in your library.`);
  }
  const features = el('ul', 'ticks');
  features.setAttribute('aria-label', 'What your plan includes');
  for (const f of describeFeatures(a.features)) features.append(el('li', f.included ? '' : 'no', f.text));
  box.replaceChildren(name, ...lines.map((line) => el('p', 'card-text', line)), ...(meters.childElementCount ? [meters] : []), features);
  box.removeAttribute('aria-busy');

  // Billing: until a payment provider is connected (billing false), the button waits.
  const billing = $<HTMLButtonElement>('#billing');
  if (a.billing && !superadmin) {
    billing.disabled = false;
    billing.textContent = sub?.source === 'manual' || !sub ? 'Upgrade' : 'Manage billing';
    billing.addEventListener('click', async () => {
      try {
        const path = billing.textContent === 'Upgrade' ? '/api/billing/checkout' : '/api/billing/portal';
        const { url } = await api<{ url: string }>('POST', path, {});
        location.assign(url);
      } catch (err) {
        flash(errorText(err));
      }
    });
  } else if (superadmin) {
    billing.hidden = true;
  }
}

function bind(a: AccountResponse): void {
  const id = a.account.id;
  $('#who').textContent = a.account.email;
  $<HTMLInputElement>('#username').value = a.account.email;
  bindAccountChrome(a);
  renderPlan(a);

  const passwordForm = $<HTMLFormElement>('#password-form');
  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(passwordForm);
    const password = String(data.get('password') ?? '');
    if (password.length < 8) return flash('The new password needs at least 8 characters.');
    try {
      await api('POST', '/api/account/password', { current: data.get('current'), password });
      passwordForm.reset();
      flash('Password changed. Every other browser is signed out.');
    } catch (err) {
      flash(errorText(err));
    }
  });

  $('#logout').addEventListener('click', () => void logout(id));
  $('#logout-everywhere').addEventListener('click', async () => {
    if (!confirm('Sign out on every browser and device, this one too?')) return;
    try {
      await api('POST', '/api/account/logout-everywhere');
      forgetAccount(id);
      location.assign('/login');
    } catch (err) {
      flash(errorText(err));
    }
  });

  const deleteForm = $<HTMLFormElement>('#delete-form');
  deleteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = String(new FormData(deleteForm).get('password') ?? '');
    if (!password) return flash('Enter your password to confirm.');
    if (!confirm(`Delete ${a.account.email} and every video in its library? This cannot be undone.`)) return;
    try {
      await api('DELETE', '/api/account', { password });
      forgetAccount(id);
      location.assign('/');
    } catch (err) {
      flash(err instanceof ApiError && err.code === 'last_superadmin' ? 'The last superadmin cannot delete the account: make another superadmin first (npm run admin).' : errorText(err));
    }
  });
}

bindThemeToggle($('#theme'));
void loadAccount().then(bind);
