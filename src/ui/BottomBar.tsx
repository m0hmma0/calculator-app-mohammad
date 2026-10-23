import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { toggleBottomBar, toggleMinimap, togglePane, useUiPrefs } from '@/state/uiPrefs';
import { PageBar } from './PageBar';
import { ZoomControls } from './ZoomControls';
import styles from './BottomBar.module.css';

/**
 * Everything about the view, in one bar: pages, the side panel, the minimap, and
 * zoom. It folds down to a single button for a clear board, and remembers which.
 */
export function BottomBar() {
  const expanded = useUiPrefs((state) => state.bottomBar);
  const pane = useUiPrefs((state) => state.pane);
  const minimap = useUiPrefs((state) => state.minimap);
  const editable = useBoardAccess(selectCanEdit);

  return (
    <div className={styles.bar} data-testid="bottom-bar" data-expanded={expanded || undefined}>
      <button
        type="button"
        className={styles.button}
        aria-expanded={expanded}
        aria-label={expanded ? 'Fold the bar away' : 'Show pages and view controls'}
        title={expanded ? 'Fold the bar away' : 'Show pages and view controls'}
        data-testid="bottom-bar-toggle"
        onClick={toggleBottomBar}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d={expanded ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {expanded ? (
        <>
          <PageBar embedded />
          <span className={styles.separator} aria-hidden="true" />
          {editable ? (
            <button
              type="button"
              className={styles.button}
              aria-pressed={pane}
              aria-label={pane ? 'Close the side panel' : 'Open the side panel'}
              title={pane ? 'Close the side panel' : 'Open the side panel (style and arrange)'}
              data-testid="toggle-pane"
              onClick={togglePane}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M2.5 3h11v10h-11zM10 3v10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className={styles.button}
            aria-pressed={minimap}
            aria-label={minimap ? 'Hide the minimap (M)' : 'Show the minimap (M)'}
            title={minimap ? 'Hide the minimap — M' : 'Show the minimap — M'}
            data-testid="bottom-minimap"
            onClick={toggleMinimap}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M2.5 3.5h11v9h-11zM8.5 8h3.5v3h-3.5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className={styles.separator} aria-hidden="true" />
          <ZoomControls embedded />
        </>
      ) : null}
    </div>
  );
}
