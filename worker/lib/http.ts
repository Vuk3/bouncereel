import type { ApiErrorBody } from '../../shared/api.ts';

/** An error that maps directly to an HTTP response with a JSON error body. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: HeadersInit | undefined;

  constructor(status: number, code: string, message: string, headers?: HeadersInit) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/**
 * The headers every API answer carries. public/_headers covers the pages and their files
 * but never a Worker's response, so noindex is repeated here.
 */
function apiHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  // Live data: never let browsers or intermediaries serve a stale copy.
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return headers;
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = apiHeaders(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { status, headers });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

export function errorResponse(status: number, code: string, message: string, headers?: HeadersInit): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return json(body, status, headers);
}

/** Reads a required JSON object body. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get('Content-Type') ?? '';
  if (type.toLowerCase().split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', 'Request body must be application/json.');
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}
