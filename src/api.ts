import type { ApiErrorBody } from '../shared/api.ts';

// The pages' one way to the Worker's /api (worker/router.ts). Errors come back as ApiError
// with the API's code, or one of two of its own: offline, not_json.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'offline', 'The server cannot be reached');
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = response.headers.get('Content-Type')?.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiError(response.status, error?.code ?? 'http_error', error?.message.replace(/\.$/, '') ?? `The server answered ${response.status}`);
  }
  if (data === null) throw new ApiError(response.status, 'not_json', 'The server answered with something other than JSON');
  return data as T;
}
