import type { BrowserErrorReport } from '@shared/types';
import { fail, json } from '../http';

const WHERE = new Set(['window', 'promise', 'render']);
const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : '';

/**
 * Phase 18: an error from someone's browser, written to the Worker's log, which is
 * the error dashboard (Cloudflare: Workers & Pages → sabboura → Logs, "browser-error").
 * Nothing is stored in D1: the log is free and kept for three days.
 */
export async function reportBrowserError(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > 16_384) return fail('Too large', 413);
  let body: Partial<BrowserErrorReport>;
  try {
    body = JSON.parse(raw) as Partial<BrowserErrorReport>;
  } catch {
    return fail('Unreadable report', 400);
  }
  const message = text(body.message, 1000);
  if (!message) return fail('No message', 400);
  console.error(
    JSON.stringify({
      kind: 'browser-error',
      message,
      stack: text(body.stack, 6000),
      where: WHERE.has(body.where as string) ? body.where : 'window',
      release: text(body.release, 40),
      path: text(body.path, 200),
      userAgent: text(body.userAgent, 300),
      country: (request as Request & { cf?: { country?: string } }).cf?.country ?? null,
    }),
  );
  return json({ ok: true });
}
