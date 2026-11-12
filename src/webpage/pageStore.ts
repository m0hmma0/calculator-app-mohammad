import { create } from 'zustand';

/**
 * What this screen is doing with the board's web pages; none of it is shared.
 */
interface PagesStore {
  /** A page showing someone else's log on this screen, by page: the teacher watching. */
  watching: Record<string, string>;
  /** Whose pages everything shows, whatever else: the audience window, the presenter. */
  forcedViewer: string | null;
  /** Bumped to start a page over on this screen. */
  restarts: Record<string, number>;
}

export const usePages = create<PagesStore>(() => ({
  watching: {},
  forcedViewer: null,
  restarts: {},
}));

export function watchPage(pageId: string, person: string | null): void {
  const watching = { ...usePages.getState().watching };
  if (person) watching[pageId] = person;
  else delete watching[pageId];
  usePages.setState({ watching });
}

export function restartPage(pageId: string): void {
  const restarts = usePages.getState().restarts;
  usePages.setState({ restarts: { ...restarts, [pageId]: (restarts[pageId] ?? 0) + 1 } });
}

/** A web page: a code box holding HTML, shown as the page rather than its code. */
export const isWebPage = (element: { type: string; language?: string; webView?: boolean }) =>
  element.type === 'code' && element.language === 'html' && element.webView === true;

/** An HTML code box: shown as its code, or as the page (`isWebPage`). */
export const isHtmlCode = (element: { type: string; language?: string }) =>
  element.type === 'code' && element.language === 'html';
