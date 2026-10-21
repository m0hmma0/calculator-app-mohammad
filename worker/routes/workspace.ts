import type { WorkspaceResponse } from '@shared/api';
import type { Account } from '../auth';
import { listBoards, listFolders, upsertUser } from '../db';
import type { Env } from '../env';
import { json } from '../http';

/** Everything the dashboard needs in one round trip. */
export async function getWorkspace(env: Env, account: Account): Promise<Response> {
  const now = Date.now();
  await upsertUser(env, account, now);

  const [folders, boards] = await Promise.all([
    listFolders(env, account.uid),
    listBoards(env, account.uid),
  ]);

  const body: WorkspaceResponse = {
    account: {
      uid: account.uid,
      email: account.email,
      name: account.name,
      picture: account.picture,
    },
    folders,
    boards,
  };
  return json(body);
}

export async function getTrash(env: Env, account: Account): Promise<Response> {
  const [folders, boards] = await Promise.all([
    listFolders(env, account.uid, true),
    listBoards(env, account.uid, true),
  ]);
  return json({ folders, boards });
}
