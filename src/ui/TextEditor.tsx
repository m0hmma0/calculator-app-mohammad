import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { fontString } from '@/canvas/fonts';
import { boardToScreen, type Viewport } from '@/canvas/viewport';
import { CODE_PADDING, STICKY_PADDING, TEXT_PADDING } from '@/canvas/renderContent';
import { textSplice } from '@/doc/schema';
import { detectDirection } from '@/model/textLayout';
import { canHoldLabel, labelBox } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';
import { autoFormat, onBackspace, onEnter, type TextEdit } from '@/text/lists';
import { KEEP_TYPING } from './LinkField';
import { RichTextEditor } from './RichTextEditor';
import styles from './TextEditor.module.css';

/**
 * Editing happens in a real editable box sitting exactly over the element, not in the
 * canvas — a rich one for text (see RichTextEditor), a textarea for code. The browser then supplies the caret, selection, IME, autocorrect and — the
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
  /** Where the caret goes once an edit made here has been rendered. */
  const pendingCaret = useRef<TextEdit | null>(null);
  /** The text as this person last saw it, and where their caret was in it. */
  const seen = useRef<{ value: string; start: number; end: number } | null>(null);

  void renderVersion;
  const element = elements.find((candidate) => candidate.id === editingId);

  // Focus once, when a box opens — not on every change to it, which would throw the
  // caret to the end after each letter typed anywhere but the end.
  const elementId = element?.id;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!elementId || !node) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }, [elementId]);

  // Someone else typed in this box. Their words arrive; this person's caret stays
  // put relative to their own text rather than jumping to the end.
  const value = element?.text ?? '';
  useLayoutEffect(() => {
    const node = ref.current;
    // This person's own edit (a list item, an indent): the caret goes where it said,
    // in the same render, before the next key can land somewhere else.
    const caret = pendingCaret.current;
    if (node && caret && node.value === caret.text) {
      pendingCaret.current = null;
      node.setSelectionRange(caret.start, caret.end);
      seen.current = { value, start: caret.start, end: caret.end };
      return;
    }
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

  const apply = (node: HTMLTextAreaElement, edit: TextEdit) => {
    if (!element) return;
    remember();
    pendingCaret.current = edit;
    setElementText(element.id, edit.text);
    // Nothing changed (the text was already this): place the caret directly.
    if (node.value === edit.text) {
      pendingCaret.current = null;
      node.setSelectionRange(edit.start, edit.end);
    }
  };

  const remember = () => {
    const node = ref.current;
    if (node)
      seen.current = { value: node.value, start: node.selectionStart, end: node.selectionEnd };
  };

  useEffect(() => {
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // In the side panel's address field, Escape closes that, not the text.
      const target = event.target;
      if (target instanceof Element && target.closest(`[${KEEP_TYPING}]`)) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        endEditing();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [element, endEditing]);

  if (!element) return null;

  // Typing into a shape happens over the room inside its outline, centred.
  const label = canHoldLabel(element);
  const area = label ? labelBox(element) : element;
  const sticky = element.type === 'sticky' || label;
  const code = element.type === 'code';
  const padding = code ? CODE_PADDING : sticky ? STICKY_PADDING : TEXT_PADDING;
  const topLeft = boardToScreen(viewport, { x: area.x, y: area.y });
  // The words in their own colour over the box as the board draws it, with nothing
  // laid on top — so typing looks the way the text will, and nothing under it fades.
  const { fill, stroke, textColor } = element.style;
  const own = label || element.type === 'text' || element.type === 'sticky';
  const ink = !own
    ? null
    : label
      ? (textColor ?? (fill ? '#ffffff' : stroke))
      : (textColor ?? fill);
  const boxStyle: CSSProperties = {
    left: `${topLeft.x}px`,
    top: `${topLeft.y}px`,
    width: `${area.w * viewport.zoom}px`,
    height: `${area.h * viewport.zoom}px`,
    padding: `${padding * viewport.zoom}px`,
    font: fontString(element.style, element.style.fontSize * viewport.zoom),
    lineHeight: element.style.lineHeight,
    letterSpacing: `${element.style.letterSpacing * viewport.zoom}px`,
    textAlign: label ? 'center' : element.style.align,
    textDecoration: element.style.underline ? 'underline' : undefined,
    ...(ink ? { color: ink } : {}),
    transform: element.rotation ? `rotate(${element.rotation}rad)` : undefined,
    transformOrigin: 'center',
  };

  // Everything but code is typed with formatting, shown as it will be drawn; the
  // controls for it are in the side panel.
  if (!code) {
    return <RichTextEditor key={element.id} element={element} style={boxStyle} center={label} />;
  }

  return (
    <textarea
      ref={ref}
      className={code ? `${styles.editor} ${styles.code}` : styles.editor}
      data-hud
      data-testid="text-editor"
      dir={code ? 'ltr' : detectDirection(value)}
      onKeyDown={(event) => {
        const node = event.currentTarget;
        const { selectionStart: from, selectionEnd: to } = node;
        if (!code && !event.nativeEvent.isComposing) {
          const edit =
            event.key === 'Enter'
              ? onEnter(node.value, from, to, event.shiftKey)
              : event.key === 'Backspace'
                ? onBackspace(node.value, from, to)
                : null;
          if (edit) {
            event.preventDefault();
            apply(node, edit);
            return;
          }
        }
        // In code, Tab indents rather than leaving the box.
        if (!code || event.key !== 'Tab') return;
        event.preventDefault();
        apply(node, {
          text: `${node.value.slice(0, from)}  ${node.value.slice(to)}`,
          start: from + 2,
          end: from + 2,
        });
      }}
      value={value}
      spellCheck={false}
      onChange={(event) => {
        remember();
        setElementText(element.id, event.target.value);
        // "- " at the start of a line becomes a bullet as it is typed.
        if (!code && (event.nativeEvent as InputEvent).data === ' ') {
          const edit = autoFormat(event.target.value, event.target.selectionStart);
          if (edit) apply(event.target, edit);
        }
      }}
      onSelect={remember}
      onKeyUp={remember}
      onFocus={remember}
      onBlur={endEditing}
      style={boxStyle}
    />
  );
}
