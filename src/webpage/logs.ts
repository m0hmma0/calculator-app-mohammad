import * as Y from 'yjs';
import { usePresence } from '@/collab/presence';
import type { BoardDoc } from '@/doc/board';
import {
  PAGE_EVENT_LIMIT,
  PAGE_LOG_LIMIT,
  PAGE_LOGS,
  pageLogKey,
  splitPageLogKey,
} from '@shared/pageLogs';

/**
 * What each person did in each web page on the board (`@shared/pageLogs`): read,
 * added to and started over. Someone who answers may write their own; someone who may
 * only look keeps theirs in the page alone, unsaved.
 */
export interface PageEvent {
  t: string;
  [field: string]: unknown;
}

/** Changes to page logs: saved and sent like any edit, but nobody's undo step. */
export const PAGE_ORIGIN = { page: true };

/** Who this is, for their own log: their account or guest id; "local" signed out. */
export function myPerson(): string {
  return usePresence.getState().self?.uid ?? 'local';
}

export function myName(): string {
  return usePresence.getState().self?.name ?? 'Me';
}

export const logsOf = (board: BoardDoc): Y.Map<Y.Array<PageEvent>> =>
  board.doc.getMap(PAGE_LOGS) as Y.Map<Y.Array<PageEvent>>;

export const mayKeepLog = (board: BoardDoc): boolean => !board.readOnly || board.answers;

export function logFor(board: BoardDoc, pageId: string, person: string): Y.Array<PageEvent> | null {
  const log = logsOf(board).get(pageLogKey(pageId, person));
  return log instanceof Y.Array ? log : null;
}

export function eventsOf(board: BoardDoc, pageId: string, person: string): PageEvent[] {
  return (logFor(board, pageId, person)?.toArray() ?? []).filter(
    (event): event is PageEvent => !!event && typeof event === 'object' && 'path' in event,
  );
}

/** Adds this person's events to their own log, starting it if need be. */
export function appendMine(board: BoardDoc, pageId: string, events: PageEvent[]): boolean {
  if (!mayKeepLog(board) || events.length === 0) return false;
  const kept = events.filter((event) => JSON.stringify(event).length <= PAGE_EVENT_LIMIT);
  if (kept.length === 0) return false;
  const person = myPerson();
  let added = false;
  board.doc.transact(() => {
    const logs = logsOf(board);
    let log = logFor(board, pageId, person);
    if (!log) {
      log = new Y.Array<PageEvent>();
      logs.set(pageLogKey(pageId, person), log);
      log.push([{ t: 'who', name: myName() }]);
    }
    if (log.length + kept.length > PAGE_LOG_LIMIT) return;
    log.push(kept);
    added = true;
  }, PAGE_ORIGIN);
  return added;
}

/** Starts this person's page over: their log goes. */
export function clearMine(board: BoardDoc, pageId: string): void {
  if (!mayKeepLog(board)) return;
  const key = pageLogKey(pageId, myPerson());
  board.doc.transact(() => logsOf(board).delete(key), PAGE_ORIGIN);
}

/** Everyone who has used a page, with the name they had then. */
export function peopleOf(
  board: BoardDoc,
  pageId: string,
): Array<{ person: string; name: string; count: number }> {
  const people: Array<{ person: string; name: string; count: number }> = [];
  logsOf(board).forEach((log, key) => {
    const parts = splitPageLogKey(key);
    if (!parts || parts.pageId !== pageId || !(log instanceof Y.Array)) return;
    const first = log.get(0) as PageEvent | undefined;
    const name = first?.t === 'who' && typeof first.name === 'string' ? first.name : 'Someone';
    people.push({ person: parts.person, name, count: Math.max(0, log.length - 1) });
  });
  return people.sort((a, b) => a.name.localeCompare(b.name));
}
