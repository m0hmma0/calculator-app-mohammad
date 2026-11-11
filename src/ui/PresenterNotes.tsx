import { useEffect, useRef, useState } from 'react';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useBoardStore } from '@/state/boardStore';
import { closeAudienceWindow } from '@/workshop/audience';
import { framesInOrder, usePresentation } from '@/workshop/presentation';
import styles from './PresenterNotes.module.css';

/** Typing is written to the board this long after the last key, as one step. */
const SAVE_AFTER_MS = 400;

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(hours > 0 ? 2 : 1, '0');
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * Presenter view's own half, along the bottom of the board while the audience window
 * is open: where the talk is, how long it has run, what comes next, and this slide's
 * notes — kept on the frame, so they are there next time, on any device. The slide
 * above is what the audience window shows.
 */
export function PresenterNotes() {
  const presenting = usePresentation((state) => state.presenting);
  const audience = usePresentation((state) => state.audience);
  if (!presenting || !audience) return null;
  return <Notes />;
}

function Notes() {
  const ref = useRef<HTMLElement | null>(null);
  const frameId = usePresentation((state) => state.frame);
  const since = usePresentation((state) => state.audienceSince);
  const elements = useBoardStore((state) => state.elements);
  const editable = useBoardAccess(selectCanEdit);
  const [now, setNow] = useState(() => Date.now());

  const frames = framesInOrder(elements);
  const index = frames.findIndex((frame) => frame.id === frameId);
  const frame = index === -1 ? null : frames[index]!;
  const next = index === -1 ? null : (frames[index + 1] ?? null);

  // The slide fits above the notes: the presentation is told how tall they are.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const report = () => usePresentation.setState({ notesInset: element.offsetHeight });
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => {
      observer.disconnect();
      usePresentation.setState({ notesInset: 0 });
    };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <section
      ref={ref}
      className={styles.notes}
      aria-label="Presenter view"
      data-hud
      data-wheel-pans
      data-testid="presenter-notes"
    >
      <div className={styles.head}>
        <span className={styles.where} data-testid="presenter-slide">
          Slide {index + 1} of {frames.length}
          {frame?.text ? <span className={styles.title}> — {frame.text}</span> : null}
        </span>
        <span className={styles.next} data-testid="presenter-next">
          {next ? `Next: ${next.text || `slide ${index + 2}`}` : 'Last slide'}
        </span>
        <span className={styles.clock} title="Time since presenter view opened">
          {since ? clock(now - since) : ''}
        </span>
        <button
          type="button"
          className={styles.close}
          data-testid="audience-close"
          onMouseDown={(event) => event.preventDefault()}
          onClick={closeAudienceWindow}
        >
          Close audience window
        </button>
      </div>
      {frame ? (
        <NoteField
          key={frame.id}
          frameId={frame.id}
          saved={frame.notes ?? ''}
          editable={editable}
        />
      ) : null}
    </section>
  );
}

/** One frame's notes. Keyed on the frame, so moving on saves and starts the next. */
function NoteField({
  frameId,
  saved,
  editable,
}: {
  frameId: string;
  saved: string;
  editable: boolean;
}) {
  const [draft, setDraft] = useState(saved);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const write = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = pending.current;
    pending.current = null;
    if (value === null) return;
    const store = useBoardStore.getState();
    const frame = store.elements.find((element) => element.id === frameId);
    if (!frame || (frame.notes ?? '') === value) return;
    store.applyDiscrete(new Map([[frameId, { notes: value }]]));
  };

  // Someone else's change (or undo) arrives while nothing is being typed: show it.
  useEffect(() => {
    if (pending.current === null) setDraft(saved);
  }, [saved]);

  // Moving to the next slide, or leaving presenter view, saves what was typed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => write(), []);

  return (
    <textarea
      className={styles.field}
      value={draft}
      readOnly={!editable}
      placeholder={
        editable
          ? 'Notes for this slide — shown here, in presenter view, never on the slides.'
          : 'No notes'
      }
      aria-label="Notes for this slide"
      data-testid="presenter-notes-field"
      onChange={(event) => {
        setDraft(event.target.value);
        pending.current = event.target.value;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(write, SAVE_AFTER_MS);
      }}
      onBlur={write}
      onKeyDown={(event) => {
        // The slide keys are the presentation's only outside the notes.
        if (event.key === 'Escape') event.currentTarget.blur();
        event.stopPropagation();
      }}
    />
  );
}
