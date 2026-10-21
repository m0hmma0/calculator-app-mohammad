/**
 * Three routes do not need a routing library. These are the pure halves — parsing a
 * path and building one — kept apart from the components so they can be tested
 * without React and reused anywhere.
 */
export type Route =
  | { name: 'dashboard' }
  | { name: 'folder'; folderId: string }
  | { name: 'trash' }
  | { name: 'board'; boardId: string };

export function parseRoute(pathname: string): Route {
  const board = /^\/b\/([\w-]+)\/?$/.exec(pathname);
  if (board) return { name: 'board', boardId: board[1]! };

  const folder = /^\/f\/([\w-]+)\/?$/.exec(pathname);
  if (folder) return { name: 'folder', folderId: folder[1]! };

  if (/^\/trash\/?$/.test(pathname)) return { name: 'trash' };
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
    default:
      return '/';
  }
}
