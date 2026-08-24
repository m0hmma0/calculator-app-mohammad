import { useEffect, useLayoutEffect, useRef } from 'react';
import { fontString } from '@/canvas/fonts';
import { boardToScreen, type Viewport } from '@/canvas/viewport';
import { STICKY_PADDING, TEXT_PADDING } from '@/canvas/renderContent';
import { detectDirection } from '@/model/textLayout';
import { useBoardStore } from '@/state/boardStore';
import styles from './TextEditor.module.css';

/**
 * Editing happens in a real textarea sitting exactly over the element, not in the
 * canvas. The browser then supplies the caret, selection, IME, autocorrect and — the
 * reason this matters most here — correct Arabic shaping and bidirectional cursor
 * movement, none of which a hand-rolled canvas caret would get right.
 */
export function TextEditor({ viewport }: { viewport: Viewport }) {
  const editingId = useBoardStore((state) => state.editingId);
  const elements = useBoardStore((state) => state.elements);
  const renderVersion = useBoardStore((state) => state.renderVersion);
  const setElementText = useBoardStore((state) => state.setElementText);
  const endEditing = useBoardStore((state) => state.endEditing);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  void renderVersion;
  const element = elements.find((candidate) => candidate.id === editingId);

  useLayoutEffect(() => {
    if (!element) return;
    const node = ref.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }, [element?.id, element]);

  useEffect(() => {
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        endEditing();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [element, endEditing]);

  if (!element) return null;

  const sticky = element.type === 'sticky';
  const padding = sticky ? STICKY_PADDING : TEXT_PADDING;
  const topLeft = boardToScreen(viewport, { x: element.x, y: element.y });
  const value = element.text ?? '';

  return (
    <textarea
      ref={ref}
      className={styles.editor}
      data-hud
      data-testid="text-editor"
      dir={detectDirection(value)}
      value={value}
      spellCheck={false}
      onChange={(event) => setElementText(element.id, event.target.value)}
      onBlur={endEditing}
      style={{
        left: `${topLeft.x}px`,
        top: `${topLeft.y}px`,
        width: `${element.w * viewport.zoom}px`,
        height: `${element.h * viewport.zoom}px`,
        padding: `${padding * viewport.zoom}px`,
        font: fontString(element.style, element.style.fontSize * viewport.zoom),
        lineHeight: element.style.lineHeight,
        letterSpacing: `${element.style.letterSpacing * viewport.zoom}px`,
        textAlign: element.style.align,
        transform: element.rotation ? `rotate(${element.rotation}rad)` : undefined,
        transformOrigin: 'center',
      }}
    />
  );
}
