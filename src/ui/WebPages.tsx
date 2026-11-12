import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Viewport } from '@/canvas/viewport';
import { boardToScreen } from '@/canvas/viewport';
import { usePresence } from '@/collab/presence';
import type { BoardElement } from '@/model/element';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { boardDoc, currentBoardId, effectiveTool, useBoardStore } from '@/state/boardStore';
import {
  appendMine,
  clearMine,
  eventsOf,
  logsOf,
  mayKeepLog,
  PAGE_ORIGIN,
  peopleOf,
  type PageEvent,
} from '@/webpage/logs';
import { isHtmlCode, isWebPage, restartPage, usePages, watchPage } from '@/webpage/pageStore';
import { hashOf, pageSource } from '@/webpage/shim';
import styles from './WebPages.module.css';

/** Who this screen is on the board: an account, a guest, or the signed-out board's one. */
function useMe(): string | null {
  const self = usePresence((state) => state.self);
  return self?.uid ?? (currentBoardId() === null ? 'local' : null);
}

/**
 * The board's web pages: each live in a walled-off frame laid out in board units and
 * scaled with the board, with a few controls above it. Rendered inside the embed layer,
 * so a slide's clip and a transition's pause apply to pages as to videos.
 */
export function WebPages({
  elements,
  viewport,
}: {
  elements: readonly BoardElement[];
  viewport: Viewport;
}) {
  const pages = elements.filter((element) => isHtmlCode(element) && !element.hidden);
  if (pages.length === 0) return null;
  return (
    <>
      {pages.map((element) => (
        <WebPage
          key={element.id}
          element={element}
          viewport={viewport}
          over={isWebPage(element) ? itemsOver(element, elements) : []}
        />
      ))}
    </>
  );
}

/**
 * What lies over a page and takes a click: notes, shapes, stamps, pictures above it
 * in the stack and overlapping it. Pen and highlighter strokes are left out, so
 * writing on a page does not stop it being used under the ink.
 */
function itemsOver(page: BoardElement, elements: readonly BoardElement[]): BoardElement[] {
  return elements.filter(
    (element) =>
      element.id !== page.id &&
      !element.hidden &&
      element.type !== 'path' &&
      element.type !== 'frame' &&
      element.z > page.z &&
      element.x < page.x + page.w &&
      element.x + element.w > page.x &&
      element.y < page.y + page.h &&
      element.y + element.h > page.y,
  );
}

/** The page's edge, in screen pixels, that the board keeps: select and move it there. */
const EDGE = 10;

