/**
 * A person's settings, saved to their account so they follow them to any device: how
 * a new text box starts, and the keyboard shortcuts they have changed. The browser and
 * the Worker both read them through `sanitiseSettings`, so neither trusts the other.
 */

export interface TextSettings {
  /** The size, in board pixels, that new text starts at. */
  fontSize: number;
  /** A clicked text box is this many characters wide… */
  boxChars: number;
  /** …and this many lines tall. Typing more makes it taller. */
  boxLines: number;
  /** What others typing on this person's boards start at; null is the same as theirs. */
  othersFontSize: number | null;
}

export interface Settings {
  text: TextSettings;
  /**
   * Shortcuts changed from the defaults, by action: each is the whole list of keys for
   * it, so an empty list means "no key at all". Actions not here keep their defaults.
   */
  shortcuts: Record<string, string[]>;
}

export const FONT_SIZE = { min: 8, max: 200 } as const;
export const BOX_CHARS = { min: 4, max: 200 } as const;
export const BOX_LINES = { min: 1, max: 40 } as const;

export const DEFAULT_TEXT: TextSettings = {
  fontSize: 40,
  boxChars: 55,
  boxLines: 8,
  othersFontSize: null,
};

export const DEFAULT_SETTINGS: Settings = { text: DEFAULT_TEXT, shortcuts: {} };

/** Plenty for every action there is, with room to grow; caps what one person can store. */
const MAX_ACTIONS = 200;
const MAX_KEYS_PER_ACTION = 4;

/** An action's name: "undo", "tool.pen", "celebrate.confetti". */
const ACTION_ID = /^[a-z][\w.-]{0,47}$/;
/** A key with its modifiers, always in this order: "Mod+Shift+KeyZ", "Numpad1". */
export const COMBO = /^(Mod\+)?(Alt\+)?(Shift\+)?[A-Z][A-Za-z0-9]{0,23}$/;

const clamp = (value: unknown, range: { min: number; max: number }, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(range.max, Math.max(range.min, Math.round(value)))
    : fallback;

/** Anything at all in, valid settings out: unknown fields dropped, numbers in range. */
export function sanitiseSettings(raw: unknown): Settings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<keyof Settings, unknown>
  >;
  const text = (value.text && typeof value.text === 'object' ? value.text : {}) as Partial<
    Record<keyof TextSettings, unknown>
  >;

  const shortcuts: Record<string, string[]> = {};
  if (value.shortcuts && typeof value.shortcuts === 'object' && !Array.isArray(value.shortcuts)) {
    for (const [id, keys] of Object.entries(value.shortcuts as Record<string, unknown>)) {
      if (Object.keys(shortcuts).length >= MAX_ACTIONS) break;
      if (!ACTION_ID.test(id) || !Array.isArray(keys)) continue;
      const valid = keys.filter((key): key is string => typeof key === 'string' && COMBO.test(key));
      shortcuts[id] = [...new Set(valid)].slice(0, MAX_KEYS_PER_ACTION);
    }
  }

  return {
    text: {
      fontSize: clamp(text.fontSize, FONT_SIZE, DEFAULT_TEXT.fontSize),
      boxChars: clamp(text.boxChars, BOX_CHARS, DEFAULT_TEXT.boxChars),
      boxLines: clamp(text.boxLines, BOX_LINES, DEFAULT_TEXT.boxLines),
      othersFontSize:
        text.othersFontSize === null || text.othersFontSize === undefined
          ? null
          : clamp(text.othersFontSize, FONT_SIZE, DEFAULT_TEXT.fontSize),
    },
    shortcuts,
  };
}

/** The size others start at on boards owned by someone with these settings. */
export const sizeForOthers = (settings: Settings): number =>
  settings.text.othersFontSize ?? settings.text.fontSize;
