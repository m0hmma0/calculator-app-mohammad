/**
 * A handful of routes do not need a routing library. These are the pure halves — parsing a
 * path and building one — kept apart from the components so they can be tested
 * without React and reused anywhere.
 */
export type Route =
  | { name: 'dashboard' }
  | { name: 'folder'; folderId: string }
  | { name: 'trash' }
  | { name: 'shared' }
  | { name: 'settings' }
  | { name: 'board'; boardId: string }
  /** A share link, as sent to someone: /s/<token>. */
  | { name: 'link'; token: string };

export function parseRoute(pathname: string): Route {
  const board = /^\/b\/([\w-]+)\/?$/.exec(pathname);
  if (board) return { name: 'board', boardId: board[1]! };

  const folder = /^\/f\/([\w-]+)\/?$/.exec(pathname);
  if (folder) return { name: 'folder', folderId: folder[1]! };

  const link = /^\/s\/([\w-]+)\/?$/.exec(pathname);
  if (link) return { name: 'link', token: link[1]! };

  if (/^\/trash\/?$/.test(pathname)) return { name: 'trash' };
  if (/^\/shared\/?$/.test(pathname)) return { name: 'shared' };
  if (/^\/settings\/?$/.test(pathname)) return { name: 'settings' };
  return { name: 'dashboard' };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'board':
      return `/b/${route.boardId}`;
    case 'folder':
      return `/f/${route.folderId}`;
    case 'trash':
      return '/trash';
    case 'shared':
      return '/shared';
    case 'settings':
      return '/settings';
    case 'link':
      return `/s/${route.token}`;
    default:
      return '/';
  }
}
