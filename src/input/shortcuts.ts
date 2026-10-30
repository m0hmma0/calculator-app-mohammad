import { useSettings } from '@/settings/settings';
import type { Settings } from '@shared/settings';

/**
 * Every keyboard shortcut, in one list: what the keys do (the handlers), what the
 * cheat sheet shows, and what Settings lets a person change all read it from here.
 *
 * A key is written as its modifiers, then the physical key: "Mod+Shift+KeyZ",
 * "Shift+Digit1", "Numpad3". Mod is Ctrl, or ⌘ on a Mac. Keys are physical
 * (`event.code`), so shortcuts stay where they are on any keyboard layout — Arabic
 * included — and Shift+1 does not depend on the key making "!".
 */

/**
 * Where a shortcut works: on the board; while presenting, ahead of the board's; or
 * while typing in a text box.
 */
export type Scope = 'board' | 'presenting' | 'typing';

export const GROUPS = [
  'Tools',
  'Shapes',
  'Editing',
  'View',
  'Board',
  'Presenting',
  'Celebrations',
  'While typing',
] as const;
export type ShortcutGroup = (typeof GROUPS)[number];

export interface ShortcutAction {
  id: string;
  label: string;
  group: ShortcutGroup;
  scope: Scope;
  /** The keys it starts with; empty for an action with no key until one is given. */
  keys: readonly string[];
}

const action = (
  id: string,
  label: string,
  group: ShortcutGroup,
  keys: readonly string[],
  scope: Scope = 'board',
): ShortcutAction => ({ id, label, group, scope, keys });

export const ACTIONS: readonly ShortcutAction[] = [
  action('tool.select', 'Move and select', 'Tools', ['KeyV']),
  action('tool.hand', 'Hand (pan the board)', 'Tools', ['KeyH']),
  action('tool.pen', 'Pen', 'Tools', ['KeyP']),
  action('tool.highlighter', 'Highlighter', 'Tools', ['KeyI']),
  action('tool.eraser', 'Eraser', 'Tools', ['KeyE']),
  action('tool.text', 'Text', 'Tools', ['KeyT']),
  action('tool.sticky', 'Sticky note', 'Tools', ['KeyN']),
  action('tool.frame', 'Frame', 'Tools', ['KeyF']),
  action('tool.laser', 'Laser pointer', 'Tools', ['KeyK']),

  action('tool.rect', 'Rectangle', 'Shapes', ['KeyR']),
  action('tool.ellipse', 'Ellipse', 'Shapes', ['KeyO']),
  action('tool.triangle', 'Triangle', 'Shapes', []),
  action('tool.diamond', 'Diamond', 'Shapes', []),
  action('tool.star', 'Star', 'Shapes', []),
  action('tool.polygon', 'Polygon', 'Shapes', []),
  action('tool.cloud', 'Cloud', 'Shapes', []),
  action('tool.spike', 'Spike', 'Shapes', []),
  action('tool.line', 'Line', 'Shapes', ['KeyL']),
  action('tool.arrow', 'Arrow', 'Shapes', ['KeyA']),

  action('undo', 'Undo', 'Editing', ['Mod+KeyZ']),
  action('redo', 'Redo', 'Editing', ['Mod+Shift+KeyZ', 'Mod+KeyY']),
  action('duplicate', 'Duplicate', 'Editing', ['Mod+KeyD']),
  action('delete', 'Delete the selection', 'Editing', ['Delete', 'Backspace']),
  action('select-all', 'Select all', 'Editing', ['Mod+KeyA']),
  action('group', 'Group', 'Editing', ['Mod+KeyG']),
  action('ungroup', 'Ungroup', 'Editing', ['Mod+Shift+KeyG']),
  action('lock', 'Lock or unlock', 'Editing', ['Mod+Shift+KeyL']),
  action('hide', 'Hide or show', 'Editing', ['Mod+Shift+KeyH']),
  action('forward', 'Bring forward', 'Editing', ['BracketRight']),
  action('backward', 'Send backward', 'Editing', ['BracketLeft']),
  action('front', 'Bring to front', 'Editing', ['Mod+BracketRight']),
  action('back', 'Send to back', 'Editing', ['Mod+BracketLeft']),

  action('zoom-in', 'Zoom in', 'View', ['Equal', 'Shift+Equal', 'NumpadAdd']),
  action('zoom-out', 'Zoom out', 'View', ['Minus', 'NumpadSubtract']),
  action('zoom-fit', 'Zoom to fit everything', 'View', ['Shift+Digit1']),
  action('zoom-selection', 'Zoom to the selection', 'View', ['Shift+Digit2']),
  action('zoom-100', 'Zoom to 100%', 'View', ['Shift+Digit0']),
  action('minimap', 'Show or hide the minimap', 'View', ['KeyM']),
  action('pane', 'Open or close the side panel', 'View', []),
  action('fullscreen', 'Full screen', 'View', []),

  action('palette', 'Command palette', 'Board', ['Mod+KeyK']),
  action('sheet', 'This list of shortcuts', 'Board', ['Shift+Slash']),
  action('chat', 'Cursor chat', 'Board', ['Slash']),
  action('settings', 'Settings', 'Board', []),

  action('present', 'Start presenting', 'Presenting', []),
  action(
    'present.next',
    'Next frame',
    'Presenting',
    ['ArrowRight', 'ArrowDown', 'PageDown', 'Space', 'Enter'],
    'presenting',
  ),
  action(
    'present.previous',
    'Previous frame',
    'Presenting',
    ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'],
    'presenting',
  ),
  action('present.first', 'First frame', 'Presenting', ['Home'], 'presenting'),
  action('present.last', 'Last frame', 'Presenting', ['End'], 'presenting'),
  action('present.stop', 'Stop presenting', 'Presenting', ['Escape'], 'presenting'),

  // In the order of the Insert menu's row of celebrations.
  action('celebrate.confetti', 'Confetti', 'Celebrations', ['Numpad1']),
  action('celebrate.drumroll', 'Drum roll', 'Celebrations', ['Numpad2']),
  action('celebrate.bubbles', 'Bubbles', 'Celebrations', ['Numpad3']),
  action('celebrate.micdrop', 'Mic drop', 'Celebrations', ['Numpad4']),
  action('celebrate.quiet', 'Quiet', 'Celebrations', ['Numpad5']),
  action('celebrate.curtain', 'Curtain call', 'Celebrations', ['Numpad6']),
  action('celebrate.applause', 'Applause', 'Celebrations', ['Numpad7']),
  action('celebrate.fireworks', 'Fireworks', 'Celebrations', ['Numpad8']),
  action('celebrate.balloons', 'Balloons', 'Celebrations', ['Numpad9']),
  action('celebrate.hearts', 'Hearts', 'Celebrations', ['Numpad0']),
  action('celebrate.fanfare', 'Fanfare', 'Celebrations', ['NumpadDivide']),
  action('celebrate.womp', 'Womp womp', 'Celebrations', ['NumpadMultiply']),

  action('text.bold', 'Bold', 'While typing', ['Mod+KeyB'], 'typing'),
  action('text.italic', 'Italic', 'While typing', ['Mod+KeyI'], 'typing'),
  action('text.underline', 'Underline', 'While typing', ['Mod+KeyU'], 'typing'),
  action('text.link', 'Link the selected words', 'While typing', ['Mod+KeyK'], 'typing'),
];

