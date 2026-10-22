import { useEffect, useState } from 'react';
import { startBoardSync, type BoardSync } from '@/doc/sync';
import { Link } from '@/router/router';
import { openBoardDocument, useBoardStore } from '@/state/boardStore';
import { useWorkspace } from '@/state/workspaceStore';
import { CanvasStage } from '@/ui/CanvasStage';
import { ToolBar } from '@/ui/ToolBar';
import { TopBar } from '@/ui/TopBar';
import styles from './BoardPage.module.css';

/**
 * Keyed on the board id, so switching boards remounts rather than needing the effect
 * to reach back and reset state it does not own.
 */
export function BoardPage({ boardId }: { boardId: string }) {
  return <BoardView key={boardId} boardId={boardId} />;
}

function BoardView({ boardId }: { boardId: string }) {
  const boards = useWorkspace((state) => state.boards);
  const renameBoard = useWorkspace((state) => state.renameBoard);
  const markBoardSaved = useWorkspace((state) => state.markBoardSaved);
  const [status, setStatus] = useState<'opening' | 'ready' | 'missing'>('opening');

  const record = boards.find((board) => board.id === boardId);

  useEffect(() => {
    let sync: BoardSync | null = null;
    let cancelled = false;

    const doc = openBoardDocument(boardId);

    void (async () => {
      try {
        const started = await startBoardSync(
          doc,
          boardId,
          () => useBoardStore.getState().elements,
          () => markBoardSaved(boardId),
        );
        if (cancelled) {
          started.stop();
          return;
        }
        sync = started;
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('missing');
      }
    })();

    return () => {
      cancelled = true;
      // Leaving the board writes whatever has not been sent yet.
      void sync?.flush().finally(() => sync?.stop());
    };
    // markBoardSaved is a stable store action; re-running on it would reopen the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const rename = () => {
    if (!record) return;
    const title = window.prompt('Rename board', record.title);
    if (title !== null) void renameBoard(boardId, title);
  };

  if (status === 'missing') {
    return (
      <main className={styles.missing} data-testid="board-missing">
        <h1>That board is not available</h1>
        <p>It may have been deleted, or it belongs to someone else.</p>
        <Link to={{ name: 'dashboard' }} className={styles.back}>
          Back to your boards
        </Link>
      </main>
    );
  }

  return (
    <>
      <TopBar
        boardName={record?.title ?? 'Board'}
        badge="Phase 6"
        onRenameBoard={record ? rename : undefined}
        leading={
          <Link
            to={
              record?.folderId
                ? { name: 'folder', folderId: record.folderId }
                : { name: 'dashboard' }
            }
            className={styles.back}
            data-testid="back-to-boards"
          >
            ← Boards
          </Link>
        }
      >
        <ToolBar />
      </TopBar>
      <CanvasStage />
    </>
  );
}
