import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { textSplice } from '@/doc/schema';
import type { BoardElement } from '@/model/element';
import { detectDirection } from '@/model/textLayout';
import { useBoardStore } from '@/state/boardStore';
import { readBox, renderInto, selectionIn, selectRange } from '@/text/domText';
import { autoFormat, onBackspace, onEnter, type TextEdit } from '@/text/lists';
import { marksAt, marksEqual, rangeHas, type MarkName, type MarkSet } from '@/text/marks';
import { useTextSelection } from '@/text/selection';
import styles from './TextEditor.module.css';

/**
 * Typing with formatting: an editable box laid over the element, showing bold,
 * italic and underline as they are. The browser still supplies the caret, selection,
 * input methods and Arabic shaping; this keeps the box and the shared text in step.
 *
 * The box is redrawn from the text only when the two differ — after a list step, a
 * formatting change, or someone else's typing — and the caret is put back where it
 * belongs each time. Typing itself goes straight into the box and is read back out.
 */
export function RichTextEditor({
  element,
  style,
  center,
}: {
  element: BoardElement;
  style: CSSProperties;
  center: boolean;
}) {
  const setElementText = useBoardStore((state) => state.setElementText);
  const formatText = useBoardStore((state) => state.formatText);
  const endEditing = useBoardStore((state) => state.endEditing);
  const ref = useRef<HTMLDivElement | null>(null);
  const composing = useRef(false);
  /** Where the caret goes once an edit made here is in the box. */
  const pendingCaret = useRef<{ start: number; end: number } | null>(null);
  /** Formatting chosen with nothing selected: it applies to what is typed next. */
  const pendingMarks = useRef<MarkSet | null>(null);
  /** The text as last seen in the box, with the caret, for following others' edits. */
  const seen = useRef<{ text: string; start: number; end: number } | null>(null);

  const text = element.text ?? '';
  const marks = element.marks;
  const id = element.id;

  // Opening: fill the box, focus it, caret at the end.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    renderInto(root, text, marks);
    root.focus({ preventScroll: true });
    selectRange(root, text.length, text.length);
    seen.current = { text, start: text.length, end: text.length };
    // Only when a different box opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // The text changed in the document: if the box no longer shows it, redraw it and
  // put the caret back — where this person's own edit said, or shifted past anyone
  // else's.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || composing.current) return;
    const shown = readBox(root);
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (shown.text === text && marksEqual(shown.marks, marks)) {
      if (caret) selectRange(root, caret.start, caret.end);
      return;
    }
    const before = seen.current;
    const current = selectionIn(root) ?? before;
    renderInto(root, text, marks);
    let next = caret;
    if (!next && current && before && before.text !== text) {
      const splice = textSplice(before.text, text);
      const shift = (position: number) =>
        position <= splice.index
          ? position
          : position >= splice.index + splice.remove
            ? position + splice.insert.length - splice.remove
            : splice.index + splice.insert.length;
      next = { start: shift(current.start), end: shift(current.end) };
    }
    next ??= current ?? { start: text.length, end: text.length };
    if (root.ownerDocument.activeElement === root) selectRange(root, next.start, next.end);
    seen.current = { text, ...next };
  }, [text, marks]);

  /** What the formatting buttons show, for the selection now. */
  const publish = () => {
    const root = ref.current;
    if (!root) return;
    const range = selectionIn(root);
    if (!range) return;
    seen.current = { text: readBox(root).text, ...range };
    const active: MarkSet =
      range.start === range.end
        ? (pendingMarks.current ?? marksAt(marks, range.start - 1))
        : {
            bold: rangeHas(marks, range.start, range.end, 'bold'),
            italic: rangeHas(marks, range.start, range.end, 'italic'),
            underline: rangeHas(marks, range.start, range.end, 'underline'),
          };
    useTextSelection.setState({ id, ...range, active, toggle });
  };

  const apply = (edit: TextEdit) => {
    pendingCaret.current = { start: edit.start, end: edit.end };
    setElementText(id, edit.text);
    const root = ref.current;
    if (root && readBox(root).text === edit.text) {
      // Already shown as it should be: only the caret moves.
      pendingCaret.current = null;
      selectRange(root, edit.start, edit.end);
    }
  };

  /** Bold, italic or underline: on the selection, or on what is typed next. */
  const toggle = (name: MarkName) => {
    const root = ref.current;
    if (!root) return;
    const range = selectionIn(root) ?? seen.current;
    if (!range) return;
    if (range.start === range.end) {
      const now = pendingMarks.current ?? marksAt(marks, range.start - 1);
      pendingMarks.current = { ...now, [name]: !now[name] };
      useTextSelection.setState({ active: pendingMarks.current, toggle });
      return;
    }
    const on = !rangeHas(marks, range.start, range.end, name);
    pendingCaret.current = { start: range.start, end: range.end };
    formatText(id, range.start, range.end, { [name]: on });
  };

  /** The box was edited by the browser: carry its text into the document. */
  const readInput = (event?: InputEvent) => {
    const root = ref.current;
    if (!root || composing.current) return;
    const shown = readBox(root).text;
    if (shown === text) return;
    const splice = textSplice(text, shown);
    const range = selectionIn(root);
    if (range) pendingCaret.current = range;
    setElementText(id, shown);
    const chosen = pendingMarks.current;
    if (chosen && splice.insert.length > 0) {
      formatText(id, splice.index, splice.index + splice.insert.length, {
        bold: Boolean(chosen.bold),
        italic: Boolean(chosen.italic),
        underline: Boolean(chosen.underline),
      });
    }
    pendingMarks.current = null;
    // "- " at the start of a line becomes a bullet as it is typed.
    if (event?.data === ' ' && range) {
      const edit = autoFormat(shown, range.start);
      if (edit) apply(edit);
    }
  };

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const caretOrEnd = () => selectionIn(root) ?? { start: text.length, end: text.length };
    const replaceSelection = (insert: string) => {
      const { start, end } = caretOrEnd();
      const current = readBox(root).text;
      apply({
        text: current.slice(0, start) + insert + current.slice(end),
        start: start + insert.length,
        end: start + insert.length,
      });
    };

    // Structure is decided here, not by the browser: new lines, list steps,
    // formatting, pasting and undo all go through the shared text.
    const onBeforeInput = (event: InputEvent) => {
      if (composing.current) return;
      const current = readBox(root).text;
      const { start, end } = caretOrEnd();
      switch (event.inputType) {
        case 'insertParagraph':
        case 'insertLineBreak': {
          event.preventDefault();
          const soft = event.inputType === 'insertLineBreak';
          const edit = onEnter(current, start, end, soft);
          if (edit) apply(edit);
          else replaceSelection('\n');
          return;
        }
        case 'deleteContentBackward': {
          const edit = onBackspace(current, start, end);
          if (edit) {
            event.preventDefault();
            apply(edit);
          }
          return;
        }
        case 'formatBold':
        case 'formatItalic':
        case 'formatUnderline':
          event.preventDefault();
          toggle(
            event.inputType === 'formatBold'
              ? 'bold'
              : event.inputType === 'formatItalic'
                ? 'italic'
                : 'underline',
          );
          return;
        case 'insertFromPaste':
        case 'insertFromDrop':
        case 'insertReplacementText': {
          const pasted = event.dataTransfer?.getData('text/plain') ?? event.data;
          if (pasted === null || pasted === undefined) return;
          event.preventDefault();
          replaceSelection(pasted.replace(/\r\n?/g, '\n'));
          return;
        }
        case 'historyUndo':
        case 'historyRedo':
          event.preventDefault();
          return;
        default:
          return;
      }
    };
    const onInput = (event: Event) => readInput(event as InputEvent);
    const onCompositionStart = () => {
      composing.current = true;
    };
    const onCompositionEnd = () => {
      composing.current = false;
      readInput();
    };
    const onSelectionChange = () => {
      if (root.ownerDocument.activeElement === root) publish();
    };

    root.addEventListener('beforeinput', onBeforeInput);
    root.addEventListener('input', onInput);
    root.addEventListener('compositionstart', onCompositionStart);
    root.addEventListener('compositionend', onCompositionEnd);
    root.ownerDocument.addEventListener('selectionchange', onSelectionChange);
    return () => {
      root.removeEventListener('beforeinput', onBeforeInput);
      root.removeEventListener('input', onInput);
      root.removeEventListener('compositionstart', onCompositionStart);
      root.removeEventListener('compositionend', onCompositionEnd);
      root.ownerDocument.removeEventListener('selectionchange', onSelectionChange);
    };
  });

  // Leaving the box: the formatting controls go back to the whole element.
  useEffect(
    () => () => useTextSelection.setState({ id: null, start: 0, end: 0, active: {}, toggle: null }),
    [],
  );

  return (
    <div
      ref={ref}
      className={`${styles.editor} ${styles.rich}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Text"
      spellCheck={false}
      data-hud
      data-testid="text-editor"
      dir={detectDirection(text)}
      style={{ ...style, textAlign: center ? 'center' : style.textAlign }}
      onKeyDown={(event) => {
        const mod = event.ctrlKey || event.metaKey;
        if (!mod || event.altKey) return;
        const key = event.key.toLowerCase();
        if (key === 'b' || key === 'i' || key === 'u') {
          event.preventDefault();
          toggle(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
        } else if (key === 'z' || key === 'y') {
          // Undo is the board's: it knows what this person typed, and nobody else.
          event.preventDefault();
          const store = useBoardStore.getState();
          if (key === 'y' || event.shiftKey) store.redo();
          else store.undo();
        }
      }}
      onBlur={endEditing}
    />
  );
}
