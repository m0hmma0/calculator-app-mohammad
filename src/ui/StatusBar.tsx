import { useBoardStore } from '@/state/boardStore';
import styles from './StatusBar.module.css';

/**
 * Only appears when something is worth saying. Losing the network does not stop the
 * board working — edits keep going into the local document — so this reports the
 * fact rather than raising an alarm.
 */
export function StatusBar() {
  const online = useBoardStore((state) => state.online);
  const hydrated = useBoardStore((state) => state.hydrated);

  if (online && hydrated) return null;

  return (
    <div
      className={`${styles.bar} ${online ? '' : styles.offline}`}
      data-testid={online ? 'status-loading' : 'status-offline'}
      role="status"
    >
      <span className={styles.dot} />
      {online ? 'Loading your board…' : 'Working offline — your changes are saved here'}
    </div>
  );
}
