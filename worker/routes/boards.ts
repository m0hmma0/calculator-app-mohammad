import type { CreateBoardBody, SnapshotMeta, UpdateBoardBody } from '@shared/api';
import type { Account } from '../auth';
import { getBoard, getFolder, toBoard } from '../db';
import type { Env } from '../env';
import { cleanName, fail, json, newId } from '../http';

const snapshotKey = (id: string) => `boards/${id}/snapshot.bin`;
const thumbnailKey = (id: string) => `boards/${id}/thumb.png`;

export async function createBoard(request: Request, env: Env, account: Account) {
  const body = (await request.json().catch(() => ({}))) as CreateBoardBody;
  const folderId = typeof body.folderId === 'string' ? body.folderId : null;

  if (folderId && !(await getFolder(env, account.uid, folderId))) {
    return fail('That folder does not exist', 404);
  }

  const now = Date.now();
  const id = newId('brd');
  await env.DB.prepare(
    `INSERT INTO boards (id, owner_id, folder_id, title, created_at, updated_at, opened_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5)`,
  )
    .bind(id, account.uid, folderId, cleanName(body.title, 'Untitled board'), now)
    .run();

  return json({ board: toBoard((await getBoard(env, account.uid, id))!) }, 201);
}

export async function updateBoard(request: Request, env: Env, account: Account, id: string) {
  const existing = await getBoard(env, account.uid, id);
  if (!existing) return fail('That board does not exist', 404);

  const body = (await request.json().catch(() => ({}))) as UpdateBoardBody;
  const title = body.title === undefined ? existing.title : cleanName(body.title, existing.title);
  const folderId = body.folderId === undefined ? existing.folder_id : body.folderId;
  const starred = body.starred === undefined ? existing.starred : body.starred ? 1 : 0;

  if (folderId && !(await getFolder(env, account.uid, folderId))) {
    return fail('That folder does not exist', 404);
  }

  await env.DB.prepare(
    `UPDATE boards SET title = ?1, folder_id = ?2, starred = ?3, updated_at = ?4
     WHERE id = ?5 AND owner_id = ?6`,
  )
    .bind(title, folderId, starred, Date.now(), id, account.uid)
    .run();

  return json({ board: toBoard((await getBoard(env, account.uid, id))!) });
}

export async function trashBoard(env: Env, account: Account, id: string) {
  if (!(await getBoard(env, account.uid, id))) return fail('That board does not exist', 404);
  await env.DB.prepare('UPDATE boards SET deleted_at = ?1 WHERE id = ?2 AND owner_id = ?3')
    .bind(Date.now(), id, account.uid)
    .run();
  return json({ ok: true });
}

export async function restoreBoard(env: Env, account: Account, id: string) {
  const row = await getBoard(env, account.uid, id);
  if (!row) return fail('That board does not exist', 404);

  // Put it back where it was, unless that folder is itself in the trash.
  const folder = row.folder_id ? await getFolder(env, account.uid, row.folder_id) : null;
  const folderId = folder && folder.deleted_at === null ? folder.id : null;

  await env.DB.prepare(
    'UPDATE boards SET deleted_at = NULL, folder_id = ?1, updated_at = ?2 WHERE id = ?3 AND owner_id = ?4',
  )
    .bind(folderId, Date.now(), id, account.uid)
    .run();

  return json({ board: toBoard((await getBoard(env, account.uid, id))!) });
}

export async function duplicateBoard(env: Env, account: Account, id: string) {
  const source = await getBoard(env, account.uid, id);
  if (!source) return fail('That board does not exist', 404);

  const now = Date.now();
  const copyId = newId('brd');
  let copiedSnapshot: string | null = null;

  if (source.snapshot_key) {
    const object = await env.FILES.get(source.snapshot_key);
    if (object) {
      copiedSnapshot = snapshotKey(copyId);
      await env.FILES.put(copiedSnapshot, await object.arrayBuffer());
    }
  }

  await env.DB.prepare(
    `INSERT INTO boards (id, owner_id, folder_id, title, starred, search_text, snapshot_key,
                         created_at, updated_at, opened_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?7, ?7)`,
  )
    .bind(
      copyId,
      account.uid,
      source.folder_id,
      `${source.title} copy`.slice(0, 120),
      '',
      copiedSnapshot,
      now,
    )
    .run();

  return json({ board: toBoard((await getBoard(env, account.uid, copyId))!) }, 201);
}

/** The Yjs state vector for a board. Phase 7 replaces this with a live room. */
export async function getSnapshot(env: Env, account: Account, id: string) {
  const row = await getBoard(env, account.uid, id);
  if (!row) return fail('That board does not exist', 404);

  await env.DB.prepare('UPDATE boards SET opened_at = ?1 WHERE id = ?2').bind(Date.now(), id).run();

  if (!row.snapshot_key) return new Response(null, { status: 204 });

  const object = await env.FILES.get(row.snapshot_key);
  if (!object) return new Response(null, { status: 204 });

  return new Response(object.body, {
    headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
  });
}

export async function putSnapshot(request: Request, env: Env, account: Account, id: string) {
  const row = await getBoard(env, account.uid, id);
  if (!row) return fail('That board does not exist', 404);

  const meta = JSON.parse(request.headers.get('x-board-meta') ?? '{}') as SnapshotMeta;
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return fail('Empty snapshot', 400);

  const key = snapshotKey(id);
  await env.FILES.put(key, body);

  let thumbKey = row.thumbnail_key;
  if (meta.thumbnail?.startsWith('data:image/png;base64,')) {
    const base64 = meta.thumbnail.slice(meta.thumbnail.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    thumbKey = thumbnailKey(id);
    await env.FILES.put(thumbKey, bytes, { httpMetadata: { contentType: 'image/png' } });
  }

  await env.DB.prepare(
    `UPDATE boards SET snapshot_key = ?1, thumbnail_key = ?2, search_text = ?3, updated_at = ?4
     WHERE id = ?5 AND owner_id = ?6`,
  )
    .bind(
      key,
      thumbKey,
      (meta.searchText ?? '').slice(0, 4000).toLowerCase(),
      Date.now(),
      id,
      account.uid,
    )
    .run();

  return json({ ok: true });
}

export async function getThumbnail(env: Env, account: Account, id: string) {
  const row = await getBoard(env, account.uid, id);
  if (!row?.thumbnail_key) return new Response(null, { status: 404 });

  const object = await env.FILES.get(row.thumbnail_key);
  if (!object) return new Response(null, { status: 404 });

  return new Response(object.body, {
    headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=60' },
  });
}

/** Full-text-ish search across titles and the text pulled out of each board. */
export async function searchBoards(env: Env, account: Account, query: string) {
  const term = `%${query.toLowerCase().slice(0, 100)}%`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM boards
     WHERE owner_id = ?1 AND deleted_at IS NULL
       AND (lower(title) LIKE ?2 OR search_text LIKE ?2)
     ORDER BY opened_at DESC LIMIT 50`,
  )
    .bind(account.uid, term)
    .all<Parameters<typeof toBoard>[0]>();

  return json({ boards: results.map(toBoard) });
}
