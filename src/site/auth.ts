import type { ResetInfo, VerifiedResponse } from '../../shared/api.ts';
import { CONTACT_EMAIL, safeNext } from '../../shared/site.ts';
import { api, ApiError } from '../api.ts';
import './chrome.ts';

// The sign-up, sign-in, forgot, reset and verify pages: one form each (or none, on /verify),
// told apart by the form's data-action. A signed-in visitor never sees /signup or /login: the
// Worker sends them on (worker/pages.ts). Where to go afterwards is `?next=`, if it is a path
// on this site (safeNext), else the studio.

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
const form = $<HTMLFormElement>('#form');
const errorBox = $<HTMLElement>('#error')!;
const okBox = $<HTMLElement>('#ok')!;
const params = new URLSearchParams(location.search);
const next = safeNext(params.get('next'), location.origin);
const action = form?.dataset.action ?? 'verify';

// Between sign-in and sign-up, keep where the visitor was going.
if (next) {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-keep-next]')) link.href += `?next=${encodeURIComponent(next)}`;
}

function link(href: string, text: string): HTMLAnchorElement {
  return Object.assign(document.createElement('a'), { href, textContent: text });
}

function show(box: HTMLElement, ...content: (string | Node)[]): void {
  (box === errorBox ? okBox : errorBox).hidden = true;
  box.replaceChildren(...content);
  box.hidden = false;
}

/** The API's error, in words that say what to do next. */
function fail(err: unknown): void {
  const code = err instanceof ApiError ? err.code : '';
  const message = err instanceof Error ? err.message : String(err);
  switch (code) {
    case 'email_taken':
      return show(errorBox, 'There is already an account with this email. ', link(`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`, 'Sign in'), ' or ', link('/forgot', 'set a new password'), '.');
    case 'link_invalid':
      return show(errorBox, 'This link is invalid, has expired or was already used. ', action === 'reset' ? link('/forgot', 'Ask for a new one.') : 'Sign in and send a new one from the studio.');
    case 'account_suspended':
      return show(errorBox, 'This account is suspended. If you think that is a mistake, write to ', link(`mailto:${CONTACT_EMAIL}`, CONTACT_EMAIL), '.');
    case 'offline':
      return show(errorBox, 'The server cannot be reached. Check your connection and try again.');
    default:
      return show(errorBox, `${message}.`);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks the fields before anything is sent; marks the first that is wrong. */
function check(): boolean {
  const email = $<HTMLInputElement>('#email');
  const password = $<HTMLInputElement>('#password');
  for (const input of [email, password]) input?.setAttribute('aria-invalid', 'false');
  if (email && !EMAIL.test(email.value.trim())) {
    email.setAttribute('aria-invalid', 'true');
    email.focus();
    show(errorBox, 'Enter a valid email address.');
    return false;
  }
  const minimum = Number(password?.getAttribute('minlength') ?? 1);
  if (password && password.value.length < minimum) {
    password.setAttribute('aria-invalid', 'true');
    password.focus();
    show(errorBox, minimum > 1 ? `The password needs at least ${minimum} characters.` : 'Enter your password.');
    return false;
  }
  return true;
}

let token = '';

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!check()) return;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  button.disabled = true;
  const email = $<HTMLInputElement>('#email')?.value.trim() ?? '';
  const password = $<HTMLInputElement>('#password')?.value ?? '';
  try {
    if (action === 'signup' || action === 'login') {
      await api('POST', `/api/auth/${action}`, { email, password });
      location.assign(next ?? '/app');
      return;
    }
    if (action === 'forgot') {
      await api('POST', '/api/auth/forgot', { email });
      form.hidden = true;
      show(okBox, `If ${email} has an account, a link to set a new password is on its way. It works for one hour; check your spam folder if it does not arrive.`);
      return;
    }
    if (action === 'reset') {
      const { account } = await api<{ account: { role: string } }>('POST', '/api/auth/reset', { token, password });
      location.assign(account.role === 'superadmin' && !next ? '/admin' : (next ?? '/app'));
      return;
    }
  } catch (err) {
    fail(err);
  }
  button.disabled = false;
});

/** Takes the one-time token out of the address bar (and the history) once it is read. */
function takeToken(): string {
  const value = params.get('token') ?? '';
  history.replaceState(null, '', location.pathname);
  return value;
}

if (action === 'reset') {
  token = takeToken();
  void api<ResetInfo>('GET', `/api/auth/reset?token=${encodeURIComponent(token)}`).then(
    (info) => {
      const who = $<HTMLElement>('#for')!;
      who.textContent =
        info.purpose === 'superadmin'
          ? `For ${info.email}. Setting it ${info.existing ? 'gives this account' : 'creates this account with'} the superadmin role.`
          : `For ${info.email}.`;
      who.hidden = false;
      $<HTMLInputElement>('#username')!.value = info.email;
      form!.hidden = false;
      $<HTMLInputElement>('#password')!.focus();
    },
    fail,
  );
}

if (action === 'verify') {
  token = takeToken();
  const working = $<HTMLElement>('#working')!;
  void api<VerifiedResponse>('POST', '/api/auth/verify', { token }).then(
    ({ email }) => {
      working.hidden = true;
      show(okBox, `${email} is confirmed. Thank you.`);
      $<HTMLElement>('#next')!.hidden = false;
    },
    (err) => {
      working.hidden = true;
      fail(err);
    },
  );
}
