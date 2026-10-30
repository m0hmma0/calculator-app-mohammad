import { useEffect, useMemo, useState } from 'react';
import {
  ACTIONS,
  GROUPS,
  actionById,
  clashesIn,
  comboOf,
  holderOf,
  keyLabel,
  keysOf,
  refusal,
  setRecordingShortcut,
  type ShortcutAction,
} from '@/input/shortcuts';
import { DEFAULT_STYLE, TEXT_STYLE } from '@/model/element';
import type { SettingsSection } from '@/settings/dialog';
import { updateSettings, useSettings, type SettingsStatus } from '@/settings/settings';
import { defaultTextBox } from '@/text/measure';
import { BOX_CHARS, BOX_LINES, FONT_SIZE, type Settings } from '@shared/settings';
import styles from './Settings.module.css';

const STATUS: Record<SettingsStatus, string> = {
  browser: 'Saved in this browser',
  loading: 'Loading your settings…',
  saving: 'Saving…',
  saved: 'Saved to your account',
  unsaved: 'Not saved to your account yet — it will be once the server can be reached',
};

/**
 * Everything a person can set: how new text starts, and every keyboard shortcut. The
 * same panel is the settings page and, over a board, a dialog — so a change can be
 * tried on the board the moment it is made.
 */
export function SettingsPanel({ section }: { section?: SettingsSection | null }) {
  const status = useSettings((state) => state.status);

  useEffect(() => {
    if (!section) return;
    document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' });
  }, [section]);

  return (
    <div className={styles.panel}>
      <p className={styles.status} data-testid="settings-status" data-status={status}>
        {STATUS[status]}
      </p>
      <TextSection />
      <ShortcutSection />
    </div>
  );
}

/* -------------------------------- text -------------------------------- */

function TextSection() {
  const text = useSettings((state) => state.settings.text);
  const setText = (change: Partial<Settings['text']>) =>
    updateSettings((current) => ({ ...current, text: { ...current.text, ...change } }));

  return (
    <section className={styles.section} id="settings-text" data-testid="settings-text">
      <h2 className={styles.heading}>Text</h2>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="setting-font-size">
          New text starts at
        </label>
        <span className={styles.inline}>
          <NumberField
            id="setting-font-size"
            value={text.fontSize}
            range={FONT_SIZE}
            onCommit={(fontSize) => setText({ fontSize })}
          />
          px
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="setting-box-chars">
          A clicked text box is
        </label>
        <span className={styles.inline}>
          <NumberField
            id="setting-box-chars"
            value={text.boxChars}
            range={BOX_CHARS}
            onCommit={(boxChars) => setText({ boxChars })}
          />
          characters wide, and
          <NumberField
            id="setting-box-lines"
            label="Lines tall"
            value={text.boxLines}
            range={BOX_LINES}
            onCommit={(boxLines) => setText({ boxLines })}
          />
          {text.boxLines === 1 ? 'line' : 'lines'} tall
        </span>
      </div>
      <p className={styles.hint}>
        Dragging with the text tool makes a box of any size; typing past the bottom makes a box
        taller.
      </p>

      <TextPreview fontSize={text.fontSize} chars={text.boxChars} lines={text.boxLines} />

      <fieldset className={styles.choice}>
        <legend className={styles.label}>Others typing on your boards start at</legend>
        <label className={styles.radio}>
          <input
            type="radio"
            name="others-size"
            checked={text.othersFontSize === null}
            data-testid="setting-others-same"
            onChange={() => setText({ othersFontSize: null })}
          />
          Your size ({text.fontSize} px)
        </label>
        <label className={styles.radio}>
          <input
            type="radio"
            name="others-size"
            checked={text.othersFontSize !== null}
            data-testid="setting-others-own"
            onChange={() => setText({ othersFontSize: text.fontSize })}
          />
          <span className={styles.inline}>
            This size:
            <NumberField
              id="setting-others-size"
              label="Others' text size"
              value={text.othersFontSize ?? text.fontSize}
              range={FONT_SIZE}
              disabled={text.othersFontSize === null}
              onCommit={(othersFontSize) => setText({ othersFontSize })}
            />
            px
          </span>
        </label>
        <p className={styles.hint}>
          On someone else&apos;s board, your new text starts at the size they chose.
        </p>
      </fieldset>
    </section>
  );
}

/**
 * A number typed freely — "1" on the way to "16" is not clamped to 8 mid-word. It is
 * taken as soon as it is a whole number in range, and tidied when the field is left.
 */
