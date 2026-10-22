import { useEffect, useLayoutEffect, useRef } from 'react';
import { fontString } from '@/canvas/fonts';
import { boardToScreen, type Viewport } from '@/canvas/viewport';
import { STICKY_PADDING, TEXT_PADDING } from '@/canvas/renderContent';
import { textSplice } from '@/doc/schema';
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
  /** The text as this person last saw it, and where their caret was in it. */
  const seen = useRef<{ value: string; start: number; end: number } | null>(null);

  void renderVersion;
  const element = elements.find((candidate) => candidate.id === editingId);

  useLayoutEffect(() => {
    if (!element) return;
    const node = ref.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }, [element?.id, element]);

  // Someone else typed in this box. Their words arrive; this person's caret stays
  // put relative to their own text rather than jumping to the end.
  const value = element?.text ?? '';
  useLayoutEffect(() => {
    const node = ref.current;
    const before = seen.current;
    if (!node || !before || before.value === value) return;
    const splice = textSplice(before.value, value);
    const shift = (position: number) => {
      if (position <= splice.index) return position;
      if (position >= splice.index + splice.remove) {
        return position + splice.insert.length - splice.remove;
      }
      return splice.index + splice.insert.length;
    };
    node.setSelectionRange(shift(before.start), shift(before.end));
    seen.current = { value, start: node.selectionStart, end: node.selectionEnd };
  }, [value]);

  const remember = () => {
    const node = ref.current;
    if (node)
      seen.current = { value: node.value, start: node.selectionStart, end: node.selectionEnd };
  };

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

  return (
    <textarea
      ref={ref}
      className={styles.editor}
      data-hud
      data-testid="text-editor"
      dir={detectDirection(value)}
      value={value}
      spellCheck={false}
      onChange={(event) => {
        remember();
        setElementText(element.id, event.target.value);
      }}
      onSelect={remember}
      onKeyUp={remember}
      onFocus={remember}
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
