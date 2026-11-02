import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { api } from '@/api/client';
import { signOutOfGoogle } from '@/auth/firebase';
import { Link, useRouter } from '@/router/router';
import { updateSettings, useSettings } from '@/settings/settings';
import {
  droppedOrder,
  folderPath,
  sortBoards,
  sortFolders,
  useWorkspace,
} from '@/state/workspaceStore';
import type { BoardRecord, FolderRecord } from '@shared/api';
import type { DashboardSettings } from '@shared/settings';
import { ROLE_LABEL, type ResourceType, type SharedItem } from '@shared/sharing';
import { NotificationBell } from '@/ui/NotificationBell';
import { ShareDialog } from '@/ui/ShareDialog';
import styles from './Dashboard.module.css';

type View =
  | { kind: 'folder'; folderId: string | null }
  | { kind: 'trash' }
  | { kind: 'archive' }
  | { kind: 'shared' };

/** The folder being dragged, if any: a drag's data cannot be read until it is dropped. */
let dragging: { id: string; parentId: string | null } | null = null;

/**
 * Dragging folders into a new order among their siblings. Each folder item takes the
 * props this returns; dropping one folder on another puts it in that one's place.
 */
function useFolderDrag(siblings: readonly FolderRecord[], parentId: string | null) {
  const orderFolders = useWorkspace((state) => state.orderFolders);
  const [over, setOver] = useState<string | null>(null);
  return (folder: FolderRecord) => ({
    draggable: true,
    'data-drop-target': over === folder.id ? 'true' : undefined,
    onDragStart: (event: DragEvent) => {
      dragging = { id: folder.id, parentId };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', folder.name);
      event.stopPropagation();
    },
    onDragOver: (event: DragEvent) => {
      if (!dragging || dragging.parentId !== parentId || dragging.id === folder.id) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setOver(folder.id);
    },
    onDragLeave: () => setOver((current) => (current === folder.id ? null : current)),
    onDrop: (event: DragEvent) => {
      const moved = dragging;
      setOver(null);
      if (!moved || moved.parentId !== parentId || moved.id === folder.id) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = null;
      const order = droppedOrder(
        siblings.map((each) => each.id),
        moved.id,
        folder.id,
      );
      void orderFolders(parentId, order);
    },
    onDragEnd: () => {
      dragging = null;
      setOver(null);
    },
  });
}

/** The list's narrowest column and the space between columns, as in the stylesheet. */
const LIST_COLUMN = 280;
const LIST_GAP = 18;

/**
 * How many rows the list needs so that it reads down each column, then on into the
 * next — as many columns as fit, filled top to bottom.
 */
function useListRows(ref: RefObject<HTMLElement | null>, count: number, active: boolean) {
  const [rows, setRows] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || !node) return;
    const measure = () => {
      const columns = Math.max(
        1,
        Math.floor((node.clientWidth + LIST_GAP) / (LIST_COLUMN + LIST_GAP)),
      );
      setRows(Math.max(1, Math.ceil(count / columns)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, count, active]);
  return active ? rows : null;
}

const setDashboard = (change: Partial<DashboardSettings>) =>
  updateSettings((current) => ({ ...current, dashboard: { ...current.dashboard, ...change } }));

const SORT_LABEL: Record<DashboardSettings['sort'], string> = {
  opened: 'Last opened',
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name',
};

/** Boards and folders other people have shared with this account, by email. */
function SharedList() {
  const [items, setItems] = useState<SharedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .sharedWithMe()
      .then(({ items: next }) => live && setItems(next))
      .catch(
        (reason: unknown) =>
          live && setError(reason instanceof Error ? reason.message : 'Could not load'),
      );
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    );
  }
  if (!items) return null;
  if (items.length === 0) {
    return (
      <p className={styles.blank} data-testid="empty-state">
        Nothing has been shared with you yet. When someone shares a board or folder with your Google
        account, it shows up here.
      </p>
    );
  }
  return (
    <div className={styles.grid}>
      {items.map((item) => {
        const to =
          item.type === 'board'
            ? ({ name: 'board', boardId: item.id } as const)
            : ({ name: 'folder', folderId: item.id } as const);
        return (
          <article
            key={`${item.type}:${item.id}`}
            className={styles.card}
            data-testid={`shared-item-${item.id}`}
          >
            <Link to={to} className={styles.thumb}>
              {item.type === 'board' ? (
                <Thumbnail url={item.thumbnailUrl} />
              ) : (
                <span className={styles.empty}>Folder</span>
              )}
            </Link>
            <div className={styles.cardFoot}>
              <Link to={to} className={styles.cardTitle}>
                {item.title}
              </Link>
            </div>
            <p className={styles.sharedMeta}>
              {ROLE_LABEL[item.role]}
              {item.ownerName ? ` · from ${item.ownerName}` : ''}
            </p>
          </article>
        );
      })}
    </div>
  );
}

