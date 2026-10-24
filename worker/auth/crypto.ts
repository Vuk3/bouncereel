// Password hashes and random tokens, on WebCrypto alone (ported from Hoops).
//
// Passwords are PBKDF2-SHA256 with a random salt per password. The iteration count is written
// into each hash, so it can be raised later while old hashes keep verifying with their own.
// 40,000 iterations take ~3.6 ms of CPU (measured: 60,000 take 5.3 ms, and workerd refuses more
// than 100,000). Hoops uses 60,000; BounceReel's password change checks the current password and
// hashes the new one in one request, and two hashes must stay inside the Workers Free plan's
// 10 ms of CPU, with the D1 queries around them.

const ITERATIONS = 40_000;
const MAX_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const SCHEME = 'pbkdf2_sha256';

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** A 256-bit random token, URL-safe: session cookies and one-time links. */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Hex SHA-256: the only form a token is stored in. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS));
}

/** "pbkdf2_sha256$40000$<salt>$<hash>" */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return [SCHEME, ITERATIONS, toBase64Url(salt), toBase64Url(await derive(password, salt, ITERATIONS))].join('$');
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsText, saltText, hashText] = stored.split('$');
  const iterations = Number(iterationsText);
  if (scheme !== SCHEME || !Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  const actual = await derive(password, fromBase64Url(saltText ?? ''), iterations);
  return constantTimeEqual(actual, fromBase64Url(hashText ?? ''));
}

/**
 * The hash of a random password nobody kept. A login for an unknown address is checked against
 * it, so a failed login takes as long whether the account exists or not.
 */
export const DUMMY_PASSWORD_HASH = 'pbkdf2_sha256$40000$KZe-xHAPmm8v1smBxTQEDw$MlMV7ps1Fx0fMNZ6VfkfUGuN5r3AoYLXIibzgY2Mqzc';
