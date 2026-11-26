import { create } from 'zustand';
import type { Role } from '@shared/sharing';
import { actsAsOwner, canAnswer, canComment, canEdit } from '@shared/sharing';

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
/**
 * Someone who runs the board as its owner: the owner, or a co-owner (26 November). They
 * present, have the minimap, lock for others and manage sharing.
 */
export const selectIsOwner = (state: BoardAccessStore) => actsAsOwner(state.role);
export const selectCanComment = (state: BoardAccessStore) => canComment(state.role);

/**
 * Whether a locked thing stops this person. A lock stops everyone, the board's owner
 * included; a lock "for others" stops everyone but the owner. Either way it can be
 * selected and unlocked on purpose, by anyone who edits.
 */
export const lockedForMe = (element: { locked: boolean; lockMode?: 'others' | null }) =>
  element.locked && !(element.lockMode === 'others' && actsAsOwner(useBoardAccess.getState().role));

/** Only the owner (or a co-owner) locks things for others: the lock that leaves them free. */
export const mayLockForOthers = () => actsAsOwner(useBoardAccess.getState().role);

/** Whether a click on a placeholder types into it here: anyone who edits, or answers. */
export const canTypeInto = () => canAnswer(useBoardAccess.getState().role);
