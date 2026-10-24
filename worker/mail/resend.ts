import type { MailResult } from '../../shared/api.ts';
import { CONTACT_EMAIL } from '../../shared/site.ts';
import { errorFields, log } from '../lib/log.ts';
import { isLocal } from '../site.ts';

// Mail through Resend's HTTP API (POST https://api.resend.com/emails): one fetch, no SDK, as in
// Hoops. The key is the Worker secret RESEND_API_KEY; the sender's domain must be verified in
// Resend first.

/** The sender, on vukcvetkovic.com, which is verified in Resend already (Hoops sends from it). */
export const MAIL_FROM = 'BounceReel <bouncereel@vukcvetkovic.com>';

/** Long enough for a slow answer, short enough that a sign-up does not hang on it. */
const TIMEOUT_MS = 8000;

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Names the mail in the log and keys it at Resend, so a retried request does not send it twice. */
  ref: string;
  /** The one-time link inside: logged instead of sent when there is no key, and only locally. */
  link: string;
}

/**
 * Sends a mail, or says why not. Never throws: a mail that fails leaves the account and its
 * link standing (the page offers to send it again).
 *
 * Without RESEND_API_KEY nothing is sent. On localhost the link goes to the log instead, so a
 * sign-up or a reset can be finished in dev; anywhere else it never does: a link is a
 * password, and Workers Logs are not the place for one.
 */
export async function deliver(env: Env, url: URL, mail: Mail): Promise<MailResult> {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) {
    if (isLocal(url)) log('info', 'Mail is off (no RESEND_API_KEY); the link it would carry', { ref: mail.ref, to: mail.to, link: mail.link });
    else log('warn', 'Mail is off (no RESEND_API_KEY)', { ref: mail.ref });
    return 'off';
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BounceReel',
        'Idempotency-Key': mail.ref,
      },
      body: JSON.stringify({ from: MAIL_FROM, to: [mail.to], reply_to: CONTACT_EMAIL, subject: mail.subject, html: mail.html, text: mail.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      log('info', 'Mail sent', { ref: mail.ref });
      return 'sent';
    }
    // Resend answers { statusCode, name, message }: an unverified domain, a wrong key, the free
    // plan's daily cap. Never the address or the link in the log.
    log('warn', 'Mail not sent', { ref: mail.ref, status: res.status, detail: (await res.text()).slice(0, 300) });
    return 'failed';
  } catch (err) {
    log('warn', 'Mail not sent', { ref: mail.ref, ...errorFields(err) });
    return 'failed';
  }
}
