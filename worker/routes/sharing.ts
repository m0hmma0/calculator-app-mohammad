import type {
  AuditEntry,
  FolderContents,
  GrantRole,
  LinkInfo,
  OpenBoardResponse,
  PersonGrant,
  PutLinkBody,
  ResourceType,
  ShareState,
  SharedItem,
} from '@shared/sharing';
import { sizeForOthers } from '@shared/settings';
import type { Account } from '../auth';
import {
  atLeast,
  boardAccess,
  boardsUnder,
  folderAccess,
  linkAdmits,
  type ShareRow,
  type Viewer,
} from '../access';
import type { Env } from '../env';
import { fail, json, newId } from '../http';
import { settingsOf } from './settings';

const GRANT_ROLES: readonly GrantRole[] = ['viewer', 'commenter', 'editor'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EXPIRY_MINUTES = 60 * 24 * 365;

export const viewerOf = (account: Account | null): Viewer | null =>
  account ? { uid: account.uid, email: account.email.toLowerCase() } : null;

const isResourceType = (value: string): value is ResourceType =>
  value === 'board' || value === 'folder';

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const thumbnailUrlFor = (id: string, key: string | null) =>
  key ? `/api/boards/${id}/thumbnail` : null;

/**
 * Tells the rooms of the given boards to check every open connection again — how a
 * revoked link or a removed person is dropped within seconds rather than at their
 * next reload.
 */
export async function tellRooms(env: Env, boardIds: string[], path: string, body?: unknown) {
  await Promise.all(
    boardIds.map((id) =>
      env.ROOMS.get(env.ROOMS.idFromName(id))
        .fetch(`https://room${path}`, {
          method: 'POST',
          headers: { 'x-board-id': id },
          body: body === undefined ? null : JSON.stringify(body),
        })
        .catch(() => undefined),
    ),
  );
}

async function affectedBoards(env: Env, type: ResourceType, id: string) {
  return type === 'board' ? [id] : boardsUnder(env, id);
}

async function audit(
  env: Env,
  account: Account,
  type: ResourceType,
  id: string,
  action: string,
  detail: string,
) {
  await env.DB.prepare(
    `INSERT INTO audit (id, resource_type, resource_id, actor_uid, actor_email, action, detail, at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(newId('aud'), type, id, account.uid, account.email, action, detail, Date.now())
    .run();
}

export async function notify(
  env: Env,
  email: string,
  kind: 'shared' | 'mention',
  where: { boardId?: string; folderId?: string },
  actorName: string,
  text: string,
) {
  await env.DB.prepare(
    `INSERT INTO notifications (id, email, kind, board_id, folder_id, actor_name, text, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      newId('ntf'),
      email.toLowerCase(),
      kind,
      where.boardId ?? null,
      where.folderId ?? null,
      actorName,
      text.slice(0, 300),
      Date.now(),
    )
    .run();
}

/** Only the owner manages sharing. Returns the resource's title, or a failure. */
async function ownedResource(
  env: Env,
  account: Account,
  type: string,
  id: string,
): Promise<{ error: Response } | { type: ResourceType; name: string }> {
  if (!isResourceType(type)) return { error: fail('Unknown kind of thing to share', 404) };
  const row =
    type === 'board'
      ? await env.DB.prepare('SELECT title AS name, owner_id, deleted_at FROM boards WHERE id = ?1')
          .bind(id)
          .first<{ name: string; owner_id: string; deleted_at: number | null }>()
      : await env.DB.prepare('SELECT name, owner_id, deleted_at FROM folders WHERE id = ?1')
          .bind(id)
          .first<{ name: string; owner_id: string; deleted_at: number | null }>();
  if (!row || row.deleted_at !== null || row.owner_id !== account.uid) {
    return { error: fail('Only the owner can change how this is shared', 404) };
  }
  return { type, name: row.name };
}

async function liveShares(env: Env, type: ResourceType, id: string) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM shares WHERE resource_type = ?1 AND resource_id = ?2 AND revoked_at IS NULL
     ORDER BY created_at`,
  )
    .bind(type, id)
    .all<ShareRow>();
  return results;
}

async function shareState(env: Env, type: ResourceType, id: string): Promise<ShareState> {
  const shares = await liveShares(env, type, id);
  const link = shares.find((share) => share.kind === 'link');
  const people = shares.filter((share) => share.kind === 'person');

  const names = new Map<string, string | null>();
  if (people.length > 0) {
    const { results } = await env.DB.prepare(
      `SELECT lower(email) AS email, name FROM users WHERE lower(email) IN (${people
        .map((_, index) => `?${index + 1}`)
        .join(',')})`,
    )
      .bind(...people.map((person) => person.email!))
      .all<{ email: string; name: string | null }>();
    for (const row of results) names.set(row.email, row.name);
  }

  const { results: log } = await env.DB.prepare(
    `SELECT at, actor_email AS actor, action, detail FROM audit
     WHERE resource_type = ?1 AND resource_id = ?2 ORDER BY at DESC LIMIT 100`,
  )
    .bind(type, id)
    .all<AuditEntry>();

  const exportRow =
    type === 'board'
      ? await env.DB.prepare('SELECT viewer_export FROM boards WHERE id = ?1')
          .bind(id)
          .first<{ viewer_export: number }>()
      : null;

  return {
    link: link
      ? {
          token: link.token!,
          role: link.role,
          audience: link.audience!,
          domain: link.domain,
          expiresAt: link.expires_at,
        }
      : null,
    people: people.map((person): PersonGrant => ({
      id: person.id,
      email: person.email!,
      role: person.role,
      name: names.get(person.email!) ?? null,
    })),
    viewerExport: exportRow ? exportRow.viewer_export === 1 : null,
    audit: log,
  };
}

export async function getShares(env: Env, account: Account, type: string, id: string) {
  const owned = await ownedResource(env, account, type, id);
  if ('error' in owned) return owned.error;
  return json(await shareState(env, owned.type, id));
}

const describeLink = (body: PutLinkBody) => {
  const who =
    body.audience === 'anyone'
      ? 'anyone with the link'
      : body.audience === 'signed-in'
        ? 'signed-in people with the link'
        : `people at ${body.domain} with the link`;
  const until =
    body.expiresInMinutes === null ? '' : `, expiring in ${body.expiresInMinutes} minute(s)`;
  return `${who} ${body.role === 'viewer' ? 'can view' : body.role === 'commenter' ? 'can comment' : 'can edit'}${until}`;
};

/** Turns the link on, or changes it. Its token stays the same unless it is reset. */
export async function putLink(
  request: Request,
  env: Env,
  account: Account,
  type: string,
  id: string,
) {
  const owned = await ownedResource(env, account, type, id);
  if ('error' in owned) return owned.error;
  const body = (await request.json().catch(() => ({}))) as Partial<PutLinkBody>;

  if (!body.role || !GRANT_ROLES.includes(body.role))
    return fail('Choose what the link allows', 400);
  if (!body.audience || !['anyone', 'signed-in', 'domain'].includes(body.audience)) {
    return fail('Choose who the link works for', 400);
  }
  const domain =
    body.audience === 'domain'
      ? String(body.domain ?? '')
          .trim()
          .toLowerCase()
          .replace(/^@/, '')
      : null;
  if (body.audience === 'domain' && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain ?? '')) {
    return fail('That does not look like an email domain', 400);
  }
  const minutes = body.expiresInMinutes ?? null;
  if (
    minutes !== null &&
    !(Number.isFinite(minutes) && minutes > 0 && minutes <= MAX_EXPIRY_MINUTES)
  ) {
    return fail('That expiry is out of range', 400);
  }
  const expiresAt = minutes === null ? null : Date.now() + minutes * 60_000;

  const existing = (await liveShares(env, owned.type, id)).find((share) => share.kind === 'link');
  if (existing) {
    await env.DB.prepare(
      'UPDATE shares SET role = ?1, audience = ?2, domain = ?3, expires_at = ?4 WHERE id = ?5',
    )
      .bind(body.role, body.audience, domain, expiresAt, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO shares (id, resource_type, resource_id, kind, token, role, audience, domain,
                           expires_at, created_by, created_at)
       VALUES (?1, ?2, ?3, 'link', ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
      .bind(
        newId('shr'),
        owned.type,
        id,
        newToken(),
        body.role,
        body.audience,
        domain,
        expiresAt,
        account.uid,
        Date.now(),
      )
      .run();
  }

  const full = { ...(body as PutLinkBody), domain };
  await audit(
    env,
    account,
    owned.type,
    id,
    existing ? 'link changed' : 'link on',
    describeLink(full),
  );
  await tellRooms(env, await affectedBoards(env, owned.type, id), '/reauthorize');
  return json(await shareState(env, owned.type, id));
}

/** Turns the link off. Its token never works again, even if sharing is turned back on. */
export async function revokeLink(
  env: Env,
  account: Account,
  type: string,
  id: string,
  reset: boolean,
) {
  const owned = await ownedResource(env, account, type, id);
  if ('error' in owned) return owned.error;
  const existing = (await liveShares(env, owned.type, id)).find((share) => share.kind === 'link');
  if (!existing) return json(await shareState(env, owned.type, id));

  await env.DB.prepare('UPDATE shares SET revoked_at = ?1 WHERE id = ?2')
    .bind(Date.now(), existing.id)
    .run();
  if (reset) {
    await env.DB.prepare(
      `INSERT INTO shares (id, resource_type, resource_id, kind, token, role, audience, domain,
                           expires_at, created_by, created_at)
       VALUES (?1, ?2, ?3, 'link', ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
      .bind(
        newId('shr'),
        owned.type,
        id,
        newToken(),
        existing.role,
        existing.audience,
        existing.domain,
        existing.expires_at,
        account.uid,
        Date.now(),
      )
      .run();
  }
  await audit(
    env,
    account,
    owned.type,
    id,
    reset ? 'link reset' : 'link off',
    reset ? 'the old link stopped working; a new one replaces it' : 'the link stopped working',
  );
  await tellRooms(env, await affectedBoards(env, owned.type, id), '/reauthorize');
  return json(await shareState(env, owned.type, id));
}

/** Shares with one person, by email, or changes what they may do. */
export async function putPerson(
  request: Request,
  env: Env,
  account: Account,
  type: string,
  id: string,
) {
  const owned = await ownedResource(env, account, type, id);
  if ('error' in owned) return owned.error;
  const body = (await request.json().catch(() => ({}))) as { email?: string; role?: GrantRole };
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email)) return fail('That does not look like an email address', 400);
  if (email === account.email.toLowerCase()) return fail('You already own this', 400);
  if (!body.role || !GRANT_ROLES.includes(body.role)) return fail('Choose what they may do', 400);

  const existing = (await liveShares(env, owned.type, id)).find(
    (share) => share.kind === 'person' && share.email === email,
  );
  if (existing) {
    if (existing.role === body.role) return json(await shareState(env, owned.type, id));
    await env.DB.prepare('UPDATE shares SET role = ?1 WHERE id = ?2')
      .bind(body.role, existing.id)
      .run();
    await audit(env, account, owned.type, id, 'person changed', `${email}: now ${body.role}`);
  } else {
    await env.DB.prepare(
      `INSERT INTO shares (id, resource_type, resource_id, kind, email, role, created_by, created_at)
       VALUES (?1, ?2, ?3, 'person', ?4, ?5, ?6, ?7)`,
    )
      .bind(newId('shr'), owned.type, id, email, body.role, account.uid, Date.now())
      .run();
    await audit(env, account, owned.type, id, 'person added', `${email} as ${body.role}`);
    await notify(
      env,
      email,
      'shared',
      owned.type === 'board' ? { boardId: id } : { folderId: id },
      account.name ?? account.email,
      `shared the ${owned.type} “${owned.name}” with you`,
    );
  }
  await tellRooms(env, await affectedBoards(env, owned.type, id), '/reauthorize');
  return json(await shareState(env, owned.type, id));
}

