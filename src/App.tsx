import { useEffect, useState } from 'react';
import { readSettings, watchUser } from '@/auth/firebase';
import { readTestToken } from '@/auth/session';
import { Dashboard } from '@/pages/Dashboard';
import { LocalBoard } from '@/pages/LocalBoard';
import { BoardPage } from '@/pages/BoardPage';
import { LinkLanding, SharedFolder } from '@/pages/Shared';
import { SignIn } from '@/pages/SignIn';
import { shareLink } from '@/sharing/linkSession';
import { RouterProvider, useRouter } from '@/router/router';
import { useWorkspace } from '@/state/workspaceStore';

/** True when this build has a Firebase project, or a test is standing in for one. */
const hasAccounts = () => readSettings() !== null || readTestToken() !== null;

function Routes() {
  const { route } = useRouter();
  const state = useWorkspace((current) => current.state);
  const load = useWorkspace((current) => current.load);
  const reset = useWorkspace((current) => current.reset);
  const folders = useWorkspace((current) => current.folders);
  const [authKnown, setAuthKnown] = useState(() => readTestToken() !== null);

  useEffect(() => {
    if (!hasAccounts()) return;
    // A token injected for tests stands in for a signed-in user.
    if (readTestToken()) {
      void load();
      return;
    }
    return watchUser((user) => {
      setAuthKnown(true);
      if (user) void load();
      else reset();
    });
  }, [load, reset]);

  if (!hasAccounts()) return <LocalBoard />;

  if (!authKnown || state === 'idle' || state === 'loading') {
    return <main data-testid="app-loading" />;
  }
  // A share link works for anyone; it decides itself whether to ask for sign-in.
  if (route.name === 'link') return <LinkLanding key={route.token} token={route.token} />;

  if (state === 'signed-out') {
    // A guest who came in by a link can open what it leads to, and nothing else.
    if (shareLink() && route.name === 'board') return <BoardPage boardId={route.boardId} />;
    if (shareLink() && route.name === 'folder') {
      return <SharedFolder key={route.folderId} folderId={route.folderId} />;
    }
    return <SignIn />;
  }

  switch (route.name) {
    case 'board':
      return <BoardPage boardId={route.boardId} />;
    case 'folder':
      // Someone else's folder, shared with this person, has no place in their tree.
      return folders.some((folder) => folder.id === route.folderId) ? (
        <Dashboard view={{ kind: 'folder', folderId: route.folderId }} />
      ) : (
        <SharedFolder key={route.folderId} folderId={route.folderId} />
      );
    case 'trash':
      return <Dashboard view={{ kind: 'trash' }} />;
    case 'shared':
      return <Dashboard view={{ kind: 'shared' }} />;
    default:
      return <Dashboard view={{ kind: 'folder', folderId: null }} />;
  }
}

export function App() {
  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  );
}
