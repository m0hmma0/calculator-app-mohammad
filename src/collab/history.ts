import * as Y from 'yjs';
import { create } from 'zustand';
import type { HistoryCheckpoint, ServerMessage } from '@shared/collab';
import { deriveView } from '@/doc/binding';
import { transactLocal, type BoardDoc } from '@/doc/board';
import { elementsOf, fromYElement, patchYElement, toYElement } from '@/doc/schema';
import type { BoardElement } from '@/model/element';
import type { RoomConnection } from './connection';

interface HistoryStore {
  open: boolean;
  /** The range the scrubber covers: update numbers in the room's log. */
  first: number;
  last: number;
  firstAt: number;
  lastAt: number;
  checkpoints: HistoryCheckpoint[];
  /** Where the scrubber is, and when that was. */
  seq: number | null;
  at: number | null;
  /** The board as it was at `seq`. While set, the canvas shows this instead. */
  preview: BoardElement[] | null;
  previewState: Uint8Array | null;
  loading: boolean;
}

const closed: HistoryStore = {
  open: false,
  first: 0,
  last: 0,
  firstAt: 0,
  lastAt: 0,
  checkpoints: [],
  seq: null,
  at: null,
  preview: null,
  previewState: null,
  loading: false,
};

export const useHistory = create<HistoryStore>(() => ({ ...closed }));

let room: RoomConnection | null = null;
let board: BoardDoc | null = null;
let latestRequest = 0;
const requested = new Map<number, { seq: number; at: number }>();

/** Called when a board opens and closes, so history always talks to the right room. */
export function attachHistory(nextRoom: RoomConnection | null, nextBoard: BoardDoc | null): void {
  room = nextRoom;
  board = nextBoard;
  useHistory.setState({ ...closed });
}

export function openHistory(): void {
  useHistory.setState({ open: true, loading: true });
  room?.send({ t: 'history' });
}

export function closeHistory(): void {
  latestRequest += 1;
  useHistory.setState({ ...closed });
}

/** Asks the room for the board as it stood after update `seq`. */
export function scrubTo(seq: number): void {
  latestRequest += 1;
  useHistory.setState({ seq, loading: true });
  room?.send({ t: 'history-state', seq, req: latestRequest });
}

export function nameCheckpoint(name: string): void {
  const trimmed = name.trim();
  if (trimmed) room?.send({ t: 'checkpoint', name: trimmed });
}

export function applyHistoryMessage(message: ServerMessage): void {
  if (message.t === 'history') {
    const current = useHistory.getState();
    if (!current.open) return;
    useHistory.setState({
      first: message.first,
      last: message.last,
      firstAt: message.firstAt,
      lastAt: message.lastAt,
      checkpoints: message.checkpoints,
      loading: false,
    });
    return;
  }
  if (message.t === 'history-state') {
    requested.set(message.req, { seq: message.seq, at: message.at });
  }
}

function elementsIn(doc: Y.Doc): Map<string, BoardElement> {
  const found = new Map<string, BoardElement>();
  elementsOf(doc).forEach((map, id) => found.set(id, fromYElement(map)));
  return found;
}

/** The binary half of a history answer. Stale answers — the scrubber moved on — are dropped. */
export function applyHistoryState(req: number, state: Uint8Array): void {
  const meta = requested.get(req);
  requested.delete(req);
  if (req !== latestRequest || !useHistory.getState().open) return;

  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    useHistory.setState({
      preview: deriveView([...elementsIn(doc).values()]),
      previewState: state,
      seq: meta?.seq ?? useHistory.getState().seq,
      at: meta?.at ?? null,
      loading: false,
    });
  } finally {
    doc.destroy();
  }
}

/**
 * Restores the board to the point being previewed. This is a new edit, not a rewind:
 * everything since is still in the log and can be scrubbed back to, and — because it
 * is this person's edit — Ctrl+Z undoes the restore.
 */
export function restorePreview(): void {
  const { previewState } = useHistory.getState();
  if (!previewState || !board) return;
  const live = board;

  const target = new Y.Doc();
  try {
    Y.applyUpdate(target, previewState);
    const targetMaps = elementsOf(target);
    const wanted = elementsIn(target);

    transactLocal(live, () => {
      const gone: string[] = [];
      live.elements.forEach((_map, id) => {
        if (!wanted.has(id)) gone.push(id);
      });
      for (const id of gone) live.elements.delete(id);

      for (const [id, element] of wanted) {
        const existing = live.elements.get(id);
        if (!existing) {
          live.elements.set(id, toYElement(element));
          continue;
        }
        // Fields the old version did not have at all are removed, not left behind.
        const keep = new Set(targetMaps.get(id)?.keys() ?? []);
        for (const key of [...existing.keys()]) {
          if (key !== 'style' && !keep.has(key)) existing.delete(key);
        }
        patchYElement(existing, element);
      }
    });
    live.undoManager.stopCapturing();
  } finally {
    target.destroy();
  }
  closeHistory();
}
