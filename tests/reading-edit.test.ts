import { describe, expect, it, vi } from 'vitest';
import type { MarkdownView, EditorTransaction } from 'obsidian';
import { EditorState } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { applyReadingEdit } from '../src/reading-edit';
import { insertBlock, moveBlock, parseBlocks } from '../src/blocks';

function fixture(initial = 'First\n\nSecond') {
  let state = EditorState.create({ doc: initial, extensions: [history()] });
  let canonical: string | undefined;
  const offsetToPos = (offset: number) => { const line = state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from }; };
  const posToOffset = (pos: { line: number; ch: number }) => state.doc.line(pos.line + 1).from + pos.ch;
  const transaction = vi.fn((tx: EditorTransaction) => {
    state = state.update({ changes: tx.changes?.map(c => ({ from: posToOffset(c.from), to: c.to ? posToOffset(c.to) : posToOffset(c.from), insert: c.text })) }).state;
  });
  const view = {
    file: { path: 'Test.md' }, getMode: vi.fn(() => 'preview'),
    getViewData: () => canonical ?? state.doc.toString(),
    setViewData: vi.fn((text: string) => { canonical = text; }), requestSave: vi.fn(),
    editor: { getValue: () => state.doc.toString(), offsetToPos, transaction, setCursor: vi.fn(), focus: vi.fn() },
    previewMode: { rerender: vi.fn() },
    leaf: { getViewState: () => ({ type: 'markdown', state: { file: 'Test.md', mode: 'preview', source: true, backlinks: false } }), setViewState: vi.fn(async () => {}) },
  };
  return { view, typed: view as unknown as MarkdownView, text: () => state.doc.toString(), setCanonical: (text: string) => { canonical = text; }, undo: () => undo({ state, dispatch: tx => { state = tx.state; } }) };
}
describe('Reading view editor bridge', () => {
  it('preserves current Reading-view metadata when the hidden editor is stale and updates the saved view', async () => {
    const f = fixture('---\nmodified: old\n---\n\nFirst\n\nSecond');
    const source = '---\nmodified: current\n---\n\nFirst\n\nSecond';
    f.setCanonical(source);
    const edit = moveBlock(source, parseBlocks(source), 0, 2)!;
    expect(await applyReadingEdit(f.typed, 'Test.md', edit, source, false)).toBe(true);
    expect(f.text()).toBe('---\nmodified: current\n---\n\nSecond\n\nFirst');
    expect(f.view.getViewData()).toBe(f.text());
    expect(f.view.requestSave).toHaveBeenCalledTimes(1);
    expect(f.view.editor.transaction).toHaveBeenCalledTimes(1);
  });
  it('moves using one undoable editor transaction without changing view mode', async () => {
    const f = fixture(); const source = f.text(); const edit = moveBlock(source, parseBlocks(source), 0, 2)!;
    expect(await applyReadingEdit(f.typed, 'Test.md', edit, source, false)).toBe(true);
    expect(f.text()).toBe('Second\n\nFirst'); expect(f.view.editor.transaction).toHaveBeenCalledTimes(1);
    expect(f.view.leaf.setViewState).not.toHaveBeenCalled();
    expect(f.undo()).toBe(true); expect(f.text()).toBe(source);
  });
  it('inserts, explicitly selects Live Preview, and places the caret in the new blank block', async () => {
    const f = fixture(); const source = f.text(); const edit = insertBlock(source, parseBlocks(source)[0], false);
    expect(await applyReadingEdit(f.typed, 'Test.md', edit, source, true)).toBe(true);
    expect(f.text()).toBe('First\n\n\n\nSecond');
    expect(f.view.leaf.setViewState).toHaveBeenCalledWith({ type: 'markdown', state: { file: 'Test.md', mode: 'source', source: false, backlinks: false } });
    expect(f.view.editor.setCursor).toHaveBeenCalledWith({ line: 2, ch: 0 });
    expect(f.view.editor.focus).toHaveBeenCalledTimes(1);
    expect(f.undo()).toBe(true); expect(f.text()).toBe(source);
  });
  it.each(['path', 'mode', 'source'])('rejects stale %s before any write or mode change', async kind => {
    const f = fixture(); const source = f.text(); const edit = insertBlock(source, parseBlocks(source)[0], false);
    if (kind === 'path') f.view.file.path = 'Other.md';
    if (kind === 'mode') f.view.getMode.mockReturnValue('source');
    const snapshot = kind === 'source' ? 'Stale source' : source;
    expect(await applyReadingEdit(f.typed, 'Test.md', edit, snapshot, true)).toBe(false);
    expect(f.view.editor.transaction).not.toHaveBeenCalled(); expect(f.view.leaf.setViewState).not.toHaveBeenCalled();
  });
  it('does not focus or select a different file if navigation occurs during the mode switch', async () => {
    const f = fixture(); const source = f.text(); const edit = insertBlock(source, parseBlocks(source)[0], false);
    f.view.leaf.setViewState.mockImplementation(async () => { f.view.file.path = 'Other.md'; });
    await applyReadingEdit(f.typed, 'Test.md', edit, source, true);
    expect(f.view.editor.focus).not.toHaveBeenCalled(); expect(f.view.editor.setCursor).not.toHaveBeenCalled();
  });
});
