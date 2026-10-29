import { useState, type FormEvent } from 'react';
import { useBoardStore } from '@/state/boardStore';
import { normaliseLink } from '@/text/marks';
import { useTextSelection } from '@/text/selection';
import styles from './Inspector.module.css';

/**
 * Focus moving into anything marked with this does not end the typing: the address
 * field takes the keyboard for a moment, and the words stay open behind it.
 */
export const KEEP_TYPING = 'data-keep-typing';

/**
 * The address for a link, typed or pasted, in the side panel; Enter applies it,
 * Escape goes back to typing. Opened by the panel's link button or Ctrl/⌘ K.
 */
export function LinkField({ current }: { current: string | null }) {
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
    <form className={styles.linkField} onSubmit={submit} data-keep-typing data-testid="link-field">
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
          // Away from the field and the words altogether: the typing is over.
          const next = event.relatedTarget;
          if (
            next instanceof Element &&
            next.closest(`[${KEEP_TYPING}], [data-testid="text-editor"]`)
          )
            return;
          useTextSelection.setState({ linkOpen: false });
          useBoardStore.getState().endEditing();
        }}
      />
      <div className={styles.buttons}>
        <button type="submit" className={styles.button} data-testid="link-apply">
          {current ? 'Update' : 'Link'}
        </button>
        {current ? (
          <button
            type="button"
            className={styles.button}
            data-testid="link-remove"
            onClick={() => {
              useTextSelection.getState().setLink?.(null);
              close();
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
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
