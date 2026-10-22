import { useState } from 'react';
import { readSettings, signInWithGoogle } from '@/auth/firebase';
import styles from './SignIn.module.css';

/** `message` says why sign-in is needed here — a share link that wants an account. */
export function SignIn({ message }: { message?: string | null } = {}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const configured = readSettings() !== null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Sign-in failed';
      // A popup the person closed themselves is not worth an error message.
      setError(/popup-closed|cancelled-popup/i.test(message) ? null : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.page} data-testid="sign-in">
      <div className={styles.card}>
        <span className={styles.mark} aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 17.5 15 6.5a2.2 2.2 0 0 1 3.1 3.1L7.1 20.6l-3.9.8.8-3.9Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>

        <h1 className={styles.title}>Sabboura</h1>
        <p className={styles.blurb} data-testid="sign-in-message">
          {message ??
            'A collaborative whiteboard. Sign in to keep your boards and reach them from anywhere.'}
        </p>

        {configured ? (
          <button
            type="button"
            className={styles.google}
            onClick={start}
            disabled={busy}
            data-testid="sign-in-google"
          >
            <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l6.9 5.3c4.1-3.8 6.6-9.4 6.6-15.6Z"
              />
              <path
                fill="#34A853"
                d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46Z"
              />
              <path
                fill="#FBBC05"
                d="M11.5 28.4a13.5 13.5 0 0 1 0-8.7l-7.1-5.5a22 22 0 0 0 0 19.8l7.1-5.6Z"
              />
              <path
                fill="#EA4335"
                d="M24 9.5c3.3 0 5.5 1.4 6.8 2.6l6-5.9C33 2.6 29.9 1 24 1 15.4 1 8.1 5.9 4.4 13.2l7.1 5.5C13.3 13.4 18.2 9.5 24 9.5Z"
              />
            </svg>
            {busy ? 'Opening Google…' : 'Sign in with Google'}
          </button>
        ) : (
          <p className={styles.unconfigured} data-testid="sign-in-unconfigured">
            This deployment has no Firebase project yet, so sign-in is unavailable. Set{' '}
            <code>VITE_FIREBASE_API_KEY</code>, <code>VITE_FIREBASE_AUTH_DOMAIN</code> and{' '}
            <code>VITE_FIREBASE_PROJECT_ID</code>, then rebuild.
          </p>
        )}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
