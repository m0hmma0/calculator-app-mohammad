import { useEffect, useState } from 'react';
import { applyHistoryMessage, applyHistoryState, attachHistory } from '@/collab/history';
import { applyServerMessage, resetPresence, usePresence } from '@/collab/presence';
import { startPresence, type PresenceHandle } from '@/collab/publish';
import { startBoardSync, type BoardSync } from '@/doc/sync';
import { Link } from '@/router/router';
import { openBoardDocument, useBoardStore } from '@/state/boardStore';
import { useWorkspace } from '@/state/workspaceStore';
import { CanvasStage } from '@/ui/CanvasStage';
import { ToolBar } from '@/ui/ToolBar';
import { HistoryPanel } from '@/ui/HistoryPanel';
import { PeerBar } from '@/ui/PeerBar';
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
    let presence: PresenceHandle | null = null;
    let cancelled = false;

    const doc = openBoardDocument(boardId);
    resetPresence();
    usePresence.setState({ status: 'connecting' });

    void (async () => {
      try {
        const started = await startBoardSync(doc, boardId, {
          elementsNow: () => useBoardStore.getState().elements,
          onSaved: () => markBoardSaved(boardId),
          events: {
            status: (status) => {
              usePresence.setState({ status });
              // The room will not have this person: same outcome as a missing board.
              if (status === 'refused' && !cancelled) setStatus('missing');
            },
            message: (message) => {
              applyServerMessage(message);
              applyHistoryMessage(message);
              // Someone new should see everyone at once, not at their next movement.
              if (message.t === 'join' || message.t === 'ready') presence?.publishNow();
            },
            history: applyHistoryState,
            synced: () => usePresence.setState({ synced: true }),
          },
        });
        if (cancelled) {
          started.stop();
          return;
        }
        sync = started;
        presence = startPresence(started.room);
        attachHistory(started.room, doc);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('missing');
      }
    })();

    return () => {
      cancelled = true;
      presence?.stop();
      attachHistory(null, null);
      resetPresence();
      // Leaving the board sends whatever has not been sent yet.
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
        badge="Phase 7"
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
        <PeerBar />
      </TopBar>
      <CanvasStage />
      <HistoryPanel />
    </>
  );
}
