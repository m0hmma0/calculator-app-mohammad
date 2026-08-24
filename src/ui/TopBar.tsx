import { useBoardStore } from '@/state/boardStore';
import { ToolBar } from './ToolBar';
import styles from './TopBar.module.css';

export interface TopBarProps {
  boardName: string;
  badge?: string;
}

export function TopBar({ boardName, badge }: TopBarProps) {
  const devPanelOpen = useBoardStore((state) => state.devPanelOpen);
  const toggleDevPanel = useBoardStore((state) => state.toggleDevPanel);

  return (
    <header className={styles.bar}>
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

      <span className={styles.divider} aria-hidden="true" />
      <span className={styles.boardName}>{boardName}</span>

      <span className={styles.spacer} />

      <ToolBar />

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
