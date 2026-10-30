import { useEffect, useState } from 'react';
import type { NotificationRecord } from '@shared/sharing';
import { api } from '@/api/client';
import { Link } from '@/router/router';
import styles from './NotificationBell.module.css';

/**
 * Checked this often while the dashboard is open and in view, so a mention arrives
 * without a reload; a tab in the background is checked again when it comes back.
 */
const POLL_MS = 30_000;

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Shares and @mentions addressed to this account. There is no email: these are kept
 * against the address and shown here, including ones from before this person ever
 * signed in.
 */
export function NotificationBell() {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .notifications()
        .then(({ notifications }) => live && setItems(notifications))
        // Quietly: a missed check is caught by the next one.
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onShown = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onShown);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShown);
    };
  }, []);

  const unread = items.filter((item) => item.readAt === null).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      void api
        .readNotifications()
        .then(() =>
          setItems((current) =>
            current.map((item) => ({ ...item, readAt: item.readAt ?? Date.now() })),
          ),
        );
    }
  };

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.bell}
        aria-expanded={open}
        aria-label={unread > 0 ? `${unread} new notifications` : 'Notifications'}
        data-testid="notifications"
        onClick={toggle}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Zm4 11a2.2 2.2 0 0 0 4 0"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 ? (
          <span className={styles.count} data-testid="notifications-unread">
            {unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className={styles.menu} role="dialog" aria-label="Notifications">
          {items.length === 0 ? (
            <p className={styles.muted}>Nothing yet.</p>
          ) : (
            <ul>
              {items.map((item) => {
                const to = item.boardId
                  ? ({ name: 'board', boardId: item.boardId } as const)
                  : item.folderId
                    ? ({ name: 'folder', folderId: item.folderId } as const)
                    : ({ name: 'shared' } as const);
                return (
                  <li key={item.id} data-testid="notification-item" data-kind={item.kind}>
                    <Link to={to} className={styles.item} onClick={() => setOpen(false)}>
                      <span>
                        <strong>{item.actorName}</strong> {item.text}
                      </span>
                      <span className={styles.time}>{when(item.createdAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
