import type { MarkName } from '@/text/marks';
import { useTextSelection } from '@/text/selection';
import styles from './TextEditor.module.css';

const BUTTONS: Array<{ name: MarkName; label: string; title: string }> = [
  { name: 'bold', label: 'B', title: 'Bold — Ctrl/⌘ B' },
  { name: 'italic', label: 'I', title: 'Italic — Ctrl/⌘ I' },
  { name: 'underline', label: 'U', title: 'Underline — Ctrl/⌘ U' },
];

/**
 * B, I and U just above the box being typed in: for the selected words, or for what
 * is typed next. Pressing one keeps the typing going — the box never loses focus.
 */
export function FormatBar({ left, top }: { left: number; top: number }) {
  const active = useTextSelection((state) => state.active);
  const toggle = useTextSelection((state) => state.toggle);
  return (
    <div
      className={styles.formatBar}
      style={{ left, top: Math.max(4, top - 40) }}
      role="toolbar"
      aria-label="Text formatting"
      data-hud
      data-testid="format-bar"
    >
      {BUTTONS.map(({ name, label, title }) => (
        <button
          key={name}
          type="button"
          className={styles[name]}
          aria-pressed={Boolean(active[name])}
          aria-label={title}
          title={title}
          data-testid={`format-${name}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => toggle?.(name)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
