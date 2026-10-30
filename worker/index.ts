import type { ApiErrorResponse, HealthResponse } from '@shared/types';
import { AuthError, optionalAccount, shareKeyFrom, type Account } from './auth';
import {
  createBoard,
  duplicateBoard,
  getSnapshot,
  getThumbnail,
  putSnapshot,
  putThumbnail,
  restoreBoard,
  searchBoards,
  trashBoard,
  updateBoard,
} from './routes/boards';
import { attachFile, getFile, putFile } from './routes/files';
import { createFolder, restoreFolder, trashFolder, updateFolder } from './routes/folders';
import { addComment, listComments, listPeople, resolveThread } from './routes/comments';
import {
  folderContents,
  getShares,
  listNotifications,
  openBoard,
  putLink,
  putPerson,
  readNotifications,
  removePerson,
  resolveLink,
  revokeLink,
  setViewerExport,
  sharedWithMe,
  transferBoard,
} from './routes/sharing';
import { addLibraryItem, listLibrary, removeLibraryItem } from './routes/library';
import { getSettings, putSettings } from './routes/settings';
import { unfurl } from './routes/unfurl';
import { emptyTrash, getTrash, getWorkspace } from './routes/workspace';
import { upsertUser } from './db';
import type { Env } from './env';
import { fail, json } from './http';

export type { Env };
export { BoardRoom } from './room';

/**
 * Routes are matched by hand rather than through a framework: there are a dozen of
 * them, and a Worker's cold start is the one place where a dependency's weight is
 * felt on every single request.
 */
