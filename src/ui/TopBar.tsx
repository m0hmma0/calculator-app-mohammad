import type { ReactNode } from 'react';
import { useBoardStore } from '@/state/boardStore';
import styles from './TopBar.module.css';

export interface TopBarProps {
  boardName: string;
  badge?: string;
  leading?: ReactNode;
  children?: ReactNode;
  onRenameBoard?: () => void;
  /** Many controls: drop the wordmark on narrower screens to make room. */
  compact?: boolean;
}

export function TopBar({
  boardName,
  badge,
  leading,
  children,
  onRenameBoard,
  compact,
}: TopBarProps) {
  const devPanelOpen = useBoardStore((state) => state.devPanelOpen);
  const toggleDevPanel = useBoardStore((state) => state.toggleDevPanel);

  return (
    <header className={compact ? `${styles.bar} ${styles.compact}` : styles.bar}>
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 17.5 15 6.5a2.2 2.2 0 0 1 3.1 3.1L7.1 20.6l-3.9.8.8-3.9Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className={styles.name}>Sabboura</span>
      </div>

      {leading}

      <span className={styles.divider} aria-hidden="true" />
      {onRenameBoard ? (
        <button
          type="button"
          className={styles.boardNameButton}
          onClick={onRenameBoard}
          title="Rename this board"
          data-testid="board-title"
        >
          {boardName}
        </button>
      ) : (
        <span className={styles.boardName} data-testid="board-title">
          {boardName}
        </span>
      )}

      <span className={styles.spacer} />
      {children}

      <button
        type="button"
        className={styles.ghost}
        onClick={toggleDevPanel}
        aria-pressed={devPanelOpen}
        title="Renderer stats and test content"
        data-testid="toggle-dev-panel"
      >
        Renderer
      </button>

      {badge ? <span className={styles.badge}>{badge}</span> : null}
    </header>
  );
}
