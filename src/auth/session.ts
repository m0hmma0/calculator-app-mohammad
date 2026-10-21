import { getFirebaseAuth } from './firebase';

/**
 * A token placed here is used instead of Firebase's. That grants nothing on its own:
 * the Worker verifies every token's signature against the issuer's published keys,
 * so a token it did not sign is refused whatever the browser believes. It exists so
 * the end-to-end tests can sign their own tokens with their own key and exercise the
 * real verification path rather than a bypass of it.
 */
const TEST_TOKEN_KEY = 'sabboura:test-token';

export function readTestToken(): string | null {
  try {
    return localStorage.getItem(TEST_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function currentIdToken(forceRefresh = false): Promise<string | null> {
  const injected = readTestToken();
  if (injected) return injected;

  const user = getFirebaseAuth()?.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}
