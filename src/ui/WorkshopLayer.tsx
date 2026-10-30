import { useEffect, useState } from 'react';
import { boardToScreen } from '@/canvas/viewport';
import { useHistory } from '@/collab/history';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useBoardStore } from '@/state/boardStore';
import {
  framesInOrder,
  stepPresentation,
  stopPresentation,
  usePresentation,
} from '@/workshop/presentation';
import { castVote, serverNow, stopTimer, useWorkshop } from '@/workshop/workshop';
import { actionFor, isRecordingShortcut } from '@/input/shortcuts';
import styles from './WorkshopLayer.module.css';

/** What each presenting shortcut does; Settings can change the keys. */
const PRESENTING: Record<string, () => void> = {
  'present.next': () => stepPresentation(1),
  'present.previous': () => stepPresentation(-1),
  'present.first': () => stepPresentation(-Infinity),
  'present.last': () => stepPresentation(Infinity),
  'present.stop': stopPresentation,
};

const formatRemaining = (ms: number) => {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** The shared countdown. Every screen counts to the same instant on the room's clock. */
function TimerWidget() {
  const timer = useWorkshop((state) => state.timer);
  const editable = useBoardAccess(selectCanEdit);
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    if (!timer) return;
    const tick = setInterval(() => setNow(serverNow()), 200);
    return () => clearInterval(tick);
  }, [timer]);

  if (!timer) return null;
  const remaining = timer.endsAt - now;
  const done = remaining <= 0;
  return (
    <div
      className={styles.timer}
      data-state={done ? 'done' : 'running'}
      role="timer"
      aria-live={done ? 'assertive' : 'off'}
      data-testid="timer"
    >
      <span className={styles.time} data-testid="timer-display">
        {done ? "Time's up" : formatRemaining(remaining)}
      </span>
      {editable ? (
        <button
          type="button"
          className={styles.close}
          aria-label={done ? 'Dismiss the timer' : 'Stop the timer'}
          data-testid="timer-stop"
          onClick={stopTimer}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/** Dots on stickies while a vote is on, and the tallies after it closes. */
function VoteLayer() {
  const vote = useWorkshop((state) => state.vote);
  const counts = useWorkshop((state) => state.counts);
  const mine = useWorkshop((state) => state.mine);
  const elements = useBoardStore((state) => state.elements);
  const viewport = useBoardStore((state) => state.viewport);
  const preview = useHistory((state) => state.preview);
  const editable = useBoardAccess(selectCanEdit);
  if (!vote || preview) return null;

  const spent = Object.values(mine).reduce((sum, dots) => sum + dots, 0);
  const left = vote.budget - spent;
  const canVote = vote.open && editable;
  const stickies = elements.filter((element) => element.type === 'sticky' && !element.hidden);

  return (
    <>
      <div className={styles.voteStatus} data-testid="vote-status">
        {vote.open ? (
          canVote ? (
            <span data-testid="votes-left">
              {left} {left === 1 ? 'dot' : 'dots'} left
            </span>
          ) : (
            'Voting is on'
          )
        ) : (
          'Voting closed'
        )}
      </div>
      {stickies.map((sticky) => {
        const corner = boardToScreen(viewport, { x: sticky.x + sticky.w, y: sticky.y });
        const count = counts[sticky.id] ?? 0;
        const own = mine[sticky.id] ?? 0;
        return (
          <div
            key={sticky.id}
            className={styles.dots}
            style={{ left: corner.x, top: corner.y }}
            data-testid={`vote-${sticky.id}`}
          >
            {canVote && own > 0 ? (
              <button
                type="button"
                className={styles.dotButton}
                aria-label="Take back a dot"
                data-testid={`vote-remove-${sticky.id}`}
                onClick={() => castVote(sticky.id, false)}
              >
                −
              </button>
            ) : null}
            <span
              className={styles.count}
              data-mine={own > 0 || undefined}
              data-testid={`vote-count-${sticky.id}`}
            >
              {count}
            </span>
            {canVote ? (
              <button
                type="button"
                className={styles.dotButton}
                aria-label="Add a dot"
                disabled={left <= 0}
                data-testid={`vote-add-${sticky.id}`}
                onClick={() => castVote(sticky.id, true)}
              >
                +
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** The presenter's controls: where they are, and the keys that move on. */
function PresentationBar() {
  const presenting = usePresentation((state) => state.presenting);
  const frame = usePresentation((state) => state.frame);
  const elements = useBoardStore((state) => state.elements);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (event: KeyboardEvent) => {
      if (isRecordingShortcut()) return;
      const id = actionFor(event, 'presenting');
      if (!id) return;
      PRESENTING[id]?.();
      // Nothing else on the board hears these keys while presenting. Celebrations
      // are the board's own shortcuts, so they work here as anywhere.
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [presenting]);

  if (!presenting) return null;
  const frames = framesInOrder(elements);
  const index = frames.findIndex((each) => each.id === frame);
  return (
    <div className={styles.presentBar} data-testid="presentation-bar">
      <button
        type="button"
        aria-label="Previous frame"
        disabled={index <= 0}
        onClick={() => stepPresentation(-1)}
      >
        ‹
      </button>
      <span data-testid="presentation-counter">
        {index + 1} / {frames.length}
      </span>
      <button
        type="button"
        aria-label="Next frame"
        disabled={index >= frames.length - 1}
        onClick={() => stepPresentation(1)}
      >
        ›
      </button>
      <button type="button" data-testid="present-stop" onClick={stopPresentation}>
        Exit
      </button>
    </div>
  );
}

export function WorkshopLayer() {
  return (
    <div className={styles.layer} data-hud data-present-keep>
      <VoteLayer />
      <TimerWidget />
      <PresentationBar />
    </div>
  );
}
