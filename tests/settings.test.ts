import { describe, expect, it, vi } from 'vitest';
vi.mock('obsidian', () => ({ PluginSettingTab: class {}, Setting: class {} }));
import { defaultSettings, highlightColor, loadSettings, normalizeHex } from '../src/settings';

describe('highlight settings', () => {
  it('normalizes valid hex entry and rejects incomplete or unsafe colors', () => {
    expect(normalizeHex(' #aBc ')).toBe('#AABBCC');
    expect(normalizeHex('12abEF')).toBe('#12ABEF');
    for (const value of ['', '#12', '#12345', '#GGGGGG', 'red', 'var(--color)', null]) {
      expect(normalizeHex(value)).toBeUndefined();
    }
  });
  it('loads saved colors, defaults safely, and follows accent changes through the CSS variable', () => {
    expect(loadSettings(null)).toEqual(defaultSettings);
    expect(loadSettings({}).optionArrowSelection).toBe(true);
    expect(loadSettings({ optionArrowSelection: false }).optionArrowSelection).toBe(false);
    expect(loadSettings({}).readingClickToEdit).toBe(true);
    expect(loadSettings({}).readingCursorPlacement).toBe('click');
    expect(loadSettings({ readingCursorPlacement: 'start' }).readingCursorPlacement).toBe('start');
    expect(loadSettings({ readingCursorPlacement: 'end' }).readingCursorPlacement).toBe('end');
    expect(loadSettings({ readingClickToEdit: false }).readingClickToEdit).toBe(false);
    expect(loadSettings({ highlightColor: 'bad-color' })).toEqual(defaultSettings);
    const custom = loadSettings({ useAccentColor: false, highlightColor: '#abc' });
    expect(highlightColor(custom)).toBe('#AABBCC');
    expect(highlightColor({ ...custom, useAccentColor: true })).toBe('var(--interactive-accent)');
  });
});
