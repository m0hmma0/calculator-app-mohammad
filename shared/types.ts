/** Types used by both the browser app and the Worker. Keep this file dependency-free. */

export interface HealthResponse {
  ok: true;
  service: 'sabboura';
  phase: number;
  time: string;
}

/** An error in someone's browser, sent to `POST /api/errors` (Phase 18). */
export interface BrowserErrorReport {
  message: string;
  stack: string;
  /** What caught it: an uncaught error, a rejected promise, or a screen that crashed. */
  where: 'window' | 'promise' | 'render';
  /** The build: the commit it was made from. */
  release: string;
  path: string;
  userAgent: string;
}

export interface ApiErrorResponse {
  error: string;
}
