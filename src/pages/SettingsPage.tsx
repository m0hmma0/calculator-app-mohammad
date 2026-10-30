import { useEffect } from 'react';
import { Link } from '@/router/router';
import { SettingsPanel } from '@/ui/SettingsPanel';
import styles from '@/ui/Settings.module.css';

/** Settings on a page of their own, from the dashboard. */
export function SettingsPage() {
  useEffect(() => {
    document.title = 'Settings · Sabboura';
    return () => {
      document.title = 'Sabboura Whiteboard';
    };
  }, []);

  return (
    <main className={styles.page} data-testid="settings-page">
      <div className={styles.pageInner}>
        <header className={styles.pageHead}>
          <Link to={{ name: 'dashboard' }} className={styles.back} data-testid="settings-back">
            ← Boards
          </Link>
          <h1 className={styles.title}>Settings</h1>
        </header>
        <div className={styles.pageCard}>
          <SettingsPanel />
        </div>
      </div>
    </main>
  );
}