function WebPage({
  element,
  viewport,
  over,
}: {
  element: BoardElement;
  viewport: Viewport;
  over: BoardElement[];
}) {
  const me = useMe();
  const forced = usePages((state) => state.forcedViewer);
  const watching = usePages((state) => state.watching[element.id] ?? null);
  const restart = usePages((state) => state.restarts[element.id] ?? 0);
  const editable = useBoardAccess(selectCanEdit);
  const selected = useBoardStore((state) => state.selection.includes(element.id));
  const web = isWebPage(element);

  // Whose page this screen shows: the presenter's in the audience window; the leader's
  // while someone leads (unless it is this person); someone watched; or one's own.
  const leader = element.lead && element.lead !== me ? element.lead : null;
  const viewing = forced ?? leader ?? watching ?? me;
  const own = !forced && viewing === me;

  const topLeft = boardToScreen(viewport, { x: element.x, y: element.y });
  const half = { x: element.w / 2, y: element.h / 2 };
  const scaled: CSSProperties = {
    left: topLeft.x,
    top: topLeft.y,
    width: element.w,
    height: element.h,
    opacity: element.opacity,
    transform:
      `scale(${viewport.zoom})` +
      (element.rotation
        ? ` translate(${half.x}px, ${half.y}px) rotate(${element.rotation}rad) translate(${-half.x}px, ${-half.y}px)`
        : ''),
  };

  // The page answers the pointer as soon as it is over it — for someone who edits, with
  // the select tool in hand; for anyone else, with anything but the laser. Any other
  // tool draws on the board over the page, and its edge selects and moves it.
  const tool = useBoardStore((state) => effectiveTool(state));
  const usable = own && (editable ? tool === 'select' : tool !== 'laser');
  const screen = {
    left: topLeft.x,
    top: topLeft.y,
    width: element.w * viewport.zoom,
    height: element.h * viewport.zoom,
  };

  return (
    <>
      {web && viewing ? (
        <PageFrame
          key={`${viewing}:${hashOf(element.text ?? '')}:${restart}:${element.asWritten ? 'as' : 'fill'}`}
          element={element}
          viewing={viewing}
          own={own}
          usable={usable}
          style={scaled}
        />
      ) : null}
      {web && !viewing ? (
        <div className={styles.waiting} style={scaled}>
          Connecting…
        </div>
      ) : null}
      {web && usable ? (
        <>
          {/* The board keeps the edge, and whatever lies over the page. */}
          <div className={styles.edge} style={{ ...screen, height: EDGE }} />
          <div
            className={styles.edge}
            style={{ ...screen, top: screen.top + screen.height - EDGE, height: EDGE }}
          />
          <div className={styles.edge} style={{ ...screen, width: EDGE }} />
          <div
            className={styles.edge}
            style={{ ...screen, left: screen.left + screen.width - EDGE, width: EDGE }}
          />
          {over.map((item) => {
            const corner = boardToScreen(viewport, { x: item.x, y: item.y });
            return (
              <div
                key={item.id}
                className={styles.edge}
                style={{
                  left: corner.x,
                  top: corner.y,
                  width: item.w * viewport.zoom,
                  height: item.h * viewport.zoom,
                }}
                data-testid="web-page-over"
              />
            );
          })}
        </>
      ) : null}
      {forced ? null : (
        <PageBar
          element={element}
          me={me}
          leader={leader}
          watching={watching}
          editable={editable}
          show={web && (!editable || selected || watching !== null || element.lead === me)}
          at={{ left: topLeft.x, top: topLeft.y }}
        />
      )}
    </>
  );
}

