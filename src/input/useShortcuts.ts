import { useEffect } from 'react';
import { useBoardStore, type Tool } from '@/state/boardStore';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

const TOOL_KEYS: Record<string, Tool> = {
  KeyV: 'select',
  KeyH: 'hand',
  KeyR: 'rect',
  KeyO: 'ellipse',
  KeyL: 'line',
  KeyA: 'arrow',
  KeyP: 'pen',
  KeyE: 'eraser',
  KeyK: 'laser',
  KeyT: 'text',
  KeyN: 'sticky',
  KeyF: 'frame',
};

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Figma-style shortcuts, matched on `event.code` rather than `event.key` so they work
 * the same on any keyboard layout — Shift+1 does not depend on the key producing "!".
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const store = useBoardStore.getState();
      const mod = event.metaKey || event.ctrlKey;

      // While a text box is open, the canvas keeps out of the way entirely.
      if (store.editingId && event.code !== 'Escape') return;
      // The palette owns the keyboard while it is up.
      if (store.paletteOpen && event.code !== 'Escape') return;

      if (event.code === 'Space') {
        event.preventDefault(); // otherwise the page tries to scroll
        if (!store.spaceHeld) store.setSpaceHeld(true);
        return;
      }

      if (mod) {
        switch (event.code) {
          case 'KeyZ':
            event.preventDefault();
            if (event.shiftKey) store.redo();
            else store.undo();
            return;
          case 'KeyY':
            event.preventDefault();
            store.redo();
            return;
          case 'KeyK':
            event.preventDefault();
            store.togglePalette();
            return;
          case 'KeyA':
            event.preventDefault();
            store.selectAll();
            return;
          case 'KeyD':
            event.preventDefault();
            store.duplicateSelection();
            return;
          case 'KeyG':
            event.preventDefault();
            if (event.shiftKey) store.ungroupSelection();
            else store.groupSelection();
            return;
          case 'KeyL':
            if (!event.shiftKey) return;
            event.preventDefault();
            store.toggleLockSelection();
            return;
          case 'KeyH':
            if (!event.shiftKey) return;
            event.preventDefault();
            store.toggleHiddenSelection();
            return;
          case 'BracketRight':
            event.preventDefault();
            store.reorderSelection('front');
            return;
          case 'BracketLeft':
            event.preventDefault();
            store.reorderSelection('back');
            return;
          default:
            return;
        }
      }

      if (event.altKey) return;

      const nudge = NUDGE[event.code];
      if (nudge) {
        if (store.selection.length === 0) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        store.nudgeSelection(nudge[0] * step, nudge[1] * step);
        return;
      }

      switch (event.code) {
        case 'Escape':
          if (store.paletteOpen) {
            store.togglePalette();
            return;
          }
          if (store.contextMenu) {
            store.closeContextMenu();
            return;
          }
          if (store.shortcutsOpen) {
            store.toggleShortcuts();
            return;
          }
          store.clearSelection();
          store.setTool('select');
          return;
        case 'Slash':
          if (!event.shiftKey) return;
          event.preventDefault();
          store.toggleShortcuts();
          return;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          store.deleteSelection();
          return;
        case 'BracketRight':
          event.preventDefault();
          store.reorderSelection('forward');
          return;
        case 'BracketLeft':
          event.preventDefault();
          store.reorderSelection('backward');
          return;
        case 'Digit0':
          if (!event.shiftKey) return;
          event.preventDefault();
          store.zoomTo100();
          return;
        case 'Digit1':
          if (!event.shiftKey) return;
          event.preventDefault();
          store.zoomToFit();
          return;
        case 'Digit2':
          if (!event.shiftKey) return;
          event.preventDefault();
          store.zoomToSelection();
          return;
        case 'Equal':
        case 'NumpadAdd':
          event.preventDefault();
          store.zoomStep(1);
          return;
        case 'Minus':
        case 'NumpadSubtract':
          event.preventDefault();
          store.zoomStep(-1);
          return;
        default:
          break;
      }

      const tool = TOOL_KEYS[event.code];
      if (tool && !event.shiftKey) store.setTool(tool);
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
