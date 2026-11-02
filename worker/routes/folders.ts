import type { CreateFolderBody, FolderOrderBody, UpdateFolderBody } from '@shared/api';
import type { Account } from '../auth';
import { getFolder, listFolders, toFolder } from '../db';
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
  const pinned = body.pinned === undefined ? existing.pinned : body.pinned ? 1 : 0;

  if (parentId === id) return fail('A folder cannot contain itself', 400);
  if (parentId && !(await getFolder(env, account.uid, parentId))) {
    return fail('That folder does not exist', 404);
  }
  if (parentId && (await wouldCycle(env, account.uid, id, parentId))) {
    return fail('A folder cannot be moved inside itself', 400);
  }

  // Moved into another folder, it takes the end of the order there, not its old place.
  const position = parentId === existing.parent_id ? existing.position : null;
  await env.DB.prepare(
    `UPDATE folders SET name = ?1, parent_id = ?2, pinned = ?3, position = ?4, updated_at = ?5
     WHERE id = ?6 AND owner_id = ?7`,
  )
    .bind(name, parentId, pinned, position, Date.now(), id, account.uid)
    .run();

  return json({ folder: toFolder((await getFolder(env, account.uid, id))!) });
}

/**
 * The folders inside one parent, in the order they were dragged into: each is given
 * its place. Ids that are not this person's folders in that parent are ignored.
 */
export async function orderFolders(request: Request, env: Env, account: Account) {
  const body = (await request.json().catch(() => ({}))) as Partial<FolderOrderBody>;
  const parentId = typeof body.parentId === 'string' ? body.parentId : null;
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string').slice(0, 500)
    : [];
  const { results } = await env.DB.prepare(
    'SELECT id FROM folders WHERE owner_id = ?1 AND parent_id IS ?2 AND deleted_at IS NULL',
  )
    .bind(account.uid, parentId)
    .all<{ id: string }>();
  const siblings = new Set(results.map((row) => row.id));
  const ordered = [...new Set(ids)].filter((id) => siblings.has(id));
  if (ordered.length > 0) {
    await env.DB.batch(
      ordered.map((id, index) =>
        env.DB.prepare('UPDATE folders SET position = ?1 WHERE id = ?2 AND owner_id = ?3').bind(
          index,
          id,
          account.uid,
        ),
      ),
    );
  }
  return json({ folders: await listFolders(env, account.uid) });
}

/** A folder and the folders under it that match `condition` (on the child rows). */
async function branchUnder(
  env: Env,
  uid: string,
  id: string,
  condition: string,
  value?: number,
): Promise<string[]> {
  const branch = [id];
  for (let index = 0; index < branch.length && index < 500; index += 1) {
    const statement = env.DB.prepare(
      `SELECT id FROM folders WHERE owner_id = ?1 AND parent_id = ?2 AND ${condition}`,
    );
    const { results } = await (
      value === undefined
        ? statement.bind(uid, branch[index])
        : statement.bind(uid, branch[index], value)
    ).all<{ id: string }>();
    for (const row of results) branch.push(row.id);
  }
  return branch;
}

/**
 * Archives a folder and everything in it, in one moment, so it all comes back
 * together. Nothing is deleted and nothing changes for anyone it is shared with but
 * that it no longer shows in lists; a board in it still opens by its link.
 */
export async function archiveFolder(env: Env, account: Account, id: string) {
  const row = await getFolder(env, account.uid, id);
  if (!row || row.deleted_at !== null) return fail('That folder does not exist', 404);
  if (row.archived_at === null) {
    const now = Date.now();
    const branch = await branchUnder(
      env,
      account.uid,
      id,
      'deleted_at IS NULL AND archived_at IS NULL',
    );
    const placeholders = branch.map((_, index) => `?${index + 3}`).join(',');
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE folders SET archived_at = ?1
         WHERE owner_id = ?2 AND id IN (${placeholders}) AND archived_at IS NULL`,
      ).bind(now, account.uid, ...branch),
      env.DB.prepare(
        `UPDATE boards SET archived_at = ?1
         WHERE owner_id = ?2 AND folder_id IN (${placeholders})
           AND archived_at IS NULL AND deleted_at IS NULL`,
      ).bind(now, account.uid, ...branch),
    ]);
  }
  return json({ folder: toFolder((await getFolder(env, account.uid, id))!) });
}

/**
 * Brings an archived folder back with whatever was archived with it. If the folder it
 * was in is itself archived or deleted, it comes back at the top level instead.
 */
export async function unarchiveFolder(env: Env, account: Account, id: string) {
  const row = await getFolder(env, account.uid, id);
  if (!row || row.deleted_at !== null) return fail('That folder does not exist', 404);
  const when = row.archived_at;
  if (when !== null) {
    const parent = row.parent_id ? await getFolder(env, account.uid, row.parent_id) : null;
    const parentId =
      parent && parent.deleted_at === null && parent.archived_at === null ? parent.id : null;
    const branch = await branchUnder(env, account.uid, id, 'archived_at = ?3', when);
    const placeholders = branch.map((_, index) => `?${index + 3}`).join(',');
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE folders SET archived_at = NULL, parent_id = ?1 WHERE id = ?2 AND owner_id = ?3',
      ).bind(parentId, id, account.uid),
      env.DB.prepare(
        `UPDATE folders SET archived_at = NULL
         WHERE archived_at = ?1 AND owner_id = ?2 AND id IN (${placeholders})`,
      ).bind(when, account.uid, ...branch),
      env.DB.prepare(
        `UPDATE boards SET archived_at = NULL
         WHERE archived_at = ?1 AND owner_id = ?2 AND folder_id IN (${placeholders})`,
      ).bind(when, account.uid, ...branch),
    ]);
  }
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

  // Everything that went to the trash with it — the folders inside and their boards,
  // deleted in the same moment — comes back with it. Anything deleted on its own
  // before then stays in the trash.
  const when = row.deleted_at;
  const branch = [id];
  if (when !== null) {
    for (let index = 0; index < branch.length && index < 500; index += 1) {
      const { results } = await env.DB.prepare(
        'SELECT id FROM folders WHERE owner_id = ?1 AND parent_id = ?2 AND deleted_at = ?3',
      )
        .bind(account.uid, branch[index], when)
        .all<{ id: string }>();
      for (const child of results) branch.push(child.id);
    }
  }
  const placeholders = branch.map((_, index) => `?${index + 3}`).join(',');
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE folders SET deleted_at = NULL, parent_id = ?1, updated_at = ?2 WHERE id = ?3 AND owner_id = ?4',
    ).bind(parentId, Date.now(), id, account.uid),
    env.DB.prepare(
      `UPDATE folders SET deleted_at = NULL WHERE deleted_at = ?1 AND owner_id = ?2 AND id IN (${placeholders})`,
    ).bind(when, account.uid, ...branch),
    env.DB.prepare(
      `UPDATE boards SET deleted_at = NULL WHERE deleted_at = ?1 AND owner_id = ?2 AND folder_id IN (${placeholders})`,
    ).bind(when, account.uid, ...branch),
  ]);

  return json({ folder: toFolder((await getFolder(env, account.uid, id))!) });
}
