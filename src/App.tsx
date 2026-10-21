import { useEffect, useState } from 'react';
import { readSettings, watchUser } from '@/auth/firebase';
import { readTestToken } from '@/auth/session';
import { Dashboard } from '@/pages/Dashboard';
import { LocalBoard } from '@/pages/LocalBoard';
import { BoardPage } from '@/pages/BoardPage';
import { SignIn } from '@/pages/SignIn';
import { RouterProvider, useRouter } from '@/router/router';
import { useWorkspace } from '@/state/workspaceStore';

/** True when this build has a Firebase project, or a test is standing in for one. */
const hasAccounts = () => readSettings() !== null || readTestToken() !== null;

function Routes() {
  const { route } = useRouter();
  const state = useWorkspace((current) => current.state);
  const load = useWorkspace((current) => current.load);
  const reset = useWorkspace((current) => current.reset);
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
  if (state === 'signed-out') return <SignIn />;

  switch (route.name) {
    case 'board':
      return <BoardPage boardId={route.boardId} />;
    case 'folder':
      return <Dashboard view={{ kind: 'folder', folderId: route.folderId }} />;
    case 'trash':
      return <Dashboard view={{ kind: 'trash' }} />;
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
