import { create } from 'zustand';
import { api, ApiError } from '@/api/client';
import type { AccountInfo, BoardRecord, FolderRecord } from '@shared/api';
import type { DashboardSettings } from '@shared/settings';

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
  pinFolder: (id: string, pinned: boolean) => Promise<void>;
  archiveFolder: (id: string) => Promise<void>;
  unarchiveFolder: (id: string) => Promise<void>;
  /** The folders inside one parent, in this order from now on. */
  orderFolders: (parentId: string | null, ids: string[]) => Promise<void>;

  createBoard: (title: string, folderId: string | null) => Promise<BoardRecord | null>;
  renameBoard: (id: string, title: string) => Promise<void>;
  moveBoard: (id: string, folderId: string | null) => Promise<void>;
  starBoard: (id: string, starred: boolean) => Promise<void>;
  duplicateBoard: (id: string) => Promise<void>;
  trashBoard: (id: string) => Promise<void>;
  archiveBoard: (id: string) => Promise<void>;
  unarchiveBoard: (id: string) => Promise<void>;
  /** Called after a board's content reaches the server. */
  markBoardSaved: (id: string) => void;
  restoreBoard: (id: string) => Promise<void>;
}

const replace = <T extends { id: string }>(list: T[], next: T): T[] =>
  list.some((item) => item.id === next.id)
    ? list.map((item) => (item.id === next.id ? next : item))
    : [...list, next];

/**
 * Thumbnails this tab has saved, by board. Leaving a board uploads its picture while
 * the dashboard is already asking for the list of boards; a list read before the upload
 * landed must not take the new picture away, nor a cached older one stand in for it.
 */
const savedThumbnails = new Map<string, { url: string; at: number }>();

const withSavedThumbnails = (boards: BoardRecord[]): BoardRecord[] =>
  boards.map((board) => {
    const saved = savedThumbnails.get(board.id);
    return saved
      ? { ...board, thumbnailUrl: saved.url, updatedAt: Math.max(board.updatedAt, saved.at) }
      : board;
  });

export const useWorkspace = create<WorkspaceState>((set, get) => {
  /** Reloads from the server; every mutation ends here so the view cannot drift. */
  const refresh = async () => {
    const data = await api.workspace();
    set({
      state: 'ready',
      error: null,
      account: data.account,
      folders: data.folders,
      boards: withSavedThumbnails(data.boards),
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

    pinFolder: (id, pinned) =>
      guard(async () => {
        const { folder } = await api.updateFolder(id, { pinned });
        set((current) => ({ folders: replace(current.folders, folder) }));
      }),
    // What goes with an archived folder is worked out by the server; the lists follow.
    archiveFolder: (id) =>
      guard(async () => {
        await api.archiveFolder(id);
        await refresh();
      }),
    unarchiveFolder: (id) =>
      guard(async () => {
        await api.unarchiveFolder(id);
        await refresh();
      }),
    orderFolders: (parentId, ids) =>
      guard(async () => {
        // In order at once, so the folder lands where it was dropped; the server's
        // positions replace these when they come back.
        const place = new Map(ids.map((id, index) => [id, index]));
        set((current) => ({
          folders: current.folders.map((folder) =>
            folder.parentId === parentId && place.has(folder.id)
              ? { ...folder, position: place.get(folder.id)! }
              : folder,
          ),
        }));
        const { folders } = await api.orderFolders({ parentId, ids });
        set({ folders });
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

    markBoardSaved: (id) => {
      // The thumbnail has landed, so the endpoint has something to serve; the version
      // keeps the browser from showing the one it fetched before.
      const at = Date.now();
      savedThumbnails.set(id, { url: `/api/boards/${id}/thumbnail?v=${at}`, at });
      set((current) => ({ boards: withSavedThumbnails(current.boards) }));
    },

    trashBoard: (id) =>
      guard(async () => {
        await api.trashBoard(id);
        set((current) => ({ boards: current.boards.filter((board) => board.id !== id) }));
      }),

    archiveBoard: (id) =>
      guard(async () => {
        const { board } = await api.archiveBoard(id);
        set((current) => ({ boards: replace(current.boards, board) }));
      }),
    unarchiveBoard: (id) =>
      guard(async () => {
        const { board } = await api.unarchiveBoard(id);
        set((current) => ({ boards: replace(current.boards, board) }));
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

/**
 * Folders side by side in one place, in the order they show: pinned first, then the
 * order they were dragged into, then — never dragged — by name.
 */
export function sortFolders(folders: readonly FolderRecord[]): FolderRecord[] {
  const place = (folder: FolderRecord) => folder.position ?? Number.MAX_SAFE_INTEGER;
  return [...folders].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      place(a) - place(b) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  );
}

/** Boards in the order chosen on the dashboard. Names compare "Lesson 2" before "Lesson 10". */
export function sortBoards(
  boards: readonly BoardRecord[],
  sort: DashboardSettings['sort'],
): BoardRecord[] {
  const byName = (a: BoardRecord, b: BoardRecord) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  return [...boards].sort((a, b) => {
    switch (sort) {
      case 'newest':
        return b.createdAt - a.createdAt || byName(a, b);
      case 'oldest':
        return a.createdAt - b.createdAt || byName(a, b);
      case 'name':
        return byName(a, b) || b.createdAt - a.createdAt;
      default:
        return b.openedAt - a.openedAt || byName(a, b);
    }
  });
}

/**
 * Where a dragged folder lands among its siblings: in the place of the one it was
 * dropped on, the others closing up around it.
 */
export function droppedOrder(order: readonly string[], dragged: string, target: string): string[] {
  const from = order.indexOf(dragged);
  const to = order.indexOf(target);
  if (from === -1 || to === -1 || from === to) return [...order];
  const next = order.filter((id) => id !== dragged);
  next.splice(to, 0, dragged);
  return next;
}
