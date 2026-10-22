import type * as Y from 'yjs';
import { create } from 'zustand';
import { usePresence } from '@/collab/presence';
import { transactLocal, type BoardDoc } from '@/doc/board';
import { metaOf } from '@/doc/schema';
import { onDocumentAttached } from '@/state/boardStore';

/**
 * The workshop tools' shared state: a countdown and a dot vote. Both live in the
 * board's document — outside the element map, so neither is undoable — which means
 * everyone on the board sees the same timer and the same tallies, and a reload keeps
 * them.
 */
export interface TimerState {
  /** When it ends, on the room's clock. */
  endsAt: number;
  durationMs: number;
  startedBy: string;
}

export interface VoteState {
  id: string;
  open: boolean;
  /** Dots each person has to spend. */
  budget: number;
  startedBy: string;
}

interface WorkshopStore {
  timer: TimerState | null;
  vote: VoteState | null;
  /** For the current vote: element id → dots, and this person's own dots by element. */
  counts: Record<string, number>;
  mine: Record<string, number>;
}

export const useWorkshop = create<WorkshopStore>(() => ({
  timer: null,
  vote: null,
  counts: {},
  mine: {},
}));

let doc: BoardDoc | null = null;

const votesOf = (board: BoardDoc) => board.doc.getMap<string[]>('votes');

/** Who is voting: the account, a guest's id, or "me" on the local board. */
export const voterId = () => usePresence.getState().self?.uid ?? 'local';
const actorName = () => usePresence.getState().self?.name ?? 'Someone';

/** The room's clock, as near as this browser can tell. */
export const serverNow = () => Date.now() + usePresence.getState().clockOffset;

function read(board: BoardDoc) {
  const meta = metaOf(board.doc);
  const timer = (meta.get('timer') as TimerState | undefined) ?? null;
  const vote = (meta.get('vote') as VoteState | undefined) ?? null;
  const counts: Record<string, number> = {};
  const mine: Record<string, number> = {};
  if (vote) {
    const me = voterId();
    votesOf(board).forEach((dots, key) => {
      const [voteId, voter] = splitKey(key);
      if (voteId !== vote.id) return;
      for (const id of dots) {
        counts[id] = (counts[id] ?? 0) + 1;
        if (voter === me) mine[id] = (mine[id] ?? 0) + 1;
      }
    });
  }
  useWorkshop.setState({ timer, vote, counts, mine });
}

/**
 * A ballot's key: the vote, the person, and the tab. One person in two windows has
 * two ballots — each written by one tab only, so neither overwrites the other — and
 * one budget across both.
 */
const ballotKey = (board: BoardDoc, voteId: string) =>
  `${voteId}|${voterId()}|${board.doc.clientID}`;

function splitKey(key: string): [string, string] {
  const first = key.indexOf('|');
  const last = key.lastIndexOf('|');
  return [key.slice(0, first), key.slice(first + 1, last)];
}

let unobserve: (() => void) | null = null;

const observe = (board: BoardDoc) => {
  const refresh = () => read(board);
  const meta = metaOf(board.doc);
  const votes = votesOf(board);
  const onVotes = refresh as (event: Y.YMapEvent<string[]>) => void;
  meta.observe(refresh);
  votes.observe(onVotes);
  refresh();
  return () => {
    meta.unobserve(refresh);
    votes.unobserve(onVotes);
  };
};

onDocumentAttached((board) => {
  unobserve?.();
  doc = board;
  unobserve = observe(board);
});
// Who "me" is arrives with the room's welcome; the tallies of mine depend on it.
usePresence.subscribe((state, previous) => {
  if (state.self !== previous.self && doc) read(doc);
});

export function startTimer(minutes: number): void {
  if (!doc) return;
  const board = doc;
  const durationMs = Math.round(minutes * 60_000);
  transactLocal(board, () => {
    metaOf(board.doc).set('timer', {
      endsAt: serverNow() + durationMs,
      durationMs,
      startedBy: actorName(),
    } satisfies TimerState);
  });
}

export function stopTimer(): void {
  if (!doc) return;
  const board = doc;
  transactLocal(board, () => metaOf(board.doc).delete('timer'));
}

export function startVote(budget: number): void {
  if (!doc) return;
  const board = doc;
  transactLocal(board, () => {
    // A new vote starts from no dots; the last one's are gone with it.
    votesOf(board).clear();
    metaOf(board.doc).set('vote', {
      id: `v${Date.now().toString(36)}`,
      open: true,
      budget,
      startedBy: actorName(),
    } satisfies VoteState);
  });
}

/** Closes voting; the tallies stay up as the result until cleared. */
export function endVote(): void {
  const vote = useWorkshop.getState().vote;
  if (!doc || !vote) return;
  const board = doc;
  transactLocal(board, () => metaOf(board.doc).set('vote', { ...vote, open: false }));
}

export function clearVote(): void {
  const vote = useWorkshop.getState().vote;
  if (!doc || !vote) return;
  const board = doc;
  transactLocal(board, () => {
    metaOf(board.doc).delete('vote');
    const votes = votesOf(board);
    for (const key of [...votes.keys()]) if (key.startsWith(`${vote.id}|`)) votes.delete(key);
  });
}

/**
 * One dot on an element, or one taken back. Each tab's dots are an entry of its
 * own, written only by that tab, so nobody voting at the same moment — another
 * person, or the same person in another window — overwrites anyone else.
 */
export function castVote(elementId: string, add: boolean): void {
  const { vote, mine } = useWorkshop.getState();
  if (!doc || !vote?.open) return;
  const spent = Object.values(mine).reduce((sum, dots) => sum + dots, 0);
  if (add && spent >= vote.budget) return;
  const board = doc;
  const own = ballotKey(board, vote.id);
  transactLocal(board, () => {
    const votes = votesOf(board);
    // A dot taken back may have been given from another of this person's tabs.
    const prefix = `${vote.id}|${voterId()}|`;
    const key =
      add || votes.get(own)?.includes(elementId)
        ? own
        : [...votes.keys()].find(
            (candidate) =>
              candidate.startsWith(prefix) && votes.get(candidate)?.includes(elementId),
          );
    if (!key) return;
    const dots = [...(votes.get(key) ?? [])];
    if (add) dots.push(elementId);
    else dots.splice(dots.lastIndexOf(elementId), 1);
    votes.set(key, dots);
  });
}
