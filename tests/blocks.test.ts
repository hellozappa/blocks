import { describe, expect, it } from 'vitest';
import { EditorState, Transaction } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { Block, Edit, bodyStart, insertBlock, moveBlock, parseBlocks } from '../src/blocks';

function apply(text: string, edit: Edit): string { return text.slice(0, edit.from) + edit.insert + text.slice(edit.to); }
function contents(text: string): string[] { return parseBlocks(text).filter(b => b.kind !== 'Empty').map(b => text.slice(b.from, b.to)); }

describe('Markdown block boundaries', () => {
  it('keeps soft lines in one paragraph and separates headings, lists, images, and embeds', () => {
    const text = '# Heading\n\nOne sentence.\nAnother sentence.\n\n- First\n  - Nested\n- Second\n\n![Photo](photo.png)\n\n![[Note]]';
    expect(contents(text)).toEqual(['# Heading', 'One sentence.\nAnother sentence.', '- First\n  - Nested', '- Second', '![Photo](photo.png)', '![[Note]]']);
  });
  it('keeps code, tables, quotes, callouts, and math with internal blank lines whole', () => {
    const units = ['```ts\nconst a = 1;\n\nconst b = 2;\n```', '| A | B |\n| - | - |\n| 1 | 2 |', '> [!note]\n> hello\n>\n> world', '$$\na\n\nb\n$$', '%%\nsecret\n\ntext\n%%'];
    expect(contents(units.join('\n\n'))).toEqual(units);
  });
  it('does not interpret math delimiters inside code as real math', () => {
    const text = '```\n$$\nhello\n$$\n```\n\nEnd';
    expect(contents(text)).toEqual(['```\n$$\nhello\n$$\n```', 'End']);
  });
  it('attaches separate block IDs and protects frontmatter', () => {
    const text = '---\ntitle: Keep\n---\n\n> Quote\n\n^quote-id\n\nEnd';
    expect(contents(text)).toEqual(['> Quote\n\n^quote-id', 'End']);
    expect(parseBlocks(text)[0].from).toBeGreaterThanOrEqual(bodyStart(text));
  });
  it('protects an unfinished frontmatter block', () => {
    const text = '---\ntitle: unfinished';
    expect(parseBlocks(text)).toEqual([]);
  });
});

describe('relative insertion', () => {
  for (const nl of ['\n', '\r\n']) for (const above of [false, true]) {
    it(`creates one writable empty block ${above ? 'above' : 'below'} with ${JSON.stringify(nl)} newlines`, () => {
      const text = ['First', 'Target', 'Last'].join(nl.repeat(2));
      const target = parseBlocks(text)[1];
      const edit = insertBlock(text, target, above);
      const changed = apply(text, edit);
      expect(parseBlocks(changed).filter(b => b.kind === 'Empty')).toHaveLength(1);
      const typed = changed.slice(0, edit.cursor) + 'New' + changed.slice(edit.cursor);
      expect(contents(typed)).toEqual(above ? ['First', 'New', 'Target', 'Last'] : ['First', 'Target', 'New', 'Last']);
    });
  }
  it('works at the start, end, and in an empty note', () => {
    for (const text of ['Only', '']) for (const above of [true, false]) {
      const edit = insertBlock(text, parseBlocks(text)[0], above);
      const changed = apply(text, edit);
      const typed = changed.slice(0, edit.cursor) + 'New' + changed.slice(edit.cursor);
      expect(contents(typed)).toEqual(!text ? ['New'] : above ? ['New', text] : [text, 'New']);
    }
  });
});

describe('moving blocks', () => {
  it('moves both directions and treats adjacent drops as no-ops', () => {
    const text = 'A\n\nB\n\nC';
    const blocks = parseBlocks(text);
    expect(contents(apply(text, moveBlock(text, blocks, 0, 3)!))).toEqual(['B', 'C', 'A']);
    expect(contents(apply(text, moveBlock(text, blocks, 2, 0)!))).toEqual(['C', 'A', 'B']);
    expect(moveBlock(text, blocks, 1, 1)).toBeNull();
    expect(moveBlock(text, blocks, 1, 2)).toBeNull();
  });
  it('preserves frontmatter, CRLF, embedded source, and block IDs', () => {
    const prefix = '---\r\ntitle: Keep exactly\r\n---\r\n\r\n';
    const units = ['A\r\nsoft line ^a', '![[Photo.png|200]]', '```js\r\nlet a = 1\r\n```'];
    const text = prefix + units.join('\r\n\r\n') + '\r\n';
    const changed = apply(text, moveBlock(text, parseBlocks(text), 0, 3)!);
    expect(changed.startsWith(prefix)).toBe(true);
    expect(contents(changed)).toEqual([units[1], units[2], units[0]]);
    expect(changed.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });
  it('keeps a moved paragraph separate from neighboring list items', () => {
    const text = 'Paragraph\n\n- A\n- B\n- C';
    const changed = apply(text, moveBlock(text, parseBlocks(text), 0, 3)!);
    expect(contents(changed)).toEqual(['- A', '- B', 'Paragraph', '- C']);
  });
  it('keeps multiline nested list items intact', () => {
    const text = '- A\n  continued\n  - Child\n- B\n- C';
    const changed = apply(text, moveBlock(text, parseBlocks(text), 0, 3)!);
    expect(contents(changed)).toEqual(['- B', '- C', '- A\n  continued\n  - Child']);
  });
  it('preserves every content unit across every source and destination in mixed Markdown', () => {
    const units = ['# Title', 'Paragraph\nsoft line', '- A\n  - Child', '- B', '```\ncode\n```', '![[Image.png]]', '> quote', '$$\nx\n\ny\n$$'];
    const text = units.join('\n\n');
    const blocks = parseBlocks(text);
    for (let source = 0; source < blocks.length; source++) for (let slot = 0; slot <= blocks.length; slot++) {
      const edit = moveBlock(text, blocks, source, slot);
      if (!edit) continue;
      const expected = [...units];
      const [moving] = expected.splice(source, 1);
      expected.splice(slot > source ? slot - 1 : slot, 0, moving);
      expect(contents(apply(text, edit))).toEqual(expected);
    }
  });
  it('makes each drop independently undoable', () => {
    const text = 'A\n\nB\n\nC';
    let state = EditorState.create({ doc: text, extensions: [history()] });
    const dispatch = (transaction: Transaction) => { state = transaction.state; };
    const move = () => {
      const edit = moveBlock(state.doc.toString(), parseBlocks(state.doc.toString()), 0, 3)!;
      dispatch(state.update({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, annotations: Transaction.userEvent.of('move.blocks') }));
    };
    move();
    const afterFirst = state.doc.toString();
    move();
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe(afterFirst);
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.doc.toString()).toBe(text);
  });
});
