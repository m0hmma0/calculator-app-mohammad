import { useEffect, useState } from 'react';
import { ROLE_LABEL, type FolderContents, type LinkInfo } from '@shared/sharing';
import { api, ApiError } from '@/api/client';
import { Link, useRouter } from '@/router/router';
import { guestIdentity, setGuestName, setShareLink } from '@/sharing/linkSession';
import { useWorkspace } from '@/state/workspaceStore';
import { Thumbnail } from './Dashboard';
import { SignIn } from './SignIn';
import styles from './Shared.module.css';

const INVITE_VERB = {
  viewer: 'view',
  commenter: 'comment on',
  answer: 'answer on',
  editor: 'edit',
} as const;

function Message({ title, body, testId }: { title: string; body: string; testId: string }) {
  const signedIn = useWorkspace((state) => state.account !== null);
  return (
    <main className={styles.message} data-testid={testId}>
      <h1>{title}</h1>
      <p>{body}</p>
      {signedIn ? (
        <Link to={{ name: 'dashboard' }} className={styles.button}>
          Back to your boards
        </Link>
      ) : null}
    </main>
  );
}

/**
 * Where a share link lands: /s/<token>. Works out what it leads to and whether this
 * person can use it as they are — asking a guest for a name to show others, or asking
 * someone to sign in — then opens the board or folder with the link attached.
 */
export function LinkLanding({ token }: { token: string }) {
  const { navigate } = useRouter();
  const signedIn = useWorkspace((state) => state.account !== null);
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [dead, setDead] = useState(false);
  const [name, setName] = useState(() => guestIdentity()?.name ?? '');
  const [named, setNamed] = useState(() => guestIdentity() !== null);

  useEffect(() => {
    let live = true;
    api
      .resolveLink(token)
      .then((next) => live && setInfo(next))
      .catch((error: unknown) => {
        if (live && error instanceof ApiError) setDead(true);
      });
    return () => {
      live = false;
    };
    // Signing in can change the answer: a link for signed-in people, say.
  }, [token, signedIn]);

  const ready = info?.admitted && (signedIn || named);
  useEffect(() => {
    if (!ready || !info) return;
    setShareLink(token);
    navigate(
      info.resource.type === 'board'
        ? { name: 'board', boardId: info.resource.id }
        : { name: 'folder', folderId: info.resource.id },
      { replace: true },
    );
  }, [ready, info, token, navigate]);

  if (dead) {
    return (
      <Message
        testId="link-dead"
        title="This link no longer works"
        body="It has expired, or the owner turned it off. Ask them for a new one."
      />
    );
  }
  if (!info) return <main data-testid="app-loading" />;

  if (!info.admitted) {
    if (info.needsSignIn) return <SignIn message={info.reason} />;
    return (
      <Message
        testId="link-refused"
        title="This link is not for this account"
        body={info.reason ?? ''}
      />
    );
  }

  if (!signedIn && !named) {
    return (
      <main className={styles.message} data-testid="guest-prompt">
        <h1>“{info.resource.title}”</h1>
        <p>
          You have been invited to {INVITE_VERB[info.role]} this {info.resource.type}. Pick a name
          so others on it know who you are.
        </p>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            setGuestName(name);
            setNamed(true);
          }}
        >
          <input
            value={name}
            maxLength={40}
            placeholder="Your name"
            aria-label="Your name"
            data-testid="guest-name"
            // The one thing this page asks for.
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="submit"
            className={styles.button}
            disabled={!name.trim()}
            data-testid="guest-continue"
          >
            Continue
          </button>
        </form>
        <p className={styles.muted}>
          Or sign in with Google from the main page to use your own name.
        </p>
      </main>
    );
  }

  return <main data-testid="app-loading" />;
}

/** A folder someone can open but does not own: its boards and subfolders, nothing to edit. */
export function SharedFolder({ folderId }: { folderId: string }) {
  const signedIn = useWorkspace((state) => state.account !== null);
  const [contents, setContents] = useState<FolderContents | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .folderContents(folderId)
      .then((next) => live && setContents(next))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [folderId]);

  if (missing) {
    return (
      <Message
        testId="folder-missing"
        title="That folder is not available"
        body="It may have been deleted, your access may have been removed, or it belongs to someone else."
      />
    );
  }
  if (!contents) return <main data-testid="app-loading" />;

  return (
    <main className={styles.folder} data-testid="shared-folder">
      <header className={styles.folderHead}>
        {signedIn ? (
          <Link to={{ name: 'shared' }} className={styles.back}>
            ← Shared with me
          </Link>
        ) : null}
        <h1>{contents.folder.name}</h1>
        <span className={styles.role}>{ROLE_LABEL[contents.role]}</span>
      </header>
      {contents.folders.length + contents.boards.length === 0 ? (
        <p className={styles.muted}>Nothing in here yet.</p>
      ) : (
        <div className={styles.grid}>
          {contents.folders.map((folder) => (
            <Link
              key={folder.id}
              to={{ name: 'folder', folderId: folder.id }}
              className={styles.card}
            >
              <span className={styles.folderIcon} aria-hidden="true">
                ▸
              </span>
              <span className={styles.title}>{folder.name}</span>
            </Link>
          ))}
          {contents.boards.map((board) => (
            <Link
              key={board.id}
              to={{ name: 'board', boardId: board.id }}
              className={styles.card}
              data-testid={`shared-board-${board.id}`}
            >
              <span className={styles.thumb}>
                <Thumbnail url={board.thumbnailUrl} />
              </span>
              <span className={styles.title}>{board.title}</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
