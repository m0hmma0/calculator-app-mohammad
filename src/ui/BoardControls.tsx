import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { selectCanEdit, selectIsOwner, useBoardAccess } from '@/sharing/boardAccess';
import { toggleMinimap, togglePane, useUiPrefs } from '@/state/uiPrefs';
import { InsertMenu } from './InsertMenu';
import { PageBar } from './PageBar';
import { ToolBar } from './ToolBar';
import { ToolsMenu } from './ToolsMenu';
import { ZoomControls } from './ZoomControls';
import styles from './BoardControls.module.css';

export interface BoardControlsProps {
  boardName: string;
  /** The person's role on someone else's board, shown beside the name. */
  badge?: string;
  /** The way back to the boards, when there is one. */
  leading?: ReactNode;
  /** Who is here, and presenting — on a board with a room. */
  people?: ReactNode;
  /** Sharing, for the owner. */
  share?: ReactNode;
  /** A line about the board itself (the signed-out board's "saved here only"). */
  notice?: ReactNode;
  onRenameBoard?: () => void;
}

/** Buttons get smaller in these steps until a phone's controls fit in two rows. */
const SQUEEZE_STEPS = 3;

/**
 * Every control for the board in one place. On a wide screen it is a pane down the
 * right-hand side; on a tall one — a tablet held upright, a phone — a bar along the
 * top, two rows at most on a phone. Nothing sits at the bottom of the board. Which
 * of the two is decided by the stylesheet, from the screen's shape.
 */
export function BoardControls({
  boardName,
  badge,
  leading,
  people,
  share,
  notice,
  onRenameBoard,
}: BoardControlsProps) {
  const editable = useBoardAccess(selectCanEdit);
  const ref = useRef<HTMLElement | null>(null);
  useSqueezeToTwoRows(ref);

  return (
    <header className={styles.controls} ref={ref} data-testid="controls">
      <div className={styles.head}>
        {leading}
        {onRenameBoard ? (
          <button
            type="button"
            className={styles.name}
            onClick={onRenameBoard}
            title={`${boardName} — rename this board`}
            data-testid="board-title"
          >
            {boardName}
          </button>
        ) : (
          <span className={styles.name} title={boardName} data-testid="board-title">
            {boardName}
          </span>
        )}
        {badge ? <span className={styles.badge}>{badge}</span> : null}
      </div>

      <ToolBar />

      {editable ? (
        <div className={styles.menus}>
          <InsertMenu />
          <ToolsMenu />
        </div>
      ) : null}

      {people || share ? (
        <div className={styles.people}>
          {people}
          {share}
        </div>
      ) : null}

      <ViewControls />

      {notice ? <p className={styles.notice}>{notice}</p> : null}
    </header>
  );
}

/** The board and its controls: the controls above it, or beside it on a wide screen. */
export function BoardShell({ children }: { children: ReactNode }) {
  return <div className={styles.shell}>{children}</div>;
}

/** Pages, the side panel, the minimap, full screen and zoom. */
function ViewControls() {
  const pane = useUiPrefs((state) => state.pane);
  const minimap = useUiPrefs((state) => state.minimap);
  const editable = useBoardAccess(selectCanEdit);
  const owner = useBoardAccess(selectIsOwner);

  return (
    <div className={styles.view} role="group" aria-label="View">
      <PageBar embedded />
      <div className={styles.viewButtons}>
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
        {owner ? (
          <button
            type="button"
            className={styles.button}
            aria-pressed={minimap}
            aria-label={minimap ? 'Hide the minimap (M)' : 'Show the minimap (M)'}
            title={minimap ? 'Hide the minimap — M' : 'Show the minimap — M'}
            data-testid="view-minimap"
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
        ) : null}
        <FullScreenButton />
      </div>
      <ZoomControls embedded />
    </div>
  );
}

/** The board fills the whole screen, with the browser's own bars out of the way. */
function FullScreenButton() {
  const [full, setFull] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const changed = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  // A phone's browser that cannot do it (an iPhone's) gets no button that does nothing.
  if (!document.fullscreenEnabled) return null;

  return (
    <button
      type="button"
      className={styles.button}
      aria-pressed={full}
      aria-label={full ? 'Leave full screen' : 'Full screen'}
      title={full ? 'Leave full screen' : 'Full screen'}
      data-testid="fullscreen"
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d={
            full
              ? 'M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4'
              : 'M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4'
          }
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/**
 * On a phone the bar wraps onto a second row before anything gets smaller; only if
 * two rows still cannot hold it do the buttons shrink, a step at a time.
 */
function useSqueezeToTwoRows(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fit = () => {
      if (getComputedStyle(node).flexDirection === 'column') {
        node.removeAttribute('data-squeeze');
        return;
      }
      for (let step = 0; step <= SQUEEZE_STEPS; step += 1) {
        node.setAttribute('data-squeeze', String(step));
        if (rowsOf(node) <= 2) return;
      }
    };
    fit();
    const observer = new ResizeObserver(() => fit());
    observer.observe(node.parentElement ?? node);
    return () => observer.disconnect();
  }, [ref]);
}

/** How many rows the bar's items have wrapped onto. */
function rowsOf(node: HTMLElement): number {
  // A group laid out as `display: contents` (a phone's) wraps item by item.
  const items = (parent: Element): Element[] =>
    [...parent.children].flatMap((child) =>
      getComputedStyle(child).display === 'contents' ? items(child) : [child],
    );
  const centres = items(node)
    .map((child) => child.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => box.top + box.height / 2)
    .sort((a, b) => a - b);
  let rows = 0;
  let previous = -Infinity;
  for (const centre of centres) {
    if (centre - previous > 14) rows += 1;
    previous = centre;
  }
  return rows;
}
