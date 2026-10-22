import type { WorkspaceResponse } from '@shared/api';
import type { Account } from '../auth';
import { listBoards, listFolders, TRASH_RETENTION_MS, upsertUser } from '../db';
import type { Env } from '../env';
import { json } from '../http';
import { sweepUnusedFiles } from './files';

/** Everything the dashboard needs in one round trip. */
export async function getWorkspace(env: Env, account: Account): Promise<Response> {
  const now = Date.now();
  await upsertUser(env, account, now);

  const [folders, boards] = await Promise.all([
    listFolders(env, account.uid),
    listBoards(env, account.uid),
  ]);

  const body: WorkspaceResponse = {
    account: {
      uid: account.uid,
      email: account.email,
      name: account.name,
      picture: account.picture,
    },
    folders,
    boards,
  };
  return json(body);
}

/**
 * Permanently deletes what has been in the trash since before `cutoff`: the boards'
 * snapshots and thumbnails, their image references, and then any image that nothing
 * refers to any more.
 */
async function purgeTrash(env: Env, uid: string, cutoff: number) {
  const { results: boards } = await env.DB.prepare(
    `SELECT id, snapshot_key, thumbnail_key FROM boards
     WHERE owner_id = ?1 AND deleted_at IS NOT NULL AND deleted_at <= ?2`,
  )
    .bind(uid, cutoff)
    .all<{ id: string; snapshot_key: string | null; thumbnail_key: string | null }>();

  // Each board's room holds its own history; it goes with the board.
  await Promise.all(
    boards.map((board) =>
      env.ROOMS.get(env.ROOMS.idFromName(board.id))
        .fetch('https://room/destroy', { method: 'POST' })
        .catch(() => undefined),
    ),
  );

  const keys = boards.flatMap((board) =>
    [board.snapshot_key, board.thumbnail_key].filter((key): key is string => key !== null),
  );
  if (keys.length > 0) await env.FILES.delete(keys);

  const outcomes = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM board_files WHERE board_id IN (
         SELECT id FROM boards WHERE owner_id = ?1 AND deleted_at IS NOT NULL AND deleted_at <= ?2)`,
    ).bind(uid, cutoff),
    env.DB.prepare(
      'DELETE FROM boards WHERE owner_id = ?1 AND deleted_at IS NOT NULL AND deleted_at <= ?2',
    ).bind(uid, cutoff),
    env.DB.prepare(
      'DELETE FROM folders WHERE owner_id = ?1 AND deleted_at IS NOT NULL AND deleted_at <= ?2',
    ).bind(uid, cutoff),
  ]);

  const files = await sweepUnusedFiles(env);
  return {
    boards: outcomes[1]?.meta.changes ?? 0,
    folders: outcomes[2]?.meta.changes ?? 0,
    files,
  };
}

export async function getTrash(env: Env, account: Account): Promise<Response> {
  // Thirty days is a promise in both directions: kept until then, gone after.
  await purgeTrash(env, account.uid, Date.now() - TRASH_RETENTION_MS);

  const [folders, boards] = await Promise.all([
    listFolders(env, account.uid, true),
    listBoards(env, account.uid, true),
  ]);
  return json({ folders, boards });
}

export async function emptyTrash(env: Env, account: Account): Promise<Response> {
  return json({ removed: await purgeTrash(env, account.uid, Date.now()) });
}
