import type { AccountResponse, AvatarResponse, ProfileBody } from '../shared/api.ts';
import { describeFeatures } from '../shared/features.ts';
import { api, ApiError } from './api.ts';
import { forgetAccount, loadAccount, logout } from './session.ts';
import { avatar } from './ui/avatar.ts';
import { bindAccountChrome, dayLine, paintAccountLinks } from './ui/plan.ts';
import { bindThemeToggle } from './ui/theme.ts';

// The account page (/account): the profile (names and a picture), the plan, how much of its day
// and its library is used, what it includes, the way to billing (waiting for a payment provider),
// the password, signing out (here or everywhere), deleting the account. The look is
// src/console.css (and the crop dialog's, src/style.css).

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

// ── The profile ───────────────────────────────────────────────────────────

/** The size the picture is kept at: the largest circle a page draws is 104 px, so 2× and more. */
const PHOTO_SIZE = 256;
/** The crop's canvas in its own pixels: shown at about half that, sharp on a 2× screen. */
const STAGE = 640;
/** Refused before decoding: a phone's photo is 3 to 12 MB, and decoding a huge one stalls the tab. */
const MAX_FILE_BYTES = 25_000_000;

function renderProfile(a: AccountResponse): void {
  const picture = avatar(a.account, 'xl');
  picture.id = 'profile-avatar';
  $('#profile-avatar').replaceWith(picture);
  $('#photo-remove').hidden = !a.account.avatarUrl;
  $('#profile-google').hidden = !a.account.google;
}

/** WebP where the browser can write it (the smallest), else JPEG: Safari answers PNG for a type it cannot write. */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await blob('image/webp', 0.86);
  if (webp?.type === 'image/webp') return webp;
  const jpeg = await blob('image/jpeg', 0.9);
  if (!jpeg) throw new Error('The picture could not be made');
  return jpeg;
}

/**
 * The photo in the crop dialog: it covers the square at zoom 1 and never less, is dragged with a
 * pointer (a mouse or a finger) and zoomed with the slider or the wheel about the circle's
 * centre. Saving draws the same view at PHOTO_SIZE. Answers the picture, or null when cancelled.
 */
function cropPhoto(image: ImageBitmap): Promise<Blob | null> {
  const dialog = $<HTMLDialogElement>('#crop');
  const stage = $('#crop-stage');
  const canvas = $<HTMLCanvasElement>('#crop-canvas');
  const zoomInput = $<HTMLInputElement>('#crop-zoom');
  const ctx = canvas.getContext('2d')!;
  const cover = Math.max(STAGE / image.width, STAGE / image.height);
  let zoom = 1;
  let cx = STAGE / 2;
  let cy = STAGE / 2;
  const size = () => ({ w: image.width * cover * zoom, h: image.height * cover * zoom });
  // The photo's edges never come inside the square, whatever the drag or the zoom.
  const clamp = () => {
    const { w, h } = size();
    cx = Math.min(w / 2, Math.max(STAGE - w / 2, cx));
    cy = Math.min(h / 2, Math.max(STAGE - h / 2, cy));
  };
  const paint = (target: CanvasRenderingContext2D, scale: number) => {
    const { w, h } = size();
    target.drawImage(image, (cx - w / 2) * scale, (cy - h / 2) * scale, w * scale, h * scale);
  };
  const draw = () => {
    ctx.clearRect(0, 0, STAGE, STAGE);
    paint(ctx, 1);
    // Outside the circle dimmed: what the pages show reads at once (the corners are kept, never shown).
    const r = STAGE / 2 - 4;
    ctx.save();
    ctx.fillStyle = 'rgb(10 12 20 / 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, STAGE, STAGE);
    ctx.arc(STAGE / 2, STAGE / 2, r, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgb(255 255 255 / 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(STAGE / 2, STAGE / 2, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };
  const zoomTo = (next: number) => {
    const z = Math.min(4, Math.max(1, next));
    cx = STAGE / 2 + ((cx - STAGE / 2) * z) / zoom;
    cy = STAGE / 2 + ((cy - STAGE / 2) * z) / zoom;
    zoom = z;
    zoomInput.value = String(z);
    clamp();
    draw();
  };

  const listening = new AbortController();
  const signal = listening.signal;
  let drag: { x: number; y: number; id: number } | null = null;
  const toStage = (px: number) => (px * STAGE) / stage.getBoundingClientRect().width;
  stage.addEventListener(
    'pointerdown',
    (e) => {
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
    },
    { signal },
  );
  stage.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      cx += toStage(e.clientX - drag.x);
      cy += toStage(e.clientY - drag.y);
      drag.x = e.clientX;
      drag.y = e.clientY;
      clamp();
      draw();
    },
    { signal },
  );
  const release = () => {
    drag = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', release, { signal });
  stage.addEventListener('pointercancel', release, { signal });
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomTo(zoom * Math.exp(-e.deltaY / 500));
    },
    { signal, passive: false },
  );
  zoomInput.addEventListener('input', () => zoomTo(Number(zoomInput.value)), { signal });

  zoomInput.value = '1';
  draw();
  dialog.showModal();
  return new Promise((resolve) => {
    const finish = (picture: Blob | null) => {
      listening.abort();
      dialog.close();
      image.close();
      resolve(picture);
    };
    $('#crop-cancel').addEventListener('click', () => finish(null), { signal });
    // Escape closes the dialog: the same as Cancel.
    dialog.addEventListener('cancel', (e) => (e.preventDefault(), finish(null)), { signal });
    $('#crop-save').addEventListener(
      'click',
      async () => {
        const out = Object.assign(document.createElement('canvas'), { width: PHOTO_SIZE, height: PHOTO_SIZE });
        const o = out.getContext('2d')!;
        o.imageSmoothingQuality = 'high';
        // White under a transparent PNG: a JPEG has no transparency and would turn it black.
        o.fillStyle = '#ffffff';
        o.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
        paint(o, PHOTO_SIZE / STAGE);
        try {
          finish(await encode(out));
        } catch (err) {
          flash(errorText(err));
        }
      },
      { signal },
    );
  });
}

