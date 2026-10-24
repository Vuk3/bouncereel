import { PLATFORMS, type NewVideo, type Platform, type RaceSide, type RaceSummary } from '../shared/api.ts';
import { HttpError } from './lib/http.ts';

// Request bodies and path parameters, checked before anything touches D1. Each failure is a
// 400 with `invalid_<field>`; the page never sends one, so a 400 means a bug or a hand-made
// request, and the message says which field.

/** A config is a few kilobytes; this leaves room for a long opening script. */
const MAX_CONFIG_BYTES = 64 * 1024;

function invalid(field: string, message: string): HttpError {
  return new HttpError(400, `invalid_${field.replace(/\W+/g, '_')}`, `${field} ${message}.`);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(field, `must be text of 1 to ${max} characters`);
  return value.trim();
}

function number(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid(field, `must be a number from ${min} to ${max}`);
  return value;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  const n = number(value, field, min, max);
  if (!Number.isInteger(n)) throw invalid(field, 'must be a whole number');
  return n;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(field, 'must be an object');
  return value as Record<string, unknown>;
}

function side(value: unknown, field: string): RaceSide {
  const o = object(value, field);
  return {
    name: text(o.name, `${field}.name`, 100),
    sequence: text(o.sequence, `${field}.sequence`, 40),
    special: text(o.special, `${field}.special`, 40),
  };
}

function race(value: unknown): RaceSummary {
  const o = object(value, 'race');
  if (o.winner !== 'a' && o.winner !== 'b' && o.winner !== null) throw invalid('race.winner', "must be 'a', 'b' or null");
  return {
    a: side(o.a, 'race.a'),
    b: side(o.b, 'race.b'),
    winner: o.winner,
    margin: o.margin === null ? null : number(o.margin, 'race.margin', 0, 100_000),
    leadChanges: integer(o.leadChanges, 'race.leadChanges', 0, 100_000),
  };
}

/** POST /api/videos */
export function parseNewVideo(body: Record<string, unknown>): NewVideo {
  if (body.game !== 'ball-race') throw invalid('game', "must be 'ball-race'");
  const recordedAt = text(body.recordedAt, 'recordedAt', 40);
  if (Number.isNaN(Date.parse(recordedAt))) throw invalid('recordedAt', 'must be an ISO 8601 time');
  if (typeof body.stoppedEarly !== 'boolean') throw invalid('stoppedEarly', 'must be true or false');
  const config = object(body.config, 'config');
  if (JSON.stringify(config).length > MAX_CONFIG_BYTES) throw invalid('config', `must be under ${MAX_CONFIG_BYTES / 1024} KB`);
  return {
    game: 'ball-race',
    recordedAt: new Date(recordedAt).toISOString(),
    title: text(body.title, 'title', 200),
    fileName: text(body.fileName, 'fileName', 300),
    format: text(body.format, 'format', 100),
    seconds: number(body.seconds, 'seconds', 0, 3600),
    stoppedEarly: body.stoppedEarly,
    videoLength: integer(body.videoLength, 'videoLength', 1, 3600),
    seed: text(body.seed, 'seed', 200),
    appVersion: text(body.appVersion, 'appVersion', 40),
    config,
    race: race(body.race),
  };
}

/** The `:id` of a route; the pattern already allows only digits. */
export function videoId(params: Record<string, string | undefined>): number {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw invalid('id', 'must be a video id');
  return id;
}

/** The `:platform` of a route. */
export function platformParam(params: Record<string, string | undefined>): Platform {
  const platform = PLATFORMS.find((p) => p === params.platform);
  if (!platform) throw new HttpError(404, 'not_found', `No platform called ${params.platform}: use ${PLATFORMS.join(', ')}.`);
  return platform;
}

// ── Accounts ────────────────────────────────────────────────────────────────

/** Something@something.something: the mail itself is the real check. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

export function emailValue(value: unknown): string {
  const email = typeof value === 'string' ? value.trim() : '';
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
  return email;
}

export function passwordValue(value: unknown): string {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD || value.length > MAX_PASSWORD) {
    throw new HttpError(400, 'invalid_password', `A password must be ${MIN_PASSWORD} to ${MAX_PASSWORD} characters long.`);
  }
  return value;
}

/** A one-time link's token, as randomToken() writes it; anything else is a link that does not work. */
export function tokenValue(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(value)) throw linkInvalid();
  return value;
}

export function linkInvalid(): HttpError {
  return new HttpError(404, 'link_invalid', 'This link is invalid, has expired or was already used.');
}

/** The `:id` of a route that names an account or a plan; the pattern allows only digits. */
export function idParam(params: Record<string, string | undefined>): number {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw invalid('id', 'must be an id');
  return id;
}
