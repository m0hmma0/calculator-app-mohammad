import type { BoardElement } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';
import { usePresentation } from './presentation';

/**
 * Play and pause from the keyboard while presenting (Space, by default): the slide's
 * video or sound files. If one is playing, it pauses; if none is, the one played last
 * on this slide plays again, or else the first, reading the slide top to bottom.
 * Other sites' players (YouTube and the like) cannot be reached from here; they play
 * from their own controls.
 */
let playedLast: string | null = null;

if (typeof document !== 'undefined') {
  // Media events do not bubble: caught on the way down.
  document.addEventListener(
    'play',
    (event) => {
      const id = (event.target as HTMLElement | null)?.dataset?.elementId;
      if (id) playedLast = id;
    },
    true,
  );
}

const centreIn = (element: BoardElement, frame: BoardElement) => {
  const x = element.x + element.w / 2;
  const y = element.y + element.h / 2;
  return x >= frame.x && x <= frame.x + frame.w && y >= frame.y && y <= frame.y + frame.h;
};

/** The slide's video and sound files, in reading order. */
export function slideMediaIds(elements: readonly BoardElement[], frameId: string | null): string[] {
  const frame = elements.find((element) => element.id === frameId);
  if (!frame) return [];
  return elements
    .filter(
      (element) =>
        element.type === 'embed' &&
        element.embed?.kind === 'media' &&
        !element.hidden &&
        centreIn(element, frame),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((element) => element.id);
}

const mediaOf = (id: string) =>
  document.querySelector<HTMLMediaElement>(
    `video[data-element-id="${CSS.escape(id)}"], audio[data-element-id="${CSS.escape(id)}"]`,
  );

/** Plays or pauses the slide's media. False when the slide has none. */
export function toggleSlideMedia(): boolean {
  const { frame } = usePresentation.getState();
  const media = slideMediaIds(useBoardStore.getState().elements, frame)
    .map((id) => ({ id, node: mediaOf(id) }))
    .filter((each): each is { id: string; node: HTMLMediaElement } => each.node !== null);
  if (media.length === 0) return false;
  const playing = media.filter((each) => !each.node.paused && !each.node.ended);
  if (playing.length > 0) {
    for (const each of playing) each.node.pause();
    return true;
  }
  const chosen = media.find((each) => each.id === playedLast) ?? media[0]!;
  if (chosen.node.ended) chosen.node.currentTime = 0;
  void chosen.node.play().catch(() => {});
  return true;
}