function FolderTree({
  folders,
  parentId,
  activeId,
  depth = 0,
}: {
  folders: FolderRecord[];
  parentId: string | null;
  activeId: string | null;
  depth?: number;
}) {
  const children = sortFolders(folders.filter((folder) => folder.parentId === parentId));
  const drag = useFolderDrag(children, parentId);
  if (children.length === 0) return null;

  return (
    <ul className={styles.tree}>
      {children.map((folder) => (
        <li key={folder.id} {...drag(folder)} data-testid={`tree-item-${folder.id}`}>
          <Link
            to={{ name: 'folder', folderId: folder.id }}
            className={styles.treeItem}
            style={{ paddingLeft: `${10 + depth * 14}px` }}
            aria-current={activeId === folder.id ? 'page' : undefined}
            data-testid={`folder-${folder.id}`}
            draggable={false}
          >
            <span aria-hidden="true">▸</span>
            <span className={styles.treeName}>{folder.name}</span>
            {folder.pinned ? (
              <span className={styles.pin} aria-label="Pinned" title="Pinned">
                <PinIcon />
              </span>
            ) : null}
          </Link>
          <FolderTree
            folders={folders}
            parentId={folder.id}
            activeId={activeId}
            depth={depth + 1}
          />
        </li>
      ))}
    </ul>
  );
}

