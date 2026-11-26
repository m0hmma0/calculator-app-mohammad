import { useEffect, useRef, useState } from 'react';
import { celebrate, EFFECTS } from '@/fun/effects';
import { STAMPS } from '@/input/insertions';
import { useRecorder } from '@/recording/recorder';
import { useUiPrefs } from '@/state/uiPrefs';
import { useNotesScroll } from '@/workshop/notesScroll';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useBoardStore } from '@/state/boardStore';
import { closeAudienceWindow } from '@/workshop/audience';
import { framesInOrder, usePresentation } from '@/workshop/presentation';
import { RecordControls } from './RecordControls';
import { SlidePicture } from './SlidePicture';
import type { BoardElement } from '@/model/element';
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

/** Below this height a landscape stage is a phone on its side: the notes go to the right. */
const SHORT_STAGE = 520;

function Notes() {
  const ref = useRef<HTMLElement | null>(null);
  const frameId = usePresentation((state) => state.frame);
  const since = usePresentation((state) => state.audienceSince);
  const elements = useBoardStore((state) => state.elements);
  const stage = useBoardStore((state) => state.stageSize);
  const editable = useBoardAccess(selectCanEdit);
  const share = useUiPrefs((state) => state.notesShare);
  const showRecord = useUiPrefs((state) => state.presenterRecord);
  const showStamps = useUiPrefs((state) => state.presenterStamps);
  const showCelebrations = useUiPrefs((state) => state.presenterCelebrations);
  const recording = useRecorder((state) => state.state);
  const [now, setNow] = useState(() => Date.now());

  const frames = framesInOrder(elements);
  const index = frames.findIndex((frame) => frame.id === frameId);
  const frame = index === -1 ? null : frames[index]!;
  const next = index === -1 ? null : (frames[index + 1] ?? null);

  // A phone on its side: the notes down the right, so the slide keeps its height.
  const side: 'bottom' | 'right' =
    stage.width > stage.height && stage.height < SHORT_STAGE ? 'right' : 'bottom';
  const length = side === 'right' ? stage.width : stage.height;
  const fraction = share ?? (side === 'right' ? 0.42 : 0.36);
  const size = Math.round(Math.max(150, Math.min(length - 120, length * fraction)));
  // Recording is never hidden while it runs.
  const recordShown = showRecord || recording === 'recording' || recording === 'paused';

  // The slide fits beside the notes: the presentation is told where, and how big.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const report = () =>
      usePresentation.setState({
        notesInset: side === 'right' ? element.offsetWidth : element.offsetHeight,
        notesSide: side,
      });
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [side]);
  useEffect(() => () => usePresentation.setState({ notesInset: 0, notesSide: 'bottom' }), []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <section
      ref={ref}
      className={styles.notes}
      data-side={side}
      style={side === 'right' ? { width: size } : { height: size }}
      aria-label="Presenter view"
      data-hud
      data-testid="presenter-notes"
    >
      <Divider side={side} length={length} />
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
        <span className={styles.switches} role="group" aria-label="Show in presenter view">
          <Toggle
            label="Record"
            icon="●"
            on={recordShown}
            disabled={recording === 'recording' || recording === 'paused'}
            testId="presenter-show-record"
            onChange={(on) => useUiPrefs.setState({ presenterRecord: on })}
          />
          <Toggle
            label="Stamps"
            icon="👍"
            on={showStamps}
            testId="presenter-show-stamps"
            onChange={(on) => useUiPrefs.setState({ presenterStamps: on })}
          />
          <Toggle
            label="Celebrations"
            icon="🎉"
            on={showCelebrations}
            testId="presenter-show-celebrations"
            onChange={(on) => useUiPrefs.setState({ presenterCelebrations: on })}
          />
        </span>
        <button
          type="button"
          className={styles.close}
          title="Close the audience window; presenting carries on here"
          data-testid="audience-close"
          onMouseDown={(event) => event.preventDefault()}
          onClick={closeAudienceWindow}
        >
          <span className={styles.long}>Close audience window</span>
          <span className={styles.short}>Close</span>
        </button>
      </div>
      {recordShown ? <RecordControls /> : null}
      {showStamps ? <StampRow /> : null}
      {showCelebrations ? <CelebrationRow /> : null}
      <div className={styles.body}>
        {frame ? (
          <NoteField
            key={frame.id}
            frameId={frame.id}
            saved={frame.notes ?? ''}
            editable={editable}
          />
        ) : null}
        <NextSlide frame={next} elements={elements} />
      </div>
    </section>
  );
}

