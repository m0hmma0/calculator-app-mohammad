import { useEffect } from 'react';
import { closeHistory, useHistory } from '@/collab/history';
import { usePresence } from '@/collab/presence';
import { celebrate, type EffectKind } from '@/fun/effects';
import { useBoardStore, type Tool } from '@/state/boardStore';
import { toggleMinimap, togglePane } from '@/state/uiPrefs';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { openSettings, useSettingsDialog } from '@/settings/dialog';
import { startPresentation, usePresentation } from '@/workshop/presentation';
import { STAMPS } from '@/model/stamps';
import { actionFor, isRecordingShortcut } from './shortcuts';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** The board fills the screen, or stops filling it. */
export function toggleFullScreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

/**
 * Does what a board shortcut is for. False when it does not apply here — the minimap
 * is the owner's, say — so the key is left to the browser.
 */
function run(id: string): boolean {
  const store = useBoardStore.getState();
  const owner = useBoardAccess.getState().role === 'owner';

  // The stamp tool; asked for again while in hand, the next stamp.
  if (id === 'tool.stamp') {
    const at = STAMPS.indexOf(store.stamp as (typeof STAMPS)[number]);
    const next = store.tool === 'stamp' ? STAMPS[(at + 1) % STAMPS.length] : store.stamp;
    store.setStamp(next ?? STAMPS[0]);
    return true;
  }
  if (id.startsWith('stamp.')) {
    const stamp = STAMPS[Number(id.slice(6))];
    if (!stamp) return false;
    store.setStamp(stamp);
    return true;
  }
  if (id.startsWith('tool.')) {
    store.setTool(id.slice(5) as Tool);
    return true;
  }
  if (id.startsWith('celebrate.')) {
    celebrate(id.slice(10) as EffectKind);
    return true;
  }

  switch (id) {
    case 'undo':
      store.undo();
      return true;
    case 'redo':
      store.redo();
      return true;
    case 'duplicate':
      store.duplicateSelection();
      return true;
    case 'delete':
      store.deleteSelection();
      return true;
    case 'select-all':
      store.selectAll();
      return true;
    case 'group':
      store.groupSelection();
      return true;
    case 'ungroup':
      store.ungroupSelection();
      return true;
    case 'lock':
      store.toggleLockSelection();
      return true;
    case 'hide':
      store.toggleHiddenSelection();
      return true;
    case 'forward':
    case 'backward':
    case 'front':
    case 'back':
      store.reorderSelection(id);
      return true;
    case 'zoom-in':
      store.zoomStep(1);
      return true;
    case 'zoom-out':
      store.zoomStep(-1);
      return true;
    case 'zoom-fit':
      store.zoomToFit();
      return true;
    case 'zoom-selection':
      store.zoomToSelection();
      return true;
    case 'zoom-100':
      store.zoomTo100();
      return true;
    case 'minimap':
      // The minimap is the owner's.
      if (!owner) return false;
      toggleMinimap();
      return true;
    case 'pane':
      if (!selectCanEdit(useBoardAccess.getState())) return false;
      togglePane();
      return true;
    case 'fullscreen':
      if (!document.fullscreenEnabled) return false;
      toggleFullScreen();
      return true;
    case 'palette':
      store.togglePalette();
      return true;
    case 'sheet':
      store.toggleShortcuts();
      return true;
    case 'chat':
      // Cursor chat, on a board others can see.
      if (usePresence.getState().status !== 'connected') return false;
      usePresence.setState({ chatOpen: true, chat: '' });
      return true;
    case 'settings':
      openSettings();
      return true;
    case 'present':
      if (!owner || usePresentation.getState().presenting) return false;
      startPresentation();
      return true;
    default:
      return false;
  }
}

/**
 * The board's shortcuts, as listed in `shortcuts.ts` and changed in Settings. A few
 * keys are fixed: Space held pans, the arrows nudge, Escape puts things down.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || isRecordingShortcut()) return;
      const store = useBoardStore.getState();
      const mod = event.metaKey || event.ctrlKey;

      // While a text box is open, the canvas keeps out of the way entirely.
      if (store.editingId && event.code !== 'Escape') return;
      // The palette owns the keyboard while it is up, and so do Settings.
      if (store.paletteOpen && event.code !== 'Escape') return;
      if (useSettingsDialog.getState().open) return;

      // Looking at an old version: nothing edits it, and Escape puts the board back.
      if (useHistory.getState().open) {
        if (event.code === 'Escape') {
          event.preventDefault();
          closeHistory();
        }
        return;
      }

      if (event.code === 'Space' && !mod && !event.altKey) {
        event.preventDefault(); // otherwise the page tries to scroll
        if (!store.spaceHeld) store.setSpaceHeld(true);
        return;
      }

      if (event.code === 'Escape') {
        if (store.paletteOpen) store.togglePalette();
        else if (store.contextMenu) store.closeContextMenu();
        else if (store.shortcutsOpen) store.toggleShortcuts();
        else {
          store.clearSelection();
          store.setTool('select');
        }
        return;
      }

      const nudge = NUDGE[event.code];
      if (nudge && !mod && !event.altKey) {
        if (store.selection.length === 0) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        store.nudgeSelection(nudge[0] * step, nudge[1] * step);
        return;
      }

      const id = actionFor(event, 'board');
      if (id && run(id)) event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') useBoardStore.getState().setSpaceHeld(false);
    };

    // Tabbing away while space is down would otherwise leave the hand tool stuck on.
    const onBlur = () => useBoardStore.getState().setSpaceHeld(false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
