import type { AuthUser } from '../auth/session.ts';

export interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  url: URL;
  /** Named groups captured from the route pattern. */
  params: Record<string, string | undefined>;
  /** One time per request. */
  now: Date;
  /** The signed-in account: always set on a route behind the sign-in, null on a public one. */
  user: AuthUser | null;
}

export type RouteHandler = (context: RouteContext) => Promise<Response>;

/** The account on a route behind the sign-in, where the router has already required one. */
export function signedIn(context: RouteContext): AuthUser {
  if (!context.user) throw new Error(`${context.url.pathname} reached a handler without a session`);
  return context.user;
}
