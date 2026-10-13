// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourceOffsetAtCaret, readingClickOffset, readingClickPosition } from '../src/reading-cursor';
import { parseBlocks } from '../src/blocks';
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function paragraph(html: string) { const element = document.createElement('p'); element.innerHTML = html; document.body.append(element); return element; }

describe('Reading click cursor mapping', () => {
  it.each([0, 6, 17, 22, 32, 33])('maps a plain paragraph caret at offset %s, including sentence, word, start, and end boundaries', offset => {
    const source = 'Before.\n\nFirst sentence. Another sentence.';
    const block = parseBlocks(source)[1];
    const element = paragraph(source.slice(block.from, block.to));
    expect(sourceOffsetAtCaret(source, block, [element], element.firstChild!, offset)).toBe(block.from + offset);
  });
  it('maps repeated words through emphasis and skips a Markdown link destination', () => {
    const source = '**same** same [same](https://same.example/same) same _last_.';
    const element = paragraph('<strong>same</strong> same <a>same</a> same <em>last</em>.');
    const block = parseBlocks(source)[0];
    const afterLink = element.childNodes[3];
    expect(sourceOffsetAtCaret(source, block, [element], afterLink, 3)).toBe(source.lastIndexOf('same') + 2);
    expect(sourceOffsetAtCaret(source, block, [element], element.querySelector('em')!.firstChild!, 2)).toBe(source.indexOf('last') + 2);
  });
  it('decodes entities and escapes and maps text after a wikilink alias and hidden comment', () => {
    const source = 'A &amp; B \\*word\\* [[Target|alias]] %%hidden%% after.';
    const element = paragraph('A &amp; B *word* <a>alias</a> after.');
    const text = element.lastChild!;
    expect(sourceOffsetAtCaret(source, parseBlocks(source)[0], [element], text, 3)).toBe(source.indexOf('after') + 2);
  });
  it('maps across separate text nodes and soft line breaks', () => {
    const source = 'First **bold**\nsecond line.';
    const element = paragraph('First <strong>bold</strong>\nsecond line.');
    expect(sourceOffsetAtCaret(source, parseBlocks(source)[0], [element], element.lastChild!, 4)).toBe(source.indexOf('second') + 3);
  });
  it('uses browser hit testing for the supplied click coordinates', () => {
    const source = 'A paragraph.'; const element = paragraph(source);
    const range = document.createRange(); range.setStart(element.firstChild!, 5); range.collapse(true);
    const hit = vi.fn(() => range);
    Object.defineProperty(document, 'caretRangeFromPoint', { value: hit, configurable: true });
    expect(readingClickOffset(source, parseBlocks(source)[0], [element], 245, 38)).toBe(5);
    expect(hit).toHaveBeenCalledWith(245, 38);
    Reflect.deleteProperty(document, 'caretRangeFromPoint');
  });
  it('captures the rendered text line top before switching modes', () => {
    const source = 'A paragraph.'; const element = paragraph(source);
    const range = document.createRange(); range.setStart(element.firstChild!, 5); range.collapse(true);
    Object.defineProperty(document, 'caretRangeFromPoint', { value: () => range, configurable: true });
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ top: 225, height: 24 }] });
    try {
      expect(readingClickPosition(source, parseBlocks(source)[0], [element], 245, 238)).toEqual({ offset: 5, screenTop: 225 });
    } finally {
      Reflect.deleteProperty(document, 'caretRangeFromPoint');
      Reflect.deleteProperty(Range.prototype, 'getClientRects');
    }
  });
  it('rejects carets outside the block and falls back for a widget without a text caret', () => {
    const source = '![[Photo.png]]'; const element = paragraph('<img>'); const other = paragraph('Other');
    expect(sourceOffsetAtCaret(source, parseBlocks(source)[0], [element], other.firstChild!, 1)).toBeUndefined();
    expect(readingClickOffset(source, parseBlocks(source)[0], [element], 0, -1)).toBe(0);
  });
});
