import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitiseSettings, sizeForOthers } from '@shared/settings';

describe('settings read back from anywhere', () => {
  it('are the defaults when there is nothing, or nonsense', () => {
    for (const raw of [null, undefined, 'text', 42, [], { text: 'big' }]) {
      expect(sanitiseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keep sizes in range, as whole numbers', () => {
    const { text } = sanitiseSettings({
      text: { fontSize: 2, boxChars: 900, boxLines: 3.6, othersFontSize: 24.2 },
    });
    expect(text).toEqual({ fontSize: 8, boxChars: 200, boxLines: 4, othersFontSize: 24 });
  });

  it('keep "the same as mine" for others, and drop what they do not know', () => {
    const settings = sanitiseSettings({
      text: { fontSize: 24, othersFontSize: null, colour: 'red' },
      theme: 'dark',
    });
    expect(settings.text).toEqual({ ...DEFAULT_SETTINGS.text, fontSize: 24 });
    expect(settings).not.toHaveProperty('theme');
    expect(sizeForOthers(settings)).toBe(24);
    expect(sizeForOthers(sanitiseSettings({ text: { fontSize: 24, othersFontSize: 32 } }))).toBe(
      32,
    );
  });

  it('keep only keys written properly, once each, and no more than four', () => {
    const { shortcuts } = sanitiseSettings({
      shortcuts: {
        'tool.pen': ['KeyB', 'KeyB', 'ctrl+b', 7, 'Mod+Shift+KeyB', 'Numpad1', 'F2', 'Home'],
        undo: [],
        'Not An Action': ['KeyQ'],
        redo: 'Mod+KeyY',
      },
    });
    expect(shortcuts).toEqual({
      'tool.pen': ['KeyB', 'Mod+Shift+KeyB', 'Numpad1', 'F2'],
      undo: [],
    });
  });
});
