// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { MarkdownView } from 'obsidian';
import { openReadingBlock } from '../src/reading-edit';
import { anchorReadingCursor } from '../src/reading-scroll';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture(drift: number) {
  const dom = document.createElement('div'); const scrollDOM = document.createElement('div'); dom.append(scrollDOM); document.body.append(dom);
  let state = EditorState.create({ doc: 'A paragraph.' });
  let layoutDrift = drift;
  let current = true;
  scrollDOM.scrollTop = 100;
  scrollDOM.getBoundingClientRect = () => ({ top: 40, height: 600 } as DOMRect);
  const frames = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(fn => { frames.set(++id, fn); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(key => { frames.delete(key); });
  const view = {
    dom, scrollDOM, get state() { return state; },
    dispatch: vi.fn((tx: Parameters<EditorState['update']>[0]) => { state = state.update(tx).state; }),
    focus: vi.fn(),
    coordsAtPos: vi.fn(() => ({ top: 240 + layoutDrift - (scrollDOM.scrollTop - 100) })),
    requestMeasure: vi.fn((request: { read(view: EditorView): number | undefined; write?(value: number | undefined, view: EditorView): void }) => { const read = request.read(view as unknown as EditorView); request.write!(read, view as unknown as EditorView); }),
  };
  const tick = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); };
  return { view, typed: view as unknown as EditorView, tick, frames, current: () => current, navigate: () => { current = false; }, drift: (value: number) => { layoutDrift = value; } };
}
describe('Reading-to-Live-Preview scroll anchoring', () => {
  it('uses the screen anchor instead of Obsidian setCursor scrolling when opening Live Preview', async () => {
    const f = fixture(30); f.view.dom.className = 'cm-editor';
    let mode = 'preview';
    const containerEl = document.createElement('div'); document.body.append(containerEl); containerEl.append(f.view.dom);
    const setCursor = vi.fn(); const focus = vi.fn();
    const snapshot = f.view.state.doc.toString();
    const markdown = {
      containerEl, file: { path: 'Note.md' }, getMode: () => mode, getViewData: () => snapshot,
      editor: { getValue: () => snapshot, setCursor, focus },
      leaf: { getViewState: () => ({ state: { mode } }), setViewState: vi.fn(async () => { mode = 'source'; }) },
    } as unknown as MarkdownView;
    vi.spyOn(EditorView, 'findFromDOM').mockReturnValue(f.typed);
    expect(await openReadingBlock(markdown, 'Note.md', 4, snapshot, 240)).toBe(true);
    expect(setCursor).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled();
    expect(f.view.state.selection.main.head).toBe(4);
    expect(f.view.coordsAtPos().top).toBe(240);
    f.tick(); f.tick(); f.tick();
  });
  it.each([-50, 30])('keeps the clicked text at the original screen height after a %s pixel mode-switch drift', drift => {
    const f = fixture(drift);
    anchorReadingCursor(f.typed, 4, 240, f.current);
    expect(f.view.coordsAtPos().top).toBe(240);
    expect(f.view.state.selection.main.head).toBe(4);
    expect(f.view.state.doc.toString()).toBe('A paragraph.');
    f.drift(drift + 18); f.tick();
    expect(f.view.coordsAtPos().top).toBe(240);
    f.tick(); f.tick();
    expect(f.frames.size).toBe(0);
    expect(f.view.focus).toHaveBeenCalledOnce();
  });
  it.each(['wheel', 'keydown', 'pointerdown', 'touchstart'])('stops correcting when the user sends %s input', type => {
    const f = fixture(30); anchorReadingCursor(f.typed, 4, 240, f.current);
    const scroll = f.view.scrollDOM.scrollTop;
    f.view.dom.dispatchEvent(new Event(type, { bubbles: true })); f.drift(80); f.tick();
    expect(f.view.scrollDOM.scrollTop).toBe(scroll); expect(f.frames.size).toBe(0);
  });
  it('stops if the pane navigates or the selection moves during layout', () => {
    const f = fixture(30); anchorReadingCursor(f.typed, 4, 240, f.current);
    const scroll = f.view.scrollDOM.scrollTop; f.navigate(); f.drift(80); f.tick();
    expect(f.view.scrollDOM.scrollTop).toBe(scroll); expect(f.frames.size).toBe(0);
  });
});
