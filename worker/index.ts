import { errorResponse, HttpError } from './lib/http.ts';
import { handlePage, isPage } from './pages.ts';
import { handleApi } from './router.ts';

export default {
  /**
   * Only what `run_worker_first` in wrangler.jsonc names reaches the Worker: /api/*, and the
   * pages whose answer depends on the session (worker/pages.ts). Every other page and file is
   * served by Workers Assets, with the headers in public/_headers.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(request, env, ctx, url);
    if (isPage(url)) {
      try {
        return await handlePage(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
        throw err;
      }
    }
    return errorResponse(404, 'not_found', 'Not found.');
  },
} satisfies ExportedHandler<Env>;
