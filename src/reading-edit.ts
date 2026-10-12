import type { MarkdownView } from 'obsidian';
import type { Edit } from './blocks';

export async function applyReadingEdit(view: MarkdownView, path: string, edit: Edit, snapshot: string, livePreview: boolean): Promise<boolean> {
  if (view.file?.path !== path || view.getMode() !== 'preview' || view.getViewData() !== snapshot) return false;
  const next = snapshot.slice(0, edit.from) + edit.insert + snapshot.slice(edit.to);
  const editorSource = view.editor.getValue();
  let change = { from: edit.from, to: edit.to, insert: edit.insert };
  if (editorSource !== snapshot) {
    // Reading view can receive file updates while its hidden editor is stale.
    let from = 0;
    while (from < editorSource.length && from < next.length && editorSource[from] === next[from]) from++;
    let suffix = 0;
    while (suffix < editorSource.length - from && suffix < next.length - from
      && editorSource[editorSource.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
    change = { from, to: editorSource.length - suffix, insert: next.slice(from, next.length - suffix) };
  }
  const beforeCursor = next.slice(0, edit.cursor).split('\n');
  const cursor = { line: beforeCursor.length - 1, ch: beforeCursor[beforeCursor.length - 1].length };
  view.editor.transaction({
    changes: [{ from: view.editor.offsetToPos(change.from), to: view.editor.offsetToPos(change.to), text: change.insert }],
    selections: [{ from: cursor }],
  }, livePreview ? 'input.blocks' : 'move.blocks');
  view.setViewData(next, false);
  view.requestSave();
  view.previewMode.rerender(true);
  if (livePreview) {
    const state = view.leaf.getViewState();
    await view.leaf.setViewState({ ...state, state: { ...state.state, mode: 'source', source: false } });
    // The pane may have navigated to another note while changing mode.
    if (view.file?.path === path && view.editor.getValue() === next) {
      view.editor.setCursor(cursor);
      view.editor.focus();
    }
  }
  return true;
}
