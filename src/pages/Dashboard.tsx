import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { signOutOfGoogle } from '@/auth/firebase';
import { Link, useRouter } from '@/router/router';
import { folderPath, useWorkspace } from '@/state/workspaceStore';
import type { BoardRecord, FolderRecord } from '@shared/api';
import { ROLE_LABEL, type ResourceType, type SharedItem } from '@shared/sharing';
import { NotificationBell } from '@/ui/NotificationBell';
import { ShareDialog } from '@/ui/ShareDialog';
import styles from './Dashboard.module.css';

type View = { kind: 'folder'; folderId: string | null } | { kind: 'trash' } | { kind: 'shared' };

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
  const children = folders.filter((folder) => folder.parentId === parentId);
  if (children.length === 0) return null;

  return (
    <ul className={styles.tree}>
      {children.map((folder) => (
        <li key={folder.id}>
          <Link
            to={{ name: 'folder', folderId: folder.id }}
            className={styles.treeItem}
            style={{ paddingLeft: `${10 + depth * 14}px` }}
            aria-current={activeId === folder.id ? 'page' : undefined}
            data-testid={`folder-${folder.id}`}
          >
            <span aria-hidden="true">▸</span>
            <span className={styles.treeName}>{folder.name}</span>
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

function FolderCard({
  folder,
  folders,
  boards,
  onRename,
  onMove,
  onShare,
  onTrash,
}: {
  folder: FolderRecord;
  folders: FolderRecord[];
  boards: BoardRecord[];
  onRename: () => void;
  onMove: (parentId: string | null) => void;
  onShare: () => void;
  onTrash: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const inside = boards.filter((board) => board.folderId === folder.id).length;
  const subfolders = folders.filter((each) => each.parentId === folder.id).length;
  const to = { name: 'folder', folderId: folder.id } as const;

  return (
    <article className={styles.card} data-testid={`folder-card-${folder.id}`}>
      <Link to={to} className={`${styles.thumb} ${styles.folderThumb}`} aria-label={folder.name}>
        <svg width="54" height="44" viewBox="0 0 54 44" aria-hidden="true">
          <path
            d="M3 8a4 4 0 0 1 4-4h13l5 6h22a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"
            fill="currentColor"
          />
        </svg>
        <span className={styles.folderCount}>
          {inside} {inside === 1 ? 'board' : 'boards'}
          {subfolders > 0 ? ` · ${subfolders} ${subfolders === 1 ? 'folder' : 'folders'}` : ''}
        </span>
      </Link>
      <div className={styles.cardFoot}>
        <Link to={to} className={styles.cardTitle}>
          {folder.name}
        </Link>
      </div>
      <div className={styles.cardActions}>
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
        <button type="button" onClick={onShare} data-testid={`folder-share-${folder.id}`}>
          Share
        </button>
        <button type="button" onClick={onTrash} data-testid={`folder-trash-${folder.id}`}>
          Delete
        </button>
      </div>
      {moving ? (
        <FolderMoveSelect
          folder={folder}
          folders={folders}
          onMove={(parentId) => {
            setMoving(false);
            onMove(parentId);
          }}
        />
      ) : null}
    </article>
  );
}

function BoardCard({
  board,
  folders,
  onStar,
  onRename,
  onMove,
  onDuplicate,
  onTrash,
  onShare,
}: {
  board: BoardRecord;
  folders: FolderRecord[];
  onStar: () => void;
  onRename: () => void;
  onMove: (folderId: string | null) => void;
  onDuplicate: () => void;
  onTrash: () => void;
  onShare: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const choices = useMemo(() => folderChoices(folders), [folders]);

  return (
    <article className={styles.card} data-testid={`board-${board.id}`}>
      <Link to={{ name: 'board', boardId: board.id }} className={styles.thumb}>
        <Thumbnail url={board.thumbnailUrl} />
      </Link>

      <div className={styles.cardFoot}>
        <Link to={{ name: 'board', boardId: board.id }} className={styles.cardTitle}>
          {board.title}
        </Link>
        {board.storageBytes > 0 ? (
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

      <div className={styles.cardActions}>
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
        <button type="button" onClick={onTrash} data-testid={`trash-${board.id}`}>
          Delete
        </button>
      </div>

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

export function Dashboard({ view }: { view: View }) {
  const { navigate } = useRouter();
  const workspace = useWorkspace();
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

  const [sharing, setSharing] = useState<{ type: ResourceType; id: string; title: string } | null>(
    null,
  );

  const visible = useMemo(() => {
    if (view.kind === 'trash') return workspace.trashedBoards;
    if (view.kind === 'shared') return [];

    const term = query.trim().toLowerCase();
    return workspace.boards.filter((board) => {
      if (starredOnly && !board.starred) return false;
      // A search looks across everything; otherwise you see one folder at a time.
      if (term) return board.title.toLowerCase().includes(term);
      return board.folderId === activeFolderId;
    });
  }, [view.kind, workspace.boards, workspace.trashedBoards, query, starredOnly, activeFolderId]);

  // The folders in view: inside the open folder, or deleted ones in the trash. A
  // folder deleted together with the one it was in shows only as that one.
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
    return workspace.folders.filter((folder) => folder.parentId === activeFolderId);
  }, [view.kind, query, starredOnly, workspace.folders, workspace.trashedFolders, activeFolderId]);
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
  const deleteFolder = async (folder: FolderRecord) => {
    const sure = window.confirm(
      `Move “${folder.name}” and everything in it to the trash? You can restore it from the trash.`,
    );
    if (!sure) return;
    // Deleting the folder on screen, or one it is inside, leaves for the one above.
    const leaving =
      activeFolderId !== null && branchOf(workspace.folders, folder.id).has(activeFolderId);
    await workspace.trashFolder(folder.id);
    if (leaving) {
      navigate(
        folder.parentId ? { name: 'folder', folderId: folder.parentId } : { name: 'dashboard' },
      );
    }
  };
  const activeFolder = workspace.folders.find((folder) => folder.id === activeFolderId) ?? null;
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
        <FolderTree folders={workspace.folders} parentId={null} activeId={activeFolderId} />
      </aside>

      <main className={styles.main}>
        <header className={styles.toolbar}>
          <nav className={styles.breadcrumb} data-testid="breadcrumb" aria-label="Breadcrumb">
            <Link to={{ name: 'dashboard' }}>
              {view.kind === 'trash'
                ? 'Trash'
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

          {activeFolderId ? (
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
                  <FolderMoveSelect
                    folder={activeFolder}
                    folders={workspace.folders}
                    onMove={(parentId) => {
                      setFolderMenu(false);
                      void workspace.moveFolder(activeFolder.id, parentId);
                    }}
                  />
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

          {view.kind === 'shared' ? null : view.kind === 'trash' ? (
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

        {view.kind === 'shared' ? (
          <SharedList />
        ) : boardCards.length === 0 && folderCards.length === 0 ? (
          <p className={styles.blank} data-testid="empty-state">
            {view.kind === 'trash'
              ? 'The trash is empty.'
              : query.trim()
                ? `No board matches “${query.trim()}”.`
                : 'No boards here yet. Create one to get started.'}
          </p>
        ) : (
          <div className={styles.grid}>
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
              ) : (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  folders={workspace.folders}
                  boards={workspace.boards}
                  onRename={() => renameFolder(folder)}
                  onMove={(parentId) => void workspace.moveFolder(folder.id, parentId)}
                  onShare={() => setSharing({ type: 'folder', id: folder.id, title: folder.name })}
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
              ) : (
                <BoardCard
                  key={board.id}
                  board={board}
                  folders={workspace.folders}
                  onStar={() => void workspace.starBoard(board.id, !board.starred)}
                  onRename={() => {
                    const title = window.prompt('Rename board', board.title);
                    if (title !== null) void workspace.renameBoard(board.id, title);
                  }}
                  onMove={(folderId) => void workspace.moveBoard(board.id, folderId)}
                  onDuplicate={() => void workspace.duplicateBoard(board.id)}
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
