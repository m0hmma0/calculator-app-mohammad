import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/client';
import { signOutOfGoogle } from '@/auth/firebase';
import { Link, useRouter } from '@/router/router';
import { folderPath, useWorkspace } from '@/state/workspaceStore';
import type { BoardRecord, FolderRecord } from '@shared/api';
import styles from './Dashboard.module.css';

type View = { kind: 'folder'; folderId: string | null } | { kind: 'trash' };

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
function Thumbnail({ url }: { url: string | null }) {
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

function BoardCard({
  board,
  folders,
  onStar,
  onRename,
  onMove,
  onDuplicate,
  onTrash,
}: {
  board: BoardRecord;
  folders: FolderRecord[];
  onStar: () => void;
  onRename: () => void;
  onMove: (folderId: string | null) => void;
  onDuplicate: () => void;
  onTrash: () => void;
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

  const visible = useMemo(() => {
    if (view.kind === 'trash') return workspace.trashedBoards;

    const term = query.trim().toLowerCase();
    return workspace.boards.filter((board) => {
      if (starredOnly && !board.starred) return false;
      // A search looks across everything; otherwise you see one folder at a time.
      if (term) return board.title.toLowerCase().includes(term);
      return board.folderId === activeFolderId;
    });
  }, [view.kind, workspace.boards, workspace.trashedBoards, query, starredOnly, activeFolderId]);

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
            to={{ name: 'trash' }}
            className={styles.navItem}
            aria-current={view.kind === 'trash' ? 'page' : undefined}
            data-testid="nav-trash"
          >
            Trash
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
            <Link to={{ name: 'dashboard' }}>{view.kind === 'trash' ? 'Trash' : 'All boards'}</Link>
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

          {view.kind === 'trash' ? null : (
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

        {visible.length === 0 ? (
          <p className={styles.blank} data-testid="empty-state">
            {view.kind === 'trash'
              ? 'The trash is empty.'
              : query.trim()
                ? `No board matches “${query.trim()}”.`
                : 'No boards here yet. Create one to get started.'}
          </p>
        ) : (
          <div className={styles.grid}>
            {visible.map((board) =>
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
                />
              ),
            )}
          </div>
        )}
      </main>
    </div>
  );
}
