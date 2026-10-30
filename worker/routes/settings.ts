import { sanitiseSettings, type Settings } from '@shared/settings';
import type { Account } from '../auth';
import type { Env } from '../env';
import { fail, json } from '../http';

/** Settings are a few numbers and a list of keys; this is far more than they need. */
const MAX_BYTES = 32 * 1024;

/** Someone's settings, or the defaults if they have never changed any. */
export async function settingsOf(env: Env, uid: string): Promise<Settings> {
  const row = await env.DB.prepare('SELECT settings FROM user_settings WHERE uid = ?1')
    .bind(uid)
    .first<{ settings: string }>();
  if (!row) return sanitiseSettings(null);
  try {
    return sanitiseSettings(JSON.parse(row.settings));
  } catch {
    return sanitiseSettings(null);
  }
}

export async function getSettings(env: Env, account: Account): Promise<Response> {
  return json({ settings: await settingsOf(env, account.uid) });
}

export async function putSettings(request: Request, env: Env, account: Account): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BYTES) return fail('Those settings are too big to keep', 413);
  let body: { settings?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return fail('Not JSON', 400);
  }
  const settings = sanitiseSettings(body.settings);
  await env.DB.prepare(
    `INSERT INTO user_settings (uid, settings, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (uid) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
  )
    .bind(account.uid, JSON.stringify(settings), Date.now())
    .run();
  return json({ settings });
}
