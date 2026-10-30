import { create } from 'zustand';
import { usePresence } from '@/collab/presence';
import { transactLocal, type BoardDoc } from '@/doc/board';
import { metaOf } from '@/doc/schema';
import { onDocumentAttached } from '@/state/boardStore';
import { playSound, type SoundName } from './sound';

/**
 * Celebrations: confetti, a drum roll and the rest, for everyone on the board at
 * once. Starting one writes it into the board's document (outside the elements, so
 * it is not undoable); every screen that sees it arrive plays it, if it is fresh.
 * Someone opening the board later finds it stale and plays nothing.
 */
export type EffectKind = SoundName;

export interface Effect {
  kind: EffectKind;
  id: string;
  /** When it started, on the room's clock. */
  at: number;
}

export const EFFECTS: ReadonlyArray<{
  kind: EffectKind;
  emoji: string;
  label: string;
}> = [
  { kind: 'confetti', emoji: '🎉', label: 'Confetti' },
  { kind: 'drumroll', emoji: '🥁', label: 'Drum roll' },
  { kind: 'bubbles', emoji: '🫧', label: 'Bubbles' },
  { kind: 'micdrop', emoji: '🎤', label: 'Mic drop' },
  { kind: 'quiet', emoji: '🤫', label: 'Quiet' },
  { kind: 'curtain', emoji: '🎭', label: 'Curtain call' },
  { kind: 'applause', emoji: '👏', label: 'Applause' },
];

/** How long each plays, in milliseconds. */
export const DURATION: Record<EffectKind, number> = {
  confetti: 3800,
  drumroll: 3800,
  bubbles: 4200,
  micdrop: 2800,
  quiet: 2600,
  curtain: 4200,
  applause: 3200,
};

/** An effect older than this when it arrives is history, not a celebration. */
const FRESH_MS = 6000;
const KEY = 'effect';

export const useEffectsStore = create<{ playing: Effect | null }>(() => ({ playing: null }));

const serverNow = () => Date.now() + usePresence.getState().clockOffset;

let doc: BoardDoc | null = null;
let unobserve: (() => void) | null = null;
let lastPlayed: string | null = null;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

function play(effect: Effect) {
  if (effect.id === lastPlayed) return;
  lastPlayed = effect.id;
  if (clearTimer) clearTimeout(clearTimer);
  useEffectsStore.setState({ playing: effect });
  playSound(effect.kind);
  clearTimer = setTimeout(() => {
    if (useEffectsStore.getState().playing?.id === effect.id) {
      useEffectsStore.setState({ playing: null });
    }
  }, DURATION[effect.kind]);
}

onDocumentAttached((board) => {
  unobserve?.();
  doc = board;
  const meta = metaOf(board.doc);
  // Whatever was last played on this board when it opens is history.
  lastPlayed = (meta.get(KEY) as Effect | undefined)?.id ?? null;
  const onChange = () => {
    const effect = meta.get(KEY) as Effect | undefined;
    if (!effect || effect.id === lastPlayed) return;
    if (Math.abs(serverNow() - effect.at) > FRESH_MS) return;
    play(effect);
  };
  meta.observe(onChange);
  unobserve = () => meta.unobserve(onChange);
});

/** Starts a celebration for everyone on the board. */
export function celebrate(kind: EffectKind): void {
  if (!doc) return;
  const board = doc;
  const effect: Effect = { kind, id: `${kind}-${Date.now().toString(36)}`, at: serverNow() };
  transactLocal(board, () => metaOf(board.doc).set(KEY, effect));
  // Someone who may only look still sees their own celebration.
  if (board.readOnly) play(effect);
}
