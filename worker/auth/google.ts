import { HttpError } from '../lib/http.ts';
import { toBase64Url } from './crypto.ts';

// Google sign-in, the server's half (OpenID Connect, the authorization code flow with PKCE): the
// address that sends a browser to Google, and the exchange of the code Google sends it back with
// for who the person is. The routes that use them are routes/auth.ts googleStart and
// googleCallback. No library: two fetches and WebCrypto.
//
// The ID token comes straight from Google's token endpoint over TLS, in answer to our own request
// with our secret, so its signature is not checked again (OpenID Connect Core §3.1.3.7 allows
// this); its issuer, audience and expiry are.

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** What BounceReel learns from Google about the person signing in. */
export interface GoogleProfile {
  /** Google's id for the account: stable, unlike the address. */
  sub: string;
  email: string;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  picture: string | null;
}

/** The PKCE pair: the verifier stays in our cookie, Google gets its SHA-256 (RFC 7636, S256). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Where to send the browser: Google's sign-in, asking for the address and the name only. */
export function authorizeUrl(env: Env, redirectUri: string, state: string, challenge: string): string {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // Always the account chooser: someone with two Google accounts picks the one they mean.
    prompt: 'select_account',
  }).toString();
  return url.href;
}

/** Trims a name Google gave to what the profile takes (routes/account.ts nameValue's 60). */
function name(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : null;
}

/** Trades the code for the ID token and reads it; throws when anything about it is off. */
export async function exchangeCode(env: Env, code: string, verifier: string, redirectUri: string, now: Date): Promise<GoogleProfile> {
  const secret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!secret) throw new HttpError(503, 'google_unavailable', 'Google sign-in is not configured (GOOGLE_CLIENT_SECRET).');
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new HttpError(502, 'google_failed', `Google answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  const payload = idToken?.split('.')[1];
  if (!payload) throw new HttpError(502, 'google_failed', 'Google sent no ID token.');
  // Base64url of UTF-8 JSON: decoded as bytes first, or "Cvetković" would come out as Latin-1.
  const bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const claims = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  if (!ISSUERS.has(String(claims.iss)) || claims.aud !== env.GOOGLE_CLIENT_ID || typeof claims.exp !== 'number' || claims.exp * 1000 < now.getTime()) {
    throw new HttpError(502, 'google_failed', 'The ID token is not for this site, or has expired.');
  }
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') throw new HttpError(502, 'google_failed', 'The ID token has no account or address.');
  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === true,
    firstName: name(claims.given_name),
    lastName: name(claims.family_name),
    picture: typeof claims.picture === 'string' ? claims.picture : null,
  };
}
