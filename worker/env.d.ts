// Secrets are set with `npx wrangler secret put` and never appear in wrangler.jsonc, so
// `wrangler types` (worker-configuration.d.ts) does not know them. They are declared here,
// merged into the generated global Env. Locally they go in `.env`, never `.dev.vars`
// (docs/build-and-deploy.md).
interface Env {
  /**
   * Resend's API key, for the confirmation and password mails (worker/mail/resend.ts). Unset,
   * nothing is sent: on localhost the link goes to the log instead, so dev works without it;
   * in production the forgot form answers that mail is unavailable.
   */
  RESEND_API_KEY?: string;
}
