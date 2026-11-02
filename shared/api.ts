/** Shapes crossing between the browser and the Worker. */

export interface AccountInfo {
  uid: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface FolderRecord {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Its place among its siblings once dragged there; null until then (sorted by name). */
  position: number | null;
  /** Pinned folders come first among their siblings. */
  pinned: boolean;
  /** Set only for folders in the trash. */
  deletedAt?: number;
  /** Set only for archived folders: kept, out of the way, nothing deleted. */
  archivedAt?: number;
}

export interface BoardRecord {
  id: string;
  folderId: string | null;
  title: string;
  starred: boolean;
  thumbnailUrl: string | null;
  /** Bytes of images this board uses. */
  storageBytes: number;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  /** Set only for boards in the trash. */
  deletedAt?: number;
  /** Set only for archived boards: kept, out of the way, still opened by their link. */
  archivedAt?: number;
}

export interface WorkspaceResponse {
  account: AccountInfo;
  folders: FolderRecord[];
  boards: BoardRecord[];
}

export interface TrashResponse {
  folders: FolderRecord[];
  boards: BoardRecord[];
}

export interface CreateFolderBody {
  name: string;
  parentId: string | null;
}

export interface UpdateFolderBody {
  name?: string;
  parentId?: string | null;
  pinned?: boolean;
}

/** The folders inside one parent, in the order they were dragged into. */
export interface FolderOrderBody {
  parentId: string | null;
  ids: string[];
}

export interface CreateBoardBody {
  title: string;
  folderId: string | null;
}

export interface UpdateBoardBody {
  title?: string;
  folderId?: string | null;
  starred?: boolean;
}

export interface DuplicateBoardResponse {
  board: BoardRecord;
}

export interface SnapshotMeta {
  /** Plain text pulled out of the board so titles and content are both searchable. */
  searchText?: string;
  /** A small PNG of the board, as a data URL. */
  thumbnail?: string;
}

export const TRASH_RETENTION_DAYS = 30;
