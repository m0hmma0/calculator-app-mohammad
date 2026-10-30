import { useEffect, useState } from 'react';
import { applyHistoryMessage, applyHistoryState, attachHistory } from '@/collab/history';
import { applyServerMessage, resetPresence, usePresence } from '@/collab/presence';
import { startPresence, type PresenceHandle } from '@/collab/publish';
import { startBoardSync, type BoardSync } from '@/doc/sync';
import { Link } from '@/router/router';
import { useBoardAccess } from '@/sharing/boardAccess';
import { useComments } from '@/sharing/comments';
import { ROLE_LABEL, canEdit, type Role } from '@shared/sharing';
import { fitOnOpen, openBoardDocument, setBoardReadOnly, useBoardStore } from '@/state/boardStore';
import { useWorkspace } from '@/state/workspaceStore';
import { BoardControls, BoardShell } from '@/ui/BoardControls';
import { CanvasStage } from '@/ui/CanvasStage';
import { CommentsPanel } from '@/ui/CommentsPanel';
import { HistoryPanel } from '@/ui/HistoryPanel';
import { ShareDialog } from '@/ui/ShareDialog';
import { PeerBar } from '@/ui/PeerBar';
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
  const [sharing, setSharing] = useState(false);
  const role = useBoardAccess((state) => state.role);
  const sharedTitle = useBoardAccess((state) => state.title);
  const signedIn = useWorkspace((state) => state.account !== null);

  const record = boards.find((board) => board.id === boardId);

  useEffect(() => {
    let sync: BoardSync | null = null;
    let presence: PresenceHandle | null = null;
    let cancelled = false;

    const doc = openBoardDocument(boardId);
    resetPresence();
    usePresence.setState({ status: 'connecting' });

    const applyRole = (nextRole: Role | null, canExport: boolean) => {
      useBoardAccess.setState({ role: nextRole, canExport });
      setBoardReadOnly(!canEdit(nextRole));
    };
    // A board in this person's own workspace is theirs: they can draw from the first
    // instant. Anyone else waits for the server, so a viewer never gets a moment in
    // which their changes seem to land.
    const owns = useWorkspace.getState().boards.some((board) => board.id === boardId);
    useBoardAccess.setState({ ownerName: null, title: null, textSize: null });
    applyRole(owns ? 'owner' : null, owns);

    void (async () => {
      try {
        const started = await startBoardSync(doc, boardId, {
          elementsNow: () => useBoardStore.getState().elements,
          onSaved: () => markBoardSaved(boardId),
          onOpened: (opened) => {
            if (cancelled) return;
            if (!opened) {
              // Offline: the boards this person owns are in their workspace; anything
              // else opens read-only until the room says more.
              const owns = useWorkspace.getState().boards.some((board) => board.id === boardId);
              applyRole(owns ? 'owner' : 'viewer', owns);
              return;
            }
            useBoardAccess.setState({
              ownerName: opened.ownerName,
              title: opened.board.title,
              // The owner's own text starts at their own size, not the one for others.
              textSize: opened.role === 'owner' ? null : opened.textSize,
            });
            applyRole(opened.role, opened.canExport);
          },
          events: {
            status: (status) => {
              usePresence.setState({ status });
              // The room will not have this person: same outcome as a missing board.
              if (status === 'refused' && !cancelled) setStatus('missing');
            },
            message: (message) => {
              applyServerMessage(message);
              applyHistoryMessage(message);
              if (message.t === 'role') applyRole(message.role, message.canExport);
              if (message.t === 'comments') void useComments.getState().refresh();
              // Someone new should see everyone at once, not at their next movement.
              if (message.t === 'join' || message.t === 'ready') presence?.publishNow();
            },
            history: applyHistoryState,
            synced: () => {
              usePresence.setState({ synced: true });
              // The room's copy is in: the view shows all of it.
              fitOnOpen();
            },
          },
        });
        if (cancelled) {
          started.stop();
          return;
        }
        sync = started;
        presence = startPresence(started.room);
        attachHistory(started.room, doc);
        void useComments.getState().open(boardId);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('missing');
      }
    })();

    return () => {
      cancelled = true;
      presence?.stop();
      attachHistory(null, null);
      useComments.getState().close();
      setBoardReadOnly(false);
      useBoardAccess.setState({
        role: 'owner',
        canExport: true,
        ownerName: null,
        title: null,
        textSize: null,
      });
      resetPresence();
      // Leaving the board sends whatever has not been sent yet.
      void sync?.flush().finally(() => sync?.stop());
    };
    // markBoardSaved is a stable store action; re-running on it would reopen the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  // The board's name in the browser tab — and, on a phone, the only place it shows.
  const title = record?.title ?? sharedTitle;
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · Sabboura`;
    return () => {
      document.title = 'Sabboura Whiteboard';
    };
  }, [title]);

  const rename = () => {
    if (!record) return;
    const title = window.prompt('Rename board', record.title);
    if (title !== null) void renameBoard(boardId, title);
  };

  if (status === 'missing') {
    return (
      <main className={styles.missing} data-testid="board-missing">
        <h1>That board is not available</h1>
        <p>
          It may have been deleted, your access may have been removed, or it belongs to someone
          else.
        </p>
        {signedIn ? (
          <Link to={{ name: 'dashboard' }} className={styles.back}>
            Back to your boards
          </Link>
        ) : null}
      </main>
    );
  }

  const owner = role === 'owner' && record !== undefined;
  // Someone else's board: back to what is shared with them, or — a guest — nowhere.
  const back = owner
    ? record.folderId
      ? ({ name: 'folder', folderId: record.folderId } as const)
      : ({ name: 'dashboard' } as const)
    : signedIn
      ? ({ name: 'shared' } as const)
      : null;

  return (
    <>
      <BoardShell>
        <BoardControls
          boardName={record?.title ?? sharedTitle ?? 'Board'}
          badge={role && role !== 'owner' ? ROLE_LABEL[role] : undefined}
          onRenameBoard={owner ? rename : undefined}
          leading={
            back ? (
              <Link
                to={back}
                className={styles.back}
                aria-label="Back to boards"
                title="Back to boards"
                data-testid="back-to-boards"
              >
                ← <span className={styles.backLabel}>Boards</span>
              </Link>
            ) : null
          }
          people={<PeerBar />}
          share={
            owner ? (
              <button
                type="button"
                className={styles.share}
                data-testid="open-share"
                onClick={() => setSharing(true)}
              >
                Share
              </button>
            ) : null
          }
        />
        <CanvasStage />
      </BoardShell>
      <HistoryPanel />
      <CommentsPanel boardId={boardId} />
      {sharing ? (
        <ShareDialog
          resource={{ type: 'board', id: boardId, title: record?.title ?? 'this board' }}
          onClose={() => setSharing(false)}
        />
      ) : null}
    </>
  );
}
