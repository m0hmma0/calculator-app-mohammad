import { boardToScreen } from '@/canvas/viewport';
import { useHistory } from '@/collab/history';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useBoardStore } from '@/state/boardStore';
import { useFrameOnShow } from '@/workshop/onShow';
import { framesInOrder, renumberFrame } from '@/workshop/presentation';
import styles from './FrameNumbers.module.css';

/**
 * Each frame's number, before its title: the order the presentation takes. Anyone who
 * can edit picks a frame's number from its drop-down, and the others close up around
 * it; everyone else sees the number.
 */
export function FrameNumbers() {
  const elements = useBoardStore((state) => state.elements);
  const viewport = useBoardStore((state) => state.viewport);
  const preview = useHistory((state) => state.preview);
  const editable = useBoardAccess(selectCanEdit);
  const onShow = useFrameOnShow();
  if (preview || onShow) return null;

  const frames = framesInOrder(elements);
  if (frames.length === 0) return null;

  return (
    <div className={styles.layer} data-present-hide>
      {frames.map((frame, index) => {
        const corner = boardToScreen(viewport, { x: frame.x, y: frame.y });
        const number = index + 1;
        const label = `Frame ${number} of ${frames.length}${frame.text ? ` — ${frame.text}` : ''}`;
        return (
          <div
            key={frame.id}
            className={styles.badge}
            style={{ left: corner.x, top: corner.y }}
            data-hud
            data-testid={`frame-number-${frame.id}`}
          >
            {editable ? (
              <select
                className={styles.select}
                value={number}
                aria-label={`${label}: its place in the presentation`}
                title="Its place in the presentation"
                data-testid={`frame-order-${frame.id}`}
                onChange={(event) => renumberFrame(frame.id, Number(event.target.value))}
              >
                {frames.map((_, at) => (
                  <option key={at} value={at + 1}>
                    {at + 1}
                  </option>
                ))}
              </select>
            ) : (
              <span className={styles.number} aria-label={label}>
                {number}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
