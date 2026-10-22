import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from './env';

export interface Account {
  uid: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Google's keys rotate, so the set is cached per URL rather than per request. */
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySetFor(url: string) {
  let set = keySets.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url));
    keySets.set(url, set);
  }
  return set;
}

const DEFAULT_JWKS =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/**
 * Verifies a Firebase ID token properly: RS256 against Google's published keys, with
 * the audience and issuer pinned to this project. The JWKS URL is configurable only
 * so tests can point it at their own key — the verification path is identical, so
 * what the tests exercise is what production runs. A token signed by anyone else
 * fails here regardless of what it claims.
 */
export async function verifyIdToken(token: string, env: Env): Promise<Account> {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new AuthError('Server is not configured for sign-in');

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, keySetFor(env.FIREBASE_JWKS_URL || DEFAULT_JWKS), {
      audience: projectId,
      issuer: `https://securetoken.google.com/${projectId}`,
      algorithms: ['RS256'],
    });
    payload = result.payload;
  } catch (error) {
    throw new AuthError(`Could not verify sign-in: ${(error as Error).message}`);
  }

  const uid = typeof payload.sub === 'string' ? payload.sub : '';
  if (!uid) throw new AuthError('Sign-in token has no subject');

  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!email) throw new AuthError('Sign-in token has no email address');

  return {
    uid,
    email,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}

export function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

export async function requireAccount(request: Request, env: Env): Promise<Account> {
  const token = bearerFrom(request);
  if (!token) throw new AuthError('Not signed in');
  return verifyIdToken(token, env);
}

/**
 * For routes a guest may use — someone holding a share link but no account. No
 * token means a guest; a token that does not verify is still refused, rather than
 * quietly treated as a guest.
 */
export async function optionalAccount(request: Request, env: Env): Promise<Account | null> {
  const token = bearerFrom(request);
  if (!token) return null;
  return verifyIdToken(token, env);
}

/** The share link presented with a request, if any. */
export function shareKeyFrom(request: Request): string | null {
  const key = request.headers.get('x-share-key')?.trim();
  return key && /^[\w-]{16,64}$/.test(key) ? key : null;
}
