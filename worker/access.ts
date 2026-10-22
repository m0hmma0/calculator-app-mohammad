import type { GrantRole, Role } from '@shared/sharing';
import type { Env } from './env';

export type { Role };

const RANK: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

export const atLeast = (role: Role | null, wanted: Role): boolean =>
  role !== null && RANK[role] >= RANK[wanted];

const higher = (a: Role | null, b: Role | null): Role | null => {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
};

/** Who is asking. Null for a guest — someone with a link and no account. */
export interface Viewer {
  uid: string;
  email: string;
}

export interface ShareRow {
  id: string;
  resource_type: 'board' | 'folder';
  resource_id: string;
  kind: 'person' | 'link';
  email: string | null;
  token: string | null;
  role: GrantRole;
  audience: 'anyone' | 'signed-in' | 'domain' | null;
  domain: string | null;
  expires_at: number | null;
  created_by: string;
  created_at: number;
  revoked_at: number | null;
}

export interface Access {
  role: Role | null;
  ownerId: string;
  /** When the grant this access rests on runs out, if it does — so a room can recheck. */
  expiresAt: number | null;
}

interface Resource {
  type: 'board' | 'folder';
  id: string;
}

/**
 * The folders above a starting folder, nearest first, with whether any is in the
 * trash. One recursive query rather than a round trip per level.
 */
async function folderChain(env: Env, folderId: string | null) {
  if (!folderId) return { ids: [] as string[], trashed: false };
  const { results } = await env.DB.prepare(
    `WITH RECURSIVE chain(id, parent_id, deleted_at, depth) AS (
       SELECT id, parent_id, deleted_at, 0 FROM folders WHERE id = ?1
       UNION ALL
       SELECT f.id, f.parent_id, f.deleted_at, c.depth + 1
       FROM folders f JOIN chain c ON f.id = c.parent_id WHERE c.depth < 64
     )
     SELECT id, deleted_at FROM chain ORDER BY depth`,
  )
    .bind(folderId)
    .all<{ id: string; deleted_at: number | null }>();
  return {
    ids: results.map((row) => row.id),
    trashed: results.some((row) => row.deleted_at !== null),
  };
}

/** Does this link admit this person (or this guest)? */
export function linkAdmits(share: ShareRow, viewer: Viewer | null, now: number): boolean {
  if (share.revoked_at !== null) return false;
  if (share.expires_at !== null && share.expires_at <= now) return false;
  switch (share.audience) {
    case 'anyone':
      return true;
    case 'signed-in':
      return viewer !== null;
    case 'domain':
      return viewer !== null && viewer.email.toLowerCase().endsWith(`@${share.domain ?? ''}`);
    default:
      return false;
  }
}

/**
 * The rule. Given a chain of resources — the thing itself, then each folder above
 * it, nearest first — and the grants on them:
 *
 *   - the owner may do anything;
 *   - a grant to this person's email applies from the *nearest* resource that has
 *     one, so a board can be made read-only for someone its folder lets edit;
 *   - a link applies if its token was presented, it is on this chain, it has not
 *     expired or been revoked, and its audience admits this person;
 *   - if both apply, the stronger wins.
 */
async function resolve(
  env: Env,
  chain: Resource[],
  ownerId: string,
  viewer: Viewer | null,
  linkToken: string | null,
): Promise<Access> {
  if (viewer && viewer.uid === ownerId) return { role: 'owner', ownerId, expiresAt: null };

  const placeholders = chain.map((_, index) => `(?${index * 2 + 1}, ?${index * 2 + 2})`).join(', ');
  const { results } = await env.DB.prepare(
    `SELECT * FROM shares WHERE revoked_at IS NULL
     AND (resource_type, resource_id) IN (VALUES ${placeholders})`,
  )
    .bind(...chain.flatMap((resource) => [resource.type, resource.id]))
    .all<ShareRow>();

  const depthOf = (share: ShareRow) =>
    chain.findIndex(
      (resource) => resource.type === share.resource_type && resource.id === share.resource_id,
    );
  const now = Date.now();

  let personRole: Role | null = null;
  if (viewer) {
    const mine = results
      .filter((share) => share.kind === 'person' && share.email === viewer.email.toLowerCase())
      .sort((a, b) => depthOf(a) - depthOf(b));
    personRole = mine[0]?.role ?? null;
  }

  let linkRole: Role | null = null;
  let expiresAt: number | null = null;
  if (linkToken) {
    const link = results.find((share) => share.kind === 'link' && share.token === linkToken);
    if (link && linkAdmits(link, viewer, now)) {
      linkRole = link.role;
      expiresAt = link.expires_at;
    }
  }

  const role = higher(personRole, linkRole);
  // If the person's own grant is at least as strong, the link running out changes nothing.
  if (role !== linkRole || (personRole && linkRole && RANK[personRole] >= RANK[linkRole])) {
    expiresAt = null;
  }
  return { role, ownerId, expiresAt };
}

export interface BoardFacts {
  id: string;
  owner_id: string;
  folder_id: string | null;
  title: string;
  deleted_at: number | null;
  viewer_export: number;
}

export async function boardAccess(
  env: Env,
  viewer: Viewer | null,
  boardId: string,
  linkToken: string | null,
): Promise<Access & { board: BoardFacts | null }> {
  const board = await env.DB.prepare(
    'SELECT id, owner_id, folder_id, title, deleted_at, viewer_export FROM boards WHERE id = ?1',
  )
    .bind(boardId)
    .first<BoardFacts>();
  if (!board || board.deleted_at !== null) {
    return { role: null, ownerId: board?.owner_id ?? '', expiresAt: null, board: null };
  }

  const folders = await folderChain(env, board.folder_id);
  // In the trash for the owner too — a board in a trashed folder is trashed with it.
  if (folders.trashed) return { role: null, ownerId: board.owner_id, expiresAt: null, board: null };

  const chain: Resource[] = [
    { type: 'board', id: board.id },
    ...folders.ids.map((id) => ({ type: 'folder' as const, id })),
  ];
  return { ...(await resolve(env, chain, board.owner_id, viewer, linkToken)), board };
}

export async function folderAccess(
  env: Env,
  viewer: Viewer | null,
  folderId: string,
  linkToken: string | null,
): Promise<Access> {
  const folder = await env.DB.prepare('SELECT owner_id FROM folders WHERE id = ?1')
    .bind(folderId)
    .first<{ owner_id: string }>();
  if (!folder) return { role: null, ownerId: '', expiresAt: null };
  const folders = await folderChain(env, folderId);
  if (folders.trashed) return { role: null, ownerId: folder.owner_id, expiresAt: null };
  const chain = folders.ids.map((id) => ({ type: 'folder' as const, id }));
  return resolve(env, chain, folder.owner_id, viewer, linkToken);
}

/** Every live board at or below a folder — whose rooms must hear about a sharing change. */
export async function boardsUnder(env: Env, folderId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `WITH RECURSIVE tree(id, depth) AS (
       SELECT id, 0 FROM folders WHERE id = ?1
       UNION ALL
       SELECT f.id, t.depth + 1 FROM folders f JOIN tree t ON f.parent_id = t.id WHERE t.depth < 64
     )
     SELECT boards.id FROM boards JOIN tree ON boards.folder_id = tree.id
     WHERE boards.deleted_at IS NULL`,
  )
    .bind(folderId)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}
