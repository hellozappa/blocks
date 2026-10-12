// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { blocksExtension } from '../src/editor';

const views: EditorView[] = [];
const captures = new WeakMap<HTMLElement, number>();
function rectangle(): DOMRect { return { x: 100, y: 0, left: 100, top: 0, right: 700, bottom: 400, width: 600, height: 400, toJSON() {} } as DOMRect; }
beforeEach(() => {
  const lineRect = () => ({ ...rectangle(), height: 20, bottom: 20 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return this.classList.contains('cm-line') ? lineRect() : rectangle();
  });
  Range.prototype.getBoundingClientRect = lineRect;
  Range.prototype.getClientRects = () => [lineRect()] as unknown as DOMRectList;
  HTMLElement.prototype.setPointerCapture = function(id) { captures.set(this, id); };
  HTMLElement.prototype.hasPointerCapture = function(id) { return captures.get(this) === id; };
  HTMLElement.prototype.releasePointerCapture = function() { captures.delete(this); };
});
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function editor(doc = 'First\n\nSecond', readOnly = false): EditorView {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [blocksExtension, EditorState.readOnly.of(readOnly)] }) });
  views.push(view);
  return view;
}
async function hover(view: EditorView, x = 120): Promise<void> {
  view.requestMeasure();
  await new Promise(resolve => setTimeout(resolve, 80));
  const y = view.documentTop + view.lineBlockAt(0).top + 1;
  view.dom.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
}
function pointer(target: Element, type: string, y: number, x = 120): void {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

describe('editor integration', () => {
  it.each([
    { doc: 'First\n\nSecond\ncontinued', cursor: 12, from: 7, to: 23 },
    { doc: '', cursor: 0, from: 0, to: 0 },
  ])('Escape selects the caret block and then restores the caret: $doc', async ({ doc, cursor, from, to }) => {
    const view = editor(doc);
    await hover(view);
    view.dispatch({ selection: { anchor: cursor } }); view.focus();
    const escape = () => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(escape()).toBe(false);
    expect(view.state.selection.main.from).toBe(from); expect(view.state.selection.main.to).toBe(to);
    expect(view.dom.querySelector('.blocks-handle')!.getAttribute('aria-pressed')).toBe('true');
    expect(view.dom.querySelector('.blocks-selection-highlight')!.classList.contains('is-visible')).toBe(true);
    expect(escape()).toBe(false);
    expect(view.state.selection.main.empty).toBe(true); expect(view.state.selection.main.head).toBe(cursor);
    expect(view.dom.querySelector('.blocks-handle')!.getAttribute('aria-pressed')).toBe('false');
    expect(view.state.doc.toString()).toBe(doc);
  });
  it('Escape only affects the focused editor and leaves arbitrary text selections unchanged', async () => {
    const first = editor(); const second = editor('Other');
    await hover(first); await hover(second);
    first.focus();
    first.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(first.dom.querySelector('.blocks-handle')!.getAttribute('aria-pressed')).toBe('true');
    expect(second.dom.querySelector('.blocks-handle')!.getAttribute('aria-pressed')).toBe('false');
    const input = document.createElement('input'); document.body.append(input); input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(first.dom.querySelector('.blocks-handle')!.getAttribute('aria-pressed')).toBe('true');
    second.dispatch({ selection: { anchor: 1, head: 3 } }); second.focus();
    second.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(second.state.selection.main.from).toBe(1); expect(second.state.selection.main.to).toBe(3);
  });
  it('preserves accessible control names without attributes that trigger host or native tooltips', () => {
    const first = editor();
    const second = editor();
    const names = new Set<string>();
    for (const view of [first, second]) {
      const controls = view.dom.querySelector('.blocks-controls')!;
      expect(controls.querySelector('[aria-label], [title]')).toBeNull();
      expect(controls.hasAttribute('aria-label')).toBe(false);
      for (const element of [controls, ...controls.querySelectorAll('button')]) {
        const id = element.getAttribute('aria-labelledby')!;
        expect(id).toBeTruthy();
        expect(names.has(id)).toBe(false);
        names.add(id);
        const label = document.getElementById(id)!;
        expect(element.contains(label)).toBe(true);
        expect(label.textContent).toBeTruthy();
      }
    }
    const plus = first.dom.querySelector('.blocks-plus')!;
    expect(document.getElementById(plus.getAttribute('aria-labelledby')!)!.textContent).toBe('Insert block below. Option-click to insert above.');
  });

  it.each([
    { theme: 'theme-light', background: 'rgb(242, 242, 242)' },
    { theme: 'theme-dark', background: 'rgb(68, 68, 68)' },
  ])('keeps selected controls visible after pointer capture ends in $theme', async ({ theme, background }) => {
    const style = document.createElement('style');
    style.textContent = readFileSync('styles.css', 'utf8');
    document.body.append(style);
    const view = editor();
    view.dom.classList.add(theme);
    await hover(view);
    const handle = view.dom.querySelector<HTMLElement>('.blocks-handle')!;
    const controls = view.dom.querySelector<HTMLElement>('.blocks-controls')!;
    const y = view.documentTop + view.lineBlockAt(0).top + 1;
    pointer(handle, 'pointerdown', y);
    pointer(handle, 'pointerup', y);
    handle.dispatchEvent(new Event('lostpointercapture'));
    view.dom.dispatchEvent(new Event('pointerleave'));
    expect(controls.classList.contains('is-visible')).toBe(true);
    expect(window.getComputedStyle(controls).opacity).toBe('1');
    expect(window.getComputedStyle(controls).pointerEvents).toBe('auto');
    expect(window.getComputedStyle(handle).backgroundColor).toBe(background);
    expect(window.getComputedStyle(handle).outline).toBe('none');
    expect(handle.getAttribute('aria-pressed')).toBe('true');
    expect(view.dom.querySelector('.blocks-selection-highlight')!.classList.contains('is-visible')).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(controls.classList.contains('is-visible')).toBe(true);
    handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    expect(view.state.doc.toString()).toBe('Second\n\nFirst');
  });

  it('keeps controls at the dragged block top and anchors to it after dropping into blank space', async () => {
    const view = editor('First\n\n\n\nSecond');
    await hover(view);
    const handle = view.dom.querySelector('.blocks-handle')!;
    const controls = view.dom.querySelector<HTMLElement>('.blocks-controls')!;
    const start = view.documentTop + view.lineBlockAt(0).top + 1;
    pointer(handle, 'pointerdown', start);
    pointer(handle, 'pointerup', start);
    pointer(handle, 'pointerdown', start);
    const dropY = view.documentTop + view.lineBlockAt(7).bottom - 1;
    pointer(handle, 'pointermove', dropY);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(Number.parseFloat(controls.style.top)).toBe(dropY - 1);
    expect(controls.classList.contains('is-visible')).toBe(true);
    pointer(handle, 'pointerup', dropY);
    await new Promise(resolve => setTimeout(resolve, 80));
    const moved = view.state.doc.toString().indexOf('First');
    expect(moved).toBeGreaterThan(0);
    expect(view.state.selection.main.from).toBe(moved);
    expect(view.state.selection.main.to).toBe(moved + 5);
    expect(Number.parseFloat(controls.style.top)).toBe(view.documentTop + view.lineBlockAt(moved).top);
    expect(handle.getAttribute('aria-pressed')).toBe('true');
    view.dom.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: 5 }));
    expect(Number.parseFloat(controls.style.top)).toBe(view.documentTop + view.lineBlockAt(moved).top);
    expect(controls.classList.contains('is-visible')).toBe(true);
  });

  it.each([
    { doc: 'Paragraph\ncontinued', from: 0, to: 19 },
    { doc: '', from: 0, to: 0 },
    { doc: 'First\n\n\n\nSecond', from: 7, to: 7 },
  ])('highlights a selected block, including an empty block: $doc', async ({ doc, from, to }) => {
    const view = editor(doc);
    await hover(view);
    const handle = view.dom.querySelector('.blocks-handle')!;
    const y = view.documentTop + view.lineBlockAt(from).top + 1;
    view.dom.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: y }));
    pointer(handle, 'pointerdown', y);
    pointer(handle, 'pointerup', y);
    const highlight = view.dom.querySelector<HTMLElement>('.blocks-selection-highlight')!;
    expect(highlight.classList.contains('is-visible')).toBe(true);
    expect(Number.parseFloat(highlight.style.height)).toBeGreaterThan(0);
    expect(Number.parseFloat(highlight.style.width)).toBeGreaterThan(0);
    expect(handle.classList.contains('is-selected')).toBe(true);
    expect(handle.getAttribute('aria-pressed')).toBe('true');
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.main.from).toBe(from);
    expect(view.state.selection.main.to).toBe(to);
    view.contentDOM.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(highlight.classList.contains('is-visible')).toBe(false);
    expect(handle.getAttribute('aria-pressed')).toBe('false');
  });

  it('highlights a rendered image widget selected with the keyboard', async () => {
    const doc = '![[Photo.png]]';
    const image = new class extends WidgetType {
      toDOM(): HTMLElement { const el = document.createElement('div'); el.append(document.createElement('img')); return el; }
    }();
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [
      blocksExtension, EditorView.decorations.of(Decoration.set(Decoration.replace({ widget: image, block: true }).range(0, doc.length))),
    ] }) });
    views.push(view);
    await hover(view);
    const handle = view.dom.querySelector('.blocks-handle')!;
    handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    const highlight = view.dom.querySelector<HTMLElement>('.blocks-selection-highlight')!;
    expect(highlight.classList.contains('is-visible')).toBe(true);
    expect(Number.parseFloat(highlight.style.height)).toBeGreaterThan(0);
    expect(handle.getAttribute('aria-pressed')).toBe('true');
    (handle as HTMLElement).focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(highlight.classList.contains('is-visible')).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('keeps the selected highlight through measurement and clears it after edits or a new selection', async () => {
    const view = editor();
    await hover(view);
    const handle = view.dom.querySelector('.blocks-handle')!;
    handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
    await hover(view);
    const highlight = view.dom.querySelector('.blocks-selection-highlight')!;
    expect(highlight.classList.contains('is-visible')).toBe(true);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    expect(highlight.classList.contains('is-visible')).toBe(false);
    handle.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(highlight.classList.contains('is-visible')).toBe(true);
    view.dispatch({ changes: { from: 0, to: 5, insert: 'Changed' } });
    expect(highlight.classList.contains('is-visible')).toBe(false);
    expect(handle.getAttribute('aria-pressed')).toBe('false');
    view.destroy();
    views.splice(views.indexOf(view), 1);
    expect(document.querySelector('.blocks-selection-highlight')).toBeNull();
  });

  it('keeps the controls beside centered text as its position changes', async () => {
    const view = editor();
    let left = 310;
    vi.spyOn(view, 'coordsAtPos').mockImplementation(() => ({ left, right: left, top: 4, bottom: 24 }));
    await hover(view, 330);
    const controls = view.dom.querySelector<HTMLElement>('.blocks-controls')!;
    expect(controls.classList.contains('is-visible')).toBe(true);
    expect(Number.parseFloat(controls.style.left) + 100 + 50).toBe(left - 4);
    left = 430;
    view.scrollDOM.dispatchEvent(new Event('scroll'));
    await hover(view, 450);
    expect(Number.parseFloat(controls.style.left) + 100 + 50).toBe(left - 4);
  });
  it('uses the rendered block position when text coordinates are unavailable', async () => {
    const view = editor();
    vi.spyOn(view, 'coordsAtPos').mockReturnValue(null);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      return this.classList.contains('cm-line')
        ? { ...rectangle(), x: 310, left: 310, right: 700, width: 390, height: 20, bottom: 20 }
        : rectangle();
    });
    await hover(view, 330);
    const controls = view.dom.querySelector<HTMLElement>('.blocks-controls')!;
    expect(controls.classList.contains('is-visible')).toBe(true);
    expect(Number.parseFloat(controls.style.left) + 100 + 50).toBe(306);
  });
  it('creates one control pair per editor and removes it on unload', () => {
    const first = editor();
    const second = editor();
    expect(document.querySelectorAll('.blocks-controls')).toHaveLength(2);
    expect(first.dom.querySelectorAll('.blocks-controls button')).toHaveLength(2);
    first.destroy();
    views.splice(views.indexOf(first), 1);
    expect(document.querySelectorAll('.blocks-controls')).toHaveLength(1);
    expect(second.dom.classList.contains('blocks-editor')).toBe(true);
    expect(first.dom.classList.contains('blocks-editor')).toBe(false);
  });
  it('shows the controls on hover, inserts below, and puts the cursor in the empty block', async () => {
    const view = editor();
    await hover(view);
    expect(view.dom.querySelector('.blocks-controls')!.classList.contains('is-visible')).toBe(true);
    view.dom.querySelector<HTMLButtonElement>('.blocks-plus')!.click();
    expect(view.state.doc.toString()).toBe('First\n\n\n\nSecond');
    expect(view.state.selection.main.head).toBe(7);
  });
  it('uses Option-click to insert above the hovered block', async () => {
    const view = editor();
    await hover(view);
    view.dom.querySelector('.blocks-plus')!.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
    expect(view.state.doc.toString()).toBe('\n\nFirst\n\nSecond');
    expect(view.state.selection.main.head).toBe(0);
  });
  it('does not permit insertion in a read-only editor', async () => {
    const view = editor('Read only', true);
    await hover(view);
    expect(view.dom.querySelector('.blocks-controls')!.classList.contains('is-visible')).toBe(false);
    view.dom.querySelector<HTMLButtonElement>('.blocks-plus')!.click();
    expect(view.state.doc.toString()).toBe('Read only');
  });
  it('moves a hovered block by keyboard and clears stale offsets after outside edits', async () => {
    const view = editor();
    await hover(view);
    view.dom.querySelector('.blocks-handle')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    expect(view.state.doc.toString()).toBe('Second\n\nFirst');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Replacement' } });
    view.dom.querySelector<HTMLButtonElement>('.blocks-plus')!.click();
    expect(view.state.doc.toString()).toBe('Replacement');
  });
  it('previews a drag without writing the note and commits only on release', async () => {
    const view = editor();
    await hover(view);
    const handle = view.dom.querySelector('.blocks-handle')!;
    const top = view.documentTop + view.lineBlockAt(0).top + 1;
    const bottom = view.documentTop + view.lineBlockAt(view.state.doc.length).bottom + 10;
    pointer(handle, 'pointerdown', top);
    pointer(handle, 'pointermove', bottom);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(document.querySelector('.blocks-drag-ghost')).not.toBeNull();
    expect(view.state.doc.toString()).toBe('First\n\nSecond');
    pointer(handle, 'pointerup', bottom);
    expect(view.state.doc.toString()).toBe('Second\n\nFirst');
    expect(document.querySelector('.blocks-drag-ghost')).toBeNull();
  });
  it('starts the dragged copy at the centered block and follows pointer movement', async () => {
    const view = editor();
    vi.spyOn(view, 'coordsAtPos').mockReturnValue({ left: 310, right: 310, top: 4, bottom: 24 });
    await hover(view, 330);
    const handle = view.dom.querySelector('.blocks-handle')!;
    const top = view.documentTop + view.lineBlockAt(0).top + 1;
    pointer(handle, 'pointerdown', top, 290);
    pointer(handle, 'pointermove', top + 10, 295);
    const ghost = document.querySelector<HTMLElement>('.blocks-drag-ghost')!;
    expect(ghost.style.transform).toContain('translate3d(315px,');
  });
  it('selects on a handle click without changing the editor selection during a drag', async () => {
    const view = editor();
    await hover(view);
    const handle = view.dom.querySelector('.blocks-handle')!;
    const top = view.documentTop + view.lineBlockAt(0).top + 1;
    const selection = view.state.selection;
    pointer(handle, 'pointerdown', top);
    pointer(handle, 'pointermove', top + 10);
    expect(view.state.selection.eq(selection)).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await hover(view);
    pointer(handle, 'pointerdown', top);
    pointer(handle, 'pointerup', top);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(5);
  });
  it('retains neighbor transforms without resetting them during repeated layout measurements', async () => {
    const view = editor();
    await hover(view);
    let request: Parameters<EditorView['requestMeasure']>[0];
    vi.spyOn(view, 'requestMeasure').mockImplementation(value => { if (value?.key) request = value; });
    const handle = view.dom.querySelector('.blocks-handle')!;
    const top = view.documentTop + view.lineBlockAt(0).top + 1;
    const bottom = view.documentTop + view.lineBlockAt(view.state.doc.length).bottom + 10;
    pointer(handle, 'pointerdown', top);
    pointer(handle, 'pointermove', bottom);
    await new Promise(resolve => setTimeout(resolve, 40));
    const observed: MutationRecord[] = [];
    const observer = new MutationObserver(records => observed.push(...records));
    observer.observe(view.contentDOM, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
    for (let i = 0; i < 3; i++) {
      view.scrollDOM.dispatchEvent(new Event('scroll'));
      expect(request).toBeDefined();
      const measured = request!.read(view);
      request!.write!(measured, view);
    }
    observed.push(...observer.takeRecords());
    observer.disconnect();
    expect(observed.filter(record => (record.target as HTMLElement).classList.contains('cm-line'))).toHaveLength(0);
  });
  it('uses one frame without layout reads when the pointer moves away from the scroll edges', async () => {
    const view = editor();
    await hover(view);
    vi.spyOn(view, 'requestMeasure').mockImplementation(() => {});
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const handle = view.dom.querySelector('.blocks-handle')!;
    const top = view.documentTop + view.lineBlockAt(0).top + 1;
    const bottom = view.documentTop + view.lineBlockAt(view.state.doc.length).bottom + 10;
    pointer(handle, 'pointerdown', top);
    pointer(handle, 'pointermove', bottom);
    for (const element of [view.contentDOM, view.scrollDOM, view.dom]) element.getBoundingClientRect = () => rectangle();
    const contentReads = vi.spyOn(view.contentDOM, 'getBoundingClientRect');
    const viewportReads = vi.spyOn(view.scrollDOM, 'getBoundingClientRect');
    const editorReads = vi.spyOn(view.dom, 'getBoundingClientRect');
    expect(frames).toHaveLength(1);
    frames.shift()!(0);
    expect.soft(contentReads.mock.calls.length).toBe(0);
    expect.soft(viewportReads.mock.calls.length).toBe(0);
    expect.soft(editorReads.mock.calls.length).toBe(0);
    expect.soft(frames).toHaveLength(0);
  });
  it('keeps a drop position stable when the pointer jitters around a block midpoint', async () => {
    const view = editor();
    await hover(view);
    vi.spyOn(view, 'requestMeasure').mockImplementation(() => {});
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const handle = view.dom.querySelector('.blocks-handle')!;
    const first = view.lineBlockAt(0);
    const second = view.lineBlockAt(view.state.doc.length);
    const midpoint = view.documentTop + (second.top + second.bottom) / 2;
    pointer(handle, 'pointerdown', view.documentTop + first.top + 1);
    pointer(handle, 'pointermove', midpoint + 8);
    frames.shift()!(0);
    const neighbor = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')[2];
    const shifted = neighbor.style.translate;
    expect(shifted).not.toBe('0px 0px');
    pointer(handle, 'pointermove', midpoint - 1);
    frames.shift()!(16);
    expect(neighbor.style.translate).toBe(shifted);
    pointer(handle, 'pointermove', midpoint - 8);
    frames.shift()!(32);
    expect(neighbor.style.translate).toBe('0px 0px');
  });
  it('continues edge scrolling and stops when the scroll limit is reached', async () => {
    const view = editor();
    await hover(view);
    vi.spyOn(view, 'requestMeasure').mockImplementation(() => {});
    Object.defineProperty(view.scrollDOM, 'scrollHeight', { value: 600, configurable: true });
    Object.defineProperty(view.scrollDOM, 'clientHeight', { value: 400, configurable: true });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const handle = view.dom.querySelector('.blocks-handle')!;
    pointer(handle, 'pointerdown', view.documentTop + view.lineBlockAt(0).top + 1);
    pointer(handle, 'pointermove', 390);
    frames.shift()!(0);
    expect(view.scrollDOM.scrollTop).toBeGreaterThan(0);
    expect(frames).toHaveLength(1);
    view.scrollDOM.scrollTop = 198;
    frames.shift()!(16);
    expect(view.scrollDOM.scrollTop).toBe(200);
    frames.shift()!(32);
    expect(view.scrollDOM.scrollTop).toBe(200);
    expect(frames).toHaveLength(0);
  });
  it('cancels a drag on Escape and discards its offsets after an external edit', async () => {
    const view = editor();
    await hover(view);
    const handle = view.dom.querySelector('.blocks-handle')!;
    const top = view.documentTop + view.lineBlockAt(0).top + 1;
    pointer(handle, 'pointerdown', top);
    pointer(handle, 'pointermove', top + 50);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(view.state.doc.toString()).toBe('First\n\nSecond');
    expect(document.querySelector('.blocks-drag-ghost')).toBeNull();
    await hover(view);
    pointer(handle, 'pointerdown', top);
    pointer(handle, 'pointermove', top + 50);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Externally changed' } });
    pointer(handle, 'pointerup', top + 50);
    expect(view.state.doc.toString()).toBe('Externally changed');
    expect(document.querySelector('.blocks-drag-ghost')).toBeNull();
  });
});