/** The thumbnail endpoint needs the sign-in token, so it cannot be a plain src. */
export function Thumbnail({ url }: { url: string | null }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void api.thumbnail(url).then((next) => {
      if (cancelled) {
        if (next) URL.revokeObjectURL(next);
        return;
      }
      objectUrl = next;
      setSrc(next);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!url) return <span className={styles.empty}>Empty board</span>;
  return src ? <img src={src} alt="" /> : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Every folder, labelled with its full path so two folders named "Q4" stay apart. */
function folderChoices(folders: FolderRecord[]) {
  return folders
    .map((folder) => ({
      id: folder.id,
      label: folderPath(folders, folder.id)
        .map((step) => step.name)
        .join(' / '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** A folder and every folder inside it — none of which it can be moved into. */
function branchOf(folders: readonly FolderRecord[], id: string): Set<string> {
  const branch = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && branch.has(folder.parentId) && !branch.has(folder.id)) {
        branch.add(folder.id);
        grew = true;
      }
    }
  }
  return branch;
}

/** Where a folder can go: the top level, or any folder not inside itself. */
function FolderMoveSelect({
  folder,
  folders,
  onMove,
}: {
  folder: FolderRecord;
  folders: FolderRecord[];
  onMove: (parentId: string | null) => void;
}) {
  const choices = useMemo(() => {
    const own = branchOf(folders, folder.id);
    return folderChoices(folders).filter((choice) => !own.has(choice.id));
  }, [folders, folder.id]);
  return (
    <label className={styles.moveTo}>
      <span>Move to</span>
      <select
        value={folder.parentId ?? ''}
        data-testid={`folder-move-to-${folder.id}`}
        onChange={(event) => onMove(event.target.value === '' ? null : event.target.value)}
      >
        <option value="">All boards (top level)</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A folder, closed: an outline for rows, filled for tiles. */
const FolderIcon = ({ size = 54 }: { size?: number }) => (
  <svg width={size} height={(size * 44) / 54} viewBox="0 0 54 44" aria-hidden="true">
    <path
      d="M3 8a4 4 0 0 1 4-4h13l5 6h22a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"
      fill="currentColor"
    />
  </svg>
);

const PinIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M10.2 1.8 14.2 5.8 12.4 6.5 9.6 9.3 9.9 12.4 8.6 13.7 5.9 11 2.6 14.3 1.7 13.4 5 10.1 2.3 7.4 3.6 6.1 6.7 6.4 9.5 3.6Z"
      fill="currentColor"
    />
  </svg>
);

/** A card's actions: laid out under a tile; folded behind "⋯" on a row of the list. */
function Actions({ compact, children }: { compact: boolean; children: ReactNode }) {
  if (!compact) return <div className={styles.cardActions}>{children}</div>;
  return <RowMenu>{children}</RowMenu>;
}

/** "⋯" and its menu, which closes on a choice, a click elsewhere, or Escape. */
function RowMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className={styles.rowMenu} ref={ref}>
      <button
        type="button"
        className={styles.rowMenuButton}
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="row-menu"
        onClick={() => setOpen((current) => !current)}
      >
        ⋯
      </button>
      {open ? (
        // A choice closes the menu once it has done its work (the click bubbles here).
        <div className={styles.rowMenuPanel} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

type DragProps = ReturnType<ReturnType<typeof useFolderDrag>>;

function FolderCard({
  folder,
  folders,
  boards,
  compact,
  drag,
  onRename,
  onMove,
  onShare,
  onPin,
  onArchive,
  onTrash,
}: {
  folder: FolderRecord;
  folders: FolderRecord[];
  boards: BoardRecord[];
  compact: boolean;
  drag?: DragProps;
  onRename: () => void;
  onMove: (parentId: string | null) => void;
  onShare: () => void;
  onPin: () => void;
  onArchive: () => void;
  onTrash: () => void;
}) {
  const [moving, setMoving] = useState(false);
  // What is in it, as it shows: an archived folder's contents went to the archive with it.
  const archived = Boolean(folder.archivedAt);
  const inside = boards.filter(
    (board) => board.folderId === folder.id && Boolean(board.archivedAt) === archived,
  ).length;
  const subfolders = folders.filter(
    (each) => each.parentId === folder.id && Boolean(each.archivedAt) === archived,
  ).length;
  const to = { name: 'folder', folderId: folder.id } as const;
  const count = `${inside} ${inside === 1 ? 'board' : 'boards'}${
    subfolders > 0 ? ` · ${subfolders} ${subfolders === 1 ? 'folder' : 'folders'}` : ''
  }`;

  return (
    <article
      className={compact ? styles.row : styles.card}
      data-testid={`folder-card-${folder.id}`}
      data-pinned={folder.pinned ? 'true' : undefined}
      {...drag}
    >
      {compact ? (
        <Link to={to} className={styles.rowIcon} aria-hidden="true" tabIndex={-1} draggable={false}>
          <FolderIcon size={22} />
        </Link>
      ) : (
        <Link
          to={to}
          className={`${styles.thumb} ${styles.folderThumb}`}
          aria-label={folder.name}
          draggable={false}
        >
          <FolderIcon />
          <span className={styles.folderCount}>{count}</span>
        </Link>
      )}
      <div className={styles.cardFoot}>
        <Link to={to} className={styles.cardTitle} draggable={false}>
          {folder.name}
        </Link>
        {folder.pinned ? (
          <span className={styles.pin} aria-label="Pinned" title="Pinned">
            <PinIcon />
          </span>
        ) : null}
        {compact ? <span className={styles.rowMeta}>{count}</span> : null}
      </div>
      <Actions compact={compact}>
        <button type="button" onClick={onRename} data-testid={`folder-rename-${folder.id}`}>
          Rename
        </button>
        <button
          type="button"
          aria-expanded={moving}
          onClick={() => setMoving((current) => !current)}
          data-testid={`folder-move-${folder.id}`}
        >
          Move
        </button>
        <button
          type="button"
          aria-pressed={folder.pinned}
          onClick={onPin}
          data-testid={`folder-pin-${folder.id}`}
        >
          {folder.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button type="button" onClick={onShare} data-testid={`folder-share-${folder.id}`}>
          Share
        </button>
        <button type="button" onClick={onArchive} data-testid={`folder-archive-${folder.id}`}>
          Archive
        </button>
        <button type="button" onClick={onTrash} data-testid={`folder-trash-${folder.id}`}>
          Delete
        </button>
      </Actions>
      {moving ? (
        <FolderMoveSelect
          folder={folder}
          folders={folders.filter((each) => !each.archivedAt)}
          onMove={(parentId) => {
            setMoving(false);
            onMove(parentId);
          }}
        />
      ) : null}
    </article>
  );
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function BoardCard({
  board,
  folders,
  compact,
  sort,
  onStar,
  onRename,
  onMove,
  onDuplicate,
  onArchive,
  onTrash,
  onShare,
}: {
  board: BoardRecord;
  folders: FolderRecord[];
  compact: boolean;
  sort: DashboardSettings['sort'];
  onStar: () => void;
  onRename: () => void;
  onMove: (folderId: string | null) => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onShare: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const choices = useMemo(() => folderChoices(folders), [folders]);
  const to = { name: 'board', boardId: board.id } as const;
  // The date the boards are in order of, so the order can be seen.
  const shown = sort === 'opened' ? board.openedAt : board.createdAt;

  return (
    <article className={compact ? styles.row : styles.card} data-testid={`board-${board.id}`}>
      {compact ? (
        <Link to={to} className={styles.rowIcon} aria-hidden="true" tabIndex={-1}>
          <BoardIcon />
        </Link>
      ) : (
        <Link to={to} className={styles.thumb}>
          <Thumbnail url={board.thumbnailUrl} />
        </Link>
      )}

      <div className={styles.cardFoot}>
        <Link to={to} className={styles.cardTitle}>
          {board.title}
        </Link>
        {compact ? (
          <span className={styles.rowMeta} title={sort === 'opened' ? 'Last opened' : 'Added'}>
            {dateFormat.format(shown)}
          </span>
        ) : null}
        {board.storageBytes > 0 && !compact ? (
          <span
            className={styles.storage}
            title="Images stored for this board"
            data-testid={`storage-${board.id}`}
          >
            {formatBytes(board.storageBytes)}
          </span>
        ) : null}
        <button
          type="button"
          className={styles.star}
          aria-pressed={board.starred}
          aria-label={board.starred ? 'Unstar' : 'Star'}
          data-testid={`star-${board.id}`}
          onClick={onStar}
        >
          {board.starred ? '★' : '☆'}
        </button>
      </div>

      <Actions compact={compact}>
        <button type="button" onClick={onRename} data-testid={`rename-${board.id}`}>
          Rename
        </button>
        <button
          type="button"
          aria-expanded={moving}
          onClick={() => setMoving((current) => !current)}
          data-testid={`move-${board.id}`}
        >
          Move
        </button>
        <button type="button" onClick={onDuplicate} data-testid={`duplicate-${board.id}`}>
          Duplicate
        </button>
        <button type="button" onClick={onShare} data-testid={`share-${board.id}`}>
          Share
        </button>
        <button type="button" onClick={onArchive} data-testid={`archive-${board.id}`}>
          Archive
        </button>
        <button type="button" onClick={onTrash} data-testid={`trash-${board.id}`}>
          Delete
        </button>
      </Actions>

      {moving ? (
        <label className={styles.moveTo}>
          <span>Move to</span>
          <select
            value={board.folderId ?? ''}
            data-testid={`move-to-${board.id}`}
            onChange={(event) => {
              setMoving(false);
              onMove(event.target.value === '' ? null : event.target.value);
            }}
          >
            <option value="">All boards (top level)</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </article>
  );
}

const BoardIcon = () => (
  <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
    <rect
      x="1"
      y="1"
      width="20"
      height="16"
      rx="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path d="M5 12l3.5-4 3 3 2-2L17 12" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

/** Something archived: opened from here, or brought back where it was. */
function ArchivedCard({
  kind,
  id,
  title,
  thumbnailUrl,
  compact,
  onRestore,
}: {
  kind: 'folder' | 'board';
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  compact: boolean;
  onRestore: () => void;
}) {
  const to =
    kind === 'board'
      ? ({ name: 'board', boardId: id } as const)
      : ({ name: 'folder', folderId: id } as const);
  return (
    <article
      className={compact ? styles.row : styles.card}
      data-testid={kind === 'board' ? `board-${id}` : `folder-card-${id}`}
    >
      {compact ? (
        <Link to={to} className={styles.rowIcon} aria-hidden="true" tabIndex={-1}>
          {kind === 'board' ? <BoardIcon /> : <FolderIcon size={22} />}
        </Link>
      ) : (
        <Link
          to={to}
          className={`${styles.thumb} ${kind === 'folder' ? styles.folderThumb : ''}`}
          aria-label={title}
        >
          {kind === 'board' ? <Thumbnail url={thumbnailUrl ?? null} /> : <FolderIcon />}
        </Link>
      )}
      <div className={styles.cardFoot}>
        <Link to={to} className={styles.cardTitle}>
          {title}
        </Link>
      </div>
      <div className={compact ? styles.rowActions : styles.cardActions}>
        <button
          type="button"
          data-testid={kind === 'board' ? `unarchive-${id}` : `unarchive-folder-${id}`}
          onClick={onRestore}
        >
          {kind === 'board' ? 'Restore' : 'Restore with everything in it'}
        </button>
      </div>
    </article>
  );
}

export function Dashboard({ view }: { view: View }) {
  const { navigate } = useRouter();
  const workspace = useWorkspace();
  const dashboard = useSettings((state) => state.settings.dashboard);
  const compact = dashboard.view === 'list';
  const [query, setQuery] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);

  useEffect(() => {
    // Coming back from a board, titles and thumbnails may have moved on.
    void workspace.refresh();
    if (view.kind === 'trash') void workspace.loadTrash();
    // Loading the trash is driven by the route, not by every store change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind]);

  const activeFolderId = view.kind === 'folder' ? view.folderId : null;
  const path = useMemo(
    () => folderPath(workspace.folders, activeFolderId),
    [workspace.folders, activeFolderId],
  );
  const activeFolder = workspace.folders.find((folder) => folder.id === activeFolderId) ?? null;
  // An archived folder, opened from the archive, shows what was archived with it.
  const browsingArchive = Boolean(activeFolder?.archivedAt);

  // Everywhere but the archive, archived things are out of the way.
  const liveFolders = useMemo(
    () => workspace.folders.filter((folder) => !folder.archivedAt),
    [workspace.folders],
  );
  const liveBoards = useMemo(
    () => workspace.boards.filter((board) => !board.archivedAt),
    [workspace.boards],
  );

  const [sharing, setSharing] = useState<{ type: ResourceType; id: string; title: string } | null>(
    null,
  );

  const visible = useMemo(() => {
    if (view.kind === 'trash') return workspace.trashedBoards;
    if (view.kind === 'shared') return [];
    const term = query.trim().toLowerCase();
    if (view.kind === 'archive') {
      // A board archived with its folder is found in that folder, not loose here —
      // unless it is being searched for.
      return sortBoards(
        workspace.boards.filter((board) => {
          if (!board.archivedAt) return false;
          if (term) return board.title.toLowerCase().includes(term);
          return !workspace.folders.some(
            (folder) => folder.id === board.folderId && folder.archivedAt === board.archivedAt,
          );
        }),
        dashboard.sort,
      );
    }

    const pool = browsingArchive ? workspace.boards : liveBoards;
    return sortBoards(
      pool.filter((board) => {
        if (starredOnly && !board.starred) return false;
        // A search looks across everything; otherwise you see one folder at a time.
        if (term) return board.title.toLowerCase().includes(term);
        return board.folderId === activeFolderId;
      }),
      dashboard.sort,
    );
  }, [
    view.kind,
    workspace.boards,
    workspace.folders,
    workspace.trashedBoards,
    liveBoards,
    browsingArchive,
    query,
    starredOnly,
    activeFolderId,
    dashboard.sort,
  ]);

  // The folders in view: inside the open folder, archived ones in the archive, or
  // deleted ones in the trash. A folder that went with the one it was in shows only as
  // that one.
  const folderCards = useMemo(() => {
    if (view.kind === 'shared' || query.trim() || starredOnly) return [];
    if (view.kind === 'trash') {
      return workspace.trashedFolders.filter(
        (folder) =>
          !workspace.trashedFolders.some(
            (parent) => parent.id === folder.parentId && parent.deletedAt === folder.deletedAt,
          ),
      );
    }
    if (view.kind === 'archive') {
      return sortFolders(
        workspace.folders.filter(
          (folder) =>
            folder.archivedAt &&
            !workspace.folders.some(
              (parent) => parent.id === folder.parentId && parent.archivedAt === folder.archivedAt,
            ),
        ),
      );
    }
    return sortFolders(
      (browsingArchive ? workspace.folders : liveFolders).filter(
        (folder) => folder.parentId === activeFolderId,
      ),
    );
  }, [
    view.kind,
    query,
    starredOnly,
    workspace.folders,
    workspace.trashedFolders,
    liveFolders,
    browsingArchive,
    activeFolderId,
  ]);
  const dragFolder = useFolderDrag(folderCards, activeFolderId);
  // In the trash, boards that went with a deleted folder come back with it.
  const boardCards =
    view.kind === 'trash'
      ? visible.filter(
          (board) =>
            !workspace.trashedFolders.some(
              (folder) => folder.id === board.folderId && folder.deletedAt === board.deletedAt,
            ),
        )
      : visible;

  const renameFolder = (folder: FolderRecord) => {
    const name = window.prompt('Rename folder', folder.name);
    if (name !== null) void workspace.renameFolder(folder.id, name);
  };
  /** Off the screen it is on: if that folder, or one it is in, is the one open, go up. */
  const leaveIfInside = (folder: FolderRecord) => {
    const leaving =
      activeFolderId !== null && branchOf(workspace.folders, folder.id).has(activeFolderId);
    if (leaving) {
      navigate(
        folder.parentId ? { name: 'folder', folderId: folder.parentId } : { name: 'dashboard' },
      );
    }
  };
  const deleteFolder = async (folder: FolderRecord) => {
    const sure = window.confirm(
      `Move “${folder.name}” and everything in it to the trash? You can restore it from the trash.`,
    );
    if (!sure) return;
    await workspace.trashFolder(folder.id);
    leaveIfInside(folder);
  };
  const archiveFolder = async (folder: FolderRecord) => {
    await workspace.archiveFolder(folder.id);
    leaveIfInside(folder);
  };
  const [folderMenu, setFolderMenu] = useState(false);

  const newFolder = async () => {
    const name = window.prompt('Name for the new folder', 'New folder');
    if (name === null) return;
    await workspace.createFolder(name, activeFolderId);
  };

  const newBoard = async () => {
    const board = await workspace.createBoard('Untitled board', activeFolderId);
    if (board) navigate({ name: 'board', boardId: board.id });
  };

  const arranging = view.kind === 'folder' || view.kind === 'archive';
  const listing = compact && arranging;
  const itemsRef = useRef<HTMLDivElement>(null);
  const listRows = useListRows(itemsRef, folderCards.length + boardCards.length, listing);

  return (
    <div className={styles.layout} data-testid="dashboard">
      <aside className={styles.sidebar}>
        <div className={styles.account}>
          {workspace.account?.picture ? (
            <img src={workspace.account.picture} alt="" className={styles.avatar} />
          ) : (
            <span className={styles.avatar} aria-hidden="true" />
          )}
          <span className={styles.accountName} data-testid="account-name">
            {workspace.account?.name ?? workspace.account?.email ?? 'Signed in'}
          </span>
          <NotificationBell />
          <button
            type="button"
            className={styles.signOut}
            data-testid="sign-out"
            onClick={() => void signOutOfGoogle()}
          >
            Sign out
          </button>
        </div>

        <nav className={styles.nav}>
          <Link
            to={{ name: 'dashboard' }}
            className={styles.navItem}
            aria-current={view.kind === 'folder' && !view.folderId ? 'page' : undefined}
            data-testid="nav-all"
          >
            All boards
          </Link>
          <button
            type="button"
            className={styles.navItem}
            aria-pressed={starredOnly}
            data-testid="nav-starred"
            onClick={() => setStarredOnly((current) => !current)}
          >
            Starred
          </button>
          <Link
            to={{ name: 'shared' }}
            className={styles.navItem}
            aria-current={view.kind === 'shared' ? 'page' : undefined}
            data-testid="nav-shared"
          >
            Shared with me
          </Link>
          <Link
            to={{ name: 'archive' }}
            className={styles.navItem}
            aria-current={view.kind === 'archive' ? 'page' : undefined}
            data-testid="nav-archive"
          >
            Archive
          </Link>
          <Link
            to={{ name: 'trash' }}
            className={styles.navItem}
            aria-current={view.kind === 'trash' ? 'page' : undefined}
            data-testid="nav-trash"
          >
            Trash
          </Link>
          <Link to={{ name: 'settings' }} className={styles.navItem} data-testid="nav-settings">
            Settings
          </Link>
        </nav>

        <div className={styles.sidebarHead}>
          <span>Folders</span>
          <button type="button" onClick={() => void newFolder()} data-testid="new-folder">
            +
          </button>
        </div>
        <FolderTree folders={liveFolders} parentId={null} activeId={activeFolderId} />
      </aside>

      <main className={styles.main}>
        <header className={styles.toolbar}>
          <nav className={styles.breadcrumb} data-testid="breadcrumb" aria-label="Breadcrumb">
            <Link to={view.kind === 'archive' ? { name: 'archive' } : { name: 'dashboard' }}>
              {view.kind === 'trash'
                ? 'Trash'
                : view.kind === 'archive'
                  ? 'Archive'
                  : view.kind === 'shared'
                    ? 'Shared with me'
                    : 'All boards'}
            </Link>
            {path.map((folder) => (
              <span key={folder.id}>
                <span className={styles.sep} aria-hidden="true">
                  /
                </span>
                <Link to={{ name: 'folder', folderId: folder.id }}>{folder.name}</Link>
              </span>
            ))}
          </nav>

          <input
            type="search"
            className={styles.search}
            placeholder="Search boards…"
            value={query}
            aria-label="Search boards"
            data-testid="search"
            onChange={(event) => setQuery(event.target.value)}
          />

          {arranging ? (
            <div className={styles.arrange}>
              <div className={styles.viewSwitch} role="group" aria-label="Show as">
                <button
                  type="button"
                  aria-pressed={!compact}
                  data-testid="view-tiles"
                  title="Tiles, with a picture of each board"
                  onClick={() => setDashboard({ view: 'tiles' })}
                >
                  Tiles
                </button>
                <button
                  type="button"
                  aria-pressed={compact}
                  data-testid="view-list"
                  title="A compact list, in columns"
                  onClick={() => setDashboard({ view: 'list' })}
                >
                  List
                </button>
              </div>
              <label className={styles.sort}>
                <span>Boards by</span>
                <select
                  value={dashboard.sort}
                  data-testid="board-sort"
                  onChange={(event) =>
                    setDashboard({ sort: event.target.value as DashboardSettings['sort'] })
                  }
                >
                  {(Object.keys(SORT_LABEL) as DashboardSettings['sort'][]).map((each) => (
                    <option key={each} value={each}>
                      {SORT_LABEL[each]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {activeFolderId && !browsingArchive ? (
            <button
              type="button"
              className={styles.secondary}
              data-testid="share-folder"
              onClick={() =>
                setSharing({
                  type: 'folder',
                  id: activeFolderId,
                  title: path.at(-1)?.name ?? 'Folder',
                })
              }
            >
              Share folder
            </button>
          ) : null}

          {activeFolder ? (
            <div className={styles.folderMenu}>
              <button
                type="button"
                className={styles.secondary}
                aria-expanded={folderMenu}
                aria-haspopup="menu"
                data-testid="folder-menu"
                onClick={() => setFolderMenu((current) => !current)}
              >
                Folder ▾
              </button>
              {folderMenu ? (
                <div className={styles.folderMenuPanel} role="menu">
                  {browsingArchive ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="folder-menu-unarchive"
                      onClick={() => {
                        setFolderMenu(false);
                        void workspace.unarchiveFolder(activeFolder.id);
                      }}
                    >
                      Bring back from the archive
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="folder-menu-rename"
                        onClick={() => {
                          setFolderMenu(false);
                          renameFolder(activeFolder);
                        }}
                      >
                        Rename folder
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="folder-menu-pin"
                        onClick={() => {
                          setFolderMenu(false);
                          void workspace.pinFolder(activeFolder.id, !activeFolder.pinned);
                        }}
                      >
                        {activeFolder.pinned ? 'Unpin folder' : 'Pin folder'}
                      </button>
                      <FolderMoveSelect
                        folder={activeFolder}
                        folders={liveFolders}
                        onMove={(parentId) => {
                          setFolderMenu(false);
                          void workspace.moveFolder(activeFolder.id, parentId);
                        }}
                      />
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="folder-menu-archive"
                        onClick={() => {
                          setFolderMenu(false);
                          void archiveFolder(activeFolder);
                        }}
                      >
                        Archive folder
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.danger}
                    data-testid="folder-menu-delete"
                    onClick={() => {
                      setFolderMenu(false);
                      void deleteFolder(activeFolder);
                    }}
                  >
                    Delete folder…
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {view.kind === 'shared' ||
          view.kind === 'archive' ||
          browsingArchive ? null : view.kind === 'trash' ? (
            <button
              type="button"
              className={styles.secondary}
              data-testid="empty-trash"
              onClick={() => {
                const sure = window.confirm(
                  'Permanently delete everything in the trash, and any image no board uses any more? This cannot be undone.',
                );
                if (sure) void workspace.emptyTrash();
              }}
            >
              Empty trash
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              onClick={() => void newBoard()}
              data-testid="new-board"
            >
              New board
            </button>
          )}
        </header>

        {workspace.error ? (
          <p className={styles.error} role="alert">
            {workspace.error}
          </p>
        ) : null}

        {browsingArchive ? (
          <p className={styles.notice} data-testid="archived-folder-notice">
            This folder is archived. Everything in it is kept; bring it back from the Folder menu.
          </p>
        ) : null}

        {view.kind === 'shared' ? (
          <SharedList />
        ) : boardCards.length === 0 && folderCards.length === 0 ? (
          <p className={styles.blank} data-testid="empty-state">
            {view.kind === 'trash'
              ? 'The trash is empty.'
              : view.kind === 'archive'
                ? 'Nothing is archived. Archive a folder or a board to keep it out of the way without deleting it.'
                : query.trim()
                  ? `No board matches “${query.trim()}”.`
                  : 'No boards here yet. Create one to get started.'}
          </p>
        ) : (
          <div
            ref={itemsRef}
            className={listing ? styles.list : styles.grid}
            data-testid="items"
            data-view={listing ? 'list' : 'tiles'}
            style={
              listing && listRows
                ? { gridTemplateRows: `repeat(${listRows}, auto)`, gridAutoFlow: 'column' }
                : undefined
            }
          >
            {folderCards.map((folder) =>
              view.kind === 'trash' ? (
                <article
                  key={folder.id}
                  className={styles.card}
                  data-testid={`folder-card-${folder.id}`}
                >
                  <span className={`${styles.thumb} ${styles.folderThumb}`}>
                    <span className={styles.empty}>Folder · {folder.name}</span>
                  </span>
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      data-testid={`restore-folder-${folder.id}`}
                      onClick={() => void workspace.restoreFolder(folder.id)}
                    >
                      Restore with everything in it
                    </button>
                  </div>
                </article>
              ) : view.kind === 'archive' ? (
                <ArchivedCard
                  key={folder.id}
                  kind="folder"
                  id={folder.id}
                  title={folder.name}
                  compact={compact}
                  onRestore={() => void workspace.unarchiveFolder(folder.id)}
                />
              ) : (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  folders={workspace.folders}
                  boards={workspace.boards}
                  compact={compact}
                  drag={browsingArchive || query.trim() ? undefined : dragFolder(folder)}
                  onRename={() => renameFolder(folder)}
                  onMove={(parentId) => void workspace.moveFolder(folder.id, parentId)}
                  onShare={() => setSharing({ type: 'folder', id: folder.id, title: folder.name })}
                  onPin={() => void workspace.pinFolder(folder.id, !folder.pinned)}
                  onArchive={() => void archiveFolder(folder)}
                  onTrash={() => void deleteFolder(folder)}
                />
              ),
            )}
            {boardCards.map((board) =>
              view.kind === 'trash' ? (
                <article key={board.id} className={styles.card} data-testid={`board-${board.id}`}>
                  <span className={styles.thumb}>
                    <span className={styles.empty}>{board.title}</span>
                  </span>
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      data-testid={`restore-${board.id}`}
                      onClick={() => void workspace.restoreBoard(board.id)}
                    >
                      Restore
                    </button>
                  </div>
                </article>
              ) : view.kind === 'archive' ? (
                <ArchivedCard
                  key={board.id}
                  kind="board"
                  id={board.id}
                  title={board.title}
                  thumbnailUrl={board.thumbnailUrl}
                  compact={compact}
                  onRestore={() => void workspace.unarchiveBoard(board.id)}
                />
              ) : (
                <BoardCard
                  key={board.id}
                  board={board}
                  folders={liveFolders}
                  compact={compact}
                  sort={dashboard.sort}
                  onStar={() => void workspace.starBoard(board.id, !board.starred)}
                  onRename={() => {
                    const title = window.prompt('Rename board', board.title);
                    if (title !== null) void workspace.renameBoard(board.id, title);
                  }}
                  onMove={(folderId) => void workspace.moveBoard(board.id, folderId)}
                  onDuplicate={() => void workspace.duplicateBoard(board.id)}
                  onArchive={() => void workspace.archiveBoard(board.id)}
                  onTrash={() => void workspace.trashBoard(board.id)}
                  onShare={() => setSharing({ type: 'board', id: board.id, title: board.title })}
                />
              ),
            )}
          </div>
        )}
      </main>

      {sharing ? (
        <ShareDialog
          resource={sharing}
          onClose={() => setSharing(null)}
          onTransferred={() => void workspace.refresh()}
        />
      ) : null}
    </div>
  );
}