export async function removePerson(
  env: Env,
  account: Account,
  type: string,
  id: string,
  shareId: string,
) {
  const owned = await ownedResource(env, account, type, id);
  if ('error' in owned) return owned.error;
  const share = (await liveShares(env, owned.type, id)).find(
    (candidate) => candidate.id === shareId && candidate.kind === 'person',
  );
  if (!share) return fail('Nobody like that has access', 404);
  await env.DB.prepare('UPDATE shares SET revoked_at = ?1 WHERE id = ?2')
    .bind(Date.now(), share.id)
    .run();
  await audit(env, account, owned.type, id, 'person removed', share.email!);
  await tellRooms(env, await affectedBoards(env, owned.type, id), '/reauthorize');
  return json(await shareState(env, owned.type, id));
}

export async function setViewerExport(request: Request, env: Env, account: Account, id: string) {
  const owned = await ownedResource(env, account, 'board', id);
  if ('error' in owned) return owned.error;
  const body = (await request.json().catch(() => ({}))) as { viewerExport?: boolean };
  if (typeof body.viewerExport !== 'boolean') return fail('Say yes or no', 400);
  await env.DB.prepare('UPDATE boards SET viewer_export = ?1 WHERE id = ?2')
    .bind(body.viewerExport ? 1 : 0, id)
    .run();
  await audit(
    env,
    account,
    'board',
    id,
    'export setting',
    body.viewerExport ? 'viewers may export' : 'viewers may not export',
  );
  await tellRooms(env, [id], '/reauthorize');
  return json(await shareState(env, 'board', id));
}

