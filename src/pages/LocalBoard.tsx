import { BoardControls, BoardShell } from '@/ui/BoardControls';
import { CanvasStage } from '@/ui/CanvasStage';

/**
 * The app without a backend: one board, saved in this browser. This is what runs
 * when no Firebase project is configured — a build with no sign-in should still be a
 * usable whiteboard rather than a locked door, and it is what the published preview
 * shows.
 */
export function LocalBoard() {
  return (
    <BoardShell>
      <BoardControls
        boardName="Local board"
        notice={
          <span data-testid="local-only-notice">
            Signed-out mode — this board is saved in this browser only.
          </span>
        }
      />
      <CanvasStage />
    </BoardShell>
  );
}
