import { selectIsOwner, useBoardAccess } from '@/sharing/boardAccess';
import { useEffect, useRef, useState } from 'react';
import {
  followsMe,
  isMyOtherWindow,
  peerList,
  presenter,
  toggleOutline,
  usePresence,
  type Peer,
} from '@/collab/presence';
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
 * Who is here, and the room's state. Clicking someone opens their card: whether
 * they are following you, following them yourself, and outlining their screen on
 * the board. "Present" asks everyone else to follow you.
 */
export function PeerBar() {
  const status = usePresence((state) => state.status);
  const self = usePresence((state) => state.self);
  const mySession = usePresence((state) => state.session);
  const peers = usePresence((state) => state.peers);
  const following = usePresence((state) => state.following);
  const spotlight = usePresence((state) => state.spotlight);
  const summoned = usePresence((state) => state.summoned);
  const owner = useBoardAccess(selectIsOwner);
  const [card, setCard] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!card) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setCard(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCard(null);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [card]);

  if (!status) return null;
  // The owner's own other windows and devices are not shown to them (27 November): one
  // of them is not someone else on the board. Anyone else's show as they are.
  const list = peerList(peers).filter((peer) => !(owner && isMyOtherWindow(peer, self)));
  const leading = presenter({ peers, self, session: mySession });
  const open = card ? peers[card] : undefined;
  // How many are following this person right now — shown on the Present button.
  const followers = list.filter((peer) => followsMe(peer, mySession)).length;

  return (
    <div className={styles.bar} ref={ref}>
      <span className={styles.status} data-status={status} data-testid="connection-status">
        <span className={styles.dot} aria-hidden="true" />
        {STATUS_LABEL[status]}
      </span>

      <div className={styles.stack} data-testid="avatar-stack">
        {list.map((peer) => {
          const active = following === peer.session || leading?.session === peer.session;
          const watching = followsMe(peer, mySession);
          return (
            <button
              key={peer.session}
              type="button"
              className={styles.peer}
              aria-pressed={active}
              aria-expanded={card === peer.session}
              title={`${peer.user.name}${watching ? ' — following you' : ''}`}
              data-testid="peer-avatar"
              data-session={peer.session}
              data-follows-me={watching || undefined}
              onClick={() => setCard(card === peer.session ? null : peer.session)}
            >
              <Avatar user={peer.user} />
              {watching ? (
                <span className={styles.watching} aria-hidden="true" data-testid="follows-you">
                  <EyeIcon />
                </span>
              ) : null}
              {peer.state?.spotlight ? (
                <span className={styles.live} title="Presenting" data-testid="peer-presenting">
                  <PlayIcon />
                </span>
              ) : null}
            </button>
          );
        })}
        {self ? (
          <span className={styles.self} title={`${self.name} (you)`}>
            <Avatar user={self} />
          </span>
        ) : null}
      </div>

      {open ? (
        <PeerCard
          peer={open}
          mySession={mySession}
          following={following === open.session || leading?.session === open.session}
          // Someone with this person "On me" is followed, chosen or not.
          forced={leading?.session === open.session}
          onFollow={(follow) => usePresence.setState({ following: follow ? open.session : null })}
          peers={peers}
          // The owner (or a co-owner) may put one person "On me".
          summoned={owner ? summoned.includes(open.session) : null}
          onSummon={(on) =>
            usePresence.setState((state) => ({
              summoned: on
                ? [...state.summoned.filter((each) => each !== open.session), open.session]
                : state.summoned.filter((each) => each !== open.session),
            }))
          }
        />
      ) : null}

      {/* Presenting is the owner's. */}
      {owner ? (
        <button
          type="button"
          className={styles.action}
          aria-pressed={spotlight}
          disabled={status !== 'connected'}
          title={
            spotlight
              ? 'Everyone is on you: they follow your view, and cannot leave it. Press to let them go'
              : 'Put everyone on you: they follow your view, and can only zoom'
          }
          data-testid="spotlight"
          onClick={() => usePresence.setState({ spotlight: !spotlight })}
        >
          {spotlight ? 'On you' : 'On me'}
          {spotlight && list.length > 0 ? (
            <span
              className={styles.followers}
              title={`${followers} of ${list.length} following you`}
              data-testid="follower-count"
            >
              {followers}/{list.length}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}

function PeerCard({
  peer,
  mySession,
  following,
  forced,
  onFollow,
  peers,
  summoned,
  onSummon,
}: {
  peer: Peer;
  mySession: string | null;
  following: boolean;
  /** They have this person "On me": following them is not a choice. */
  forced: boolean;
  onFollow: (follow: boolean) => void;
  peers: Record<string, Peer>;
  /** Whether this one person is "On me"; null where that is not this person's to say. */
  summoned: boolean | null;
  onSummon: (on: boolean) => void;
}) {
  const outlined = usePresence((state) => Boolean(state.outlined[peer.session]));
  const theirLeader = peer.state?.following ?? null;
  const status = followsMe(peer, mySession)
    ? 'Following you'
    : theirLeader && peers[theirLeader]
      ? `Following ${peers[theirLeader]!.user.name}`
      : 'Not following anyone';

  return (
    <div className={styles.card} role="dialog" aria-label={peer.user.name} data-testid="peer-card">
      <div className={styles.cardHead}>
        <Avatar user={peer.user} size={30} />
        <div>
          <strong>{peer.user.name}</strong>
          <span
            className={styles.cardStatus}
            data-follows-me={followsMe(peer, mySession) || undefined}
            data-testid="peer-follow-status"
          >
            {status}
          </span>
        </div>
      </div>
      <button
        type="button"
        className={styles.cardButton}
        aria-pressed={following}
        disabled={forced}
        title={forced ? 'They have you on them' : undefined}
        data-testid="peer-follow"
        onClick={() => onFollow(!following)}
      >
        {forced ? 'On them' : following ? 'Stop following them' : 'Follow their view'}
      </button>
      {summoned !== null ? (
        <button
          type="button"
          role="switch"
          className={styles.cardButton}
          aria-checked={summoned}
          title="Only this person follows your view, and cannot leave it"
          data-testid="peer-summon"
          onClick={() => onSummon(!summoned)}
        >
          {summoned ? 'On you — let them go' : 'On me'}
        </button>
      ) : null}
      <button
        type="button"
        role="switch"
        className={styles.cardButton}
        aria-checked={outlined}
        disabled={!peer.state?.view}
        title="Draw the edges of their screen on the board, to keep within what they see"
        data-testid="peer-outline"
        onClick={() => toggleOutline(peer.session)}
      >
        <span className={styles.switch} aria-hidden="true" />
        Show their screen edges
      </button>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l9.5-5.5z" fill="currentColor" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
    </svg>
  );
}
