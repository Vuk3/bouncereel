import type { SidesResponse } from '../../shared/api.ts';
import { serveFile } from '../files.ts';
import { json } from '../lib/http.ts';
import type { RouteContext } from './context.ts';

// Goal Rush's real crests and players' photos, the superadmin's alone (the owner's decision: real
// pictures in his own videos, none shipped to customers, docs/goal-rush.md §3). They are in the
// private bucket under sides/, put there from his computer by `npm run pictures -- upload`
// (scripts/pictures.ts), with sides/manifest.json saying which file is whose. Both routes are under
// /api/admin, so the router has checked the session and the superadmin role before they run:
// anyone else gets the 403 of the admin area, and the studio draws the kits.

/** GET /api/admin/sides: which club and player has a picture, and its file; an empty list before the first upload. */
export async function listSides(context: RouteContext): Promise<Response> {
  const object = await context.env.FILES.get('sides/manifest.json');
  const body: SidesResponse = { version: '', sides: {} };
  if (object) {
    const manifest = (await object.json()) as { version?: string; sides?: Record<string, { file?: unknown; kind?: unknown }> };
    body.version = String(manifest.version ?? '');
    // Only what the studio needs: the file and what it is. Where each came from stays in the manifest on the owner's computer.
    for (const [id, picture] of Object.entries(manifest.sides ?? {})) {
      if (typeof picture.file === 'string' && (picture.kind === 'crest' || picture.kind === 'photo')) body.sides[id] = { file: picture.file, kind: picture.kind };
    }
  }
  // The list changes with every upload: never kept by the browser, unlike the files it names.
  return json(body, 200, { 'Cache-Control': 'private, no-store' });
}

/** GET /api/admin/sides/:file: one picture; its name carries its content's hash, so a browser keeps it for good. */
export async function getSide(context: RouteContext): Promise<Response> {
  return serveFile(context.env, `sides/${context.params.file}`);
}
