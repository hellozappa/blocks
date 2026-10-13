// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ReadingControls, SectionInfo } from '../src/reading';
import { Edit } from '../src/blocks';

const controllers: ReadingControls[] = [];
afterEach(() => { controllers.splice(0).forEach(c => c.destroy()); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const rect = (top: number, height = 30) => ({ x: 200, y: top, top, bottom: top + height, left: 200, right: 600, width: 400, height, toJSON() {} } as DOMRect);
function fixture(initial = 'First\n\nSecond', markup = ['<p>First</p>', '<p>Second</p>'], lines = [0, 2]) {
  let text = initial;
  let active = true;
  let clickToEdit = true;
  let cursorPlacement: 'click' | 'start' | 'end' = 'click';
  const root = document.createElement('div'); root.className = 'markdown-preview-view';
  root.innerHTML = '<div class="markdown-preview-section"></div>';
  document.body.append(root);
  root.getBoundingClientRect = () => ({ ...rect(0, 400), left: 100, right: 700, width: 600 });
  const section = root.firstElementChild!;
  const elements = markup.map((html, i) => {
    const el = document.createElement('div'); el.innerHTML = html; el.getBoundingClientRect = () => rect(20 + i * 80);
    for (const child of el.children) (child as HTMLElement).getBoundingClientRect = () => el.getBoundingClientRect();
    section.append(el); return el;
  });
  const captures = new WeakMap<HTMLElement, number>();
  HTMLElement.prototype.setPointerCapture = function(id) { captures.set(this, id); };
  HTMLElement.prototype.hasPointerCapture = function(id) { return captures.get(this) === id; };
  HTMLElement.prototype.releasePointerCapture = function() { captures.delete(this); };
  const apply = vi.fn(async (edit: Edit, snapshot: string, livePreview: boolean) => {
    if (snapshot !== text) return false;
    text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
    if (livePreview) active = false;
    return true;
  });
  const report = vi.fn();
  const open = vi.fn(async (_offset: number, _snapshot: string) => { active = false; return true; });
  const controller = new ReadingControls(root, { clickToEdit: () => clickToEdit, cursorPlacement: () => cursorPlacement, open, read: () => text, active: () => active, apply, report });
  controllers.push(controller);
  elements.forEach((el, i) => controller.addSection(el, () => ({ text: initial, lineStart: lines[i], lineEnd: lines[i] })));
  controller.refresh();
  const handle = root.querySelector<HTMLElement>('.blocks-handle')!;
  const plus = root.querySelector<HTMLButtonElement>('.blocks-plus')!;
  const controls = root.querySelector<HTMLElement>('.blocks-controls')!;
  const hover = (y = 25, x = 210) => root.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
  const pointer = (type: string, y: number, x = 180) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 1 }); handle.dispatchEvent(event);
  };
  return { setCursorPlacement: (value: typeof cursorPlacement) => { cursorPlacement = value; }, open, setClickToEdit: (value: boolean) => { clickToEdit = value; }, root, elements, controller, handle, plus, controls, hover, pointer, apply, report, text: () => text, setText: (next: string) => { text = next; }, setActive: (next: boolean) => { active = next; } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

describe('Reading view controls', () => {
  it('selects on first content click and opens Live Preview on the second click of the same block', async () => {
    const f = fixture();
    const click = (index: number) => {
      const paragraph = f.elements[index].querySelector('p')!;
      paragraph.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    };
    click(0);
    expect(f.root.querySelector('.blocks-selection-highlight')!.classList.contains('is-visible')).toBe(true);
    expect(f.handle.getAttribute('aria-pressed')).toBe('true');
    expect(f.open).not.toHaveBeenCalled();
    click(1);
    expect(f.open).not.toHaveBeenCalled();
    click(1); await settle();
    expect(f.open).toHaveBeenCalledExactlyOnceWith(7, 'First\n\nSecond', undefined);
    expect(f.apply).not.toHaveBeenCalled(); expect(f.text()).toBe('First\n\nSecond');
  });
  it.each(['click', 'start', 'end'] as const)('uses the %s cursor placement on the second click', async placement => {
    const f = fixture(); f.setCursorPlacement(placement);
    const paragraph = f.elements[1].querySelector('p')!;
    const range = document.createRange(); range.setStart(paragraph.firstChild!, 3); range.collapse(true);
    const hit = vi.fn(() => range);
    Object.defineProperty(document, 'caretRangeFromPoint', { value: hit, configurable: true });
    try {
      paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 320, clientY: 110 }));
      expect(f.open).not.toHaveBeenCalled();
      paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 350, clientY: 110 }));
      await settle();
      expect(f.open).toHaveBeenCalledExactlyOnceWith(placement === 'click' ? 10 : placement === 'start' ? 7 : 13, 'First\n\nSecond', undefined);
      if (placement === 'click') expect(hit).toHaveBeenCalledWith(350, 110);
      else expect(hit).not.toHaveBeenCalled();
      expect(f.apply).not.toHaveBeenCalled();
    } finally { Reflect.deleteProperty(document, 'caretRangeFromPoint'); }
  });
  it('honors the live toggle and preserves link, checkbox, modified-click, and text-selection behavior', () => {
    const f = fixture('First\n\nSecond', ['<p>First <a href="https://example.com">link</a><input type="checkbox"></p>', '<p>Second</p>']);
    const click = (target: Element, options = {}) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
    expect(click(f.elements[0].querySelector('a')!)).toBe(true);
    expect(click(f.elements[0].querySelector('input')!)).toBe(true);
    expect(click(f.elements[1].querySelector('p')!, { metaKey: true })).toBe(true);
    const range = document.createRange(); const text = f.elements[1].querySelector('p')!.firstChild!;
    range.setStart(text, 0); range.setEnd(text, 3); document.getSelection()!.addRange(range);
    expect(click(f.elements[1].querySelector('p')!)).toBe(true);
    document.getSelection()!.removeAllRanges();
    f.setClickToEdit(false);
    expect(click(f.elements[1].querySelector('p')!)).toBe(true);
    expect(f.open).not.toHaveBeenCalled(); expect(f.handle.getAttribute('aria-pressed')).toBe('false');
    f.setClickToEdit(true);
    expect(click(f.elements[1].querySelector('p')!)).toBe(false);
    expect(f.handle.getAttribute('aria-pressed')).toBe('true');
    expect(f.open).not.toHaveBeenCalled();
  });
  it('replaces Reading text selection paint with the containing block background', () => {
    const f = fixture();
    const text = f.elements[0].querySelector('p')!.firstChild!;
    const range = document.createRange(); range.setStart(text, 1); range.setEnd(text, 4);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    const highlight = f.root.querySelector<HTMLElement>('.blocks-selection-highlight')!;
    expect(f.root.classList.contains('blocks-text-selected')).toBe(true);
    expect(highlight.classList.contains('is-visible')).toBe(true);
    expect(highlight.style.top).toBe('20px'); expect(highlight.style.height).toBe('30px');
    expect(selection.toString()).toBe('irs');
    selection.removeAllRanges(); document.dispatchEvent(new Event('selectionchange'));
    expect(f.root.classList.contains('blocks-text-selected')).toBe(false);
    expect(highlight.classList.contains('is-visible')).toBe(false);
    expect(f.apply).not.toHaveBeenCalled();
  });
  it('anchors to the visible paragraph inside its wrapper and remains aligned after scrolling', () => {
    const f = fixture();
    const paragraph = f.elements[0].firstElementChild as HTMLElement;
    let top = 45;
    paragraph.getBoundingClientRect = () => rect(top);
    Object.defineProperty(f.root, 'clientTop', { value: 2 });
    f.controller.refresh(); f.hover(50);
    expect(f.controls.style.top).toBe('43px');
    f.pointer('pointerdown', 50); f.pointer('pointerup', 50);
    top = 25; f.root.scrollTop = 20;
    f.root.dispatchEvent(new Event('scroll'));
    expect(f.controls.style.top).toBe('43px');
    expect(f.handle.getAttribute('aria-pressed')).toBe('true');
  });
  it('remeasures and keeps selection anchored when only frontmatter changes', () => {
    const initial = '---\nmodified: old\n---\n\nFirst\n\nSecond';
    const next = '---\nmodified: a newer timestamp\n---\n\nFirst\n\nSecond';
    const f = fixture(initial, undefined, [4, 6]);
    f.hover(); f.pointer('pointerdown', 25); f.pointer('pointerup', 25);
    f.setText(next);
    f.elements.forEach((el, i) => {
      f.controller.addSection(el, () => ({ text: next, lineStart: 4 + i * 2, lineEnd: 4 + i * 2 }));
      (el.firstElementChild as HTMLElement).getBoundingClientRect = () => rect(60 + i * 80);
    });
    f.controller.refresh();
    expect(f.controls.style.top).toBe('60px');
    expect(f.controls.classList.contains('is-visible')).toBe(true);
    expect(f.handle.getAttribute('aria-pressed')).toBe('true');
    expect(f.root.querySelector<HTMLElement>('.blocks-selection-highlight')!.style.top).toBe('60px');
  });
  it('shows controls over paragraphs and their left margin without tooltip triggers', () => {
    const f = fixture();
    f.hover();
    expect(f.controls.classList.contains('is-visible')).toBe(true);
    expect(f.controls.style.top).toBe('20px');
    expect(f.controls.style.left).toBe('46px');
    f.hover(105, 160);
    expect(f.controls.style.top).toBe('100px');
    expect(f.controls.querySelector('[title], [aria-label]')).toBeNull();
    expect(f.controls.hasAttribute('aria-label')).toBe(false);
    expect(f.handle.getAttribute('aria-labelledby')).toBeTruthy();
  });
  it.each([['theme-light', 'rgb(242, 242, 242)'], ['theme-dark', 'rgb(68, 68, 68)']])('keeps selected controls visible with the exact %s handle background', (theme, expected) => {
    const style = document.createElement('style'); style.textContent = readFileSync('styles.css', 'utf8'); document.body.append(style);
    const f = fixture(); f.root.classList.add(theme);
    f.hover(); f.pointer('pointerdown', 25); f.pointer('pointerup', 25);
    f.handle.dispatchEvent(new Event('lostpointercapture')); f.root.dispatchEvent(new Event('pointerleave'));
    expect(f.controls.classList.contains('is-visible')).toBe(true);
    expect(f.handle.getAttribute('aria-pressed')).toBe('true');
    expect(window.getComputedStyle(f.handle).backgroundColor).toBe(expected);
    expect(f.root.querySelector('.blocks-selection-highlight')!.classList.contains('is-visible')).toBe(true);
    expect(f.apply).not.toHaveBeenCalled();
  });
  it.each([false, true])('plus inserts a blank block and requests Live Preview, above=%s', async above => {
    const f = fixture(); f.hover();
    f.plus.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: above }));
    await settle();
    expect(f.apply).toHaveBeenCalledTimes(1);
    expect(f.apply.mock.calls[0][2]).toBe(true);
    expect(f.text()).toBe(above ? '\n\nFirst\n\nSecond' : 'First\n\n\n\nSecond');
    expect(f.apply.mock.calls[0][0].cursor).toBe(above ? 0 : 7);
  });
  it('previews an image drag, commits only on drop, and stays in Reading view', async () => {
    const f = fixture('![[Photo.png]]\n\nSecond', ['<p><img src="photo.png"></p>', '<p>Second</p>']);
    f.hover(); f.pointer('pointerdown', 25); f.pointer('pointermove', 160);
    expect(document.querySelector('.blocks-drag-ghost img')).not.toBeNull();
    expect(f.controls.style.top).toBe('155px');
    expect(f.apply).not.toHaveBeenCalled();
    f.pointer('pointerup', 160); await settle();
    expect(f.text()).toBe('Second\n\n![[Photo.png]]');
    expect(f.apply.mock.calls[0][2]).toBe(false);
    expect(document.querySelector('.blocks-drag-ghost')).toBeNull();
  });
  it('cancels stale drags without overwriting an external edit', async () => {
    const f = fixture(); f.hover(); f.pointer('pointerdown', 25); f.pointer('pointermove', 160);
    f.setText('Externally changed'); f.pointer('pointerup', 160); await settle();
    expect(f.text()).toBe('Externally changed'); expect(f.apply).not.toHaveBeenCalled();
    expect(document.querySelector('.blocks-drag-ghost')).toBeNull();
  });
  it('cancels on Escape and supports keyboard movement', async () => {
    const f = fixture(); f.hover(); f.pointer('pointerdown', 25); f.pointer('pointermove', 160);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.blocks-drag-ghost')).toBeNull(); expect(f.apply).not.toHaveBeenCalled();
    f.hover(); f.handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await settle();
    expect(f.text()).toBe('Second\n\nFirst');
  });
  it('maps top-level list items separately without splitting nested children', async () => {
    const text = '- First\n  - Child\n- Second';
    const f = fixture(text, ['<ul><li>First<ul><li>Child</li></ul></li><li>Second</li></ul>'], [0]);
    const info: SectionInfo = { text, lineStart: 0, lineEnd: 2 };
    const items = [...f.elements[0].querySelectorAll(':scope > ul > li')] as HTMLElement[];
    items.forEach((el, i) => { el.getBoundingClientRect = () => rect(20 + i * 80); });
    f.controller.addSection(f.elements[0], () => info); f.controller.refresh();
    f.hover(); f.handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await settle();
    expect(f.text()).toBe('- Second\n- First\n  - Child');
  });
  it('creates selectable targets for an empty note and interior blank blocks', () => {
    for (const initial of ['', 'First\n\n\n\nSecond']) {
      const empty = initial === '';
      const f = fixture(initial, empty ? [] : undefined, empty ? [] : [0, 4]);
      const blank = f.root.querySelector<HTMLElement>('.blocks-reading-empty')!;
      expect(blank).not.toBeNull(); blank.getBoundingClientRect = () => rect(60, 24);
      f.controller.refresh(); f.hover(65); f.pointer('pointerdown', 65); f.pointer('pointerup', 65);
      expect(f.handle.getAttribute('aria-pressed')).toBe('true');
      expect(f.root.querySelector('.blocks-selection-highlight')!.classList.contains('is-visible')).toBe(true);
    }
  });
  it('ignores stale rendered section offsets and removes controls on teardown', () => {
    const f = fixture(); f.setText('New source'); f.controller.refresh(); f.hover();
    expect(f.controls.classList.contains('is-visible')).toBe(false);
    f.controller.destroy();
    expect(f.root.querySelector('.blocks-controls')).toBeNull();
    expect(f.root.classList.contains('blocks-reading')).toBe(false);
  });
  it('reports failed writes and allows retry', async () => {
    const f = fixture(); f.apply.mockRejectedValueOnce(new Error('write failed')); f.hover(); f.plus.click(); await settle();
    expect(f.report).toHaveBeenCalledTimes(1); expect(f.text()).toBe('First\n\nSecond');
    f.plus.click(); await settle(); expect(f.apply).toHaveBeenCalledTimes(2);
  });
});
