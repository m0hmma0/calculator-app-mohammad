import { selectIsOwner, useBoardAccess } from '@/sharing/boardAccess';
import { useBoardStore } from '@/state/boardStore';
import {
  frameNumbers,
  framesInOrder,
  selectedFrame,
  startPresentation,
  usePresentation,
} from '@/workshop/presentation';
import styles from './PresentButton.module.css';

/**
 * Present the frames, one slide each: where the pages used to be (20 November). From
 * the selected frame, if there is one, else the first. The owner's, as presenting is;
 * while presenting, the slide controls take over.
 */
export function PresentButton() {
  const owner = useBoardAccess(selectIsOwner);
  const presenting = usePresentation((state) => state.presenting);
  const elements = useBoardStore((state) => state.elements);
  const selection = useBoardStore((state) => state.selection);
  if (!owner || presenting) return null;

  const frames = framesInOrder(elements).length;
  const start = selectedFrame(elements, selection);
  const number = start ? frameNumbers(elements).get(start.id) : undefined;
  const label = number ? `Present from frame ${number}` : 'Present frames';

  return (
    <button
      type="button"
      className={styles.present}
      disabled={frames === 0}
      title={frames === 0 ? 'Add a frame first — each frame is one slide.' : label}
      data-testid="present-start"
      onClick={() => startPresentation()}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M2.5 3h11v7.5h-11zM8 10.5V13M5.5 13.5h5M7 5.2v3.1l2.6-1.55Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span>{label}</span>
    </button>
  );
}
