import type {
  BoardRecord,
  CreateBoardBody,
  CreateFolderBody,
  FolderRecord,
  SnapshotMeta,
  TrashResponse,
  UpdateBoardBody,
  UpdateFolderBody,
  WorkspaceResponse,
} from '@shared/api';
import { currentIdToken } from '@/auth/session';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Headers> {
  const token = await currentIdToken();
  const headers = new Headers(extra);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = await authHeaders(init.body ? { 'content-type': 'application/json' } : {});
  const response = await fetch(path, { ...init, headers });

  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  workspace: () => request<WorkspaceResponse>('/api/workspace'),
  trash: () => request<TrashResponse>('/api/trash'),

  search: (query: string) =>
    request<{ boards: BoardRecord[] }>(`/api/search?q=${encodeURIComponent(query)}`),

  createFolder: (body: CreateFolderBody) =>
    request<{ folder: FolderRecord }>('/api/folders', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateFolder: (id: string, body: UpdateFolderBody) =>
    request<{ folder: FolderRecord }>(`/api/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  trashFolder: (id: string) => request<{ ok: true }>(`/api/folders/${id}`, { method: 'DELETE' }),
  restoreFolder: (id: string) =>
    request<{ folder: FolderRecord }>(`/api/folders/${id}/restore`, { method: 'POST' }),

  createBoard: (body: CreateBoardBody) =>
    request<{ board: BoardRecord }>('/api/boards', { method: 'POST', body: JSON.stringify(body) }),

  updateBoard: (id: string, body: UpdateBoardBody) =>
    request<{ board: BoardRecord }>(`/api/boards/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  trashBoard: (id: string) => request<{ ok: true }>(`/api/boards/${id}`, { method: 'DELETE' }),
  restoreBoard: (id: string) =>
    request<{ board: BoardRecord }>(`/api/boards/${id}/restore`, { method: 'POST' }),
  duplicateBoard: (id: string) =>
    request<{ board: BoardRecord }>(`/api/boards/${id}/duplicate`, { method: 'POST' }),

  /**
   * An <img> cannot send the sign-in token, so a thumbnail is fetched like any other
   * private resource and handed back as an object URL. The caller revokes it.
   */
  async thumbnail(path: string): Promise<string | null> {
    const response = await fetch(path, { headers: await authHeaders() });
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  },

  /** Returns null for a board that has never been saved. */
  async loadSnapshot(id: string): Promise<Uint8Array | null> {
    const response = await fetch(`/api/boards/${id}/snapshot`, { headers: await authHeaders() });
    if (response.status === 204) return null;
    if (!response.ok)
      throw new ApiError(`Could not open that board (${response.status})`, response.status);
    return new Uint8Array(await response.arrayBuffer());
  },

  async saveSnapshot(id: string, bytes: Uint8Array, meta: SnapshotMeta): Promise<void> {
    const headers = await authHeaders({
      'content-type': 'application/octet-stream',
      'x-board-meta': JSON.stringify(meta),
    });
    const response = await fetch(`/api/boards/${id}/snapshot`, {
      method: 'PUT',
      headers,
      body: bytes as unknown as BodyInit,
    });
    if (!response.ok)
      throw new ApiError(`Could not save that board (${response.status})`, response.status);
  },
};
