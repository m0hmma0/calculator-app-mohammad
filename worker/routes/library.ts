import { isFileId } from '@shared/files';
import type { Account } from '../auth';
import type { Env } from '../env';
import { cleanName, fail, json, newId } from '../http';

/** A library item is a handful of elements; this is far more than a styled group needs. */
const MAX_ITEM_BYTES = 256 * 1024;
const MAX_ITEMS = 200;

export interface LibraryRow {
  id: string;
  name: string;
  elements: string;
  created_at: number;
}

const toItem = (row: LibraryRow) => ({
  id: row.id,
  name: row.name,
  elements: JSON.parse(row.elements) as unknown[],
  createdAt: row.created_at,
});

export async function listLibrary(env: Env, account: Account): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, elements, created_at FROM library_items
     WHERE owner_uid = ?1 ORDER BY created_at DESC LIMIT ${MAX_ITEMS}`,
  )
    .bind(account.uid)
    .all<LibraryRow>();
  return json({ items: results.map(toItem) });
}

/** Image hashes anywhere in the saved elements, so the images outlive their boards. */
function imagesIn(elements: unknown[]): string[] {
  const found = new Set<string>();
  for (const element of elements) {
    const image = (element as { image?: { fileId?: unknown } } | null)?.image;
    if (isFileId(image?.fileId)) found.add(image.fileId);
  }
  return [...found];
}

export async function addLibraryItem(
  request: Request,
  env: Env,
  account: Account,
): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_ITEM_BYTES) return fail('That is too big to keep in the library', 413);
  let body: { name?: unknown; elements?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return fail('Not JSON', 400);
  }
  const elements = body.elements;
  if (!Array.isArray(elements) || elements.length === 0 || elements.length > 500) {
    return fail('A library item needs between 1 and 500 elements', 400);
  }
  if (!elements.every((element) => typeof element === 'object' && element !== null)) {
    return fail('Elements must be objects', 400);
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM library_items WHERE owner_uid = ?1')
    .bind(account.uid)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ITEMS) return fail('The library is full', 409);

  const row: LibraryRow = {
    id: newId('lib'),
    name: cleanName(body.name, 'Untitled', 80),
    elements: JSON.stringify(elements),
    created_at: Date.now(),
  };
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO library_items (id, owner_uid, name, elements, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    ).bind(row.id, account.uid, row.name, row.elements, row.created_at),
    ...imagesIn(elements).map((hash) =>
      env.DB.prepare('INSERT OR IGNORE INTO library_files (item_id, hash) VALUES (?1, ?2)').bind(
        row.id,
        hash,
      ),
    ),
  ]);
  return json({ item: toItem(row) }, 201);
}

export async function removeLibraryItem(env: Env, account: Account, id: string): Promise<Response> {
  const result = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM library_files WHERE item_id = ?1
       AND EXISTS (SELECT 1 FROM library_items WHERE id = ?1 AND owner_uid = ?2)`,
    ).bind(id, account.uid),
    env.DB.prepare('DELETE FROM library_items WHERE id = ?1 AND owner_uid = ?2').bind(
      id,
      account.uid,
    ),
  ]);
  if ((result[1]?.meta.changes ?? 0) === 0) return fail('Not found', 404);
  return json({ ok: true });
}