const BY_ID = new Map(ACTIONS.map((each) => [each.id, each]));
export const actionById = (id: string): ShortcutAction | undefined => BY_ID.get(id);

type Shortcuts = Settings['shortcuts'];

/** The keys an action has now: the person's own, or its defaults. */
export function keysOf(id: string, shortcuts: Shortcuts = currentShortcuts()): readonly string[] {
  return shortcuts[id] ?? BY_ID.get(id)?.keys ?? [];
}

const currentShortcuts = () => useSettings.getState().settings.shortcuts;

/* ----------------------------- matching ------------------------------ */

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'CapsLock',
  'Fn',
  'FnLock',
]);

/** The key pressed, written as a shortcut is; null for a modifier on its own. */
export function comboOf(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): string | null {
  const code = event.code;
  if (!code || MODIFIER_CODES.has(code)) return null;
  return [
    event.ctrlKey || event.metaKey ? 'Mod' : null,
    event.altKey ? 'Alt' : null,
    event.shiftKey ? 'Shift' : null,
    code,
  ]
    .filter(Boolean)
    .join('+');
}

type KeyMaps = Record<Scope, Map<string, string>>;
let cached: { shortcuts: Shortcuts; maps: KeyMaps } | null = null;

/**
 * Key → action, for each scope. Where two actions share a key, one the person gave it
 * wins over one that had it by default — the newer choice — and otherwise the one
 * listed first. Settings shows the clash either way.
 */
function keyMaps(shortcuts: Shortcuts): KeyMaps {
  if (cached?.shortcuts === shortcuts) return cached.maps;
  const maps: KeyMaps = { board: new Map(), presenting: new Map(), typing: new Map() };
  for (const chosen of [true, false]) {
    for (const each of ACTIONS) {
      if (each.id in shortcuts !== chosen) continue;
      for (const key of keysOf(each.id, shortcuts)) {
        if (!maps[each.scope].has(key)) maps[each.scope].set(key, each.id);
      }
    }
  }
  cached = { shortcuts, maps };
  return maps;
}

