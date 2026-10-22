import type { CreateFolderBody, UpdateFolderBody } from '@shared/api';
import type { Account } from '../auth';
import { getFolder, toFolder } from '../db';
import { boardsUnder } from '../access';
import type { Env } from '../env';
import { cleanName, fail, json, newId } from '../http';
import { tellRooms } from './sharing';

export async function createFolder(request: Request, env: Env, account: Account) {
  const body = (await request.json().catch(() => ({}))) as CreateFolderBody;
  const parentId = typeof body.parentId === 'string' ? body.parentId : null;

  if (parentId && !(await getFolder(env, account.uid, parentId))) {
    return fail('That folder does not exist', 404);
  }

  const now = Date.now();
  const id = newId('fld');
  await env.DB.prepare(
    `INSERT INTO folders (id, owner_id, parent_id, name, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
  )
    .bind(id, account.uid, parentId, cleanName(body.name, 'Untitled folder'), now)
    .run();

  const row = await getFolder(env, account.uid, id);
  return json({ folder: toFolder(row!) }, 201);
}

/**
 * Walks up from `candidate` to check it is not inside `folderId`. Moving a folder
 * into its own descendant would detach that whole branch from the tree.
 */
async function wouldCycle(
  env: Env,
  uid: string,
  folderId: string,
  candidate: string | null,
): Promise<boolean> {
  let cursor = candidate;
  let guard = 0;
  while (cursor && guard < 64) {
    if (cursor === folderId) return true;
    const row = await getFolder(env, uid, cursor);
    cursor = row?.parent_id ?? null;
    guard += 1;
  }
  return false;
}

export async function updateFolder(request: Request, env: Env, account: Account, id: string) {
  const existing = await getFolder(env, account.uid, id);
  if (!existing) return fail('That folder does not exist', 404);

  const body = (await request.json().catch(() => ({}))) as UpdateFolderBody;
  const name = body.name === undefined ? existing.name : cleanName(body.name, existing.name);
  const parentId = body.parentId === undefined ? existing.parent_id : body.parentId;

  if (parentId === id) return fail('A folder cannot contain itself', 400);
  if (parentId && !(await getFolder(env, account.uid, parentId))) {
    return fail('That folder does not exist', 404);
  }
  if (parentId && (await wouldCycle(env, account.uid, id, parentId))) {
    return fail('A folder cannot be moved inside itself', 400);
  }

  await env.DB.prepare(
    'UPDATE folders SET name = ?1, parent_id = ?2, updated_at = ?3 WHERE id = ?4 AND owner_id = ?5',
  )
    .bind(name, parentId, Date.now(), id, account.uid)
    .run();

  return json({ folder: toFolder((await getFolder(env, account.uid, id))!) });
}

/** Soft delete: the folder, every folder under it, and every board inside any of them. */
export async function trashFolder(env: Env, account: Account, id: string) {
  if (!(await getFolder(env, account.uid, id))) return fail('That folder does not exist', 404);
  const now = Date.now();

  const branch = [id];
  for (let index = 0; index < branch.length && index < 500; index += 1) {
    const { results } = await env.DB.prepare(
      'SELECT id FROM folders WHERE owner_id = ?1 AND parent_id = ?2 AND deleted_at IS NULL',
    )
      .bind(account.uid, branch[index])
      .all<{ id: string }>();
    for (const row of results) branch.push(row.id);
  }

  // Collected before they are marked deleted, so their rooms can be told after.
  const affected = await boardsUnder(env, id);
  const placeholders = branch.map((_, index) => `?${index + 2}`).join(',');
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE folders SET deleted_at = ?1 WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    ).bind(now, ...branch),
    env.DB.prepare(
      `UPDATE boards SET deleted_at = ?1 WHERE folder_id IN (${placeholders}) AND deleted_at IS NULL`,
    ).bind(now, ...branch),
  ]);
  await tellRooms(env, affected, '/reauthorize');

  return json({ ok: true });
}

export async function restoreFolder(env: Env, account: Account, id: string) {
  const row = await getFolder(env, account.uid, id);
  if (!row) return fail('That folder does not exist', 404);

  // If the folder it used to live in is itself still in the trash, put it at the top
  // level rather than restoring it somewhere invisible.
  const parent = row.parent_id ? await getFolder(env, account.uid, row.parent_id) : null;
  const parentId = parent && parent.deleted_at === null ? parent.id : null;

  await env.DB.prepare(
    'UPDATE folders SET deleted_at = NULL, parent_id = ?1, updated_at = ?2 WHERE id = ?3 AND owner_id = ?4',
  )
    .bind(parentId, Date.now(), id, account.uid)
    .run();

  return json({ folder: toFolder((await getFolder(env, account.uid, id))!) });
}