/**
 * Hands a board to someone else. They must have signed in at least once — until
 * then there is no account to hand it to. The previous owner stays on as an editor,
 * and the board leaves their folders, which the new owner cannot see.
 */
export async function transferBoard(request: Request, env: Env, account: Account, id: string) {
  const owned = await ownedResource(env, account, 'board', id);
  if ('error' in owned) return owned.error;
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  if (email === account.email.toLowerCase()) return fail('You already own it', 400);

  const recipient = await env.DB.prepare('SELECT id, email FROM users WHERE lower(email) = ?1')
    .bind(email)
    .first<{ id: string; email: string }>();
  if (!recipient) {
    return fail('They need to sign in to Sabboura once before a board can be handed to them', 404);
  }

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE boards SET owner_id = ?1, folder_id = NULL, updated_at = ?2 WHERE id = ?3',
    ).bind(recipient.id, now, id),
    // The new owner needs no grant; the old one keeps editing through one.
    env.DB.prepare(
      `UPDATE shares SET revoked_at = ?1
       WHERE resource_type = 'board' AND resource_id = ?2 AND kind = 'person' AND email = ?3
         AND revoked_at IS NULL`,
    ).bind(now, id, email),
    env.DB.prepare(
      `INSERT INTO shares (id, resource_type, resource_id, kind, email, role, created_by, created_at)
       VALUES (?1, 'board', ?2, 'person', ?3, 'editor', ?4, ?5)`,
    ).bind(newId('shr'), id, account.email.toLowerCase(), account.uid, now),
  ]);
  await audit(env, account, 'board', id, 'ownership', `handed to ${email}`);
  await notify(
    env,
    email,
    'shared',
    { boardId: id },
    account.name ?? account.email,
    `made you the owner of “${owned.name}”`,
  );
  await tellRooms(env, [id], '/reauthorize');
  return json({ ok: true });
}

