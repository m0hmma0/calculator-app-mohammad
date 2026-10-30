import type {
  BoardRecord,
  CreateBoardBody,
  CreateFolderBody,
  FolderRecord,
  TrashResponse,
  UpdateBoardBody,
  UpdateFolderBody,
  WorkspaceResponse,
} from '@shared/api';
import type {
  CommentRecord,
  FolderContents,
  GrantRole,
  LinkInfo,
  NewCommentBody,
  NotificationRecord,
  OpenBoardResponse,
  Person,
  PutLinkBody,
  ResourceType,
  ShareState,
  SharedItem,
} from '@shared/sharing';
import type { Settings } from '@shared/settings';
import { currentIdToken } from '@/auth/session';
import type { BoardElement } from '@/model/element';
import { guestIdentity, shareLink } from '@/sharing/linkSession';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Who is asking: their sign-in token if they have one, the share link they came by
 * if any, and a guest's chosen name. The server weighs all three.
 */
export async function authHeaders(extra: Record<string, string> = {}): Promise<Headers> {
  const token = await currentIdToken();
  const headers = new Headers(extra);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const link = shareLink();
  if (link) headers.set('x-share-key', link);
  const guest = token ? null : guestIdentity();
  if (guest) {
    headers.set('x-guest-id', guest.id);
    headers.set('x-guest-name', encodeURIComponent(guest.name));
  }
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
  emptyTrash: () =>
    request<{ removed: { boards: number; folders: number; files: number } }>('/api/trash', {
      method: 'DELETE',
    }),

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

  /** What this board is, and what this person may do with it. */
  openBoard: (id: string) => request<OpenBoardResponse>(`/api/boards/${id}`),

  resolveLink: (token: string) => request<LinkInfo>(`/api/links/${token}`),

  shares: (type: ResourceType, id: string) => request<ShareState>(`/api/shares/${type}/${id}`),
  putLink: (type: ResourceType, id: string, body: PutLinkBody) =>
    request<ShareState>(`/api/shares/${type}/${id}/link`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  revokeLink: (type: ResourceType, id: string) =>
    request<ShareState>(`/api/shares/${type}/${id}/link`, { method: 'DELETE' }),
  resetLink: (type: ResourceType, id: string) =>
    request<ShareState>(`/api/shares/${type}/${id}/link/reset`, { method: 'POST' }),
  addPerson: (type: ResourceType, id: string, email: string, role: GrantRole) =>
    request<ShareState>(`/api/shares/${type}/${id}/people`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),
  removePerson: (type: ResourceType, id: string, shareId: string) =>
    request<ShareState>(`/api/shares/${type}/${id}/people/${shareId}`, { method: 'DELETE' }),
  setViewerExport: (id: string, viewerExport: boolean) =>
    request<ShareState>(`/api/boards/${id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ viewerExport }),
    }),
  transfer: (id: string, email: string) =>
    request<{ ok: true }>(`/api/boards/${id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  sharedWithMe: () => request<{ items: SharedItem[] }>('/api/shared'),

  /** A web page's title, summary and picture, fetched by the server. */
  unfurl: (url: string) =>
    request<{
      title?: string;
      description?: string;
      image?: string;
      site?: string;
      media?: 'video' | 'audio';
    }>(`/api/unfurl?url=${encodeURIComponent(url)}`),
  settings: () => request<{ settings: Settings }>('/api/settings'),
  putSettings: (settings: Settings) =>
    request<{ settings: Settings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings }),
    }),

  library: () => request<{ items: unknown[] }>('/api/library'),
  addToLibrary: (name: string, elements: BoardElement[]) =>
    request<{ item: unknown }>('/api/library', {
      method: 'POST',
      body: JSON.stringify({ name, elements }),
    }),
  removeFromLibrary: (id: string) =>
    request<{ ok: true }>(`/api/library/${id}`, { method: 'DELETE' }),

  folderContents: (id: string) => request<FolderContents>(`/api/folders/${id}/contents`),

  comments: (boardId: string) =>
    request<{ comments: CommentRecord[] }>(`/api/boards/${boardId}/comments`),
  addComment: (boardId: string, body: NewCommentBody) =>
    request<{ comments: CommentRecord[] }>(`/api/boards/${boardId}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resolveThread: (threadId: string, resolved: boolean) =>
    request<{ comments: CommentRecord[] }>(`/api/comments/${threadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved }),
    }),
  people: (boardId: string) => request<{ people: Person[] }>(`/api/boards/${boardId}/people`),

  notifications: () => request<{ notifications: NotificationRecord[] }>('/api/notifications'),
  readNotifications: () => request<{ ok: true }>('/api/notifications/read', { method: 'POST' }),

  async saveThumbnail(id: string, png: Blob): Promise<void> {
    const response = await fetch(`/api/boards/${id}/thumbnail`, {
      method: 'PUT',
      headers: await authHeaders({ 'content-type': 'image/png' }),
      body: png,
    });
    if (!response.ok)
      throw new ApiError(`Could not save the thumbnail (${response.status})`, response.status);
  },
};
