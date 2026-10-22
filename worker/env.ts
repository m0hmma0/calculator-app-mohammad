export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  /** One BoardRoom per board, addressed by the board's id. */
  ROOMS: DurableObjectNamespace;

  /** Firebase project the ID tokens must be issued for. */
  FIREBASE_PROJECT_ID: string;
  /** Set only by the test backend, whose preview page is served on localhost. */
  UNFURL_ALLOW_LOCAL?: string;
  /** Overridable only so tests can verify against their own key. */
  FIREBASE_JWKS_URL?: string;
}
