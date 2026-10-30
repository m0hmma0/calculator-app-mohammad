import { IMAGE_TYPES, isFileId, maxBytesFor, mediaKindOf } from '@shared/files';
import type { Account } from '../auth';
import { atLeast, boardAccess } from '../access';
import type { Env } from '../env';
import { fail, json } from '../http';
import { viewerOf } from './sharing';

const fileKey = (hash: string) => `files/${hash}`;

/**
 * An image never changes under its name, so it can be cached forever. The security
 * headers matter for SVG: opened directly from this origin it could otherwise run
 * script, and `sandbox` plus a closed CSP means it renders as a picture and nothing
 * more.
 */
function fileHeaders(contentType: string, size: number, hash: string): Headers {
  return new Headers({
    'content-type': contentType,
    'content-length': String(size),
    // A video seeks by asking for part of the file.
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    etag: `"${hash}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Public by design: the hash is the capability. Immutable, so each browser asks once.
 *
 * Deliberately not put in Cloudflare's edge cache: a cached copy there outlives the
 * object, and an image removed when the trash is emptied should actually be gone.
 */
export async function getFile(request: Request, env: Env, hash: string): Promise<Response> {
  if (!isFileId(hash)) return fail('Not a file id', 404);

  if (request.headers.get('if-none-match') === `"${hash}"`) {
    return new Response(null, { status: 304, headers: { etag: `"${hash}"` } });
  }

  // A player asks for the part it needs — the start, or where it was seeked to.
  const ranged = request.headers.has('range');
  const object = await env.FILES.get(
    fileKey(hash),
    ranged ? { range: request.headers } : undefined,
  );
  if (!object) return fail('No such file', 404);

  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const part = ranged && object.range ? byteRange(object.range, object.size) : null;
  const headers = fileHeaders(contentType, part ? part.length : object.size, hash);
  if (part) headers.set('content-range', `bytes ${part.start}-${part.end}/${object.size}`);
  if (request.method === 'HEAD') return new Response(null, { headers });

  return new Response(object.body, { status: part ? 206 : 200, headers });
}

/** Where the part of a file that R2 returned starts and ends, and its length. */
function byteRange(range: R2Range, size: number) {
  let start: number;
  let length: number;
  if ('suffix' in range && range.suffix !== undefined) {
    length = Math.min(range.suffix, size);
    start = size - length;
  } else {
    const bounded = range as { offset?: number; length?: number };
    start = bounded.offset ?? 0;
    length = bounded.length ?? size - start;
  }
  return { start, end: start + length - 1, length };
}

/** Adding an image to a board is editing it: the owner, or anyone it lets edit. */
async function editableBoard(
  env: Env,
  account: Account | null,
  linkToken: string | null,
  boardId: string | null,
) {
  if (!boardId) return false;
  const access = await boardAccess(env, viewerOf(account), boardId, linkToken);
  return atLeast(access.role, 'editor');
}

const recordUse = (env: Env, boardId: string, hash: string) =>
  env.DB.prepare('INSERT OR IGNORE INTO board_files (board_id, hash) VALUES (?1, ?2)').bind(
    boardId,
    hash,
  );

/**
 * "I have an image with this hash for this board." If it is already stored, the
 * board starts using it and the browser skips the upload entirely — this is the
 * deduplication. A 404 means: send the bytes.
 */
export async function attachFile(
  request: Request,
  env: Env,
  account: Account | null,
  linkToken: string | null,
  hash: string,
): Promise<Response> {
  if (!isFileId(hash)) return fail('Not a file id', 400);
  const boardId = new URL(request.url).searchParams.get('board');
  if (!(await editableBoard(env, account, linkToken, boardId))) {
    return fail('That board does not exist', 404);
  }

  const file = await env.DB.prepare('SELECT size FROM files WHERE hash = ?1')
    .bind(hash)
    .first<{ size: number }>();
  if (!file || !(await env.FILES.head(fileKey(hash)))) return json({ stored: false }, 404);

  await recordUse(env, boardId!, hash).run();
  return json({ stored: true, size: file.size });
}

/**
 * Stores an image, a video or a sound under its hash. The hash is recomputed here and must match: with
 * one shared copy per picture, accepting a mismatched body would let anyone replace
 * an image on someone else's board.
 */
export async function putFile(
  request: Request,
  env: Env,
  account: Account | null,
  linkToken: string | null,
  hash: string,
): Promise<Response> {
  if (!isFileId(hash)) return fail('Not a file id', 400);
  const boardId = new URL(request.url).searchParams.get('board');
  if (!(await editableBoard(env, account, linkToken, boardId))) {
    return fail('That board does not exist', 404);
  }

  const contentType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!(IMAGE_TYPES as readonly string[]).includes(contentType) && !mediaKindOf(contentType)) {
    return fail('Only pictures, videos and sounds can be uploaded', 415);
  }

  const limit = maxBytesFor(contentType);
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) return fail('That file is too large', 413);

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return fail('Empty upload', 400);
  if (body.byteLength > limit) return fail('That file is too large', 413);
  if ((await sha256Hex(body)) !== hash) return fail('The upload does not match its hash', 400);

  const existing = await env.DB.prepare('SELECT size FROM files WHERE hash = ?1')
    .bind(hash)
    .first<{ size: number }>();

  // Re-store if the row outlived its object, so a half-finished cleanup heals itself.
  if (!existing || !(await env.FILES.head(fileKey(hash)))) {
    await env.FILES.put(fileKey(hash), body, { httpMetadata: { contentType } });
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO files (hash, size, content_type, uploaded_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(hash, body.byteLength, contentType, account?.uid ?? 'guest', Date.now()),
    recordUse(env, boardId!, hash),
  ]);

  return json({ stored: true, size: body.byteLength }, existing ? 200 : 201);
}

/**
 * Removes images that no board — live or in anyone's trash — and no library item
 * refers to. Runs when a
 * trash is emptied, so an image deleted from a board can still come back with undo
 * until then.
 */
export async function sweepUnusedFiles(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT hash FROM files
     WHERE NOT EXISTS (SELECT 1 FROM board_files WHERE board_files.hash = files.hash)
       AND NOT EXISTS (SELECT 1 FROM library_files WHERE library_files.hash = files.hash)
     LIMIT 500`,
  ).all<{ hash: string }>();
  if (results.length === 0) return 0;

  // The row goes first, and only if the image is still unused at that instant; the
  // object follows only for rows that actually went. A board that picks the image up
  // in between keeps it.
  const hashes = results.map((row) => row.hash);
  const outcomes = await env.DB.batch(
    hashes.map((hash) =>
      env.DB.prepare(
        `DELETE FROM files WHERE hash = ?1
         AND NOT EXISTS (SELECT 1 FROM board_files WHERE board_files.hash = ?1)
         AND NOT EXISTS (SELECT 1 FROM library_files WHERE library_files.hash = ?1)`,
      ).bind(hash),
    ),
  );
  const removed = hashes.filter((_, index) => (outcomes[index]?.meta.changes ?? 0) > 0);
  if (removed.length > 0) await env.FILES.delete(removed.map(fileKey));
  return removed.length;
}
