import { randomToken } from './auth/crypto.ts';
import { HttpError, privateFile } from './lib/http.ts';
import { errorFields, log } from './lib/log.ts';

// Files that are not rows, in R2 (the FILES bucket, wrangler.jsonc): profile pictures under
// avatars/<account id>/<random name>. Nothing in the bucket is public: GET /api/avatars/… serves a
// picture to its own account and to a superadmin (routes/account.ts getAvatar).

/**
 * A picture as the account page makes it is 256 px square, a WebP or JPEG of 10–40 KB; Google's
 * at that size is about the same. 200 KB leaves room for a PNG from a browser that encodes
 * nothing smaller, and keeps an upload far from the Worker's limits.
 */
export const AVATAR_MAX_BYTES = 200_000;

const EXTENSIONS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' } as const;
type ImageType = keyof typeof EXTENSIONS;

/** The picture's address on the site, from its key: "avatars/12/k3….webp" → "/api/avatars/12/k3….webp". */
export function avatarUrl(key: string | null): string | null {
  return key ? `/api/${key}` : null;
}

/**
 * What the bytes are, from their first bytes rather than from what the request says: anything but
 * the three image types is refused, so nothing else can be stored and served back as one.
 */
function sniff(b: Uint8Array): ImageType | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((byte, j) => b[i + j] === byte);
  if (b.length > 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (b.length > 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (b.length > 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  return null;
}

/** Stores a picture for the account under a new name and answers its key; the caller drops the old one. */
export async function storeAvatar(env: Env, userId: number, bytes: Uint8Array): Promise<string> {
  if (bytes.length === 0) throw new HttpError(400, 'invalid_avatar', 'The picture is empty.');
  if (bytes.length > AVATAR_MAX_BYTES) throw new HttpError(413, 'avatar_too_large', 'The picture is too large: 200 KB at most.');
  const type = sniff(bytes);
  if (!type) throw new HttpError(415, 'invalid_avatar', 'The picture must be a WebP, JPEG or PNG image.');
  // 16 random characters: the name cannot be guessed, and a new picture is a new address.
  const key = `avatars/${userId}/${randomToken().slice(0, 16)}.${EXTENSIONS[type]}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  return key;
}

/** Removes a stored file; a key already gone, or none, is fine. */
export async function deleteFile(env: Env, key: string | null): Promise<void> {
  if (key) await env.FILES.delete(key);
}

/** A stored file as an answer, or 404 when it is not there (a picture replaced since the page loaded). */
export async function serveFile(env: Env, key: string): Promise<Response> {
  const object = await env.FILES.get(key);
  if (!object) throw new HttpError(404, 'not_found', 'No such file.');
  return privateFile(object.body, object.httpMetadata?.contentType ?? 'application/octet-stream', object.httpEtag);
}

/**
 * Copies the Google account's picture as the profile picture (Google sign-in, an account with
 * none). Only from Google's own picture host, at 256 px; anything that goes wrong leaves the
 * account without a picture rather than failing the sign-in.
 */
export async function importGoogleAvatar(env: Env, userId: number, picture: string): Promise<string | null> {
  try {
    const url = new URL(picture);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com')) return null;
    // Google's picture addresses end in their size, "=s96-c": ask for the size the page draws.
    url.pathname = url.pathname.replace(/=s\d+(-c)?$/, '=s256-c');
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return await storeAvatar(env, userId, bytes);
  } catch (err) {
    log('warn', 'Google picture not copied', { userId, ...errorFields(err) });
    return null;
  }
}
