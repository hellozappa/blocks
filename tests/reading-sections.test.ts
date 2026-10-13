import { describe, expect, it, vi } from 'vitest';
import type { MarkdownView } from 'obsidian';
import { readingSectionInfo } from '../src/reading-sections';

describe('cached Reading section adapter', () => {
  it('reads current section information from the actual renderer even without a postprocessor context', () => {
    const element = {} as HTMLElement;
    const info = { text: 'First\n\nSecond', lineStart: 2, lineEnd: 2 };
    const renderer = { getSectionInfo: vi.fn(function(this: unknown, target: HTMLElement) { expect(this).toBe(renderer); expect(target).toBe(element); return info; }) };
    const view = { previewMode: { renderer } } as unknown as MarkdownView;
    expect(readingSectionInfo(view, element)).toBe(info);
  });
  it.each([null, { text: 'Note', lineStart: -1, lineEnd: 1 }, { text: 'Note', lineStart: 2, lineEnd: 1 }, { text: 123, lineStart: 0, lineEnd: 0 }])('rejects unavailable or invalid renderer information: %j', info => {
    const view = { previewMode: { renderer: { getSectionInfo: () => info } } } as unknown as MarkdownView;
    expect(readingSectionInfo(view, {} as HTMLElement)).toBeNull();
  });
  it('returns null when the host renderer adapter is unavailable', () => {
    expect(readingSectionInfo({ previewMode: {} } as MarkdownView, {} as HTMLElement)).toBeNull();
  });
});
