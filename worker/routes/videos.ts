import { PLATFORM_LABELS, type CreatedResponse, type NewVideo, type PostResponse, type VideoResponse, type VideosResponse } from '../../shared/api.ts';
import { SOUNDS, soundAllowed, type Features, type Look, type Sound } from '../../shared/features.ts';
import { parsePostLink } from '../../shared/links.ts';
import { HttpError, json, noContent, readJsonObject } from '../lib/http.ts';
import { entitlements } from '../plans.ts';
import { parseNewVideo, platformParam, videoId } from '../validate.ts';
import { deletePost, deleteVideo, insertVideo, postOwner, selectVideo, selectVideos, upsertPost, videoExists } from '../videos.ts';
import { signedIn, type RouteContext } from './context.ts';

// The video library, each account its own: every handler passes the signed-in account to the
// query, so another account's video is a 404 exactly like a missing one.

function noVideo(id: number): HttpError {
  return new HttpError(404, 'video_not_found', `There is no video ${id}.`);
}

function notInPlan(message: string): HttpError {
  return new HttpError(403, 'not_in_plan', message);
}

/**
 * The sound a recording was made with, from its config (`sound.track`). A config from before
 * the choice existed was recorded with the narrator, when it had one.
 */
function soundOf(video: NewVideo): Sound {
  const sound = (video.config.sound as { track?: unknown } | undefined)?.track;
  return SOUNDS.find((s) => s === sound) ?? 'narrator';
}

/**
 * What passes through the server is checked against the plan: the length the video was made
 * for, the sound it was recorded with, its look and its powers. The studio never sends one that
 * breaks them (it disables what the plan does not include); this is for a hand-made request or
 * a stale page.
 */
function checkPlan(video: NewVideo, features: Features): void {
  const config = video.config as { timing?: { video?: unknown }; look?: { skin?: unknown }; a?: Ball; b?: Ball };
  const length = config.timing?.video;
  if (video.videoLength > features.maxSeconds || (typeof length === 'number' && length > features.maxSeconds)) {
    throw notInPlan(`Your plan makes videos up to ${features.maxSeconds} s.`);
  }
  if (!soundAllowed(features, soundOf(video))) throw notInPlan('Your plan does not include that sound for a recording.');
  const skin = config.look?.skin;
  if (typeof skin === 'string' && !features.looks.includes(skin as Look)) throw notInPlan('Your plan does not include that look.');
  if (!features.powers && [config.a, config.b].some((ball) => ball?.special !== 'none' && Number(ball?.amount) > 0)) {
    throw notInPlan('Your plan does not include powers.');
  }
}

/** A ball as the config has it, as far as its power goes. */
interface Ball {
  special?: unknown;
  amount?: unknown;
}

export async function listVideos(context: RouteContext): Promise<Response> {
  const body: VideosResponse = { videos: await selectVideos(context.env.DB, signedIn(context).id) };
  return json(body);
}

export async function createVideo(context: RouteContext): Promise<Response> {
  const user = signedIn(context);
  const { env, request, now } = context;
  const video = parseNewVideo(await readJsonObject(request));
  const { features } = await entitlements(env.DB, user, now);
  checkPlan(video, features);
  // The day's video was taken when Record started (POST /api/account/day); a save only fills the
  // library, which has its own limit.
  const id = await insertVideo(env.DB, video, user.id, features.library);
  if (id === null) {
    throw new HttpError(403, 'library_full', `Your library is full: your plan keeps ${features.library} videos. Delete one on the Videos page, or upgrade.`);
  }
  const body: CreatedResponse = { id };
  return json(body, 201);
}

export async function getVideo(context: RouteContext): Promise<Response> {
  const id = videoId(context.params);
  const video = await selectVideo(context.env.DB, id, signedIn(context).id);
  if (!video) throw noVideo(id);
  const body: VideoResponse = { video };
  return json(body);
}

export async function removeVideo(context: RouteContext): Promise<Response> {
  const id = videoId(context.params);
  if (!(await deleteVideo(context.env.DB, id, signedIn(context).id))) throw noVideo(id);
  return noContent();
}

export async function putPost(context: RouteContext): Promise<Response> {
  const user = signedIn(context);
  const { request, env, params, now } = context;
  const id = videoId(params);
  const platform = platformParam(params);
  const { url } = await readJsonObject(request);
  const link = typeof url === 'string' ? parsePostLink(platform, url) : null;
  if (!link) throw new HttpError(400, 'invalid_url', `That is not a link to a post on ${PLATFORM_LABELS[platform]}.`);
  if (!(await videoExists(env.DB, id, user.id))) throw noVideo(id);
  const owner = link.externalId ? await postOwner(env.DB, user.id, platform, link.externalId) : null;
  if (owner !== null && owner !== id) {
    throw new HttpError(409, 'post_taken', `That ${PLATFORM_LABELS[platform]} post is already linked to video ${owner}.`);
  }
  const body: PostResponse = { post: await upsertPost(env.DB, id, user.id, platform, link, now) };
  return json(body);
}

export async function removePost(context: RouteContext): Promise<Response> {
  const id = videoId(context.params);
  const platform = platformParam(context.params);
  if (!(await deletePost(context.env.DB, id, signedIn(context).id, platform))) {
    throw new HttpError(404, 'post_not_found', `Video ${id} has no ${PLATFORM_LABELS[platform]} link.`);
  }
  return noContent();
}
