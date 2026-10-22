import { openHistory, useHistory } from '@/collab/history';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useComments } from '@/sharing/comments';
import { peerList, presenter, usePresence, type Peer } from '@/collab/presence';
import type { PeerIdentity } from '@shared/collab';
import styles from './PeerBar.module.css';

const STATUS_LABEL = {
  connecting: 'Connecting…',
  connected: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
  refused: 'Not available',
} as const;

function initials(name: string): string {
  // "Layla (guest)" is Layla: the note in brackets is not part of the name.
  const parts = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/);
  return (
    ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase() ||
    '?'
  );
}

function Avatar({ user, size = 26 }: { user: PeerIdentity; size?: number }) {
  return user.picture ? (
    <img
      src={user.picture}
      alt=""
      className={styles.avatar}
      style={{ width: size, height: size, borderColor: user.color }}
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, background: user.color, borderColor: user.color }}
      aria-hidden="true"
    >
      {initials(user.name)}
    </span>
  );
}

/**
 * Who is here, and the room's state. Clicking someone follows their view; clicking
 * again stops. "Present" asks everyone else to follow you.
 */
export function PeerBar() {
  const status = usePresence((state) => state.status);
  const self = usePresence((state) => state.self);
  const peers = usePresence((state) => state.peers);
  const following = usePresence((state) => state.following);
  const spotlight = usePresence((state) => state.spotlight);
  const dismissed = usePresence((state) => state.dismissedSpotlight);
  const historyOpen = useHistory((state) => state.open);
  const editable = useBoardAccess(selectCanEdit);
  const commentsOpen = useComments((state) => state.visible);
  const openThreads = useComments(
    (state) =>
      state.comments.filter((comment) => comment.threadId === comment.id && !comment.resolvedAt)
        .length,
  );

  if (!status) return null;
  const list = peerList(peers);
  const leading = presenter({ peers, dismissedSpotlight: dismissed });

  const toggleFollow = (peer: Peer) =>
    usePresence.setState({
      following: following === peer.session ? null : peer.session,
      // Choosing someone yourself overrides an ongoing presentation.
      dismissedSpotlight: leading && leading.session !== peer.session ? leading.session : dismissed,
    });

  return (
    <div className={styles.bar}>
      <span className={styles.status} data-status={status} data-testid="connection-status">
        <span className={styles.dot} aria-hidden="true" />
        {STATUS_LABEL[status]}
      </span>

      <div className={styles.stack} data-testid="avatar-stack">
        {list.map((peer) => {
          const active = following === peer.session || leading?.session === peer.session;
          return (
            <button
              key={peer.session}
              type="button"
              className={styles.peer}
              aria-pressed={active}
              title={
                active ? `Stop following ${peer.user.name}` : `Follow ${peer.user.name}'s view`
              }
              data-testid="peer-avatar"
              data-session={peer.session}
              onClick={() => toggleFollow(peer)}
            >
              <Avatar user={peer.user} />
              {peer.state?.spotlight ? <span className={styles.live}>presenting</span> : null}
            </button>
          );
        })}
        {self ? (
          <span className={styles.self} title={`${self.name} (you)`}>
            <Avatar user={self} />
          </span>
        ) : null}
      </div>

      <button
        type="button"
        className={styles.action}
        aria-pressed={spotlight}
        disabled={status !== 'connected'}
        title="Everyone on the board follows your view"
        data-testid="spotlight"
        onClick={() => usePresence.setState({ spotlight: !spotlight })}
      >
        {spotlight ? 'Stop presenting' : 'Present'}
      </button>
      <button
        type="button"
        className={styles.action}
        aria-pressed={commentsOpen}
        title="Comments"
        data-testid="open-comments"
        onClick={() =>
          useComments.setState({ visible: !commentsOpen, placing: false, draftAt: null })
        }
      >
        Comments{openThreads > 0 ? ` (${openThreads})` : ''}
      </button>
      {editable ? (
        <button
          type="button"
          className={styles.action}
          aria-pressed={historyOpen}
          disabled={status !== 'connected'}
          title="Version history"
          data-testid="open-history"
          onClick={openHistory}
        >
          History
        </button>
      ) : null}
    </div>
  );
}
