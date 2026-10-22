import { create } from 'zustand';
import { api, ApiError } from '@/api/client';
import type { AccountInfo, BoardRecord, FolderRecord } from '@shared/api';

export type LoadState = 'idle' | 'loading' | 'ready' | 'signed-out' | 'error';

interface WorkspaceState {
  state: LoadState;
  error: string | null;
  account: AccountInfo | null;
  folders: FolderRecord[];
  boards: BoardRecord[];
  trashedFolders: FolderRecord[];
  trashedBoards: BoardRecord[];

  load: () => Promise<void>;
  /** Refetches without flipping the app into its loading state. */
  refresh: () => Promise<void>;
  loadTrash: () => Promise<void>;
  /** Permanently deletes the trash, and any stored image nothing uses any more. */
  emptyTrash: () => Promise<void>;
  reset: () => void;

  createFolder: (name: string, parentId: string | null) => Promise<FolderRecord | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  moveFolder: (id: string, parentId: string | null) => Promise<void>;
  trashFolder: (id: string) => Promise<void>;
  restoreFolder: (id: string) => Promise<void>;

  createBoard: (title: string, folderId: string | null) => Promise<BoardRecord | null>;
  renameBoard: (id: string, title: string) => Promise<void>;
  moveBoard: (id: string, folderId: string | null) => Promise<void>;
  starBoard: (id: string, starred: boolean) => Promise<void>;
  duplicateBoard: (id: string) => Promise<void>;
  trashBoard: (id: string) => Promise<void>;
  /** Called after a board's content reaches the server. */
  markBoardSaved: (id: string) => void;
  restoreBoard: (id: string) => Promise<void>;
}

const replace = <T extends { id: string }>(list: T[], next: T): T[] =>
  list.some((item) => item.id === next.id)
    ? list.map((item) => (item.id === next.id ? next : item))
    : [...list, next];

export const useWorkspace = create<WorkspaceState>((set, get) => {
  /** Reloads from the server; every mutation ends here so the view cannot drift. */
  const refresh = async () => {
    const data = await api.workspace();
    set({
      state: 'ready',
      error: null,
      account: data.account,
      folders: data.folders,
      boards: data.boards,
    });
  };

  const guard = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        set({ state: 'signed-out', account: null });
        return;
      }
      set({ error: error instanceof Error ? error.message : 'Something went wrong' });
    }
  };

  return {
    state: 'idle',
    error: null,
    account: null,
    folders: [],
    boards: [],
    trashedFolders: [],
    trashedBoards: [],

    load: async () => {
      set({ state: 'loading', error: null });
      await guard(refresh);
      if (get().state === 'loading') set({ state: 'error' });
    },

    // Deliberately quiet: the dashboard calls this on mount, and showing a loading
    // screen would unmount the very component that asked for it.
    refresh: () => guard(refresh),

    loadTrash: () =>
      guard(async () => {
        const data = await api.trash();
        set({ trashedFolders: data.folders, trashedBoards: data.boards });
      }),

    emptyTrash: () =>
      guard(async () => {
        await api.emptyTrash();
        set({ trashedFolders: [], trashedBoards: [] });
      }),

    reset: () => set({ state: 'signed-out', account: null, folders: [], boards: [], error: null }),

    createFolder: async (name, parentId) => {
      let created: FolderRecord | null = null;
      await guard(async () => {
        const { folder } = await api.createFolder({ name, parentId });
        created = folder;
        set((current) => ({ folders: replace(current.folders, folder) }));
      });
      return created;
    },

    renameFolder: (id, name) =>
      guard(async () => {
        const { folder } = await api.updateFolder(id, { name });
        set((current) => ({ folders: replace(current.folders, folder) }));
      }),

    moveFolder: (id, parentId) =>
      guard(async () => {
        const { folder } = await api.updateFolder(id, { parentId });
        set((current) => ({ folders: replace(current.folders, folder) }));
      }),

    trashFolder: (id) =>
      guard(async () => {
        await api.trashFolder(id);
        await refresh();
      }),

    restoreFolder: (id) =>
      guard(async () => {
        await api.restoreFolder(id);
        await Promise.all([refresh(), get().loadTrash()]);
      }),

    createBoard: async (title, folderId) => {
      let created: BoardRecord | null = null;
      await guard(async () => {
        const { board } = await api.createBoard({ title, folderId });
        created = board;
        set((current) => ({ boards: replace(current.boards, board) }));
      });
      return created;
    },

    renameBoard: (id, title) =>
      guard(async () => {
        const { board } = await api.updateBoard(id, { title });
        set((current) => ({ boards: replace(current.boards, board) }));
      }),

    moveBoard: (id, folderId) =>
      guard(async () => {
        const { board } = await api.updateBoard(id, { folderId });
        set((current) => ({ boards: replace(current.boards, board) }));
      }),

    starBoard: (id, starred) =>
      guard(async () => {
        const { board } = await api.updateBoard(id, { starred });
        set((current) => ({ boards: replace(current.boards, board) }));
      }),

    duplicateBoard: (id) =>
      guard(async () => {
        await api.duplicateBoard(id);
        await refresh();
      }),

    markBoardSaved: (id) =>
      set((current) => ({
        boards: current.boards.map((board) =>
          board.id === id
            ? {
                ...board,
                updatedAt: Date.now(),
                // The thumbnail is written alongside the snapshot, so the endpoint
                // has something to serve from the moment the save lands.
                thumbnailUrl: `/api/boards/${id}/thumbnail?v=${Date.now()}`,
              }
            : board,
        ),
      })),

    trashBoard: (id) =>
      guard(async () => {
        await api.trashBoard(id);
        set((current) => ({ boards: current.boards.filter((board) => board.id !== id) }));
      }),

    restoreBoard: (id) =>
      guard(async () => {
        await api.restoreBoard(id);
        await Promise.all([refresh(), get().loadTrash()]);
      }),
  };
});

/** Folder ids from the root down to this one, for a breadcrumb. */
export function folderPath(folders: readonly FolderRecord[], id: string | null): FolderRecord[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: FolderRecord[] = [];

  let cursor = id;
  let guard = 0;
  while (cursor && guard < 64) {
    const folder = byId.get(cursor);
    if (!folder) break;
    path.unshift(folder);
    cursor = folder.parentId;
    guard += 1;
  }
  return path;
}
