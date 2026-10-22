export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  /** One BoardRoom per board, addressed by the board's id. */
  ROOMS: DurableObjectNamespace;

  /** Firebase project the ID tokens must be issued for. */
  FIREBASE_PROJECT_ID: string;
  /** Overridable only so tests can verify against their own key. */
  FIREBASE_JWKS_URL?: string;
}
