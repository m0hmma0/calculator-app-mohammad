import { usePresence } from '@/collab/presence';
import { useUploads, type UploadState } from '@/media/uploads';
import { useBoardStore } from '@/state/boardStore';
import styles from './StatusBar.module.css';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function uploadMessage(uploads: UploadState[]): { text: string; testId: string } | null {
  if (uploads.length === 0) return null;

  const active = uploads.filter((upload) => upload.status === 'uploading');
  if (active.length > 0) {
    const total = active.reduce((sum, upload) => sum + upload.total, 0);
    const loaded = active.reduce((sum, upload) => sum + upload.loaded, 0);
    const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
    return {
      text: `Uploading ${plural(active.length, 'image')} · ${percent}%`,
      testId: 'status-uploading',
    };
  }

  const rejected = uploads.filter((upload) => upload.status === 'rejected').length;
  if (rejected > 0) {
    return {
      text: `${plural(rejected, 'image')} could not be stored`,
      testId: 'status-upload-rejected',
    };
  }
  return {
    text: `${plural(uploads.length, 'image')} waiting to upload — will retry`,
    testId: 'status-upload-waiting',
  };
}

/**
 * Only appears when something is worth saying. Losing the network does not stop the
 * board working — edits keep going into the local document — so this reports the
 * fact rather than raising an alarm. Images still on their way say so too: until
 * they land, nobody else can see them.
 */
export function StatusBar() {
  const online = useBoardStore((state) => state.online);
  const hydrated = useBoardStore((state) => state.hydrated);
  const uploads = useUploads((state) => state.byId);
  const connection = usePresence((state) => state.status);

  const upload = uploadMessage(Object.values(uploads));

  if (!online) {
    return (
      <div
        className={`${styles.bar} ${styles.offline}`}
        data-present-hide
        data-testid="status-offline"
        role="status"
      >
        <span className={styles.dot} />
        Working offline — your changes are saved here
      </div>
    );
  }

  if (connection === 'reconnecting') {
    return (
      <div
        className={`${styles.bar} ${styles.offline}`}
        data-present-hide
        data-testid="status-reconnecting"
        role="status"
      >
        <span className={styles.dot} />
        Reconnecting — your changes are kept here and will sync
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className={styles.bar} data-present-hide data-testid="status-loading" role="status">
        <span className={styles.dot} />
        Loading your board…
      </div>
    );
  }

  if (!upload) return null;

  return (
    <div
      className={`${styles.bar} ${styles.busy}`}
      data-present-hide
      data-testid={upload.testId}
      role="status"
    >
      <span className={styles.dot} />
      {upload.text}
    </div>
  );
}