/**
 * Opening a board, for anyone: the owner, someone it is shared with, or a guest with
 * a link. The answer says what they may do; everything after this is enforced again
 * by the room itself.
 */
export async function openBoard(
  env: Env,
  account: Account | null,
  linkToken: string | null,
  id: string,
) {
  const access = await boardAccess(env, viewerOf(account), id, linkToken);
  if (!access.role || !access.board) return fail('That board does not exist', 404);

  if (access.role === 'owner') {
    await env.DB.prepare('UPDATE boards SET opened_at = ?1 WHERE id = ?2')
      .bind(Date.now(), id)
      .run();
  }
  const owner = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?1')
    .bind(access.ownerId)
    .first<{ name: string | null; email: string }>();

  const body: OpenBoardResponse = {
    board: {
      id,
      title: access.board.title,
      folderId: access.role === 'owner' ? access.board.folder_id : null,
    },
    role: access.role,
    canExport: atLeast(access.role, 'editor') || access.board.viewer_export === 1,
    ownerName: owner?.name ?? owner?.email ?? null,
    // New text on this board starts at the size its owner chose for everyone.
    textSize: sizeForOthers(await settingsOf(env, access.ownerId)),
  };
  return json(body);
}

/** Where a share link leads, and whether this person can follow it as they are. */
export async function resolveLink(env: Env, account: Account | null, token: string) {
  const share = await env.DB.prepare(
    "SELECT * FROM shares WHERE token = ?1 AND kind = 'link' AND revoked_at IS NULL",
  )
    .bind(token)
    .first<ShareRow>();
  const now = Date.now();
  if (!share || (share.expires_at !== null && share.expires_at <= now)) {
    return fail('This link has expired or been turned off', 404);
  }

  const title =
    share.resource_type === 'board'
      ? await env.DB.prepare(
          'SELECT title AS name FROM boards WHERE id = ?1 AND deleted_at IS NULL',
        )
          .bind(share.resource_id)
          .first<{ name: string }>()
      : await env.DB.prepare('SELECT name FROM folders WHERE id = ?1 AND deleted_at IS NULL')
          .bind(share.resource_id)
          .first<{ name: string }>();
  if (!title) return fail('This link has expired or been turned off', 404);

  const viewer = viewerOf(account);
  const admitted = linkAdmits(share, viewer, now);
  const needsSignIn = !admitted && viewer === null;
  const body: LinkInfo = {
    resource: { type: share.resource_type, id: share.resource_id, title: title.name },
    role: share.role,
    audience: share.audience!,
    admitted,
    needsSignIn,
    reason: admitted
      ? null
      : needsSignIn
        ? share.audience === 'domain'
          ? `Sign in with a ${share.domain} account to open this`
          : 'Sign in to open this'
        : `This link only works for ${share.domain} accounts`,
  };
  return json(body);
}

