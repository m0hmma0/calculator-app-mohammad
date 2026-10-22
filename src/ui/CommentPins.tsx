import { boardToScreen, screenToBoard } from '@/canvas/viewport';
import { threadsOf, useComments } from '@/sharing/comments';
import { useBoardStore } from '@/state/boardStore';
import styles from './CommentPins.module.css';

/**
 * Where each comment thread is pinned, numbered to match the panel. While a new
 * comment is being placed, a layer over the board takes the click.
 */
export function CommentPins() {
  const visible = useComments((state) => state.visible);
  const comments = useComments((state) => state.comments);
  const placing = useComments((state) => state.placing);
  const draftAt = useComments((state) => state.draftAt);
  const openThread = useComments((state) => state.openThread);
  const showResolved = useComments((state) => state.showResolved);
  const viewport = useBoardStore((state) => state.viewport);

  if (!visible) return null;
  const threads = threadsOf(comments).filter(
    (thread) => showResolved || thread.root.resolvedAt === null,
  );

  return (
    <div className={styles.layer} data-hud>
      {threads.map((thread, index) => {
        if (thread.root.x === null || thread.root.y === null) return null;
        const at = boardToScreen(viewport, { x: thread.root.x, y: thread.root.y });
        return (
          <button
            key={thread.root.id}
            type="button"
            className={styles.pin}
            style={{ left: at.x, top: at.y }}
            aria-current={openThread === thread.root.id ? 'true' : undefined}
            aria-label={`Comment ${index + 1} by ${thread.root.authorName}`}
            data-testid="comment-pin"
            onClick={() => useComments.setState({ openThread: thread.root.id })}
          >
            {index + 1}
          </button>
        );
      })}

      {draftAt ? (
        <span
          className={`${styles.pin} ${styles.draft}`}
          style={{
            left: boardToScreen(viewport, draftAt).x,
            top: boardToScreen(viewport, draftAt).y,
          }}
          aria-hidden="true"
        >
          +
        </span>
      ) : null}

      {placing ? (
        <div
          className={styles.placing}
          data-testid="comment-place"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const at = screenToBoard(useBoardStore.getState().viewport, {
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            });
            useComments.setState({ placing: false, draftAt: { x: at.x, y: at.y } });
          }}
        />
      ) : null}
    </div>
  );
}
