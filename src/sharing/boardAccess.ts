import { create } from 'zustand';
import type { Role } from '@shared/sharing';
import { canAnswer, canComment, canEdit } from '@shared/sharing';

interface BoardAccessStore {
  /** Null until the board says; the local board, with no server, is always 'owner'. */
  role: Role | null;
  canExport: boolean;
  ownerName: string | null;
  title: string | null;
  /** On someone else's board, the size new text starts at: its owner's choice. */
  textSize: number | null;
}

/**
 * What this person may do on the open board. The server decides; this mirrors its
 * answer so the interface offers only what will work — the room enforces it either way.
 */
export const useBoardAccess = create<BoardAccessStore>(() => ({
  role: 'owner',
  canExport: true,
  ownerName: null,
  title: null,
  textSize: null,
}));

export const selectCanEdit = (state: BoardAccessStore) => canEdit(state.role);
/** The board's owner — the only one who presents, and who has the minimap. */
export const selectIsOwner = (state: BoardAccessStore) => state.role === 'owner';
export const selectCanComment = (state: BoardAccessStore) => canComment(state.role);

/**
 * Locks guard against accidents, and bind everyone but the board's owner: the owner
 * moves and edits locked things freely; everyone else can select them, and unlock
 * them on purpose, but not move them by mistake.
 */
export const lockedForMe = (element: { locked: boolean }) =>
  element.locked && useBoardAccess.getState().role !== 'owner';

/** Only the board's owner locks things; anyone who edits may unlock them. */
export const mayLock = () => useBoardAccess.getState().role === 'owner';

/** Whether a click on a placeholder types into it here: anyone who edits, or answers. */
export const canTypeInto = () => canAnswer(useBoardAccess.getState().role);