async function handleApi(request: Request, env: Env, pathname: string): Promise<Response> {
  const method = request.method.toUpperCase();

  if (pathname === '/api/health') {
    const body: HealthResponse = {
      ok: true,
      service: 'sabboura',
      phase: 6,
      time: new Date().toISOString(),
    };
    return json(body);
  }

  const file = /^\/api\/files\/([^/]+)(\/attach)?$/.exec(pathname);

  // Reading an image needs no sign-in: its hash is the capability (see shared/files).
  if (file && !file[2] && (method === 'GET' || method === 'HEAD')) {
    return getFile(request, env, file[1]!);
  }

  // A browser cannot put a token on a WebSocket request, so the room asks for one as
  // the first message instead, and refuses to do anything else until it is valid.
  const room = /^\/api\/boards\/([\w-]+)\/room$/.exec(pathname);
  if (room && method === 'GET') {
    const boardId = room[1]!;
    const stub = env.ROOMS.get(env.ROOMS.idFromName(boardId));
    const forwarded = new Request(request);
    forwarded.headers.set('x-board-id', boardId);
    return stub.fetch(forwarded);
  }

  // Everything below needs to know who is asking — possibly nobody: a guest holding
  // a share link. A token that is present but does not verify is refused outright.
  let maybe: Account | null;
  try {
    maybe = await optionalAccount(request, env);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, 401);
    throw error;
  }
  const linkToken = shareKeyFrom(request);

  const link = /^\/api\/links\/([\w-]+)$/.exec(pathname);
  if (link && method === 'GET') return resolveLink(env, maybe, link[1]!);

  const contents = /^\/api\/folders\/([\w-]+)\/contents$/.exec(pathname);
  if (contents && method === 'GET') return folderContents(env, maybe, linkToken, contents[1]!);

  const comment = /^\/api\/comments\/([\w-]+)$/.exec(pathname);
  if (comment && method === 'PATCH') {
    return resolveThread(request, env, maybe, linkToken, comment[1]!);
  }

  // Board routes open to anyone the board is shared with, guests included. Each one
  // checks what this person may do; nothing here assumes ownership.
  const shared = /^\/api\/boards\/([\w-]+)(?:\/(snapshot|thumbnail|comments|people))?$/.exec(
    pathname,
  );
  if (shared && method === 'GET') {
    const id = shared[1]!;
    switch (shared[2]) {
      case undefined:
        return openBoard(env, maybe, linkToken, id);
      case 'snapshot':
        return getSnapshot(env, maybe, linkToken, id);
      case 'thumbnail':
        return getThumbnail(env, maybe, linkToken, id);
      case 'comments':
        return listComments(env, maybe, linkToken, id);
      case 'people':
        return listPeople(env, maybe, linkToken, id);
    }
  }
  if (shared?.[2] === 'comments' && method === 'POST') {
    return addComment(request, env, maybe, linkToken, shared[1]!);
  }

  // Adding images: anyone who may edit the board, guests with an edit link included.
  if (file) {
    if (file[2] && method === 'POST') return attachFile(request, env, maybe, linkToken, file[1]!);
    if (!file[2] && method === 'PUT') return putFile(request, env, maybe, linkToken, file[1]!);
  }

  if (!maybe) return fail('Not signed in', 401);
  const account: Account = maybe;

  // Folders and boards reference a user row, so it has to exist before anything can
  // be created. Reads skip the write; the dashboard's own request refreshes it.
  if (method !== 'GET' || pathname === '/api/workspace') {
    await upsertUser(env, account, Date.now());
  }

  if (pathname === '/api/workspace' && method === 'GET') return getWorkspace(env, account);
  if (pathname === '/api/trash' && method === 'GET') return getTrash(env, account);
  if (pathname === '/api/trash' && method === 'DELETE') return emptyTrash(env, account);

  if (pathname === '/api/search' && method === 'GET') {
    const query = new URL(request.url).searchParams.get('q') ?? '';
    return query.trim() === '' ? json({ boards: [] }) : searchBoards(env, account, query.trim());
  }

  if (pathname === '/api/shared' && method === 'GET') return sharedWithMe(env, account);
  if (pathname === '/api/unfurl' && method === 'GET') return unfurl(request, env);
  if (pathname === '/api/library' && method === 'GET') return listLibrary(env, account);
  if (pathname === '/api/library' && method === 'POST')
    return addLibraryItem(request, env, account);
  const libraryItem = /^\/api\/library\/([\w-]+)$/.exec(pathname);
  if (libraryItem && method === 'DELETE') return removeLibraryItem(env, account, libraryItem[1]!);
  if (pathname === '/api/settings' && method === 'GET') return getSettings(env, account);
  if (pathname === '/api/settings' && method === 'PUT') return putSettings(request, env, account);
  if (pathname === '/api/notifications' && method === 'GET') return listNotifications(env, account);
  if (pathname === '/api/notifications/read' && method === 'POST') {
    return readNotifications(env, account);
  }

  const share =
    /^\/api\/shares\/(board|folder)\/([\w-]+)(?:\/(link|link\/reset|people)(?:\/([\w-]+))?)?$/.exec(
      pathname,
    );
  if (share) {
    const [, type, id, part, shareId] = share as unknown as [
      string,
      string,
      string,
      string?,
      string?,
    ];
    if (!part && method === 'GET') return getShares(env, account, type, id);
    if (part === 'link' && method === 'PUT') return putLink(request, env, account, type, id);
    if (part === 'link' && method === 'DELETE') return revokeLink(env, account, type, id, false);
    if (part === 'link/reset' && method === 'POST') return revokeLink(env, account, type, id, true);
    if (part === 'people' && !shareId && method === 'POST') {
      return putPerson(request, env, account, type, id);
    }
    if (part === 'people' && shareId && method === 'DELETE') {
      return removePerson(env, account, type, id, shareId);
    }
  }

  if (pathname === '/api/folders' && method === 'POST') return createFolder(request, env, account);

  const folder = /^\/api\/folders\/([\w-]+)(\/restore)?$/.exec(pathname);
  if (folder) {
    const id = folder[1]!;
    if (folder[2] && method === 'POST') return restoreFolder(env, account, id);
    if (method === 'PATCH') return updateFolder(request, env, account, id);
    if (method === 'DELETE') return trashFolder(env, account, id);
  }

  if (pathname === '/api/boards' && method === 'POST') return createBoard(request, env, account);

  const board =
    /^\/api\/boards\/([\w-]+)(?:\/(restore|duplicate|snapshot|thumbnail|settings|transfer))?$/.exec(
      pathname,
    );
  if (board) {
    const id = board[1]!;
    switch (board[2]) {
      case 'restore':
        if (method === 'POST') return restoreBoard(env, account, id);
        break;
      case 'duplicate':
        if (method === 'POST') return duplicateBoard(env, account, id);
        break;
      case 'snapshot':
        if (method === 'PUT') return putSnapshot(request, env, account, id);
        break;
      case 'thumbnail':
        if (method === 'PUT') return putThumbnail(request, env, account, linkToken, id);
        break;
      case 'settings':
        if (method === 'PATCH') return setViewerExport(request, env, account, id);
        break;
      case 'transfer':
        if (method === 'POST') return transferBoard(request, env, account, id);
        break;
      default:
        if (method === 'PATCH') return updateBoard(request, env, account, id);
        if (method === 'DELETE') return trashBoard(env, account, id);
    }
  }

  const error: ApiErrorResponse = { error: `No route for ${method} ${pathname}` };
  return json(error, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url.pathname);
      } catch (error) {
        console.error('API error', error);
        return fail('Something went wrong on the server', 500);
      }
    }

    // Everything else is a static asset, with unknown paths falling back to
    // index.html so client-side routes like /b/:boardId survive a cold load.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
