// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, Scope as ObsidianScope } from 'obsidian';
vi.mock('obsidian', () => ({ Scope: class {
  keys: { modifiers: string[] | null; key: string | null; func: (event: KeyboardEvent) => boolean | undefined }[] = [];
  constructor(public parent?: { handleKey(event: KeyboardEvent): boolean | undefined }) {}
  register(modifiers: string[] | null, key: string | null, func: (event: KeyboardEvent) => boolean | undefined) { this.keys.push({ modifiers, key, func }); }
  handleKey(event: KeyboardEvent): boolean | undefined {
    const modifiers = [event.altKey && 'Alt', event.ctrlKey && 'Ctrl', event.metaKey && 'Meta', event.shiftKey && 'Shift'].filter(Boolean).sort().join(',');
    for (const binding of this.keys) {
      if (binding.key !== null && binding.key !== event.key || binding.modifiers !== null && [...binding.modifiers].sort().join(',') !== modifiers) continue;
      const result = binding.func(event);
      if (result !== undefined || binding.key !== null || binding.modifiers !== null) return result;
    }
    return this.parent?.handleKey(event);
  }
} }));
const { Scope } = await vi.importMock<typeof import('obsidian')>('obsidian');
type Scope = ObsidianScope;
import { BlockKeyboardScope } from '../src/keyboard-scope';
import { ReadingControls } from '../src/reading';

type RuntimeScope = Scope & { handleKey(event: KeyboardEvent): boolean | undefined };
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); document.body.replaceChildren(); vi.restoreAllMocks(); });
function dispatcher() {
  const parent = new Scope() as RuntimeScope;
  const shortcut = vi.fn(() => false as const); parent.register(['Alt'], 'ArrowUp', shortcut);
  const other = vi.fn(() => false as const); parent.register(['Mod'], 'K', other);
  const stack: Scope[] = [parent];
  const keymap = {
    pushScope: vi.fn((scope: Scope) => { if (stack.at(-1) !== scope) stack.push(scope); }),
    popScope: vi.fn((scope: Scope) => { const index = stack.indexOf(scope); if (index > 0) stack.splice(index, 1); }),
  };
  // Obsidian's shortcut dispatcher is registered on window before plugins load.
  const native = (event: KeyboardEvent) => {
    if ((stack.at(-1) as RuntimeScope).handleKey(event) === false) { event.preventDefault(); event.stopPropagation(); }
  };
  window.addEventListener('keydown', native, true); cleanup.push(() => window.removeEventListener('keydown', native, true));
  return { parent, shortcut, other, stack, keymap, app: { keymap } as unknown as App };
}
function key(target: HTMLElement, name = 'ArrowUp', altKey = true) {
  return target.dispatchEvent(new KeyboardEvent('keydown', { key: name, altKey, bubbles: true, cancelable: true }));
}
describe('Obsidian selected-block keyboard scope', () => {
  it('takes priority inside the earlier window dispatcher and restores parent hotkeys on deselection', () => {
    const host = dispatcher(); const root = document.createElement('div'); const handle = document.createElement('button'); root.append(handle); document.body.append(root);
    let selected = true;
    const navigate = vi.fn((event: KeyboardEvent) => { event.preventDefault(); return true; });
    const scope = new BlockKeyboardScope(host.app, root, navigate, () => selected, host.parent, parent => new Scope(parent)); cleanup.push(() => scope.destroy());
    handle.focus(); scope.sync();
    key(handle); key(handle, 'ArrowDown');
    expect(navigate).toHaveBeenCalledTimes(2); expect(host.shortcut).not.toHaveBeenCalled();
    selected = false; scope.sync(); key(handle);
    expect(host.shortcut).toHaveBeenCalledOnce(); expect(host.stack).toEqual([host.parent]);
  });
  it('delegates other keys and disabled Option navigation without suppressing parent shortcuts', () => {
    const host = dispatcher(); const root = document.createElement('div'); const handle = document.createElement('button'); root.append(handle); document.body.append(root);
    let enabled = true;
    const navigate = vi.fn((event: KeyboardEvent) => { event.preventDefault(); return true; });
    const scope = new BlockKeyboardScope(host.app, root, navigate, () => enabled, host.parent, parent => new Scope(parent)); cleanup.push(() => scope.destroy());
    handle.focus(); scope.sync();
    const fallback = vi.fn(() => false as const); host.parent.register([], 'Escape', fallback);
    key(handle, 'Escape', false); expect(fallback).toHaveBeenCalledOnce(); expect(navigate).not.toHaveBeenCalled();
    enabled = false; key(handle); expect(host.shortcut).toHaveBeenCalledOnce(); expect(navigate).not.toHaveBeenCalled();
    scope.sync(); expect(host.stack).toEqual([host.parent]);
  });
  it('releases the scope on external focus, window blur, and disposal without disturbing a modal scope', () => {
    const host = dispatcher(); const root = document.createElement('div'); const handle = document.createElement('button'); root.append(handle); document.body.append(root);
    const outside = document.createElement('input'); document.body.append(outside);
    const scope = new BlockKeyboardScope(host.app, root, () => true, () => true, host.parent, parent => new Scope(parent)); cleanup.push(() => scope.destroy());
    handle.focus(); scope.sync(); outside.focus(); expect(host.stack).toEqual([host.parent]);
    key(outside); expect(host.shortcut).toHaveBeenCalledOnce();
    handle.focus(); window.dispatchEvent(new Event('blur')); expect(host.stack).toEqual([host.parent]);
    window.dispatchEvent(new Event('focus')); expect(host.stack.length).toBe(2);
    const modal = new Scope(host.parent); host.keymap.pushScope(modal);
    scope.destroy(); expect(host.stack).toEqual([host.parent, modal]);
  });
  it('navigates actual Reading controls when the conflicting shortcut runs at window capture before Blocks listeners', () => {
    const host = dispatcher(); const source = 'First\n\nSecond';
    const root = document.createElement('div'); root.innerHTML = '<div class="markdown-preview-section"><div><p>First</p></div><div><p>Second</p></div></div>'; document.body.append(root);
    const rect = (top: number) => ({ top, bottom: top + 30, left: 0, right: 400, height: 30, width: 400 } as DOMRect);
    root.getBoundingClientRect = () => rect(0);
    const sections = [...root.firstElementChild!.children] as HTMLElement[];
    sections.forEach((section, i) => { section.getBoundingClientRect = () => rect(i * 50); (section.firstElementChild as HTMLElement).getBoundingClientRect = () => rect(i * 50); });
    const apply = vi.fn(async () => true);
    const controller = new ReadingControls(root, {
      read: () => source, active: () => true, clickToEdit: () => true, open: vi.fn(async () => true), apply, report: vi.fn(),
      keyboardScope: (element, handle, selected) => new BlockKeyboardScope(host.app, element, handle, selected, host.parent, parent => new Scope(parent)),
    }); cleanup.push(() => controller.destroy());
    sections.forEach((section, i) => controller.addSection(section, () => ({ text: source, lineStart: i * 2, lineEnd: i * 2 })));
    controller.refresh(); sections[1].querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const handle = root.querySelector<HTMLElement>('.blocks-handle')!;
    expect(root.querySelector<HTMLElement>('.blocks-controls')!.style.top).toBe('50px');
    key(handle); expect(root.querySelector<HTMLElement>('.blocks-controls')!.style.top).toBe('0px');
    key(handle, 'ArrowDown'); expect(root.querySelector<HTMLElement>('.blocks-controls')!.style.top).toBe('50px');
    expect(host.shortcut).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  });
});
