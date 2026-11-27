import { create } from 'zustand';
import type { PeerIdentity, PresenceState, ServerMessage } from '@shared/collab';
import type { LaserPoint } from '@/laser/laser';
import type { ConnectionStatus } from './connection';

export interface Peer {
  session: string;
  user: PeerIdentity;
  state: PresenceState | null;
  /** The peer's laser, converted to this browser's clock so it fades on time here. */
  laser: { points: LaserPoint[]; lifetimeMs: number } | null;
  /** When their pointer last moved, on this browser's clock: still for long, it hides. */
  cursorAt?: number;
}

interface PresenceStore {
  /** Null on the local board, which has no room. */
  status: ConnectionStatus | null;
  /** True once the first exchange with the room has finished. */
  synced: boolean;
  session: string | null;
  self: PeerIdentity | null;
  peers: Record<string, Peer>;

  /** The session whose view this browser is following, if any. */
  following: string | null;
  /** A presenter this person chose to stop following; not re-followed automatically. */
  dismissedSpotlight: string | null;
  /** This person is presenting. */
  spotlight: boolean;
  /** Sessions this person has put "On me" one by one (27 November). */
  summoned: string[];
  /** Sessions whose screen edges are outlined on this board, for presenting within them. */
  outlined: Record<string, true>;
  /** The frame this person is presenting, in presentation mode. */
  present: { frame: string } | null;

  /** Cursor chat: open while typing, and the words being typed. */
  chatOpen: boolean;
  chat: string;
  /** Where this person's pointer is, in board coordinates, or null off the canvas. */
  cursor: { x: number; y: number } | null;
  /** The room's clock minus this one, so shared timers agree across screens. */
  clockOffset: number;
}

const initial = {
  status: null,
  synced: false,
  session: null,
  self: null,
  peers: {},
  following: null,
  dismissedSpotlight: null,
  spotlight: false,
  summoned: [],
  outlined: {},
  present: null,
  chatOpen: false,
  chat: '',
  cursor: null,
  clockOffset: 0,
} satisfies PresenceStore;

export const usePresence = create<PresenceStore>(() => ({ ...initial }));

export function resetPresence(): void {
  usePresence.setState({ ...initial });
}

/** The room's view of who is here, folded into the store. */
export function applyServerMessage(message: ServerMessage): void {
  switch (message.t) {
    case 'ready':
      usePresence.setState({
        session: message.session,
        self: message.you,
        clockOffset: message.now - Date.now(),
        peers: Object.fromEntries(
          message.peers.map((peer) => [
            peer.session,
            { session: peer.session, user: peer.user, state: null, laser: null },
          ]),
        ),
      });
      return;
    case 'join':
      usePresence.setState((current) => ({
        peers: {
          ...current.peers,
          [message.session]: {
            session: message.session,
            user: message.user,
            state: null,
            laser: null,
          },
        },
      }));
      return;
    case 'leave':
      usePresence.setState((current) => {
        const peers = { ...current.peers };
        delete peers[message.session];
        return {
          peers,
          following: current.following === message.session ? null : current.following,
        };
      });
      return;
    case 'presence': {
      const now = performance.now();
      const laser = message.state.laser
        ? {
            lifetimeMs: message.state.laser.lifetimeMs,
            points: message.state.laser.points.map((point) => ({
              x: point.x,
              y: point.y,
              at: now - point.age,
              mark: point.m,
            })),
          }
        : null;
      usePresence.setState((current) => ({
        peers: {
          ...current.peers,
          [message.session]: {
            session: message.session,
            user: message.user,
            state: message.state,
            laser,
            cursorAt: sameCursor(
              current.peers[message.session]?.state?.cursor,
              message.state.cursor,
            )
              ? (current.peers[message.session]?.cursorAt ?? now)
              : now,
          },
        },
        // Saying "stop following" holds for that presentation only: once they stop
        // presenting, their next presentation brings this person along again.
        dismissedSpotlight:
          current.dismissedSpotlight === message.session && !message.state.spotlight
            ? null
            : current.dismissedSpotlight,
      }));
      return;
    }
    default:
      return;
  }
}

const sameCursor = (
  a: { x: number; y: number } | null | undefined,
  b: { x: number; y: number } | null | undefined,
) => (a ?? null) === (b ?? null) || (a != null && b != null && a.x === b.x && a.y === b.y);

/** A pointer that has not moved for this long is hidden, the presenter's too (27 November). */
export const CURSOR_IDLE_MS = 2000;

/** Peers in a stable order, one entry per open window. */
export function peerList(peers: Record<string, Peer>): Peer[] {
  return Object.values(peers).sort((a, b) => a.session.localeCompare(b.session));
}

/**
 * Whoever has everyone — or this person alone — on them ("On me"): followed, and since
 * 27 November without a way out but their own zoom. One's own other window or device
 * is never followed (26 November): edit in one, present in the other. A guest has no
 * account to share.
 */
export function presenter(
  store: Pick<PresenceStore, 'peers'> & {
    self?: PeerIdentity | null;
    session?: string | null;
  },
): Peer | null {
  return (
    peerList(store.peers).find(
      (peer) =>
        (peer.state?.spotlight ||
          (store.session && peer.state?.summoned?.includes(store.session))) &&
        !isMyOtherWindow(peer, store.self ?? null),
    ) ?? null
  );
}

/** Another window or device of this same signed-in person. */
export function isMyOtherWindow(peer: Peer, self: PeerIdentity | null): boolean {
  return Boolean(self && !self.uid.startsWith('guest:') && peer.user.uid === self.uid);
}

/** Shows or hides the outline of someone's screen on this board. */
export function toggleOutline(session: string): void {
  usePresence.setState((current) => {
    const outlined = { ...current.outlined };
    if (outlined[session]) delete outlined[session];
    else outlined[session] = true;
    return { outlined };
  });
}

/** True when this peer's view is following this browser. */
export function followsMe(peer: Peer, mySession: string | null): boolean {
  return mySession !== null && peer.state?.following === mySession;
}
