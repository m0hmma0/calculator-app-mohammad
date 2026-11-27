import { readSettings } from '@/auth/firebase';
import type { BrowserErrorReport } from '@shared/types';

/**
 * Phase 18: errors in someone's browser reach the Worker's log, which is Cloudflare's
 * dashboard (Workers & Pages → sabboura → Logs; search "browser-error"). Each report
 * names the build (`release`, the commit), so a minified stack can be read against
 * that build's source maps: `node scripts/symbolicate.mjs`.
 */

declare const __RELEASE__: string;
const RELEASE = typeof __RELEASE__ === 'string' ? __RELEASE__ : 'dev';

/** A page that loops on an error sends a handful, not thousands. */
const MAX_PER_PAGE = 8;
let sent = 0;
const seen = new Set<string>();

/** Noise that is not ours: extensions, cross-origin scripts, a benign browser warning. */
function isNoise(message: string, stack: string): boolean {
  return (
    message === 'Script error.' ||
    /ResizeObserver loop/.test(message) ||
    /(chrome|moz|safari(-web)?)-extension:\/\//.test(stack)
  );
}

function describe(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, stack: error.stack ?? '' };
  }
  return { message: String(error), stack: '' };
}

/** Sends one error to the Worker, if this build has one to send to. */
export function reportError(error: unknown, where: BrowserErrorReport['where']): void {
  // The published preview has no backend: nothing to send to.
  if (!readSettings()) return;
  const { message, stack } = describe(error);
  if (isNoise(message, stack)) return;
  const key = `${message}\n${stack.split('\n')[1] ?? ''}`;
  if (seen.has(key) || sent >= MAX_PER_PAGE) return;
  seen.add(key);
  sent += 1;

  const report: BrowserErrorReport = {
    message: message.slice(0, 1000),
    stack: stack.slice(0, 6000),
    where,
    release: RELEASE,
    path: location.pathname,
    userAgent: navigator.userAgent,
  };
  void fetch('/api/errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {
    // Offline, or the Worker is the thing that is broken: nothing more to do.
  });
}

let installed = false;

/** Reports uncaught errors and unhandled promise rejections from here on. */
export function installErrorReporting(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (event) => {
    reportError(event.error ?? new Error(event.message), 'window');
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'promise');
  });
}