function bindProfile(a: AccountResponse): void {
  renderProfile(a);
  const form = $<HTMLFormElement>('#profile-form');
  ($<HTMLInputElement>('#profile-form [name="firstName"]')).value = a.account.firstName ?? '';
  ($<HTMLInputElement>('#profile-form [name="lastName"]')).value = a.account.lastName ?? '';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const body: ProfileBody = { firstName: String(data.get('firstName') ?? ''), lastName: String(data.get('lastName') ?? '') };
    try {
      const saved = await api<Required<ProfileBody>>('PUT', '/api/account/profile', body);
      a.account.firstName = saved.firstName;
      a.account.lastName = saved.lastName;
      renderProfile(a);
      paintAccountLinks(a);
      flash('Profile saved.');
    } catch (err) {
      flash(errorText(err));
    }
  });

  const file = $<HTMLInputElement>('#photo-file');
  $('#photo-choose').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    file.value = '';
    if (!chosen) return;
    if (chosen.size > MAX_FILE_BYTES) return flash('That photo is too large to open here: 25 MB at most.');
    const image = await createImageBitmap(chosen).catch(() => null);
    if (!image) return flash('That file could not be opened as a picture. Try a JPEG, PNG or WebP.');
    const picture = await cropPhoto(image);
    if (!picture) return;
    try {
      const { avatarUrl } = await api<AvatarResponse>('PUT', '/api/account/avatar', picture);
      a.account.avatarUrl = avatarUrl;
      renderProfile(a);
      paintAccountLinks(a);
      flash('Photo saved.');
    } catch (err) {
      flash(errorText(err));
    }
  });
  $('#photo-remove').addEventListener('click', async () => {
    if (!confirm('Remove your photo? Your initials show in its place.')) return;
    try {
      const { avatarUrl } = await api<AvatarResponse>('DELETE', '/api/account/avatar');
      a.account.avatarUrl = avatarUrl;
      renderProfile(a);
      paintAccountLinks(a);
      flash('Photo removed.');
    } catch (err) {
      flash(errorText(err));
    }
  });
}

function bind(a: AccountResponse): void {
  const id = a.account.id;
  $('#who').textContent = a.account.email;
  $<HTMLInputElement>('#username').value = a.account.email;
  bindAccountChrome(a);
  bindProfile(a);
  renderPlan(a);

  // An account made with Google has no password: the mail that sets one, instead of the form.
  if (!a.account.hasPassword) {
    $('#password-form').hidden = true;
    $('#password-none').hidden = false;
    $('#password-mail').addEventListener('click', async () => {
      try {
        await api('POST', '/api/auth/forgot', { email: a.account.email });
        flash(`A link to set a password is on its way to ${a.account.email}. It works for one hour.`);
      } catch (err) {
        flash(errorText(err));
      }
    });
  }

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
  // Without a password, the address typed out confirms instead.
  if (!a.account.hasPassword) {
    const input = deleteForm.querySelector('input')!;
    Object.assign(input, { type: 'email', name: 'confirm', autocomplete: 'off', placeholder: a.account.email });
    deleteForm.querySelector('.field > span')!.textContent = 'Your email address, to confirm';
  }
  deleteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(deleteForm);
    const body = a.account.hasPassword ? { password: String(data.get('password') ?? '') } : { confirm: String(data.get('confirm') ?? '') };
    if (!(body.password ?? body.confirm)) return flash(a.account.hasPassword ? 'Enter your password to confirm.' : 'Type your email address to confirm.');
    if (!confirm(`Delete ${a.account.email} and every video in its library? This cannot be undone.`)) return;
    try {
      await api('DELETE', '/api/account', body);
      forgetAccount(id);
      location.assign('/');
    } catch (err) {
      flash(err instanceof ApiError && err.code === 'last_superadmin' ? 'The last superadmin cannot delete the account: make another superadmin first (npm run admin).' : errorText(err));
    }
  });
}

bindThemeToggle($('#theme'));
void loadAccount().then(bind);
