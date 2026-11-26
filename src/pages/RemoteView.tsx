import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { RoomConnection } from '@/collab/connection';
import { REMOTE_ORIGIN } from '@/doc/board';
import { openAudienceDocument, useBoardStore } from '@/state/boardStore';
import { useNotesScroll } from '@/workshop/notesScroll';
import { framesInOrder } from '@/workshop/presentation';
import { remoteChannelName, type FromRemote, type ToRemote } from '@/workshop/remote';
import type { RemoteAction, RemoteState } from '@shared/collab';
import { SlidePicture } from '@/ui/SlidePicture';
import styles from './RemoteView.module.css';

type Status = 'connecting' | 'waiting' | 'live' | 'ended';

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(hours > 0 ? 2 : 1, '0');
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * The remote control (Phase 17c): presenter view on another phone or tab, opened by
 * the presenter's link. It shows the slide on show, the next one, the slide's notes
 * and a clock, and its buttons (or a swipe across the slide) move the presentation.
 * It reads the board — from the room on a board with one, or from the presenter's
 * tab on the signed-out board — and changes nothing on it.
 */
export function RemoteView({ remoteKey, boardId }: { remoteKey: string; boardId: string | null }) {
  const [status, setStatus] = useState<Status>('connecting');
  const [state, setState] = useState<RemoteState>({ frame: null, since: null });
  const send = useRef<(action: RemoteAction) => void>(() => {});
  const elements = useBoardStore((store) => store.elements);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    document.title = 'Remote control — Sabboura';
    const doc = openAudienceDocument();

    if (boardId) {
      const room = new RoomConnection(
        doc,
        boardId,
        {
          status: (next) => {
            if (next === 'refused') setStatus('ended');
            else if (next !== 'connected') {
              setStatus((current) => (current === 'ended' ? current : 'connecting'));
            }
          },
          message: (message) => {
            if (message.t === 'remote-state') {
              setState(message.state);
              setStatus('live');
            } else if (message.t === 'error' && message.code === 'waiting') {
              setStatus('waiting');
            } else if (message.t === 'error' && message.code === 'unauthorised') {
              setStatus('ended');
            }
          },
          history: () => {},
          synced: () => {},
        },
        remoteKey,
      );
      room.start();
      send.current = (action) => room.send({ t: 'remote', action });
      return () => room.stop();
    }

    // The signed-out board: the presenter's tab, in this browser, answers.
    const channel = new BroadcastChannel(remoteChannelName(remoteKey));
    const say = (message: FromRemote) => channel.postMessage(message);
    channel.onmessage = (event: MessageEvent<ToRemote>) => {
      const message = event.data;
      if (message.t === 'doc') Y.applyUpdate(doc.doc, message.update, REMOTE_ORIGIN);
      else if (message.t === 'state') {
        setState(message.state);
        setStatus('live');
      } else if (message.t === 'end') setStatus('ended');
    };
    say({ t: 'hello' });
    // Nobody answered: the presenting tab is not open in this browser.
    const timer = setTimeout(() => {
      setStatus((current) => (current === 'connecting' ? 'waiting' : current));
    }, 1500);
    send.current = (action) => say({ t: 'remote', action });
    return () => {
      clearTimeout(timer);
      channel.close();
    };
  }, [remoteKey, boardId]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const frames = framesInOrder(elements);
  const index = frames.findIndex((frame) => frame.id === state.frame);
  const frame = index === -1 ? null : frames[index]!;
  const next = index === -1 ? null : (frames[index + 1] ?? null);
  const press = (action: RemoteAction) => send.current(action);

  // A swipe across the slide moves it on or back, as on the presenter's own screen.
  const swipe = useRef<{ x: number; y: number } | null>(null);

  if (status !== 'live' || !frame) {
    return (
      <main className={styles.remote} data-testid="remote" data-status={status}>
        <p className={styles.message} data-testid="remote-status">
          {status === 'ended'
            ? 'This remote control link has ended. Start presenting again for a new one.'
            : status === 'waiting'
              ? boardId
                ? 'Waiting for the presenter…'
                : 'Open the presentation in this browser to use this remote control.'
              : 'Connecting…'}
        </p>
      </main>
    );
  }

  return (
    <main className={styles.remote} data-testid="remote" data-status={status}>
      <header className={styles.head}>
        <span className={styles.where} data-testid="remote-slide">
          Slide {index + 1} of {frames.length}
          {frame.text ? <span className={styles.title}> — {frame.text}</span> : null}
        </span>
        <span className={styles.clock} data-testid="remote-clock">
          {state.since ? clock(now - state.since) : ''}
        </span>
      </header>

      <section className={styles.stage}>
        <div
          className={styles.current}
          onPointerDown={(event) => {
            swipe.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const start = swipe.current;
            swipe.current = null;
            if (!start) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.abs(dx) >= 50 && Math.abs(dx) >= Math.abs(dy) * 1.5) {
              press(dx < 0 ? 'next' : 'previous');
            }
          }}
        >
          <SlidePicture
            frame={frame}
            elements={elements}
            className={styles.picture}
            label="The slide on show"
            testId="remote-current"
          />
        </div>
        <aside className={styles.side}>
          <figure className={styles.next}>
            {next ? (
              <SlidePicture
                frame={next}
                elements={elements}
                className={styles.picture}
                label="The next slide"
                testId="remote-next"
              />
            ) : (
              <div className={styles.end}>End of the slides</div>
            )}
            <figcaption className={styles.nextLabel}>Next</figcaption>
          </figure>
          <RemoteNotes frameId={frame.id} notes={frame.notes ?? ''} />
        </aside>
      </section>

      <nav className={styles.buttons} aria-label="Slides">
        <button
          type="button"
          className={styles.step}
          disabled={index <= 0}
          data-testid="remote-previous"
          onClick={() => press('previous')}
        >
          ‹ Previous
        </button>
        <button
          type="button"
          className={`${styles.step} ${styles.forward}`}
          disabled={index >= frames.length - 1}
          data-testid="remote-next-button"
          onClick={() => press('next')}
        >
          Next ›
        </button>
      </nav>
    </main>
  );
}

/** The slide's notes, to read; each slide's scroll is kept. */
function RemoteNotes({ frameId, notes }: { frameId: string; notes: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useNotesScroll(ref, frameId);
  return (
    <div ref={ref} className={styles.notes} data-testid="remote-notes" tabIndex={0}>
      {notes || <span className={styles.empty}>No notes for this slide</span>}
    </div>
  );
}
