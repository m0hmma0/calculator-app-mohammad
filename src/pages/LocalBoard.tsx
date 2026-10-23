import { CanvasStage } from '@/ui/CanvasStage';
import { InsertMenu } from '@/ui/InsertMenu';
import { ToolsMenu } from '@/ui/ToolsMenu';
import { ToolBar } from '@/ui/ToolBar';
import { TopBar } from '@/ui/TopBar';
import styles from './LocalBoard.module.css';

/**
 * The app without a backend: one board, saved in this browser. This is what runs
 * when no Firebase project is configured — a build with no sign-in should still be a
 * usable whiteboard rather than a locked door, and it is what the published preview
 * shows.
 */
export function LocalBoard() {
  return (
    <>
      <TopBar boardName="Local board">
        <ToolBar />
        <InsertMenu />
        <ToolsMenu />
      </TopBar>
      <p className={styles.notice} data-testid="local-only-notice">
        Signed-out mode — this board is saved in this browser only.
      </p>
      <CanvasStage />
    </>
  );
}
