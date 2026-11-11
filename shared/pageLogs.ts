/**
 * Web pages on a board remember what each person did in them — clicks, choices, typing
 * — as a log per page and person, kept in the board's document under one root map.
 * Replaying a log rebuilds that person's page: their own progress when they come back,
 * a student's page when the teacher watches it, the teacher's when everyone follows.
 *
 * One key per page and person (`<page id>|<person>`), never a map per page holding
 * people: two students starting at the same moment would each create that map, and one
 * would win, losing the other's log.
 */
export const PAGE_LOGS = 'pageLogs';

/** The longest log kept: past it, a page still works but stops remembering. */
export const PAGE_LOG_LIMIT = 4000;

/** The biggest single entry, in characters of JSON. */
export const PAGE_EVENT_LIMIT = 4000;

export const pageLogKey = (pageId: string, person: string): string => `${pageId}|${person}`;

/** The page and the person a key belongs to. */
export function splitPageLogKey(key: string): { pageId: string; person: string } | null {
  const at = key.indexOf('|');
  if (at <= 0 || at === key.length - 1) return null;
  return { pageId: key.slice(0, at), person: key.slice(at + 1) };
}