/** Boards and folders shared with this person by email. */
export async function sharedWithMe(env: Env, account: Account) {
  const { results } = await env.DB.prepare(
    `SELECT s.resource_type AS type, s.resource_id AS id, s.role,
            COALESCE(b.title, f.name) AS title,
            COALESCE(ub.name, ub.email, uf.name, uf.email) AS owner_name,
            b.thumbnail_key
     FROM shares s
     LEFT JOIN boards b ON s.resource_type = 'board' AND b.id = s.resource_id AND b.deleted_at IS NULL
     LEFT JOIN folders f ON s.resource_type = 'folder' AND f.id = s.resource_id AND f.deleted_at IS NULL
     LEFT JOIN users ub ON ub.id = b.owner_id
     LEFT JOIN users uf ON uf.id = f.owner_id
     WHERE s.kind = 'person' AND s.email = ?1 AND s.revoked_at IS NULL
       AND (b.id IS NOT NULL OR f.id IS NOT NULL)
       AND COALESCE(b.owner_id, f.owner_id) != ?2
     ORDER BY s.created_at DESC`,
  )
    .bind(account.email.toLowerCase(), account.uid)
    .all<{
      type: ResourceType;
      id: string;
      role: GrantRole;
      title: string;
      owner_name: string | null;
      thumbnail_key: string | null;
    }>();

  const items: SharedItem[] = results.map((row) => ({
    type: row.type,
    id: row.id,
    title: row.title,
    role: row.role,
    ownerName: row.owner_name,
    thumbnailUrl: row.type === 'board' ? thumbnailUrlFor(row.id, row.thumbnail_key) : null,
  }));
  return json({ items });
}

/** What is inside a folder someone can see but does not own. */
export async function folderContents(
  env: Env,
  account: Account | null,
  linkToken: string | null,
  id: string,
) {
  const access = await folderAccess(env, viewerOf(account), id, linkToken);
  if (!access.role) return fail('That folder does not exist', 404);

  const folder = await env.DB.prepare('SELECT id, name FROM folders WHERE id = ?1')
    .bind(id)
    .first<{ id: string; name: string }>();
  const [{ results: folders }, { results: boards }] = await Promise.all([
    env.DB.prepare(
      'SELECT id, name FROM folders WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE',
    )
      .bind(id)
      .all<{ id: string; name: string }>(),
    env.DB.prepare(
      `SELECT id, title, thumbnail_key FROM boards WHERE folder_id = ?1 AND deleted_at IS NULL
       ORDER BY title COLLATE NOCASE`,
    )
      .bind(id)
      .all<{ id: string; title: string; thumbnail_key: string | null }>(),
  ]);

  const body: FolderContents = {
    folder: folder!,
    role: access.role,
    folders,
    boards: boards.map((board) => ({
      id: board.id,
      title: board.title,
      thumbnailUrl: thumbnailUrlFor(board.id, board.thumbnail_key),
    })),
  };
  return json(body);
}

export async function listNotifications(env: Env, account: Account) {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, board_id AS boardId, folder_id AS folderId, actor_name AS actorName,
            text, created_at AS createdAt, read_at AS readAt
     FROM notifications WHERE email = ?1 ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(account.email.toLowerCase())
    .all();
  return json({ notifications: results });
}

export async function readNotifications(env: Env, account: Account) {
  await env.DB.prepare('UPDATE notifications SET read_at = ?1 WHERE email = ?2 AND read_at IS NULL')
    .bind(Date.now(), account.email.toLowerCase())
    .run();
  return json({ ok: true });
}
