import { useEffect, useRef, useState } from 'react';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { startPresentation } from '@/workshop/presentation';
import {
  clearVote,
  endVote,
  startTimer,
  startVote,
  stopTimer,
  useWorkshop,
} from '@/workshop/workshop';
import styles from './InsertMenu.module.css';

const TIMER_MINUTES = [1, 3, 5, 10];
const VOTE_BUDGET = 3;

/** The facilitator's tools: present the frames, run a timer, run a dot vote. */
export function WorkshopMenu() {
  const editable = useBoardAccess(selectCanEdit);
  const timer = useWorkshop((state) => state.timer);
  const vote = useWorkshop((state) => state.vote);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const run = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="workshop-menu"
        onClick={() => {
          setNotice(null);
          setOpen((current) => !current);
        }}
      >
        Workshop
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            data-testid="present-start"
            onClick={() => {
              if (startPresentation()) setOpen(false);
              else setNotice('Add a frame first — each frame is one slide.');
            }}
          >
            Present frames
          </button>
          {notice ? <p className={styles.hint}>{notice}</p> : null}
          {editable ? (
            <>
              <p className={styles.label}>Timer</p>
              <div className={styles.row}>
                {TIMER_MINUTES.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    role="menuitem"
                    data-testid={`timer-start-${minutes}`}
                    onClick={run(() => startTimer(minutes))}
                  >
                    {minutes} min
                  </button>
                ))}
              </div>
              {timer ? (
                <button type="button" role="menuitem" onClick={run(stopTimer)}>
                  Stop the timer
                </button>
              ) : null}
              <p className={styles.label}>Dot voting</p>
              {!vote || !vote.open ? (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="vote-start"
                  onClick={run(() => startVote(VOTE_BUDGET))}
                >
                  {vote ? 'Start a new vote' : `Start a vote (${VOTE_BUDGET} dots each)`}
                </button>
              ) : (
                <button type="button" role="menuitem" data-testid="vote-end" onClick={run(endVote)}>
                  End voting
                </button>
              )}
              {vote ? (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="vote-clear"
                  onClick={run(clearVote)}
                >
                  Clear the dots
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
