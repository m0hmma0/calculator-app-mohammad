import type { PresenceState } from '@shared/collab';
import { fitToRect, viewportsEqual, type Viewport } from '@/canvas/viewport';
import { laserSnapshot, onLaserChange } from '@/laser/laserTrail';
import { useBoardStore } from '@/state/boardStore';
import type { RoomConnection } from './connection';
import { PRESENT_PADDING } from '@/workshop/presentation';
import { presenter, usePresence } from './presence';

/** Presence is sent at most this often — smooth enough for a cursor, cheap enough. */
const PRESENCE_MS = 50;
/** A laser trail is long; the newest points are the ones anyone needs to see. */
const MAX_LASER_POINTS = 80;

function currentPresence(): PresenceState {
  const board = useBoardStore.getState();
  const presence = usePresence.getState();
  const now = performance.now();
  const trail = laserSnapshot(now);

  return {
    cursor: presence.cursor,
    selection: board.selection,
    view: {
      x: board.viewport.x,
      y: board.viewport.y,
      zoom: board.viewport.zoom,
      width: board.stageSize.width,
      height: board.stageSize.height,
    },
    laser:
      trail.points.length > 0
        ? {
            lifetimeMs: trail.lifetimeMs,
            points: trail.points.slice(-MAX_LASER_POINTS).map((point) => ({
              x: point.x,
              y: point.y,
              age: Math.round(now - point.at),
            })),
          }
        : null,
    chat: presence.chatOpen || presence.chat ? presence.chat : null,
    spotlight: presence.spotlight,
    present: presence.present,
    following: leaderSession(),
    page: board.page,
  };
}

export interface PresenceHandle {
  /** Sends right away — when someone joins, they should not wait to see you. */
  publishNow: () => void;
  stop: () => void;
}

/**
 * Keeps the room told where this person is and what they are doing, and keeps this
 * person's view on whoever they are following.
 */
export function startPresence(room: RoomConnection): PresenceHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSent = 0;

  const publishNow = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastSent = performance.now();
    room.sendPresence(currentPresence());
  };

  const schedule = () => {
    if (timer) return;
    const wait = Math.max(0, PRESENCE_MS - (performance.now() - lastSent));
    timer = setTimeout(publishNow, wait);
  };

  const stopBoard = useBoardStore.subscribe((state, previous) => {
    if (
      state.selection !== previous.selection ||
      state.viewport !== previous.viewport ||
      state.stageSize !== previous.stageSize ||
      state.page !== previous.page
    ) {
      schedule();
    }
  });
  let lastLeader = leaderSession();
  const stopPresence = usePresence.subscribe((state, previous) => {
    // Whom this browser follows changes as presenters start and stop, too.
    const leader = leaderSession();
    if (leader !== lastLeader) {
      lastLeader = leader;
      schedule();
      return;
    }
    if (
      state.cursor !== previous.cursor ||
      state.chat !== previous.chat ||
      state.chatOpen !== previous.chatOpen ||
      state.spotlight !== previous.spotlight ||
      state.present !== previous.present
    ) {
      schedule();
    }
  });
  const stopLaser = onLaserChange(schedule);
  const stopFollowing = startFollowing();

  return {
    publishNow,
    stop: () => {
      if (timer) clearTimeout(timer);
      stopBoard();
      stopPresence();
      stopLaser();
      stopFollowing();
    },
  };
}

/** The session being followed: chosen by clicking an avatar, or a presenter. */
function leaderSession(presence = usePresence.getState()): string | null {
  if (presence.following && presence.peers[presence.following]) return presence.following;
  return presenter(presence)?.session ?? null;
}

/**
 * The frame a followed presenter is showing — which this screen then shows alone, as
 * theirs does. Null when not following anyone who is presenting.
 */
export function followedFrameId(presence = usePresence.getState()): string | null {
  const session = leaderSession(presence);
  return session ? (presence.peers[session]?.state?.present?.frame ?? null) : null;
}

/**
 * Follow mode: this view tracks the leader's — same zoom, same centre. Moving the
 * view yourself is taken as "stop following", which is what people expect.
 */
function startFollowing(): () => void {
  let applied: Viewport | null = null;

  const apply = () => {
    const session = leaderSession();
    if (!session) {
      applied = null;
      return;
    }
    const leader = usePresence.getState().peers[session]?.state;
    const view = leader?.view;
    if (!view || view.zoom <= 0) return;

    // Following someone means being on their page, too.
    if (leader.page && leader.page !== useBoardStore.getState().page) {
      applied = null;
      useBoardStore.getState().setPage(leader.page);
    }
    const board = useBoardStore.getState();
    // A presenter's frame fills this screen, whatever shape this screen is.
    const frame = leader.present
      ? board.elements.find((element) => element.id === leader.present?.frame)
      : undefined;
    if (frame) {
      const fitted = fitToRect(frame, board.stageSize, PRESENT_PADDING);
      applied = fitted;
      board.setViewport(fitted);
      return;
    }
    // Everything the leader can see fits on this screen, whatever its size or shape:
    // a phone following a desktop zooms out until the desktop's whole view is in it.
    const next: Viewport = fitToRect(
      { x: view.x, y: view.y, w: view.width / view.zoom, h: view.height / view.zoom },
      board.stageSize,
      0,
    );
    applied = next;
    board.setViewport(next);
  };

  const stopPresence = usePresence.subscribe((state, previous) => {
    if (state.peers !== previous.peers || state.following !== previous.following) apply();
  });

  const stopBoard = useBoardStore.subscribe((state, previous) => {
    if (state.viewport === previous.viewport || !applied) return;
    if (viewportsEqual(state.viewport, applied)) return;
    // The view moved, and not because of the leader: this person took the wheel.
    const presence = usePresence.getState();
    const leading = presenter(presence);
    usePresence.setState({
      following: null,
      dismissedSpotlight: leading ? leading.session : presence.dismissedSpotlight,
    });
    applied = null;
  });

  return () => {
    stopPresence();
    stopBoard();
  };
}