/** Which action a key does in a scope, with these settings. */
export function holderOf(combo: string, scope: Scope, shortcuts: Shortcuts): string | null {
  return keyMaps(shortcuts)[scope].get(combo) ?? null;
}

/** The action this key press is a shortcut for, in this scope, if any. */
export function actionFor(event: KeyboardEvent, scope: Scope): string | null {
  const combo = comboOf(event);
  return combo ? (keyMaps(currentShortcuts())[scope].get(combo) ?? null) : null;
}

/** Each action that shares a key with another in the same scope, and with which. */
export function clashesIn(shortcuts: Shortcuts): Map<string, Array<{ key: string; with: string }>> {
  const holders = new Map<string, string[]>();
  for (const each of ACTIONS) {
    for (const key of keysOf(each.id, shortcuts)) {
      const slot = `${each.scope} ${key}`;
      holders.set(slot, [...(holders.get(slot) ?? []), each.id]);
    }
  }
  const clashes = new Map<string, Array<{ key: string; with: string }>>();
  for (const [slot, ids] of holders) {
    if (ids.length < 2) continue;
    const key = slot.slice(slot.indexOf(' ') + 1);
    for (const id of ids) {
      for (const other of ids) {
        if (other !== id) clashes.set(id, [...(clashes.get(id) ?? []), { key, with: other }]);
      }
    }
  }
  return clashes;
}

/**
 * Why a key cannot be given to an action, or null if it can. Some keys already mean
 * something that is not on the list: Escape puts things down, the arrows nudge, Space
 * held pans, Tab moves between controls, and copy, cut and paste are the browser's.
 */
export function refusal(combo: string, scope: Scope): string | null {
  const key = combo.split('+').at(-1)!;
  const modified = combo.startsWith('Mod+') || combo.includes('Alt+');
  if (key === 'Tab') return 'Tab moves between controls, so it stays as it is.';
  if (['Mod+KeyC', 'Mod+KeyX', 'Mod+KeyV'].includes(combo)) {
    return 'Copy, cut and paste stay as they are.';
  }
  if (scope === 'typing') {
    if (!modified) return 'While typing, a shortcut needs Ctrl, ⌘ or Alt — otherwise it types.';
    if (combo === 'Mod+KeyA') return 'Ctrl/⌘ A selects all the words while typing.';
    return null;
  }
  if (scope === 'board') {
    // The board reads these before any shortcut, whatever else is held with them.
    if (key === 'Escape') return 'Escape puts the selection down, so it stays as it is.';
    if (/^(Shift\+)?Space$/.test(combo)) return 'Space held pans the board, so it stays as it is.';
    if (/^(Shift\+)?Arrow/.test(combo)) return 'The arrows nudge the selection.';
  }
  return null;
}

/* ------------------------------ labels ------------------------------- */

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const NAMED: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Backslash: '\\',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Escape: 'Esc',
  Delete: 'Delete',
  Backspace: 'Backspace',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
};

function keyName(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** "Mod+Shift+KeyZ" → "Ctrl+Shift+Z", or "⇧⌘Z" on a Mac. */
export function keyLabel(combo: string): string {
  const parts = combo.split('+');
  const key = keyName(parts.pop()!);
  if (IS_MAC) {
    const glyph: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧' };
    // A Mac writes them Shift, Option, Command, as its own menus do.
    const order = ['Shift', 'Alt', 'Mod'];
    return `${order
      .filter((each) => parts.includes(each))
      .map((each) => glyph[each])
      .join('')}${key}`;
  }
  const word: Record<string, string> = { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  return [...parts.map((each) => word[each] ?? each), key].join('+');
}

/** The first key an action has now, written for people; null if it has none. */
export function shortcutLabel(
  id: string,
  shortcuts: Shortcuts = currentShortcuts(),
): string | null {
  const first = keysOf(id, shortcuts)[0];
  return first ? keyLabel(first) : null;
}

/** "Pen — P" for a tooltip; just "Pen" when it has no key. */
export const withKey = (label: string, key: string | null): string =>
  key ? `${label} — ${key}` : label;

/** The label of an action's first key, kept up to date as the person changes it. */
export function useShortcutLabel(id: string): string | null {
  const shortcuts = useSettings((state) => state.settings.shortcuts);
  return shortcutLabel(id, shortcuts);
}

/* ----------------------------- recording ----------------------------- */

let recording = false;

/** While Settings waits for a key to be pressed, no shortcut does anything. */
export const isRecordingShortcut = () => recording;
export const setRecordingShortcut = (value: boolean) => {
  recording = value;
};
