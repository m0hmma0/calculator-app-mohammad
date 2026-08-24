import type { ApiErrorResponse, HealthResponse } from '@shared/types';

export interface Env {
  ASSETS: Fetcher;
  // Phase 5  DB: D1Database
  // Phase 6  IMAGES: R2Bucket
  // Phase 7  BOARD_ROOM: DurableObjectNamespace
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

function handleApi(pathname: string): Response {
  if (pathname === '/api/health') {
    const body: HealthResponse = {
      ok: true,
      service: 'sabboura',
      phase: 0,
      time: new Date().toISOString(),
    };
    return json(body);
  }

  const error: ApiErrorResponse = { error: `No route for ${pathname}` };
  return json(error, 404);
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(url.pathname);
    }

    // Everything else is a static asset. Unknown paths fall back to index.html so
    // client-side routes like /b/:boardId work on a cold load (Phase 5 onwards).
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
