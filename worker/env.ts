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
  /** How long a silent window counts as present; shortened only by the test backend. */
  PEER_STALE_MS?: string;

  /** Rate limits (Phase 18; wrangler.toml). Absent in a deployment without them. */
  LIMIT_API?: RateLimit;
  LIMIT_HEAVY?: RateLimit;
  LIMIT_ERRORS?: RateLimit;
  /** The address pages are served at; a visit to a workers.dev address is sent here. */
  CANONICAL_HOST?: string;
  /** Test backend only: count just the requests that carry an `x-rate-key`. */
  RATE_LIMIT_TEST?: string;
}
