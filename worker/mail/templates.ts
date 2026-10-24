import { CONTACT_EMAIL, SITE_URL } from '../../shared/site.ts';

// The two mails the site sends: confirm your address (after sign-up, or again from the banner)
// and set a new password (forgot password, or the admin's "send a password reset").
//
// Email is HTML from 2005: tables for layout, every style inline. The look is the paper look of
// the videos: a white box in an ink frame on paper, an ink button. Light only, on purpose: Gmail's
// apps invert a light mail into a dark one for readers who want dark, and ignore a dark mail's
// own colours (Hoops learned this; see its worker/mail/invite.ts). Rubik where the client loads
// web fonts, Arial where not. The plain-text part says the same; spam filters weigh a mail
// without one.

const PAPER = '#ece0c7';
const BOX = '#fbf8f0';
const INK = '#1b1b2f';
const MUTED = '#5c5a6e';
const FONT = `Rubik, 'Helvetica Neue', Helvetica, Arial, sans-serif`;

const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Copy {
  subject: string;
  /** The line an inbox shows after the subject. */
  preview: string;
  heading: string;
  body: string[];
  button: string;
  validity: string;
  footer: string;
}

function render(copy: Copy, link: string): { subject: string; html: string; text: string } {
  const host = SITE_URL.replace('https://', '');
  const paragraphs = copy.body.map((p) => `<p style="margin:0 0 16px;">${esc(p)}</p>`).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};" bgcolor="${PAPER}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(copy.preview)}${'&#8204;&nbsp;'.repeat(50)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background:${PAPER};">
  <tr>
    <td align="center" style="padding:36px 12px 56px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="padding:0 4px 18px;font-family:${FONT};font-weight:900;font-size:26px;line-height:1;color:${INK};">BounceReel</td>
        </tr>
        <tr>
          <td bgcolor="${BOX}" style="background:${BOX};border:4px solid ${INK};border-radius:10px;padding:34px 36px 32px;font-family:${FONT};font-size:16px;line-height:1.6;color:${INK};">
            <h1 style="margin:0 0 18px;font-family:${FONT};font-weight:900;font-size:30px;line-height:1.1;color:${INK};">${esc(copy.heading)}</h1>
            ${paragraphs}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 14px;">
              <tr>
                <td bgcolor="${INK}" style="background:${INK};border-radius:10px;">
                  <a href="${esc(link)}" style="display:inline-block;padding:15px 26px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(copy.button)}</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 22px;font-size:14px;color:${MUTED};">${esc(copy.validity)}</p>
            <p style="margin:0 0 6px;font-size:13px;color:${MUTED};">If the button does not work, open this link:</p>
            <p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${esc(link)}" style="color:${INK};">${esc(link)}</a></p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:22px 20px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
            ${esc(copy.footer)}<br>
            Questions: <a href="mailto:${CONTACT_EMAIL}" style="color:${MUTED};">${CONTACT_EMAIL}</a> · <a href="${SITE_URL}" style="color:${MUTED};text-decoration:none;">${host}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
  const text = [copy.heading, '', ...copy.body.flatMap((p) => [p, '']), `${copy.button}: ${link}`, copy.validity, '', '--', copy.footer, `Questions: ${CONTACT_EMAIL}`, host].join('\n');
  return { subject: copy.subject, html, text };
}

export function verifyMail(email: string, link: string) {
  return render(
    {
      subject: 'Confirm your email for BounceReel',
      preview: 'One click and your account is confirmed.',
      heading: 'Confirm your email',
      body: [`You signed up for BounceReel with ${email}. Confirm it's your address, so a password reset can reach you.`],
      button: 'Confirm my email',
      validity: 'The link works for 7 days, and once.',
      footer: 'Did not sign up? Ignore this mail and nothing happens.',
    },
    link,
  );
}

export function resetMail(email: string, link: string) {
  return render(
    {
      subject: 'Set a new password for BounceReel',
      preview: 'The link works for one hour.',
      heading: 'Set a new password',
      body: [`Someone asked for a new password for the BounceReel account ${email}. Your current password works until you set a new one.`],
      button: 'Set a new password',
      validity: 'The link works for one hour, and once. Setting a new password signs you out everywhere else.',
      footer: 'Did not ask for this? Ignore this mail: your password stays as it is.',
    },
    link,
  );
}
