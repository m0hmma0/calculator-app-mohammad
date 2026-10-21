import { describe, expect, it } from 'vitest';
import { hrefFor, parseRoute } from '@/router/routes';

describe('parseRoute', () => {
  it('reads the dashboard', () => {
    expect(parseRoute('/')).toEqual({ name: 'dashboard' });
    expect(parseRoute('/anything-else')).toEqual({ name: 'dashboard' });
  });

  it('reads a board', () => {
    expect(parseRoute('/b/brd_123')).toEqual({ name: 'board', boardId: 'brd_123' });
    expect(parseRoute('/b/brd_123/')).toEqual({ name: 'board', boardId: 'brd_123' });
  });

  it('reads a folder and the trash', () => {
    expect(parseRoute('/f/fld_9')).toEqual({ name: 'folder', folderId: 'fld_9' });
    expect(parseRoute('/trash')).toEqual({ name: 'trash' });
  });

  it('refuses an id with characters an id cannot have', () => {
    expect(parseRoute('/b/../etc')).toEqual({ name: 'dashboard' });
    expect(parseRoute('/b/a b')).toEqual({ name: 'dashboard' });
  });

  it('round-trips every route through its href', () => {
    const routes = [
      { name: 'dashboard' },
      { name: 'board', boardId: 'brd_1' },
      { name: 'folder', folderId: 'fld_1' },
      { name: 'trash' },
    ] as const;

    for (const route of routes) {
      expect(parseRoute(hrefFor(route))).toEqual(route);
    }
  });
});
