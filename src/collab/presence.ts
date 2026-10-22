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
          },
        },
      }));
      return;
    }
    default:
      return;
  }
}

/** Peers in a stable order, one entry per open window. */
export function peerList(peers: Record<string, Peer>): Peer[] {
  return Object.values(peers).sort((a, b) => a.session.localeCompare(b.session));
}

/** Whoever is presenting, unless this person has said they would rather not follow. */
export function presenter(store: Pick<PresenceStore, 'peers' | 'dismissedSpotlight'>): Peer | null {
  return (
    peerList(store.peers).find(
      (peer) => peer.state?.spotlight && peer.session !== store.dismissedSpotlight,
    ) ?? null
  );
}
