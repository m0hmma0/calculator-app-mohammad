import { create } from 'zustand';
import type { Role } from '@shared/sharing';
import { canComment, canEdit } from '@shared/sharing';

interface BoardAccessStore {
  /** Null until the board says; the local board, with no server, is always 'owner'. */
  role: Role | null;
  canExport: boolean;
  ownerName: string | null;
  title: string | null;
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
}));

export const selectCanEdit = (state: BoardAccessStore) => canEdit(state.role);
export const selectCanComment = (state: BoardAccessStore) => canComment(state.role);
