import { REMOTE_KEY } from '@shared/collab';

/**
 * A remote control's page: this app at the presenter's address, with
 * `#remote=<key>` and, on a board with a room, `&b=<board>`. The key is in the hash,
 * so it is never sent to the server in an address or written in its logs.
 */
export function remoteParams(): { key: string; boardId: string | null } | null {
  if (typeof location === 'undefined' || !location.hash.startsWith('#remote=')) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const key = params.get('remote') ?? '';
  const boardId = params.get('b');
  if (!REMOTE_KEY.test(key)) return null;
  return { key, boardId: boardId && /^[\w-]{1,64}$/.test(boardId) ? boardId : null };
}
