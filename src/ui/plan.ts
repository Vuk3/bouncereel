import type { AccountResponse, Day } from '../../shared/api.ts';
import { LOOK_LABELS, LOOKS, MAX_VIDEO_SECONDS, soundAllowed, type Features } from '../../shared/features.ts';
import { api } from '../api.ts';

// What the pages behind the sign-in share about the account: the header's links that depend on
// it (the admin area for a superadmin), the banner asking to confirm the address, how something
// the plan does not include is marked, and what is left of the plan's day.

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** When the plan's next day starts (midnight UTC), in the viewer's own time: "at 20:00", or "tomorrow at 02:00". */
export function nextVideoAt(endsAt: string): string {
  const at = new Date(endsAt);
  return `${at.toDateString() === new Date().toDateString() ? '' : 'tomorrow '}at ${clock.format(at)}`;
}

/** The plan's daily allowance in a few words: "1 video left today", "Next video tomorrow at 02:00"; null without a limit. */
export function dayLine(day: Day): string | null {
  if (day.limit === null) return null;
  const left = Math.max(0, day.limit - day.used);
  if (left) return `${left} video${left === 1 ? '' : 's'} left today`;
  return day.endsAt ? `Next video ${nextVideoAt(day.endsAt)}` : 'No videos left today';
}

/**
 * A plan in a few words each, for the studio's plan card: what it makes, and what it leaves out
 * (`included` false). The pricing page says the same at length (describeFeatures).
 */
export function planChips(f: Features): { text: string; included: boolean }[] {
  const narrator = soundAllowed(f, 'narrator');
  const looks = f.looks.length === LOOKS.length ? 'Every look' : `${f.looks.map((l) => LOOK_LABELS[l]).join(' and ')} look${f.looks.length === 1 ? '' : 's'}`;
  return [
    { text: f.perDay === null ? 'Unlimited videos' : `${f.perDay} video${f.perDay === 1 ? '' : 's'} a day`, included: true },
    { text: `Up to ${f.maxSeconds} s`, included: true },
    { text: looks, included: true },
    { text: narrator ? 'Narrator' : 'No narrator', included: narrator },
    { text: f.powers ? 'Powers' : 'No powers', included: f.powers },
    { text: f.watermark ? 'With watermark' : 'No watermark', included: !f.watermark },
    { text: f.follow ? 'Follow button' : 'No follow button', included: f.follow },
    { text: f.library === null ? 'Every video kept' : `${f.library} video${f.library === 1 ? '' : 's'} kept`, included: true },
  ];
}

/** Whether a plan holds anything back: one that holds nothing back needs no plan card. */
export function planHoldsBack(f: Features): boolean {
  return f.perDay !== null || f.maxSeconds < MAX_VIDEO_SECONDS || f.looks.length < LOOKS.length || !soundAllowed(f, 'narrator') || !f.powers || f.watermark || !f.follow || f.library !== null;
}

/** A link to the pricing page, where the plans are compared: an invitation to look, not a demand. */
export function upgradeLink(text = 'See plans'): HTMLAnchorElement {
  return Object.assign(document.createElement('a'), { href: '/pricing', className: 'upgrade', textContent: text });
}

/** "X is not in your plan. See plans": under an option that stays visible but disabled. */
export function planNote(text: string): HTMLParagraphElement {
  const note = Object.assign(document.createElement('p'), { className: 'plan-note' });
  note.append(text, ' ', upgradeLink());
  return note;
}

/**
 * Under something the plan holds back, what upgrading brings ("Up to 90 s on the paid plans. See
 * plans"), in the accent, when `paid` says every paid plan has it; the plain note otherwise, so
 * the line is never more than the plans make true. Never a plan's name.
 */
export function planInvite(invite: string, paid: boolean, plain: string): HTMLParagraphElement {
  if (!paid) return planNote(plain);
  const note = Object.assign(document.createElement('p'), { className: 'plan-note invite' });
  note.append(invite, ' ', upgradeLink());
  return note;
}

/** The small tag on a control the plan holds back, which stays at full contrast. */
export function paidTag(paid: boolean): HTMLSpanElement {
  return Object.assign(document.createElement('span'), { className: 'paid-tag', textContent: paid ? 'Paid plans' : 'Not in your plan' });
}

/**
 * The header's account-dependent parts (`#admin-link` shows for a superadmin) and the banner that
 * asks to confirm the address (`#verify`) until it is confirmed.
 */
export function bindAccountChrome(account: AccountResponse): void {
  const admin = document.querySelector<HTMLElement>('#admin-link');
  if (admin) admin.hidden = account.account.role !== 'superadmin';
  const banner = document.querySelector<HTMLElement>('#verify');
  if (!banner || account.account.verified) return;
  const send = Object.assign(document.createElement('button'), { type: 'button', className: 'link-button', textContent: 'Send it again' });
  const text = document.createElement('span');
  text.append('Confirm your email: the link is in the mail we sent to ', Object.assign(document.createElement('strong'), { textContent: account.account.email }), '.');
  banner.replaceChildren(text, ' ', send);
  banner.hidden = false;
  send.addEventListener('click', async () => {
    send.disabled = true;
    try {
      await api('POST', '/api/account/verify');
      send.textContent = 'Sent: check your inbox';
    } catch (err) {
      send.textContent = err instanceof Error ? err.message : String(err);
      send.disabled = false;
    }
  });
}
