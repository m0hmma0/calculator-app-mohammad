import { lockedForMe } from '@/sharing/boardAccess';
import { useBoardStore } from '@/state/boardStore';
import type { BoardElement } from '@/model/element';
import { FRAME_SIZES, hasRatio, resizedFrame, screenRatio } from '@/workshop/frameSizes';
import styles from './TransitionPicker.module.css';

/** The side panel's frame sizes: shapes that fill a phone or a laptop when presented. */
export function FrameSizePicker({ frames }: { frames: BoardElement[] }) {
  const applyDiscrete = useBoardStore((state) => state.applyDiscrete);
  const free = frames.filter((frame) => !lockedForMe(frame));
  if (free.length === 0) return null;

  const choose = (ratio: number | null) => {
    const wanted = ratio ?? screenRatio();
    applyDiscrete(new Map(free.map((frame) => [frame.id, resizedFrame(frame, wanted)])));
  };

  return (
    <div className={styles.section} data-testid="frame-sizes">
      <p className={styles.label}>Fill a screen</p>
      <div className={styles.sizes}>
        {FRAME_SIZES.map((size) => (
          <button
            key={size.id}
            type="button"
            className={styles.size}
            aria-pressed={
              size.ratio !== null && free.every((frame) => hasRatio(frame, size.ratio!))
            }
            title={
              size.ratio === null
                ? 'The shape of the screen this is on, as it is held now'
                : `${size.label}: keeps the frame's corner and about its size`
            }
            data-testid={`frame-size-${size.id}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(size.ratio)}
          >
            {size.label}
          </button>
        ))}
      </div>
    </div>
  );
}