function NumberField({
  id,
  label,
  value,
  range,
  disabled,
  onCommit,
}: {
  id: string;
  label?: string;
  value: number;
  range: { min: number; max: number };
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : String(value);
  const parse = (raw: string) => {
    const number = Number(raw);
    return raw.trim() !== '' && Number.isInteger(number) ? number : null;
  };

  return (
    <input
      id={id}
      className={styles.number}
      type="number"
      inputMode="numeric"
      min={range.min}
      max={range.max}
      step={1}
      value={shown}
      disabled={disabled}
      aria-label={label}
      data-testid={id}
      onFocus={() => {
        setDraft(String(value));
        setFocused(true);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        const number = parse(event.target.value);
        if (number !== null && number >= range.min && number <= range.max) onCommit(number);
      }}
      onBlur={() => {
        setFocused(false);
        const number = parse(draft);
        if (number !== null) onCommit(Math.min(range.max, Math.max(range.min, number)));
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

/** The clicked box, drawn to scale, so "55 by 8 at 40 px" means something. */
function TextPreview({
  fontSize,
  chars,
  lines,
}: {
  fontSize: number;
  chars: number;
  lines: number;
}) {
  const style = { ...DEFAULT_STYLE, ...TEXT_STYLE, fontSize };
  const box = defaultTextBox(style, { chars, lines });
  const scale = Math.min(1, 440 / box.w, 160 / box.h);
  return (
    <figure className={styles.preview} data-testid="settings-text-preview">
      <div
        className={styles.previewBox}
        style={{
          width: box.w * scale,
          height: box.h * scale,
          fontSize: fontSize * scale,
          lineHeight: style.lineHeight,
        }}
      >
        Your words start here
      </div>
      <figcaption className={styles.hint} data-testid="settings-text-size">
        {box.w} × {box.h} px on the board{scale < 1 ? ', shown smaller here' : ''}
      </figcaption>
    </figure>
  );
}

/* ------------------------------ shortcuts ----------------------------- */

const sameKeys = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key, index) => key === b[index]);

/** Sets an action's keys, dropping the override again if they are its defaults. */
function setKeys(id: string, keys: readonly string[]): void {
  updateSettings((current) => {
    const shortcuts = { ...current.shortcuts };
    const unique = [...new Set(keys)];
    if (sameKeys(unique, actionById(id)?.keys ?? [])) delete shortcuts[id];
    else shortcuts[id] = unique;
    return { ...current, shortcuts };
  });
}

interface Recording {
  id: string;
  /** Which key is being replaced; the length of the list adds one. */
  index: number;
}

function ShortcutSection() {
  const shortcuts = useSettings((state) => state.settings.shortcuts);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [refused, setRefused] = useState<{ id: string; why: string } | null>(null);
  const [filter, setFilter] = useState('');
  const clashes = useMemo(() => clashesIn(shortcuts), [shortcuts]);
  const changed = Object.keys(shortcuts).length > 0;

  // Waiting for a key: it is taken here, before anything on the board can act on it.
  useEffect(() => {
    if (!recording) return;
    setRecordingShortcut(true);
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const bare = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
      if (event.code === 'Escape' && bare) {
        setRecording(null);
        return;
      }
      const combo = comboOf(event);
      if (!combo) return; // a modifier on its own: wait for the key it goes with
      const action = actionById(recording.id);
      if (!action) return setRecording(null);
      const why = refusal(combo, action.scope);
      if (why) {
        setRefused({ id: recording.id, why: `${keyLabel(combo)}: ${why}` });
        return;
      }
      const keys = [...keysOf(recording.id, useSettings.getState().settings.shortcuts)];
      keys.splice(recording.index, 1, combo);
      setKeys(recording.id, keys);
      setRefused(null);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      setRecordingShortcut(false);
    };
  }, [recording]);

  const query = filter.trim().toLowerCase();
  const shown = (each: ShortcutAction) =>
    query === '' ||
    each.label.toLowerCase().includes(query) ||
    each.group.toLowerCase().includes(query) ||
    keysOf(each.id, shortcuts).some((key) => keyLabel(key).toLowerCase().includes(query));

  return (
    <section className={styles.section} id="settings-shortcuts" data-testid="settings-shortcuts">
      <div className={styles.sectionHead}>
        <h2 className={styles.heading}>Keyboard shortcuts</h2>
        <button
          type="button"
          className={styles.secondary}
          disabled={!changed}
          data-testid="shortcuts-reset-all"
          onClick={() => {
            setRecording(null);
            updateSettings((current) => ({ ...current, shortcuts: {} }));
          }}
        >
          Reset all to the defaults
        </button>
      </div>
      <p className={styles.hint}>
        Click a key to change it, then press the new one (Esc to stop). A key two actions share is
        marked; the one you chose last wins.
      </p>
      <input
        type="search"
        className={styles.filter}
        placeholder="Find a shortcut"
        aria-label="Find a shortcut"
        value={filter}
        data-testid="shortcut-filter"
        onChange={(event) => setFilter(event.target.value)}
      />

      {GROUPS.map((group) => {
        const rows = ACTIONS.filter((each) => each.group === group && shown(each));
        if (rows.length === 0) return null;
        return (
          <div key={group} className={styles.group}>
            <h3 className={styles.groupTitle}>{group}</h3>
            <ul className={styles.rows}>
              {rows.map((each) => (
                <ShortcutRow
                  key={each.id}
                  action={each}
                  shortcuts={shortcuts}
                  recording={recording?.id === each.id ? recording.index : null}
                  clashes={clashes.get(each.id) ?? []}
                  refused={refused?.id === each.id ? refused.why : null}
                  onRecord={(index) => {
                    setRefused(null);
                    setRecording({ id: each.id, index });
                  }}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function ShortcutRow({
  action,
  shortcuts,
  recording,
  clashes,
  refused,
  onRecord,
}: {
  action: ShortcutAction;
  shortcuts: Settings['shortcuts'];
  recording: number | null;
  clashes: Array<{ key: string; with: string }>;
  refused: string | null;
  onRecord: (index: number) => void;
}) {
  const keys = keysOf(action.id, shortcuts);
  const changed = action.id in shortcuts;
  const waiting = (
    <span className={styles.waiting} data-testid="shortcut-recording">
      Press a key…
    </span>
  );

  return (
    <li
      className={styles.row}
      data-testid={`shortcut-row-${action.id}`}
      data-changed={changed || undefined}
      data-clash={clashes.length > 0 || undefined}
    >
      <span className={styles.rowLabel}>{action.label}</span>
      <span className={styles.keys}>
        {keys.map((key, index) =>
          recording === index ? (
            <span key={key}>{waiting}</span>
          ) : (
            <span key={key} className={styles.key}>
              <button
                type="button"
                className={styles.keyButton}
                aria-label={`${action.label}: ${keyLabel(key)} — change`}
                data-testid={`shortcut-key-${action.id}-${index}`}
                onClick={() => onRecord(index)}
              >
                {keyLabel(key)}
              </button>
              <button
                type="button"
                className={styles.removeKey}
                aria-label={`Remove ${keyLabel(key)} from ${action.label}`}
                data-testid={`shortcut-remove-${action.id}-${index}`}
                onClick={() =>
                  setKeys(
                    action.id,
                    keys.filter((_, at) => at !== index),
                  )
                }
              >
                ×
              </button>
            </span>
          ),
        )}
        {recording === keys.length ? (
          waiting
        ) : keys.length < 4 ? (
          <button
            type="button"
            className={styles.addKey}
            aria-label={`Add a key for ${action.label}`}
            data-testid={`shortcut-add-${action.id}`}
            onClick={() => onRecord(keys.length)}
          >
            {keys.length === 0 ? 'Add a key' : '+'}
          </button>
        ) : null}
        {changed ? (
          <button
            type="button"
            className={styles.resetKey}
            data-testid={`shortcut-reset-${action.id}`}
            onClick={() => setKeys(action.id, action.keys)}
          >
            Reset
          </button>
        ) : null}
      </span>
      {clashes.length > 0 ? (
        <p className={styles.clash} role="status" data-testid={`shortcut-clash-${action.id}`}>
          {clashes.map(({ key, with: other }) => {
            const winner = holderOf(key, action.scope, shortcuts);
            return (
              <span key={`${key} ${other}`}>
                {keyLabel(key)} is also {actionById(other)?.label ?? other}. Pressing it does{' '}
                {actionById(winner ?? '')?.label ?? 'nothing'}.{' '}
              </span>
            );
          })}
        </p>
      ) : null}
      {refused ? (
        <p className={styles.refused} role="alert" data-testid={`shortcut-refused-${action.id}`}>
          {refused}
        </p>
      ) : null}
    </li>
  );
}
