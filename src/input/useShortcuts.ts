import { useEffect } from 'react';
import { useBoardStore } from '@/state/boardStore';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

/**
 * Figma-style shortcuts. Matching is on `event.code`, not `event.key`, so Shift+1
 * works whether the keyboard produces "!" or something else entirely — and so an
 * Arabic or French layout behaves the same as a US one.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const store = useBoardStore.getState();

      if (event.code === 'Space') {
        event.preventDefault(); // otherwise the page tries to scroll
        if (!store.spaceHeld) store.setSpaceHeld(true);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.code) {
        case 'KeyV':
          store.setTool('select');
          break;
        case 'KeyH':
          store.setTool('hand');
          break;
        case 'Digit0':
          if (!event.shiftKey) return;
          event.preventDefault();
          store.zoomTo100();
          break;
        case 'Digit1':
          if (!event.shiftKey) return;
          event.preventDefault();
          store.zoomToFit();
          break;
        case 'Digit2':
          if (!event.shiftKey) return;
          event.preventDefault();
          store.zoomToSelection();
          break;
        case 'Equal':
        case 'NumpadAdd':
          event.preventDefault();
          store.zoomStep(1);
          break;
        case 'Minus':
        case 'NumpadSubtract':
          event.preventDefault();
          store.zoomStep(-1);
          break;
        default:
          break;
      }
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
