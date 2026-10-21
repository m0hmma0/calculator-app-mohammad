import type { BoardRecord, FolderRecord } from '@shared/api';
import type { Account } from './auth';
import type { Env } from './env';

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface BoardRow {
  id: string;
  folder_id: string | null;
  title: string;
  starred: number;
  thumbnail_key: string | null;
  snapshot_key: string | null;
  search_text: string;
  created_at: number;
  updated_at: number;
  opened_at: number;
  deleted_at: number | null;
}

const toFolder = (row: FolderRow): FolderRecord => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toBoard = (row: BoardRow): BoardRecord => ({
  id: row.id,
  folderId: row.folder_id,
  title: row.title,
  starred: row.starred === 1,
  thumbnailUrl: row.thumbnail_key ? `/api/boards/${row.id}/thumbnail` : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  openedAt: row.opened_at,
  ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
});

export async function upsertUser(env: Env, account: Account, now: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, picture, created_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       last_seen_at = excluded.last_seen_at`,
  )
    .bind(account.uid, account.email, account.name, account.picture, now)
    .run();
}

export async function listFolders(env: Env, uid: string, deleted = false): Promise<FolderRecord[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM folders WHERE owner_id = ?1 AND deleted_at IS ${deleted ? 'NOT' : ''} NULL
     ORDER BY name COLLATE NOCASE`,
  )
    .bind(uid)
    .all<FolderRow>();
  return results.map(toFolder);
}

export async function listBoards(env: Env, uid: string, deleted = false): Promise<BoardRecord[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM boards WHERE owner_id = ?1 AND deleted_at IS ${deleted ? 'NOT' : ''} NULL
     ORDER BY opened_at DESC`,
  )
    .bind(uid)
    .all<BoardRow>();
  return results.map(toBoard);
}

export async function getBoard(env: Env, uid: string, id: string): Promise<BoardRow | null> {
  return env.DB.prepare('SELECT * FROM boards WHERE id = ?1 AND owner_id = ?2')
    .bind(id, uid)
    .first<BoardRow>();
}

export async function getFolder(env: Env, uid: string, id: string): Promise<FolderRow | null> {
  return env.DB.prepare('SELECT * FROM folders WHERE id = ?1 AND owner_id = ?2')
    .bind(id, uid)
    .first<FolderRow>();
}

export { toBoard, toFolder };
export type { BoardRow, FolderRow };
