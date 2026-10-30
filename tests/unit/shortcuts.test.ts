import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTIONS,
  actionFor,
  clashesIn,
  comboOf,
  keyLabel,
  keysOf,
  refusal,
  type Scope,
} from '@/input/shortcuts';
import { useSettings } from '@/settings/settings';
import { COMBO, DEFAULT_SETTINGS, sanitiseSettings } from '@shared/settings';

const press = (
  code: string,
  mods: Partial<Record<'ctrl' | 'meta' | 'alt' | 'shift', boolean>> = {},
) =>
  new KeyboardEvent('keydown', {
    code,
    ctrlKey: mods.ctrl,
    metaKey: mods.meta,
    altKey: mods.alt,
    shiftKey: mods.shift,
  });

const withShortcuts = (shortcuts: Record<string, string[]>) =>
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, shortcuts } });

afterEach(() => withShortcuts({}));

describe('the list of shortcuts', () => {
  it('starts with no two actions sharing a key where both work', () => {
    expect(clashesIn({})).toEqual(new Map());
  });

  it('writes every default key the way settings store them', () => {
    for (const each of ACTIONS) {
      for (const key of each.keys) expect(key, each.id).toMatch(COMBO);
    }
  });

  it('has names that survive being saved and read back', () => {
    const shortcuts = Object.fromEntries(ACTIONS.map((each) => [each.id, ['KeyQ']]));
    expect(Object.keys(sanitiseSettings({ shortcuts }).shortcuts)).toEqual(
      ACTIONS.map((each) => each.id),
    );
  });
});

describe('a key press', () => {
  it('is written with Ctrl or ⌘ as Mod, then Alt and Shift, then the physical key', () => {
    expect(comboOf(press('KeyZ', { ctrl: true, shift: true }))).toBe('Mod+Shift+KeyZ');
    expect(comboOf(press('KeyZ', { meta: true }))).toBe('Mod+KeyZ');
    expect(comboOf(press('Digit1', { alt: true, shift: true }))).toBe('Alt+Shift+Digit1');
    expect(comboOf(press('Numpad4'))).toBe('Numpad4');
    expect(comboOf(press('ShiftLeft', { shift: true }))).toBeNull();
  });

  it('finds its action in the scope it is pressed in', () => {
    const cases: Array<[KeyboardEvent, Scope, string]> = [
      [press('KeyP'), 'board', 'tool.pen'],
      [press('Numpad1'), 'board', 'celebrate.confetti'],
      [press('Numpad7'), 'board', 'celebrate.applause'],
      [press('KeyZ', { ctrl: true, shift: true }), 'board', 'redo'],
      [press('KeyK', { ctrl: true }), 'board', 'palette'],
      [press('KeyK', { ctrl: true }), 'typing', 'text.link'],
      [press('ArrowRight'), 'presenting', 'present.next'],
      [press('Backspace'), 'presenting', 'present.previous'],
      [press('Backspace'), 'board', 'delete'],
    ];
    for (const [event, scope, id] of cases) expect(actionFor(event, scope), id).toBe(id);
    // Shift makes it a different key: Shift+P is nothing.
    expect(actionFor(press('KeyP', { shift: true }), 'board')).toBeNull();
  });
});

describe('a changed shortcut', () => {
  it('works at once, and the old key stops', () => {
    withShortcuts({ 'tool.pen': ['KeyB'] });
    expect(actionFor(press('KeyB'), 'board')).toBe('tool.pen');
    expect(actionFor(press('KeyP'), 'board')).toBeNull();
  });

  it('can be given a key another action has; both are marked, and the newer choice wins', () => {
    withShortcuts({ 'celebrate.confetti': ['KeyP'] });
    expect(actionFor(press('KeyP'), 'board')).toBe('celebrate.confetti');
    const clashes = clashesIn(useSettings.getState().settings.shortcuts);
    expect(clashes.get('celebrate.confetti')).toEqual([{ key: 'KeyP', with: 'tool.pen' }]);
    expect(clashes.get('tool.pen')).toEqual([{ key: 'KeyP', with: 'celebrate.confetti' }]);
  });

  it('does not clash with the same key somewhere else: presenting, or typing', () => {
    withShortcuts({ 'present.first': ['KeyP'], 'text.bold': ['Mod+KeyD'] });
    expect(clashesIn(useSettings.getState().settings.shortcuts)).toEqual(new Map());
  });

  it('can have no key at all, and reset gives the defaults back', () => {
    withShortcuts({ undo: [] });
    expect(keysOf('undo')).toEqual([]);
    expect(actionFor(press('KeyZ', { ctrl: true }), 'board')).toBeNull();
    withShortcuts({});
    expect(keysOf('undo')).toEqual(['Mod+KeyZ']);
  });
});

describe('keys that cannot be given away', () => {
  it('keeps Escape, Space, the arrows, Tab and the clipboard on the board', () => {
    for (const combo of [
      'Escape',
      'Shift+Escape',
      'Space',
      'Shift+Space',
      'ArrowLeft',
      'Shift+ArrowUp',
      'Tab',
      'Mod+KeyV',
    ]) {
      expect(refusal(combo, 'board'), combo).not.toBeNull();
    }
    expect(refusal('KeyQ', 'board')).toBeNull();
    expect(refusal('Mod+ArrowLeft', 'board')).toBeNull();
    expect(refusal('Escape', 'presenting')).toBeNull();
  });

  it('asks for Ctrl, ⌘ or Alt while typing, so letters still type', () => {
    expect(refusal('KeyB', 'typing')).not.toBeNull();
    expect(refusal('Shift+KeyB', 'typing')).not.toBeNull();
    expect(refusal('Mod+KeyE', 'typing')).toBeNull();
    expect(refusal('Alt+KeyE', 'typing')).toBeNull();
  });
});

describe('a key written for people', () => {
  it('reads like the keyboard', () => {
    expect(keyLabel('Mod+Shift+KeyZ')).toBe('Ctrl+Shift+Z');
    expect(keyLabel('Shift+Digit1')).toBe('Shift+1');
    expect(keyLabel('Numpad3')).toBe('Num 3');
    expect(keyLabel('BracketLeft')).toBe('[');
    expect(keyLabel('Mod+BracketRight')).toBe('Ctrl+]');
  });
});
