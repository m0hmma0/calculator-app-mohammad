import type { Env } from './env';
import { json } from './http';

/**
 * Phase 18: rate limits, so a script or a page stuck in a loop gets a clear answer
 * instead of running the free plan's daily allowance down. Cloudflare's rate-limit
 * bindings (wrangler.toml) count per key within each location; they are loose
 * by design, which is fine for a guard rail.
 *
 * Keys are the caller's address. A whole class can share one school address, so the
 * general limit is generous (a class of 30 opening one board makes about 300
 * requests); the tight limits are for things that cost something each time.
 */
export type LimitKind = 'api' | 'heavy' | 'errors';

/** Requests that each fetch another site, create something, or send email-like events. */
export function limitKindFor(method: string, pathname: string): LimitKind {
  if (pathname === '/api/errors') return 'errors';
  if (pathname === '/api/unfurl') return 'heavy';
  if (method === 'POST' && /^\/api\/boards(\/[\w-]+\/(duplicate|transfer))?$/.test(pathname)) {
    return 'heavy';
  }
  if (method === 'POST' && /^\/api\/shares\/(board|folder)\/[\w-]+\/people$/.test(pathname)) {
    return 'heavy';
  }
  return 'api';
}

function bindingFor(env: Env, kind: LimitKind): RateLimit | undefined {
  return kind === 'errors' ? env.LIMIT_ERRORS : kind === 'heavy' ? env.LIMIT_HEAVY : env.LIMIT_API;
}

/** Who is counted: the caller's address (or, on the test backend only, a test's own key). */
function keyFor(request: Request, env: Env): string | null {
  if (env.RATE_LIMIT_TEST) {
    // Tests share one address; only a test that names its own key is counted.
    return request.headers.get('x-rate-key');
  }
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

export const TOO_MANY = 'Too many requests. Wait a minute, then try again.';

/** A 429 to send back if this request is over its limit; null if it may go ahead. */
export async function overLimit(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  const kind = limitKindFor(request.method.toUpperCase(), pathname);
  const binding = bindingFor(env, kind);
  const key = keyFor(request, env);
  if (!binding || !key) return null;
  const { success } = await binding.limit({ key: `${kind}:${key}` });
  if (success) return null;
  const response = json({ error: TOO_MANY }, 429);
  response.headers.set('retry-after', '60');
  return response;
}