/** A switch in presenter view's top row, showing or hiding one of its parts. */
function Toggle({
  label,
  icon,
  on,
  disabled = false,
  testId,
  onChange,
}: {
  label: string;
  /** What it shows on a narrow screen, where the words do not fit. */
  icon: string;
  on: boolean;
  disabled?: boolean;
  testId: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={on ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
      className={styles.toggle}
      disabled={disabled}
      data-testid={testId}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChange(!on)}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.long}>{label}</span>
    </button>
  );
}

/** The stamps, to put on the slide: picking one takes up the stamp tool with it. */
function StampRow() {
  const stamp = useBoardStore((state) => state.stamp);
  const tool = useBoardStore((state) => state.tool);
  return (
    <div className={styles.row} role="group" aria-label="Stamps" data-testid="presenter-stamps">
      {STAMPS.map((each) => (
        <button
          key={each}
          type="button"
          className={styles.chip}
          aria-pressed={tool === 'stamp' && stamp === each}
          data-testid={`presenter-stamp-${each}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => useBoardStore.getState().setStamp(each)}
        >
          {each}
        </button>
      ))}
    </div>
  );
}

/** The celebrations, to play on every screen. */
function CelebrationRow() {
  return (
    <div
      className={styles.row}
      role="group"
      aria-label="Celebrations"
      data-testid="presenter-celebrations"
    >
      {EFFECTS.map((effect) => (
        <button
          key={effect.kind}
          type="button"
          className={styles.chip}
          title={effect.label}
          data-testid={`presenter-celebrate-${effect.kind}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => celebrate(effect.kind)}
        >
          <span aria-hidden="true">{effect.emoji}</span> {effect.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The edge between the slide and the notes, dragged to give either more room (asked
 * for on 20 November). The share is remembered on this device.
 */
function Divider({ side, length }: { side: 'bottom' | 'right'; length: number }) {
  return (
    <div
      className={styles.divider}
      data-side={side}
      role="separator"
      aria-orientation={side === 'right' ? 'vertical' : 'horizontal'}
      aria-label="Drag to share the room between the slide and the notes"
      data-testid="presenter-divider"
      onPointerDown={(event) => {
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const stage = handle.closest('[data-testid="stage"]')?.getBoundingClientRect();
        if (!stage) return;
        const move = (moved: PointerEvent) => {
          const taken =
            side === 'right' ? stage.right - moved.clientX : stage.bottom - moved.clientY;
          const share = Math.min(0.8, Math.max(0.15, taken / Math.max(1, length)));
          useUiPrefs.setState({ notesShare: share });
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      }}
    />
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

  const field = useRef<HTMLTextAreaElement | null>(null);
  useNotesScroll(field, frameId);

  return (
    <textarea
      ref={field}
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

/** The next slide as it will look, small, beside the notes. "End" after the last one. */
function NextSlide({
  frame,
  elements,
}: {
  frame: BoardElement | null;
  elements: readonly BoardElement[];
}) {
  return (
    <figure className={styles.upNext} data-testid="presenter-next-preview">
      {frame ? (
        <SlidePicture
          frame={frame}
          elements={elements}
          className={styles.upNextCanvas}
          label="The next slide"
        />
      ) : (
        <div className={styles.upNextEnd}>End of the slides</div>
      )}
      <figcaption className={styles.upNextLabel}>Next</figcaption>
    </figure>
  );
}
