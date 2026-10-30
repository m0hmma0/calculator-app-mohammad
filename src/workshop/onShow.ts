import { usePresence } from '@/collab/presence';
import { followedFrameId } from '@/collab/publish';
import type { BoardElement } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';
import { usePresentation } from './presentation';

/**
 * The frame shown alone right now: the one this person is presenting, or the one the
 * presenter they follow is. Everything outside it is hidden — on the canvas and in
 * the layers over it — so a presentation shows each slide and nothing else.
 */
export function frameOnShowId(): string | null {
  const own = usePresentation.getState();
  return own.presenting ? own.frame : followedFrameId();
}

export function useFrameOnShow(): BoardElement | null {
  const own = usePresentation((state) => (state.presenting ? state.frame : null));
  const followed = usePresence((state) => followedFrameId(state));
  const id = own ?? followed;
  return useBoardStore((state) =>
    id ? (state.elements.find((element) => element.id === id) ?? null) : null,
  );
}
