import { usePresence } from '@/collab/presence';
import styles from './FollowMeToggle.module.css';

/**
 * Follow me while presenting (asked for on 26 November): the slide controls carry it,
 * since the people bar steps aside on a slide. On, everyone on the board follows the
 * slides; off, they are left free while the presentation goes on. Only on a board with
 * a room — on the signed-out board there is nobody to follow.
 */
export function FollowMeToggle({ compact = false }: { compact?: boolean }) {
  const status = usePresence((state) => state.status);
  const spotlight = usePresence((state) => state.spotlight);
  if (!status) return null;
  return (
    <button
      type="button"
      className={compact ? `${styles.toggle} ${styles.compact}` : styles.toggle}
      role="switch"
      aria-checked={spotlight}
      disabled={status !== 'connected'}
      title={
        spotlight
          ? 'Everyone on the board follows your slides: press to let them go'
          : 'Bring everyone on the board along with your slides'
      }
      data-testid="present-follow-me"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => usePresence.setState({ spotlight: !spotlight })}
    >
      {spotlight ? 'Following you' : 'Follow me'}
    </button>
  );
}
