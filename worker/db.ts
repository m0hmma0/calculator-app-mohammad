import type { BoardRecord, FolderRecord } from '@shared/api';
import { fileListChanges } from '@shared/files';
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
  storage_bytes: number;
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
  ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
});

const toBoard = (row: BoardRow): BoardRecord => ({
  id: row.id,
  folderId: row.folder_id,
  title: row.title,
  starred: row.starred === 1,
  thumbnailUrl: row.thumbnail_key ? `/api/boards/${row.id}/thumbnail` : null,
  storageBytes: row.storage_bytes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  openedAt: row.opened_at,
  ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
});

/**
 * Every board read carries the size of the images it uses. An image shared by two
 * boards counts towards both, which is what "how much is on this board" means.
 */
export const BOARD_COLUMNS = `boards.*, (
  SELECT COALESCE(SUM(files.size), 0) FROM board_files
  JOIN files ON files.hash = board_files.hash
  WHERE board_files.board_id = boards.id
) AS storage_bytes`;

/**
 * The statements that bring a board's recorded files in line with the ones it uses:
 * only what differs. Rewriting the whole list on every save cost two rows written per
 * picture, every two seconds of editing — nearly all of the account's daily D1
 * allowance on a board with a few dozen pictures.
 */
export async function boardFilesUpdate(
  env: Env,
  boardId: string,
  fileIds: Iterable<string>,
): Promise<D1PreparedStatement[]> {
  const { results } = await env.DB.prepare('SELECT hash FROM board_files WHERE board_id = ?1')
    .bind(boardId)
    .all<{ hash: string }>();
  const { add, remove } = fileListChanges(
    results.map((row) => row.hash),
    fileIds,
  );
  return [
    ...remove.map((hash) =>
      env.DB.prepare('DELETE FROM board_files WHERE board_id = ?1 AND hash = ?2').bind(
        boardId,
        hash,
      ),
    ),
    ...add.map((hash) =>
      env.DB.prepare('INSERT OR IGNORE INTO board_files (board_id, hash) VALUES (?1, ?2)').bind(
        boardId,
        hash,
      ),
    ),
  ];
}

export async function upsertUser(env: Env, account: Account, now: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, picture, created_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       last_seen_at = excluded.last_seen_at
     -- Called on every change a person sends; written only when something is new, or
     -- an hour after it was last noted that they were here.
     WHERE users.email IS NOT excluded.email
        OR users.name IS NOT excluded.name
        OR users.picture IS NOT excluded.picture
        OR users.last_seen_at < excluded.last_seen_at - 3600000`,
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
    `SELECT ${BOARD_COLUMNS} FROM boards
     WHERE owner_id = ?1 AND deleted_at IS ${deleted ? 'NOT' : ''} NULL
     ORDER BY opened_at DESC`,
  )
    .bind(uid)
    .all<BoardRow>();
  return results.map(toBoard);
}

export async function getBoard(env: Env, uid: string, id: string): Promise<BoardRow | null> {
  return env.DB.prepare(`SELECT ${BOARD_COLUMNS} FROM boards WHERE id = ?1 AND owner_id = ?2`)
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
