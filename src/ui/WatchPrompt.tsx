import { useEffect } from 'react';
import { usePresence } from '@/collab/presence';
import { followedFrameId, leaderSession } from '@/collab/publish';
import { usePresentation } from '@/workshop/presentation';
import { startWatching, stopWatching, useWatching } from '@/workshop/watching';
import styles from './WatchPrompt.module.css';

/**
 * On the screens of people following a presentation: "Ana is presenting — Watch full
 * screen". While watching, only an Exit for screens that cannot go full screen.
 */
export function WatchPrompt() {
  const presenting = usePresentation((state) => state.presenting);
  const frame = usePresence((state) => followedFrameId(state));
  const leader = usePresence((state) => {
    const session = leaderSession(state);
    return session ? (state.peers[session] ?? null) : null;
  });
  const watching = useWatching((state) => state.watching);
  const dismissed = useWatching((state) => state.dismissed);
  const showing = Boolean(frame) && !presenting;
  const presentation = leader ? `${leader.session}` : null;

  // The presentation ends, or this person stops following: back to the board.
  useEffect(() => {
    if (showing) return;
    if (useWatching.getState().watching) stopWatching();
    // A new presentation is offered afresh, even if this one was waved away.
    useWatching.setState({ dismissed: null });
  }, [showing]);

  if (!showing || !leader) return null;

  if (watching) {
    return (
      <button
        type="button"
        className={styles.exit}
        data-hud
        data-testid="watch-exit"
        onClick={stopWatching}
      >
        Exit full screen
      </button>
    );
  }
  if (dismissed === presentation) return null;

  return (
    <div className={styles.prompt} data-hud role="status" data-testid="watch-prompt">
      <span className={styles.who}>
        <span className={styles.dot} style={{ background: leader.user.color }} aria-hidden="true" />
        {leader.user.name} is presenting
      </span>
      <button
        type="button"
        className={styles.watch}
        data-testid="watch-fullscreen"
        onClick={startWatching}
      >
        Watch full screen
      </button>
      <button
        type="button"
        className={styles.close}
        aria-label="Not now"
        title="Not now"
        data-testid="watch-dismiss"
        onClick={() => useWatching.setState({ dismissed: presentation })}
      >
        ×
      </button>
    </div>
  );
}
