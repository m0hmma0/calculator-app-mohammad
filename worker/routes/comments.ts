import type { CommentRecord, NewCommentBody, Person } from '@shared/sharing';
import type { Account } from '../auth';
import { atLeast, boardAccess } from '../access';
import type { Env } from '../env';
import { fail, json, newId } from '../http';
import { notify, tellRooms, viewerOf } from './sharing';

const MAX_BODY = 2000;
const MAX_MENTIONS = 10;

interface CommentRow {
  id: string;
  thread_id: string;
  author_uid: string;
  author_name: string;
  body: string;
  x: number | null;
  y: number | null;
  created_at: number;
  resolved_at: number | null;
}

const toComment = (row: CommentRow): CommentRecord => ({
  id: row.id,
  threadId: row.thread_id,
  authorUid: row.author_uid,
  authorName: row.author_name,
  body: row.body,
  x: row.x,
  y: row.y,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
});

/**
 * Who is writing. A guest — a link with comment rights and no account — signs with
 * the name they gave, which the room shows as "(guest)" everywhere else too.
 */
function authorOf(request: Request, account: Account | null) {
  if (account) return { uid: account.uid, name: account.name ?? account.email };
  const id =
    (request.headers.get('x-guest-id') ?? '').replace(/[^\w-]/g, '').slice(0, 32) || 'anon';
  let raw = request.headers.get('x-guest-name') ?? '';
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Not encoded after all; use it as it came.
  }
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
  return { uid: `guest:${id}`, name: `${name || 'Guest'} (guest)` };
}

async function threadsOf(env: Env, boardId: string) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM comments WHERE board_id = ?1 ORDER BY created_at',
  )
    .bind(boardId)
    .all<CommentRow>();
  return results.map(toComment);
}

export async function listComments(
  env: Env,
  account: Account | null,
  linkToken: string | null,
  boardId: string,
) {
  const access = await boardAccess(env, viewerOf(account), boardId, linkToken);
  if (!access.role) return fail('That board does not exist', 404);
  return json({ comments: await threadsOf(env, boardId) });
}

/** Everyone who can open the board by name: its owner and the people it is shared with. */
async function peopleOn(env: Env, boardId: string): Promise<Person[]> {
  const board = await env.DB.prepare('SELECT owner_id, folder_id FROM boards WHERE id = ?1')
    .bind(boardId)
    .first<{ owner_id: string; folder_id: string | null }>();
  if (!board) return [];

  const { results: chain } = await env.DB.prepare(
    `WITH RECURSIVE chain(id, parent_id, depth) AS (
       SELECT id, parent_id, 0 FROM folders WHERE id = ?1
       UNION ALL SELECT f.id, f.parent_id, c.depth + 1 FROM folders f JOIN chain c ON f.id = c.parent_id
       WHERE c.depth < 64
     ) SELECT id FROM chain`,
  )
    .bind(board.folder_id ?? '')
    .all<{ id: string }>();

  const { results: grants } = await env.DB.prepare(
    `SELECT DISTINCT s.email, u.name FROM shares s LEFT JOIN users u ON lower(u.email) = s.email
     WHERE s.kind = 'person' AND s.revoked_at IS NULL AND (
       (s.resource_type = 'board' AND s.resource_id = ?1)
       OR (s.resource_type = 'folder' AND s.resource_id IN (SELECT value FROM json_each(?2)))
     )`,
  )
    .bind(boardId, JSON.stringify(chain.map((row) => row.id)))
    .all<{ email: string; name: string | null }>();

  const owner = await env.DB.prepare('SELECT email, name FROM users WHERE id = ?1')
    .bind(board.owner_id)
    .first<{ email: string; name: string | null }>();

  const people = new Map<string, Person>();
  if (owner)
    people.set(owner.email.toLowerCase(), { email: owner.email.toLowerCase(), name: owner.name });
  for (const grant of grants) people.set(grant.email, { email: grant.email, name: grant.name });
  return [...people.values()];
}

export async function listPeople(
  env: Env,
  account: Account | null,
  linkToken: string | null,
  boardId: string,
) {
  const access = await boardAccess(env, viewerOf(account), boardId, linkToken);
  if (!atLeast(access.role, 'commenter')) return fail('That board does not exist', 404);
  return json({ people: await peopleOn(env, boardId) });
}

export async function addComment(
  request: Request,
  env: Env,
  account: Account | null,
  linkToken: string | null,
  boardId: string,
) {
  const access = await boardAccess(env, viewerOf(account), boardId, linkToken);
  if (!access.role) return fail('That board does not exist', 404);
  if (!atLeast(access.role, 'commenter'))
    return fail('You can view this board but not comment', 403);

  const body = (await request.json().catch(() => ({}))) as NewCommentBody;
  const text = String(body.body ?? '')
    .trim()
    .slice(0, MAX_BODY);
  if (!text) return fail('Write something first', 400);

  let threadId: string;
  let x: number | null = null;
  let y: number | null = null;
  const id = newId('cmt');
  if (body.threadId) {
    const thread = await env.DB.prepare(
      'SELECT id FROM comments WHERE id = ?1 AND board_id = ?2 AND thread_id = id',
    )
      .bind(body.threadId, boardId)
      .first<{ id: string }>();
    if (!thread) return fail('That thread does not exist', 404);
    threadId = thread.id;
  } else {
    if (!Number.isFinite(body.x) || !Number.isFinite(body.y)) {
      return fail('A new thread needs a place on the board', 400);
    }
    threadId = id;
    x = body.x!;
    y = body.y!;
  }

  const author = authorOf(request, account);
  await env.DB.prepare(
    `INSERT INTO comments (id, board_id, thread_id, author_uid, author_name, body, x, y, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(id, boardId, threadId, author.uid, author.name, text, x, y, Date.now())
    .run();

  // A mention notifies only someone who can open the board — never a stranger whose
  // address was typed in.
  const mentions = [...new Set((body.mentions ?? []).map((email) => String(email).toLowerCase()))]
    .filter((email) => email !== account?.email.toLowerCase())
    .slice(0, MAX_MENTIONS);
  if (mentions.length > 0) {
    const allowed = new Set((await peopleOn(env, boardId)).map((person) => person.email));
    const title = access.board?.title ?? 'a board';
    for (const email of mentions) {
      if (!allowed.has(email)) continue;
      await notify(
        env,
        email,
        'mention',
        { boardId },
        author.name,
        `mentioned you on “${title}”: ${text}`,
      );
    }
  }

  await tellRooms(env, [boardId], '/notify', { t: 'comments' });
  return json({ comments: await threadsOf(env, boardId) }, 201);
}

export async function resolveThread(
  request: Request,
  env: Env,
  account: Account | null,
  linkToken: string | null,
  commentId: string,
) {
  const thread = await env.DB.prepare(
    'SELECT board_id FROM comments WHERE id = ?1 AND thread_id = id',
  )
    .bind(commentId)
    .first<{ board_id: string }>();
  if (!thread) return fail('That thread does not exist', 404);
  const access = await boardAccess(env, viewerOf(account), thread.board_id, linkToken);
  if (!atLeast(access.role, 'commenter')) return fail('That thread does not exist', 404);

  const body = (await request.json().catch(() => ({}))) as { resolved?: boolean };
  await env.DB.prepare('UPDATE comments SET resolved_at = ?1 WHERE id = ?2')
    .bind(body.resolved === false ? null : Date.now(), commentId)
    .run();
  await tellRooms(env, [thread.board_id], '/notify', { t: 'comments' });
  return json({ comments: await threadsOf(env, thread.board_id) });
}
