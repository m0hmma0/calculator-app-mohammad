import type { ReactNode } from 'react';
import styles from './TopBar.module.css';

export interface TopBarProps {
  boardName: string;
  badge?: string;
  leading?: ReactNode;
  children?: ReactNode;
  onRenameBoard?: () => void;
}

export function TopBar({ boardName, badge, leading, children, onRenameBoard }: TopBarProps) {
  return (
    <header className={styles.bar}>
      {leading}
      {leading ? <span className={styles.divider} aria-hidden="true" /> : null}
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

      {badge ? <span className={styles.badge}>{badge}</span> : null}
    </header>
  );
}
