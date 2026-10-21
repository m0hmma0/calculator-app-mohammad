import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

export interface FirebaseSettings {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

export function readSettings(): FirebaseSettings | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!apiKey || !authDomain || !projectId) return null;
  return { apiKey, authDomain, projectId };
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

/** Null when the app has not been given a Firebase project yet. */
export function getFirebaseAuth(): Auth | null {
  if (auth) return auth;
  const settings = readSettings();
  if (!settings) return null;

  app = initializeApp(settings);
  auth = getAuth(app);
  return auth;
}

export async function signInWithGoogle(): Promise<void> {
  const instance = getFirebaseAuth();
  if (!instance) throw new Error('Sign-in is not configured for this deployment');

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(instance, provider);
}

export async function signOutOfGoogle(): Promise<void> {
  const instance = getFirebaseAuth();
  if (instance) await signOut(instance);
}

export function watchUser(listener: (user: User | null) => void): () => void {
  const instance = getFirebaseAuth();
  if (!instance) {
    listener(null);
    return () => {};
  }
  return onAuthStateChanged(instance, listener);
}