function PageFrame({
  element,
  viewing,
  own,
  usable,
  style,
}: {
  element: BoardElement;
  viewing: string;
  own: boolean;
  usable: boolean;
  style: CSSProperties;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const html = element.text ?? '';
  const fill = !element.asWritten;
  const source = useMemo(() => pageSource(html, element.id, fill), [html, element.id, fill]);

  useEffect(() => {
    const board = boardDoc();
    let sent = 0;
    let ready = false;
    const post = (message: unknown) => frameRef.current?.contentWindow?.postMessage(message, '*');

    const sendNew = (catchUp: boolean) => {
      const events = eventsOf(board, element.id, viewing);
      // Started over: the page starts over too.
      if (events.length < sent) return restartPage(element.id);
      const fresh = events.slice(sent);
      sent = events.length;
      if (fresh.length > 0 || catchUp)
        post({ sabboura: 'replay', events: fresh, catchUp, live: own });
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { sabboura?: string; event?: PageEvent } | null;
      if (data?.sabboura === 'ready') {
        ready = true;
        sendNew(true);
      } else if (data?.sabboura === 'event' && own && data.event) {
        appendMine(board, element.id, [data.event]);
      }
    };
    window.addEventListener('message', onMessage);

    const logs = logsOf(board);
    const onChange = (_events: unknown, transaction: { origin: unknown }) => {
      if (!ready) return;
      // This screen's own steps are on the page already.
      if (own && transaction.origin === PAGE_ORIGIN) {
        sent = eventsOf(board, element.id, viewing).length;
        return;
      }
      sendNew(false);
    };
    logs.observeDeep(onChange);
    return () => {
      window.removeEventListener('message', onMessage);
      logs.unobserveDeep(onChange);
    };
  }, [element.id, viewing, own]);

  return (
    <iframe
      ref={frameRef}
      className={styles.frame}
      style={{ ...style, pointerEvents: usable ? 'auto' : 'none' }}
      srcDoc={source}
      title={`Web page ${element.id}`}
      // Scripts, forms, pop-ups and alerts; never the board's own origin, so the page
      // cannot reach the whiteboard, its sign-in or its storage.
      sandbox="allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock"
      allow="fullscreen; autoplay; clipboard-write"
      referrerPolicy="no-referrer"
      data-testid="web-page"
      data-viewing={viewing}
      data-usable={usable || undefined}
    />
  );
}

/** A page's controls, above its top-left corner. */
function PageBar({
  element,
  me,
  leader,
  watching,
  editable,
  show,
  at,
}: {
  element: BoardElement;
  me: string | null;
  leader: string | null;
  watching: string | null;
  editable: boolean;
  show: boolean;
  at: { left: number; top: number };
}) {
  const applyDiscrete = useBoardStore((state) => state.applyDiscrete);
  const peers = usePresence((state) => state.peers);
  const [people, setPeople] = useState(() => peopleOf(boardDoc(), element.id));
  const web = isWebPage(element);

  // The list of who has used it stays current while the bar is up.
  useEffect(() => {
    if (!show) return;
    const board = boardDoc();
    const refresh = () => setPeople(peopleOf(board, element.id));
    refresh();
    const logs = logsOf(board);
    logs.observe(refresh);
    return () => logs.unobserve(refresh);
  }, [show, element.id]);

  if (!show) return null;
  const nameOf = (person: string | null) =>
    !person
      ? ''
      : (people.find((each) => each.person === person)?.name ??
        Object.values(peers).find((peer) => peer.user.uid === person)?.user.name ??
        'the teacher');
  const keep = (event: { preventDefault: () => void }) => event.preventDefault();
  const others = people.filter((each) => each.person !== me && each.count > 0);

  return (
    <div
      className={styles.bar}
      style={{ left: at.left, top: at.top }}
      data-hud
      data-media-controls
      data-testid="web-page-bar"
    >
      {web && editable && me ? (
        <button
          type="button"
          aria-pressed={element.lead === me}
          className={element.lead === me ? styles.on : undefined}
          title="Everyone's copy of this page follows what you do in yours"
          data-testid="web-page-lead"
          onMouseDown={keep}
          onClick={() =>
            applyDiscrete(new Map([[element.id, { lead: element.lead === me ? null : me }]]))
          }
        >
          {element.lead === me ? 'Everyone sees mine ●' : 'Everyone sees mine'}
        </button>
      ) : null}

      {web && editable ? (
        <select
          aria-label="Watch someone's page"
          value={watching ?? ''}
          data-testid="web-page-watch"
          onChange={(event) => {
            watchPage(element.id, event.target.value || null);
          }}
        >
          <option value="">{others.length ? 'Watch…' : 'Nobody else yet'}</option>
          {others.map((each) => (
            <option key={each.person} value={each.person}>
              {each.name} ({each.count})
            </option>
          ))}
        </select>
      ) : null}

      {web && !leader && !watching ? (
        <button
          type="button"
          title="Clear what you did in this page and start again"
          data-testid="web-page-restart"
          onMouseDown={keep}
          onClick={() => {
            const board = boardDoc();
            if (mayKeepLog(board)) clearMine(board, element.id);
            restartPage(element.id);
          }}
        >
          Start over
        </button>
      ) : null}

      {web && leader ? (
        <span className={styles.status} data-testid="web-page-following">
          Following {nameOf(leader)}’s page
        </span>
      ) : null}
      {web && watching ? (
        <span className={styles.status} data-testid="web-page-watching">
          Watching {nameOf(watching)}
        </span>
      ) : null}
    </div>
  );
}
