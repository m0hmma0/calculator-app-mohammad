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
}

export interface BoardRecord {
  id: string;
  folderId: string | null;
  title: string;
  starred: boolean;
  thumbnailUrl: string | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  /** Set only for boards in the trash. */
  deletedAt?: number;
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
