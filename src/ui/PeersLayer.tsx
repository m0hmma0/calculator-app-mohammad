import { useEffect, useRef, type RefObject } from 'react';
import { boardToScreen, screenToBoard } from '@/canvas/viewport';
import { useHistory } from '@/collab/history';
import { peerList, presenter, usePresence } from '@/collab/presence';
import { elementAABB } from '@/model/bounds';
import { FIRST_PAGE } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';
import styles from './PeersLayer.module.css';

/** A chat message stays readable this long after its author stops typing. */
const CHAT_LINGER_MS = 4000;

/**
 * Everyone else on the board, drawn over the canvas: their pointer with their name,
 * an outline in their colour around what they have selected, and anything they are
 * saying in cursor chat. Also tracks this person's own pointer for everyone else.
 */
export function PeersLayer({ hostRef }: { hostRef: RefObject<HTMLElement | null> }) {
  const peers = usePresence((state) => state.peers);
  const chatOpen = usePresence((state) => state.chatOpen);
  const chat = usePresence((state) => state.chat);
  const cursor = usePresence((state) => state.cursor);
  const following = usePresence((state) => state.following);
  const dismissed = usePresence((state) => state.dismissedSpotlight);
  const outlined = usePresence((state) => state.outlined);
  const viewport = useBoardStore((state) => state.viewport);
  const elements = useBoardStore((state) => state.elements);
  const page = useBoardStore((state) => state.page);
  // Looking at an old version: what people have selected now does not belong on it.
  const previewing = useHistory((state) => state.preview !== null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const at = screenToBoard(useBoardStore.getState().viewport, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      usePresence.setState({ cursor: { x: at.x, y: at.y } });
    };
    const onLeave = () => usePresence.setState({ cursor: null });
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [hostRef]);

  useEffect(
    () => () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
    },
    [],
  );

  const closeChat = () => {
    usePresence.setState({ chatOpen: false });
    if (lingerTimer.current) clearTimeout(lingerTimer.current);
    lingerTimer.current = setTimeout(() => {
      if (!usePresence.getState().chatOpen) usePresence.setState({ chat: '' });
    }, CHAT_LINGER_MS);
  };

  const byId = new Map(elements.map((element) => [element.id, element]));
  // Someone on another page is not pointing at anything here.
  const list = peerList(peers).filter((peer) => (peer.state?.page ?? FIRST_PAGE) === page);
  const leaderSession =
    following && peers[following]
      ? following
      : (presenter({ peers, dismissedSpotlight: dismissed })?.session ?? null);
  const leader = leaderSession ? peers[leaderSession] : null;
  const chatAt = cursor ? boardToScreen(viewport, cursor) : null;

  return (
    <div className={styles.layer} data-hud data-present-keep>
      {list.map((peer) =>
        (previewing ? [] : (peer.state?.selection ?? [])).map((id, index) => {
          const element = byId.get(id);
          if (!element) return null;
          const box = elementAABB(element);
          const topLeft = boardToScreen(viewport, { x: box.x, y: box.y });
          return (
            <div
              key={`${peer.session}:${id}`}
              className={styles.halo}
              data-testid="peer-selection"
              data-peer={peer.session}
              style={{
                left: topLeft.x - 3,
                top: topLeft.y - 3,
                width: box.w * viewport.zoom + 6,
                height: box.h * viewport.zoom + 6,
                borderColor: peer.user.color,
              }}
            >
              {index === 0 ? (
                <span className={styles.haloName} style={{ background: peer.user.color }}>
                  {peer.user.name}
                </span>
              ) : null}
            </div>
          );
        }),
      )}

      {list.map((peer) => {
        const at = peer.state?.cursor;
        if (!at) return null;
        const point = boardToScreen(viewport, at);
        return (
          <div
            key={peer.session}
            className={styles.cursor}
            data-testid="peer-cursor"
            data-peer={peer.session}
            style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
          >
            <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true">
              <path
                d="M1.5 1.5 16 9.6l-6.4 1.6-2.9 6.3Z"
                fill={peer.user.color}
                stroke="#fff"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            <span className={styles.name} style={{ background: peer.user.color }}>
              {peer.user.name}
            </span>
            {peer.state?.chat ? (
              <span
                className={styles.bubble}
                style={{ borderColor: peer.user.color }}
                data-testid="peer-chat"
              >
                {peer.state.chat}
              </span>
            ) : null}
          </div>
        );
      })}

      {chatOpen ? (
        <input
          className={styles.chatInput}
          style={
            chatAt
              ? { left: chatAt.x + 16, top: chatAt.y + 18 }
              : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
          }
          // It appears because the person pressed "/" to talk, so it takes the keys.
          autoFocus
          maxLength={120}
          placeholder="Say something…"
          aria-label="Cursor chat"
          data-testid="chat-input"
          value={chat}
          onChange={(event) => usePresence.setState({ chat: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeChat();
            }
          }}
          onBlur={closeChat}
        />
      ) : null}

      {/* The edges of other people's screens, so whoever is presenting can keep
          what they show inside what everyone can see. */}
      {list
        .filter((peer) => outlined[peer.session] && peer.state?.view)
        .map((peer) => {
          const view = peer.state!.view;
          const topLeft = boardToScreen(viewport, { x: view.x, y: view.y });
          const scale = viewport.zoom / view.zoom;
          return (
            <div
              key={`outline:${peer.session}`}
              className={styles.outline}
              style={{
                left: topLeft.x,
                top: topLeft.y,
                width: view.width * scale,
                height: view.height * scale,
                borderColor: peer.user.color,
              }}
              data-testid={`peer-outline-${peer.session}`}
            >
              <span style={{ background: peer.user.color }}>{peer.user.name}'s screen</span>
            </div>
          );
        })}

      {/* Following someone: a thin frame in their colour says so, and takes no room. */}
      {leader ? (
        <div
          className={styles.followingFrame}
          style={{ borderColor: leader.user.color }}
          data-testid="following-frame"
          data-leader={leader.session}
          aria-label={`Following ${leader.user.name}`}
        />
      ) : null}
    </div>
  );
}
