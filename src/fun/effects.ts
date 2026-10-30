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
 *
 * Each play is a little different — its colours, shapes, where it comes from, its
 * sound — and never the same as the one before. Started again while one of its kind
 * is still playing, it does not restart: it piles on, bigger and louder.
 */
export type EffectKind = SoundName;

export interface Effect {
  kind: EffectKind;
  id: string;
  /** When it started, on the room's clock. */
  at: number;
  /** How many of its kind are playing with it, itself included: 1 to MAX_LEVEL. */
  level: number;
  /** Which of its kind's variations: colours, shapes, where it comes from. */
  variant: number;
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
  { kind: 'fireworks', emoji: '🎆', label: 'Fireworks' },
  { kind: 'balloons', emoji: '🎈', label: 'Balloons' },
  { kind: 'hearts', emoji: '💖', label: 'Hearts' },
  { kind: 'fanfare', emoji: '🎺', label: 'Fanfare' },
  { kind: 'womp', emoji: '😢', label: 'Womp womp' },
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
  fireworks: 4400,
  balloons: 4600,
  hearts: 3800,
  fanfare: 3600,
  womp: 3200,
};

/** How many variations each kind has; a play never repeats the one before it. */
export const VARIANTS: Record<EffectKind, number> = {
  confetti: 12,
  drumroll: 3,
  bubbles: 4,
  micdrop: 3,
  quiet: 3,
  curtain: 3,
  applause: 4,
  fireworks: 4,
  balloons: 4,
  hearts: 4,
  fanfare: 3,
  womp: 3,
};

/** However often it is pressed, it gets no bigger than this. */
export const MAX_LEVEL = 5;

/** An effect older than this when it arrives is history, not a celebration. */
const FRESH_MS = 6000;
const KEY = 'effect';

export const useEffectsStore = create<{ playing: Effect[] }>(() => ({ playing: [] }));

const serverNow = () => Date.now() + usePresence.getState().clockOffset;

let doc: BoardDoc | null = null;
let unobserve: (() => void) | null = null;
const played = new Set<string>();
const lastVariant = new Map<EffectKind, number>();

function play(effect: Effect) {
  if (played.has(effect.id)) return;
  played.add(effect.id);
  lastVariant.set(effect.kind, effect.variant);
  useEffectsStore.setState((state) => ({ playing: [...state.playing, effect] }));
  playSound(effect.kind, { level: effect.level, seed: effect.id, variant: effect.variant });
  setTimeout(() => {
    useEffectsStore.setState((state) => ({
      playing: state.playing.filter((each) => each.id !== effect.id),
    }));
  }, DURATION[effect.kind]);
}

/** Reads what arrives: an older effect without a level or variant plays as one. */
function readEffect(raw: unknown): Effect | null {
  const value = raw as Partial<Effect> | undefined;
  if (!value || typeof value.id !== 'string') return null;
  if (!EFFECTS.some((each) => each.kind === value.kind)) return null;
  return {
    kind: value.kind!,
    id: value.id,
    at: Number(value.at) || 0,
    level: Math.min(MAX_LEVEL, Math.max(1, Math.round(Number(value.level) || 1))),
    variant: Math.abs(Math.round(Number(value.variant) || 0)) % VARIANTS[value.kind!],
  };
}

onDocumentAttached((board) => {
  unobserve?.();
  doc = board;
  const meta = metaOf(board.doc);
  // Whatever was last played on this board when it opens is history.
  const last = readEffect(meta.get(KEY));
  if (last) played.add(last.id);
  const onChange = () => {
    const effect = readEffect(meta.get(KEY));
    if (!effect || played.has(effect.id)) return;
    if (Math.abs(serverNow() - effect.at) > FRESH_MS) return;
    play(effect);
  };
  meta.observe(onChange);
  unobserve = () => meta.unobserve(onChange);
});

/** One of `count` variations, chosen by `random` (0 to 1), never `last` again. */
export function variantAfter(last: number | undefined, count: number, random: number): number {
  const at = Math.min(0.999999, Math.max(0, random));
  if (last === undefined || count < 2) return Math.floor(at * count);
  return (last + 1 + Math.floor(at * (count - 1))) % count;
}

/** A variation other than the last one this screen played of the kind. */
const nextVariant = (kind: EffectKind) =>
  variantAfter(lastVariant.get(kind), VARIANTS[kind], Math.random());

/** Starts a celebration for everyone on the board. */
export function celebrate(kind: EffectKind): void {
  if (!doc) return;
  const board = doc;
  const already = useEffectsStore.getState().playing.filter((each) => each.kind === kind).length;
  const effect: Effect = {
    kind,
    id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: serverNow(),
    level: Math.min(MAX_LEVEL, already + 1),
    variant: nextVariant(kind),
  };
  transactLocal(board, () => metaOf(board.doc).set(KEY, effect));
  // Someone who may only look still sees their own celebration.
  if (board.readOnly) play(effect);
}
