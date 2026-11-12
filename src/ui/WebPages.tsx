import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Viewport } from '@/canvas/viewport';
import { boardToScreen } from '@/canvas/viewport';
import { usePresence } from '@/collab/presence';
import type { BoardElement } from '@/model/element';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { boardDoc, currentBoardId, useBoardStore } from '@/state/boardStore';
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
import {
  isHtmlCode,
  isWebPage,
  restartPage,
  setActivePage,
  usePages,
  watchPage,
} from '@/webpage/pageStore';
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
        <WebPage key={element.id} element={element} viewport={viewport} />
      ))}
    </>
  );
}

function WebPage({ element, viewport }: { element: BoardElement; viewport: Viewport }) {
  const me = useMe();
  const forced = usePages((state) => state.forcedViewer);
  const watching = usePages((state) => state.watching[element.id] ?? null);
  const restart = usePages((state) => state.restarts[element.id] ?? 0);
  const active = usePages((state) => state.active === element.id);
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

  // Students use their page straight away; someone who edits clicks into it first
  // (double-click, or Use page), so a single click still selects and moves it.
  const usable = own && (!editable || active);

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
      {forced ? null : (
        <PageBar
          element={element}
          me={me}
          leader={leader}
          watching={watching}
          active={active}
          editable={editable}
          show={!editable || selected || active || watching !== null || element.lead === me}
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
      } else if (data?.sabboura === 'escape') {
        setActivePage(null);
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
  active,
  editable,
  show,
  at,
}: {
  element: BoardElement;
  me: string | null;
  leader: string | null;
  watching: string | null;
  active: boolean;
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
      {editable ? (
        <span className={styles.toggle} role="group" aria-label="Show as">
          <button
            type="button"
            aria-pressed={!web}
            data-testid="web-page-code"
            onMouseDown={keep}
            onClick={() => {
              setActivePage(null);
              applyDiscrete(new Map([[element.id, { webView: false }]]));
            }}
          >
            Code
          </button>
          <button
            type="button"
            aria-pressed={web}
            data-testid="web-page-web"
            onMouseDown={keep}
            onClick={() => applyDiscrete(new Map([[element.id, { webView: true }]]))}
          >
            Web
          </button>
        </span>
      ) : null}

      {web && editable && !leader && !watching ? (
        <button
          type="button"
          className={active ? styles.on : undefined}
          data-testid="web-page-use"
          title={active ? 'Back to the board (Escape)' : 'Click and type in the page'}
          onMouseDown={keep}
          onClick={() => setActivePage(active ? null : element.id)}
        >
          {active ? 'Done' : 'Use page'}
        </button>
      ) : null}

      {web && editable ? (
        <button
          type="button"
          aria-pressed={!element.asWritten}
          className={!element.asWritten ? styles.on : undefined}
          title={
            element.asWritten
              ? 'Shown at the size it was written: stretch it to fill the box'
              : 'Fills the box: drag the box to give the page more room. Off: the size it was written'
          }
          data-testid="web-page-fill"
          onMouseDown={keep}
          onClick={() => applyDiscrete(new Map([[element.id, { asWritten: !element.asWritten }]]))}
        >
          Fill box
        </button>
      ) : null}

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
            setActivePage(null);
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
