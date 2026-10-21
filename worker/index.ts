import type { ApiErrorResponse, HealthResponse } from '@shared/types';
import { AuthError, requireAccount, type Account } from './auth';
import {
  createBoard,
  duplicateBoard,
  getSnapshot,
  getThumbnail,
  putSnapshot,
  restoreBoard,
  searchBoards,
  trashBoard,
  updateBoard,
} from './routes/boards';
import { createFolder, restoreFolder, trashFolder, updateFolder } from './routes/folders';
import { getTrash, getWorkspace } from './routes/workspace';
import { upsertUser } from './db';
import type { Env } from './env';
import { fail, json } from './http';

export type { Env };

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
      phase: 5,
      time: new Date().toISOString(),
    };
    return json(body);
  }

  let account: Account;
  try {
    account = await requireAccount(request, env);
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message, 401);
    throw error;
  }

  // Folders and boards reference a user row, so it has to exist before anything can
  // be created. Reads skip the write; the dashboard's own request refreshes it.
  if (method !== 'GET' || pathname === '/api/workspace') {
    await upsertUser(env, account, Date.now());
  }

  if (pathname === '/api/workspace' && method === 'GET') return getWorkspace(env, account);
  if (pathname === '/api/trash' && method === 'GET') return getTrash(env, account);

  if (pathname === '/api/search' && method === 'GET') {
    const query = new URL(request.url).searchParams.get('q') ?? '';
    return query.trim() === '' ? json({ boards: [] }) : searchBoards(env, account, query.trim());
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

  const board = /^\/api\/boards\/([\w-]+)(?:\/(restore|duplicate|snapshot|thumbnail))?$/.exec(
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
        if (method === 'GET') return getSnapshot(env, account, id);
        if (method === 'PUT') return putSnapshot(request, env, account, id);
        break;
      case 'thumbnail':
        if (method === 'GET') return getThumbnail(env, account, id);
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
