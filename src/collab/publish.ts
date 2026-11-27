import type { PresenceState } from '@shared/collab';
import { useWatching } from '@/workshop/watching';
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
              m: point.mark,
            })),
          }
        : null,
    chat: presence.chatOpen || presence.chat ? presence.chat : null,
    spotlight: presence.spotlight,
    summoned: presence.summoned.length > 0 ? presence.summoned : undefined,
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
      state.summoned !== previous.summoned ||
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
export function leaderSession(presence = usePresence.getState()): string | null {
  // Someone with this person "On me" comes first: following them is not a choice.
  const forced = presenter(presence)?.session ?? null;
  if (forced) return forced;
  if (presence.following && presence.peers[presence.following]) return presence.following;
  return null;
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
 * view yourself is taken as "stop following", which is what people expect — except
 * when the leader has this person "On me" (27 November): then there is no way out, but
 * they may zoom and look about, until the leader moves on (another slide, another
 * view) or puts them "On me" again, which brings their view back.
 */
function startFollowing(): () => void {
  let applied: Viewport | null = null;
  /** What was last fitted: the leader, and their frame or view, and this screen. */
  let lastKey = '';
  /** A forced follower moved their own view since: left as it is until the leader moves. */
  let ownView = false;

  const apply = () => {
    const session = leaderSession();
    if (!session) {
      applied = null;
      lastKey = '';
      ownView = false;
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
    const watching = useWatching.getState().watching;
    const key = [
      session,
      leader.present?.frame ?? `${view.x},${view.y},${view.zoom},${view.width},${view.height}`,
      board.stageSize.width,
      board.stageSize.height,
      watching,
    ].join('|');
    if (key === lastKey && ownView) return;
    if (key !== lastKey) ownView = false;
    lastKey = key;
    // A presenter's frame fills this screen, whatever shape this screen is.
    const frame = leader.present
      ? board.elements.find((element) => element.id === leader.present?.frame)
      : undefined;
    if (frame) {
      // Watching full screen: edge to edge, as the audience window shows it, so a slide
      // the shape of the screen fills it with no dark bars.
      const fitted = fitToRect(frame, board.stageSize, watching ? 0 : PRESENT_PADDING);
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
  const stopWatching = useWatching.subscribe((state, previous) => {
    if (state.watching !== previous.watching) apply();
  });

  const stopBoard = useBoardStore.subscribe((state, previous) => {
    // This screen changed size (full screen, a phone turned): fit the leader again.
    if (state.stageSize !== previous.stageSize && applied) {
      apply();
      return;
    }
    if (state.viewport === previous.viewport || !applied) return;
    if (viewportsEqual(state.viewport, applied)) return;
    // The view moved, and not because of the leader. Put "On me", this person zooms
    // and looks about but keeps following; following by choice, they took the wheel.
    if (presenter(usePresence.getState())) {
      ownView = true;
      return;
    }
    usePresence.setState({ following: null });
    applied = null;
    lastKey = '';
  });

  return () => {
    stopPresence();
    stopWatching();
    stopBoard();
  };
}
