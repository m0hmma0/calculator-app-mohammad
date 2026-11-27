import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from './report';
import styles from './ErrorBoundary.module.css';

interface State {
  failed: boolean;
}

/**
 * A screen that crashes shows this instead of a blank page, and is reported. The
 * board itself is safe: it is saved in this browser and in the room as it changes,
 * so reloading brings it back.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (info.componentStack) error.stack = `${error.stack ?? ''}\nIn:${info.componentStack}`;
    reportError(error, 'render');
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.screen} role="alert" data-testid="crash-screen">
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.text}>
          Your work is saved. Reloading the page usually puts things right, and the problem has been
          reported.
        </p>
        <button type="button" className={styles.button} onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
