import { assertSameOrigin, requireSuperadmin, requireUser, type AuthUser } from './auth/session.ts';
import { HttpError, errorResponse } from './lib/http.ts';
import { errorFields, log } from './lib/log.ts';
import { siteOrigin } from './site.ts';
import { changePassword, deleteAccount, getAccount, logoutEverywhere, resendVerification, takeVideo } from './routes/account.ts';
import {
  archivePlan,
  createPlan,
  editPlan,
  getLog,
  getUser,
  listAdminPlans,
  listUsers,
  overview,
  putSubscription,
  removePlan,
  removeUser,
  reorderPlans,
  restorePlan,
  sendUserReset,
  suspendUser,
  unsuspendUser,
} from './routes/admin.ts';
import { forgot, login, logout, reset, resetInfo, signup, verify } from './routes/auth.ts';
import { checkout, portal, webhook } from './routes/billing.ts';
import type { RouteHandler } from './routes/context.ts';
import { listPlans } from './routes/plans.ts';
import { createVideo, getVideo, listVideos, putPost, removePost, removeVideo } from './routes/videos.ts';

interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  pattern: RegExp;
  handler: RouteHandler;
}

// Which routes need what is decided by the path, before any route is matched (handleApi), so a
// caller who is not allowed cannot learn which routes exist:
//
//   public      PUBLIC below: signing up and in, the links in mails, the plans, the webhook
//   signed in   everything else
//   superadmin  /api/admin/*
const ROUTES: Route[] = [
  { method: 'POST', pattern: /^\/api\/auth\/signup$/, handler: signup },
  { method: 'POST', pattern: /^\/api\/auth\/login$/, handler: login },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/, handler: logout },
  { method: 'POST', pattern: /^\/api\/auth\/forgot$/, handler: forgot },
  { method: 'GET', pattern: /^\/api\/auth\/reset$/, handler: resetInfo },
  { method: 'POST', pattern: /^\/api\/auth\/reset$/, handler: reset },
  { method: 'POST', pattern: /^\/api\/auth\/verify$/, handler: verify },
  { method: 'GET', pattern: /^\/api\/plans$/, handler: listPlans },
  { method: 'POST', pattern: /^\/api\/billing\/webhook$/, handler: webhook },

  { method: 'GET', pattern: /^\/api\/account$/, handler: getAccount },
  { method: 'DELETE', pattern: /^\/api\/account$/, handler: deleteAccount },
  { method: 'POST', pattern: /^\/api\/account\/day$/, handler: takeVideo },
  { method: 'POST', pattern: /^\/api\/account\/password$/, handler: changePassword },
  { method: 'POST', pattern: /^\/api\/account\/verify$/, handler: resendVerification },
  { method: 'POST', pattern: /^\/api\/account\/logout-everywhere$/, handler: logoutEverywhere },
  { method: 'POST', pattern: /^\/api\/billing\/checkout$/, handler: checkout },
  { method: 'POST', pattern: /^\/api\/billing\/portal$/, handler: portal },

  { method: 'GET', pattern: /^\/api\/videos$/, handler: listVideos },
  { method: 'POST', pattern: /^\/api\/videos$/, handler: createVideo },
  { method: 'GET', pattern: /^\/api\/videos\/(?<id>\d+)$/, handler: getVideo },
  { method: 'DELETE', pattern: /^\/api\/videos\/(?<id>\d+)$/, handler: removeVideo },
  { method: 'PUT', pattern: /^\/api\/videos\/(?<id>\d+)\/posts\/(?<platform>[a-z]+)$/, handler: putPost },
  { method: 'DELETE', pattern: /^\/api\/videos\/(?<id>\d+)\/posts\/(?<platform>[a-z]+)$/, handler: removePost },

  { method: 'GET', pattern: /^\/api\/admin\/overview$/, handler: overview },
  { method: 'GET', pattern: /^\/api\/admin\/users$/, handler: listUsers },
  { method: 'GET', pattern: /^\/api\/admin\/users\/(?<id>\d+)$/, handler: getUser },
  { method: 'DELETE', pattern: /^\/api\/admin\/users\/(?<id>\d+)$/, handler: removeUser },
  { method: 'PUT', pattern: /^\/api\/admin\/users\/(?<id>\d+)\/subscription$/, handler: putSubscription },
  { method: 'POST', pattern: /^\/api\/admin\/users\/(?<id>\d+)\/suspend$/, handler: suspendUser },
  { method: 'POST', pattern: /^\/api\/admin\/users\/(?<id>\d+)\/unsuspend$/, handler: unsuspendUser },
  { method: 'POST', pattern: /^\/api\/admin\/users\/(?<id>\d+)\/reset$/, handler: sendUserReset },
  { method: 'GET', pattern: /^\/api\/admin\/plans$/, handler: listAdminPlans },
  { method: 'POST', pattern: /^\/api\/admin\/plans$/, handler: createPlan },
  { method: 'POST', pattern: /^\/api\/admin\/plans\/order$/, handler: reorderPlans },
  { method: 'PUT', pattern: /^\/api\/admin\/plans\/(?<id>\d+)$/, handler: editPlan },
  { method: 'DELETE', pattern: /^\/api\/admin\/plans\/(?<id>\d+)$/, handler: removePlan },
  { method: 'POST', pattern: /^\/api\/admin\/plans\/(?<id>\d+)\/archive$/, handler: archivePlan },
  { method: 'POST', pattern: /^\/api\/admin\/plans\/(?<id>\d+)\/restore$/, handler: restorePlan },
  { method: 'GET', pattern: /^\/api\/admin\/log$/, handler: getLog },
];

/** The whole public API, as an explicit list: anything not on it needs a session. */
const PUBLIC = [/^\/api\/auth\/[a-z-]+$/, /^\/api\/plans$/, /^\/api\/billing\/webhook$/];
/** The payment provider's events come from its servers: no session, not this origin. Its signature is checked instead. */
const WEBHOOK = '/api/billing/webhook';

function isAdmin(pathname: string): boolean {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  try {
    const now = new Date();
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    // Fails closed: without SITE_URL in production, nothing is answered.
    siteOrigin(env, url);
    if (pathname !== WEBHOOK) assertSameOrigin(request, url);
    // The session, then the role, before route matching: probing for routes answers 401 or 403.
    let user: AuthUser | null = null;
    if (!PUBLIC.some((p) => p.test(pathname))) user = await requireUser(request, env.DB, now);
    if (isAdmin(pathname)) requireSuperadmin(user!);

    const matching = ROUTES.filter((r) => r.pattern.test(pathname));
    if (matching.length === 0) throw new HttpError(404, 'not_found', `No API route for ${pathname}.`);
    const route = matching.find((r) => r.method === request.method);
    if (!route) {
      const allowed = matching.map((r) => r.method).join(', ');
      throw new HttpError(405, 'method_not_allowed', `Use ${allowed} for ${pathname}.`, { Allow: allowed });
    }
    const params = route.pattern.exec(pathname)?.groups ?? {};
    return await route.handler({ request, env, ctx, url, params, now, user });
  } catch (err) {
    if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message, err.headers);
    log('error', 'Unhandled API error', { method: request.method, path: url.pathname, ...errorFields(err) });
    return errorResponse(500, 'internal_error', 'Unexpected server error.');
  }
}
