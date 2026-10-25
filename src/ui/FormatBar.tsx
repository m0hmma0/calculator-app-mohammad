import { useState, type FormEvent } from 'react';
import { useBoardStore } from '@/state/boardStore';
import { normaliseLink, type MarkName } from '@/text/marks';
import { useTextSelection } from '@/text/selection';
import { HIGHLIGHTS, TEXT_COLOURS } from './palettes';
import styles from './TextEditor.module.css';

const BUTTONS: Array<{ name: MarkName; label: string; title: string }> = [
  { name: 'bold', label: 'B', title: 'Bold — Ctrl/⌘ B' },
  { name: 'italic', label: 'I', title: 'Italic — Ctrl/⌘ I' },
  { name: 'underline', label: 'U', title: 'Underline — Ctrl/⌘ U' },
];

const keepTyping = (event: { preventDefault: () => void }) => event.preventDefault();

/**
 * Formatting just above the box being typed in — bold, italic, underline, a colour,
 * a highlight and a link — for the selected words, or for what is typed next.
 * Pressing a button keeps the typing going: the box never loses focus, except to the
 * field an address is typed into.
 */
export function FormatBar({ left, top }: { left: number; top: number }) {
  const active = useTextSelection((state) => state.active);
  const toggle = useTextSelection((state) => state.toggle);
  const format = useTextSelection((state) => state.format);
  const link = useTextSelection((state) => state.link);
  const linkOpen = useTextSelection((state) => state.linkOpen);
  const [palette, setPalette] = useState<'color' | 'highlight' | null>(null);

  const href = link ? normaliseLink(link.url) : null;

  return (
    <div
      className={styles.formatBar}
      style={{ left, top: Math.max(4, top - 40) }}
      role="toolbar"
      aria-label="Text formatting"
      data-hud
      data-format-bar
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
          onMouseDown={keepTyping}
          onClick={() => toggle?.(name)}
        >
          {label}
        </button>
      ))}
      <span className={styles.barDivider} />
      <button
        type="button"
        className={styles.colourButton}
        aria-label="Text colour"
        aria-expanded={palette === 'color'}
        title="Text colour"
        data-testid="format-colour"
        onMouseDown={keepTyping}
        onClick={() => setPalette(palette === 'color' ? null : 'color')}
      >
        A
        <span style={{ background: active.color ?? 'currentColor' }} />
      </button>
      <button
        type="button"
        className={styles.colourButton}
        aria-label="Highlight"
        aria-expanded={palette === 'highlight'}
        title="Highlight"
        data-testid="format-highlight"
        onMouseDown={keepTyping}
        onClick={() => setPalette(palette === 'highlight' ? null : 'highlight')}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            d="M9.6 2.4 13.6 6.4 7.4 12.6H3.4V8.6Z M3.4 12.6 2 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <span style={{ background: active.highlight ?? 'transparent' }} />
      </button>
      <button
        type="button"
        aria-pressed={Boolean(link)}
        aria-label="Link — Ctrl/⌘ K"
        title="Link — Ctrl/⌘ K"
        data-testid="format-link"
        onMouseDown={keepTyping}
        onClick={() => useTextSelection.setState({ linkOpen: !linkOpen })}
      >
        <LinkIcon />
      </button>
      {href ? (
        <a
          className={styles.linkChip}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={href}
          data-testid="format-open-link"
          onMouseDown={keepTyping}
        >
          ↗ {linkLabel(href)}
        </a>
      ) : null}

      {palette ? (
        <div className={styles.palette} data-testid={`format-${palette}-palette`}>
          {(palette === 'color' ? TEXT_COLOURS : HIGHLIGHTS).map(({ value, name }) => (
            <button
              key={value}
              type="button"
              className={styles.paletteSwatch}
              style={{ background: value }}
              aria-label={`${palette === 'color' ? 'Colour' : 'Highlight'} ${name}`}
              title={name}
              aria-pressed={(palette === 'color' ? active.color : active.highlight) === value}
              data-testid={`format-${palette}-${name.toLowerCase()}`}
              onMouseDown={keepTyping}
              onClick={() => {
                format?.({ [palette]: value });
                setPalette(null);
              }}
            />
          ))}
          <button
            type="button"
            className={`${styles.paletteSwatch} ${styles.paletteNone}`}
            aria-label={palette === 'color' ? 'The box’s own colour' : 'No highlight'}
            title={palette === 'color' ? 'The box’s own colour' : 'No highlight'}
            data-testid={`format-${palette}-none`}
            onMouseDown={keepTyping}
            onClick={() => {
              format?.({ [palette]: null });
              setPalette(null);
            }}
          />
        </div>
      ) : null}

      {linkOpen ? <LinkField key={link?.url ?? ''} current={link?.url ?? null} /> : null}
    </div>
  );
}

/** Where a link goes, short: its site, or the address for an email. */
function linkLabel(href: string): string {
  try {
    const url = new URL(href);
    return url.protocol === 'mailto:' ? url.pathname : url.hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

/** The address for a link, typed or pasted; Enter applies it, Escape goes back to typing. */
function LinkField({ current }: { current: string | null }) {
  const [value, setValue] = useState(current ?? '');
  const [invalid, setInvalid] = useState(false);

  const close = () => {
    useTextSelection.setState({ linkOpen: false });
    useTextSelection.getState().refocus?.();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const url = normaliseLink(value);
    if (!url) {
      setInvalid(true);
      return;
    }
    useTextSelection.getState().setLink?.(url);
    close();
  };

  return (
    <form className={styles.linkField} onSubmit={submit} data-testid="link-field">
      <input
        autoFocus
        type="text"
        inputMode="url"
        value={value}
        placeholder="Paste or type a link"
        aria-label="Link address"
        aria-invalid={invalid}
        data-testid="link-input"
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          close();
        }}
        onBlur={(event) => {
          // Away from the bar and the box altogether: the typing is over.
          const next = event.relatedTarget;
          if (
            next instanceof Element &&
            next.closest('[data-format-bar], [data-testid="text-editor"]')
          )
            return;
          useTextSelection.setState({ linkOpen: false });
          useBoardStore.getState().endEditing();
        }}
      />
      <button type="submit" data-testid="link-apply">
        {current ? 'Update' : 'Link'}
      </button>
      {current ? (
        <button
          type="button"
          data-testid="link-remove"
          onClick={() => {
            useTextSelection.getState().setLink?.(null);
            close();
          }}
        >
          Remove
        </button>
      ) : null}
      {invalid ? (
        <span className={styles.linkError} role="alert">
          That isn’t a web or email address.
        </span>
      ) : null}
    </form>
  );
}

export function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M6.7 9.3a2.6 2.6 0 0 0 3.7 0l2.3-2.3a2.6 2.6 0 0 0-3.7-3.7l-.9.9M9.3 6.7a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
