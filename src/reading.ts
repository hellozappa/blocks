import { Block, Edit, bodyStart, insertBlock, moveBlock, parseBlocks } from './blocks';
import { createControls } from './controls';
import type { KeyboardScopeControl, KeyboardScopeFactory } from './keyboard-scope';
import { readingClickPosition, type CursorPlacement } from './reading-cursor';

export interface ReadingHost {
  keyboardScope?: KeyboardScopeFactory;
  sectionInfo?(element: HTMLElement): SectionInfo | null;
  highlightColor?(): string;
  clickToEdit?(): boolean;
  cursorPlacement?(): CursorPlacement;
  optionArrowSelection?(): boolean;
  open?(offset: number, snapshot: string, screenTop?: number): Promise<boolean>;
  read(): string;
  active(): boolean;
  apply(edit: Edit, snapshot: string, livePreview: boolean): Promise<boolean>;
  report(error: unknown): void;
}
export interface SectionInfo { text: string; lineStart: number; lineEnd: number }
interface Geometry { block: Block; index: number; elements: HTMLElement[]; top: number; bottom: number; left: number; right: number }
interface Drag { pointer: number; source: number; slot: number; snapshot: string; x: number; y: number; startX: number; startY: number; offset: number; left: number; active: boolean; ghost?: HTMLElement }

export class ReadingControls {
  private source = '';
  private initialized = false;
  private blocks: Block[] = [];
  private geometry: Geometry[] = [];
  private sections = new Map<HTMLElement, () => SectionInfo | null>();
  private sectionInfo?: (element: HTMLElement) => SectionInfo | null;
  private blanks = new Map<number, HTMLElement>();
  private selected?: number;
  private selectionAfterEdit?: { source: string; from: number };
  private selectionPreview?: { from: number; elements: HTMLElement[]; text: (string | null)[] };
  private hovered?: number;
  private drag?: Drag;
  private frame = 0;
  private pending = false;
  private destroyed = false;
  private keyboardScope?: KeyboardScopeControl;
  private readonly controls: HTMLElement;
  private readonly plus: HTMLButtonElement;
  private readonly handle: HTMLButtonElement;
  private readonly highlight: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly win: Window;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly root: HTMLElement, private readonly host: ReadingHost) {
    this.win = root.ownerDocument.defaultView!;
    this.sectionInfo = host.sectionInfo;
    const buttons = createControls(root.ownerDocument);
    this.controls = buttons.controls; this.plus = buttons.plus; this.handle = buttons.handle;
    this.highlight = root.ownerDocument.createElement('div');
    this.highlight.className = 'blocks-selection-highlight';
    this.highlight.setAttribute('aria-hidden', 'true');
    this.marker = root.ownerDocument.createElement('div');
    this.marker.className = 'blocks-drop-marker';
    this.marker.setAttribute('aria-hidden', 'true');
    root.classList.add('blocks-reading');
    root.append(this.highlight, this.controls, this.marker);
    this.listen(root, 'pointermove', event => this.hover(event as PointerEvent));
    this.listen(root, 'pointerleave', () => { if (!this.drag && this.selected === undefined) this.hide(); });
    this.listen(root, 'pointerdown', event => {
      if (!this.controls.contains(event.target as Node) && !this.clickTarget(event as MouseEvent)) { this.selected = undefined; this.selectionAfterEdit = undefined; this.selectionPreview = undefined; this.paintSelection(); }
    });
    this.listen(root, 'click', event => this.click(event as MouseEvent), true);
    this.listen(root.ownerDocument, 'selectionchange', () => this.paintSelection());
    const observer = new root.ownerDocument.defaultView!.MutationObserver(() => this.schedule());
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    this.cleanup.push(() => observer.disconnect());
    this.listen(root, 'scroll', () => this.refresh());
    this.listen(root, 'load', () => this.schedule(), true);
    this.listen(this.plus, 'pointerdown', event => event.preventDefault());
    this.listen(this.plus, 'click', event => {
      const block = this.blocks[this.hovered ?? -1];
      if (block && !this.pending) void this.commit(insertBlock(this.source, block, (event as MouseEvent).altKey), true);
    });
    this.listen(this.handle, 'pointerdown', event => this.begin(event as PointerEvent));
    this.listen(this.handle, 'pointermove', event => this.move(event as PointerEvent));
    this.listen(this.handle, 'pointerup', event => this.finish(event as PointerEvent));
    this.listen(this.handle, 'lostpointercapture', () => { if (this.drag) this.cancel(); });
    this.listen(this.handle, 'pointercancel', () => this.cancel());
    this.listen(this.handle, 'keydown', event => this.keyboard(event as KeyboardEvent));
    this.listen(this.win, 'keydown', event => {
      const key = event as KeyboardEvent;
      if (key.defaultPrevented || key.isComposing || !key.altKey || key.ctrlKey || key.metaKey || key.shiftKey
        || (key.key !== 'ArrowUp' && key.key !== 'ArrowDown') || this.selected === undefined
        || this.host.optionArrowSelection?.() === false || !this.host.active()
        || !this.root.contains(this.root.ownerDocument.activeElement)) return;
      this.keyboard(key);
    }, true);
    this.listen(this.win, 'keydown', event => {
      if ((event as KeyboardEvent).key !== 'Escape' || event.defaultPrevented || !this.host.active()
        || !this.root.contains(this.root.ownerDocument.activeElement) || (!this.drag && this.selected === undefined)) return;
      event.preventDefault(); event.stopPropagation();
      this.cancel(); this.selected = undefined; this.selectionAfterEdit = undefined; this.selectionPreview = undefined; this.paintSelection(); this.hide();
    }, true);
    this.listen(this.win, 'blur', () => this.cancel());
    this.listen(this.win, 'resize', () => this.schedule());
    this.keyboardScope = host.keyboardScope?.(root, event => { this.keyboard(event); return event.defaultPrevented; },
      () => !this.destroyed && !this.pending && this.selected !== undefined && this.host.active() && this.host.optionArrowSelection?.() !== false);
    this.schedule();
  }

  private listen(target: EventTarget, type: string, callback: EventListener, capture = false): void {
    target.addEventListener(type, callback, capture);
    this.cleanup.push(() => target.removeEventListener(type, callback, capture));
  }

  addSection(element: HTMLElement, info: () => SectionInfo | null, sectionInfo?: (element: HTMLElement) => SectionInfo | null): void {
    if (sectionInfo) this.sectionInfo = sectionInfo;
    this.sections.set(element, info);
    this.schedule();
  }

  private schedule(): void {
    if (!this.destroyed && !this.frame) this.frame = this.win.requestAnimationFrame(() => { this.frame = 0; this.refresh(); });
  }

  refresh(): void {
    if (this.destroyed) return;
    if (!this.host.active()) { this.cancel(); this.hide(); this.highlight.classList.remove('is-visible'); this.root.classList.remove('blocks-text-selected'); return; }
    // A reload can leave already-rendered sections without new postprocessor callbacks.
    // The host context can still resolve their current source ranges.
    const sectionRoot = this.root.querySelector<HTMLElement>('.markdown-preview-section');
    if (this.sectionInfo && sectionRoot) for (const child of sectionRoot.children) {
      const element = child as HTMLElement;
      if (element.matches('.mod-ui, .markdown-preview-pusher, .blocks-reading-empty')) continue;
      this.sections.set(element, () => this.sectionInfo!(element));
    }
    const source = this.host.read();
    if (!this.initialized || source !== this.source) {
      const oldBody = bodyStart(this.source);
      const newBody = bodyStart(source);
      const sameBody = this.initialized && this.source.slice(oldBody) === source.slice(newBody);
      const intent = this.selectionAfterEdit;
      const ownMove = intent && source.slice(newBody) === intent.source.slice(bodyStart(intent.source));
      const selected = ownMove ? intent.from + newBody - bodyStart(intent.source)
        : sameBody && this.selected !== undefined ? this.selected + newBody - oldBody : undefined;
      if (ownMove) this.selectionAfterEdit = undefined;
      this.initialized = true;
      this.cancel();
      if (this.selectionPreview && selected !== undefined) this.selectionPreview.from = selected;
      else this.selectionPreview = undefined;
      this.selected = selected; this.hovered = undefined;
      if (selected === undefined) this.hide();
      this.source = source; this.blocks = parseBlocks(source);
      if (this.selected !== undefined) this.hovered = this.blocks.findIndex(block => block.from === this.selected);
      for (const blank of this.blanks.values()) blank.remove();
      this.blanks.clear();
    }
    const starts = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
    const mapped = new Map<number, HTMLElement[]>();
    for (const [element, getInfo] of this.sections) {
      if (!this.root.contains(element)) { this.sections.delete(element); continue; }
      const info = getInfo();
      // Section offsets are usable only for the exact document being rendered.
      if (!info || info.text !== source) continue;
      const from = starts[info.lineStart];
      const to = starts[info.lineEnd + 1] ?? source.length;
      if (from === undefined) continue;
      const candidates = this.blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.kind !== 'Empty' && block.from < to && block.to > from);
      const list = element.querySelector(':scope > ul, :scope > ol');
      const items = list ? [...list.children].filter(e => e.tagName === 'LI') as HTMLElement[] : [];
      candidates.forEach(({ index }, i) => {
        const child = element.firstElementChild as HTMLElement | null;
        const target = items.length === candidates.length ? items[i]
          : element.children.length === 1 && child ? child : element;
        const previous = mapped.get(index) ?? [];
        if (!previous.includes(target)) previous.push(target);
        mapped.set(index, previous);
      });
    }
    if (sectionRoot) this.blocks.forEach((block, index) => {
      if (block.kind !== 'Empty') return;
      let blank = this.blanks.get(block.from);
      const next = this.blocks.slice(index + 1).map((_, i) => mapped.get(index + i + 1)?.[0]).find(Boolean);
      if (!next && mapped.size === 0 && source.trim()) return;
      if (!blank) {
        blank = this.root.ownerDocument.createElement('div');
        blank.className = 'blocks-reading-empty';
        blank.setAttribute('aria-hidden', 'true');
        this.blanks.set(block.from, blank);
      }
      let anchor = next;
      while (anchor && anchor.parentElement !== sectionRoot) anchor = anchor.parentElement ?? undefined;
      if (blank.parentElement !== sectionRoot || (anchor && blank.nextElementSibling !== anchor)) sectionRoot.insertBefore(blank, anchor ?? null);
      mapped.set(index, [blank]);
    });
    this.geometry = [...mapped].map(([index, elements]) => {
      const bounds = elements.map(element => element.getBoundingClientRect());
      return { block: this.blocks[index], index, elements, top: Math.min(...bounds.map(b => b.top)), bottom: Math.max(...bounds.map(b => b.bottom)), left: Math.min(...bounds.map(b => b.left)), right: Math.max(...bounds.map(b => b.right)) };
    }).filter(g => g.bottom > g.top).sort((a, b) => a.index - b.index);
    this.paintSelection();
    if (this.drag?.active) this.paintDrag();
    else if (this.selected !== undefined) {
      const selected = this.geometry.find(g => g.block.from === this.selected);
      if (selected) this.show(selected);
      else {
        const bounds = this.selectionBounds();
        if (bounds) { this.position(this.controls, bounds.left - 54, bounds.top); this.controls.classList.add('is-visible'); }
        else this.hide();
      }
    }
  }

  private hover(event: PointerEvent): void {
    if (!this.host.active() || this.pending || this.drag || this.controls.contains(event.target as Node)) return;
    this.refresh();
    if (this.selected !== undefined) return;
    const found = this.geometry.find(g => event.clientY >= g.top && event.clientY < g.bottom && event.clientX >= g.left - 58 && event.clientX <= g.right);
    if (found) this.show(found); else this.hide();
  }

  private position(element: HTMLElement, left: number, top: number, width?: number, height?: number): void {
    const root = this.root.getBoundingClientRect();
    element.style.left = `${left - root.left - this.root.clientLeft + this.root.scrollLeft}px`;
    element.style.top = `${top - root.top - this.root.clientTop + this.root.scrollTop}px`;
    if (width !== undefined) element.style.width = `${Math.max(1, width)}px`;
    if (height !== undefined) element.style.height = `${Math.max(1, height)}px`;
  }

  private show(g: Geometry): void {
    this.hovered = g.index;
    this.position(this.controls, g.left - 54, g.top);
    this.controls.classList.add('is-visible');
    this.paintSelection();
  }
  private clickTarget(event: MouseEvent): Geometry | undefined {
    const target = event.target as Element | null;
    if (!this.host.clickToEdit?.() || !this.host.open || !this.host.active() || this.pending || this.drag
      || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || !target?.closest || this.controls.contains(target)
      || target.closest('a, button, input, textarea, select, [contenteditable="true"], .markdown-embed, .clickable-icon')) return;
    return this.geometry.find(g => g.elements.some(element => element.contains(target)));
  }

  private click(event: MouseEvent): void {
    this.refresh();
    const target = this.clickTarget(event);
    if (!target) return;
    const selection = this.root.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed && this.root.contains(selection.anchorNode)) return;
    event.preventDefault(); event.stopPropagation();
    if (this.selected === target.block.from) {
      const placement = this.host.cursorPlacement?.() ?? 'click';
      const position = placement === 'click'
        ? readingClickPosition(this.source, target.block, target.elements, event.clientX, event.clientY)
        : { offset: placement === 'start' ? target.block.from : target.block.to };
      void this.open(position.offset, position.screenTop);
    } else {
      this.selected = target.block.from;
      this.show(target);
      this.handle.focus({ preventScroll: true });
    }
  }

  private async open(offset: number, screenTop?: number): Promise<void> {
    this.pending = true;
    try { await this.host.open!(offset, this.source, screenTop); }
    catch (error) { this.host.report(error); }
    finally { this.pending = false; this.refresh(); }
  }

  private hide(): void { this.controls.classList.remove('is-visible'); }
  private selectionBounds(): { top: number; bottom: number; left: number; right: number } | undefined {
    const current = this.geometry.find(g => g.block.from === this.selected);
    if (current) {
      this.selectionPreview = { from: current.block.from, elements: current.elements, text: current.elements.map(el => el.textContent) };
      return current;
    }
    const preview = this.selectionPreview;
    if (!preview || preview.from !== this.selected || !preview.elements.every((el, i) => this.root.contains(el) && el.textContent === preview.text[i])) return;
    const bounds = preview.elements.map(el => el.getBoundingClientRect()).filter(rect => rect.height > 0);
    if (!bounds.length) return;
    return { top: Math.min(...bounds.map(rect => rect.top)), bottom: Math.max(...bounds.map(rect => rect.bottom)),
      left: Math.min(...bounds.map(rect => rect.left)), right: Math.max(...bounds.map(rect => rect.right)) };
  }

  private paintSelection(): void {
    this.keyboardScope?.sync();
    this.highlight.style.setProperty('--blocks-highlight-color', this.host.highlightColor?.() ?? 'var(--interactive-accent)');
    const pressed = this.selected !== undefined && this.blocks.some(block => block.from === this.selected);
    this.handle.classList.toggle('is-selected', pressed);
    this.handle.setAttribute('aria-pressed', String(pressed));
    const selection = this.root.ownerDocument.getSelection();
    const range = selection && !selection.isCollapsed && selection.rangeCount === 1
      && this.root.contains(selection.anchorNode) && this.root.contains(selection.focusNode)
      ? selection.getRangeAt(0) : undefined;
    const selected = this.selectionBounds();
    const matching = this.selected !== undefined
      ? selected ? [selected] : []
      : this.geometry.filter(g => range && g.elements.some(element => range.intersectsNode(element)));
    this.root.classList.toggle('blocks-text-selected', matching.length > 0 && !!range && this.host.active());
    const g = matching.length ? {
      top: Math.min(...matching.map(g => g.top)), bottom: Math.max(...matching.map(g => g.bottom)),
      left: Math.min(...matching.map(g => g.left)), right: Math.max(...matching.map(g => g.right)),
    } : undefined;
    const visible = !!g && !this.drag?.active && this.host.active();
    this.highlight.classList.toggle('is-visible', visible);
    if (g && visible) this.position(this.highlight, g.left, g.top, g.right - g.left, g.bottom - g.top);
  }

  private begin(event: PointerEvent): void {
    if (event.button !== 0 || this.pending || !this.host.active()) return;
    this.refresh();
    const g = this.geometry.find(g => g.index === this.hovered);
    if (!g) return;
    event.preventDefault();
    this.drag = { pointer: event.pointerId, source: g.index, slot: g.index, snapshot: this.source, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, offset: event.clientY - g.top, left: g.left, active: false };
    this.handle.setPointerCapture(event.pointerId);
    this.handle.focus({ preventScroll: true });
  }
  private move(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 4) {
      drag.active = true;
      const g = this.geometry.find(g => g.index === drag.source)!;
      drag.ghost = this.root.ownerDocument.createElement('div');
      drag.ghost.className = 'blocks-drag-ghost';
      drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.style.width = `${g.right - g.left}px`;
      for (const element of g.elements) {
        const clone = element.cloneNode(true) as HTMLElement;
        clone.removeAttribute('id'); clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        drag.ghost.append(clone);
      }
      this.root.ownerDocument.body.append(drag.ghost);
      this.root.classList.add('blocks-dragging');
      g.elements.forEach(el => el.classList.add('blocks-source-line'));
      this.paintSelection();
    }
    if (drag.active) this.paintDrag();
  }
  private paintDrag(): void {
    const drag = this.drag;
    if (!drag?.active) return;
    const next = this.geometry.find(g => drag.y < (g.top + g.bottom) / 2);
    drag.slot = next ? next.index : this.geometry.length ? this.geometry[this.geometry.length - 1].index + 1 : drag.slot;
    drag.ghost!.style.transform = `translate3d(${drag.left + drag.x - drag.startX}px, ${drag.y - drag.offset}px, 0)`;
    this.position(this.controls, drag.left + drag.x - drag.startX - 54, drag.y - drag.offset);
    this.controls.classList.add('is-visible');
    const target = next ?? this.geometry[this.geometry.length - 1];
    if (target) {
      this.position(this.marker, target.left, next ? target.top : target.bottom, target.right - target.left);
      this.marker.classList.add('is-visible');
    }
    const bounds = this.root.getBoundingClientRect();
    const distance = drag.y < bounds.top + 48 ? drag.y - bounds.top - 48 : drag.y > bounds.bottom - 48 ? drag.y - bounds.bottom + 48 : 0;
    const before = this.root.scrollTop;
    const maximum = Math.max(0, this.root.scrollHeight - this.root.clientHeight);
    if (distance) this.root.scrollTop = Math.max(0, Math.min(maximum, before + Math.max(-18, Math.min(18, distance * .25))));
    if (this.root.scrollTop !== before) this.schedule();
  }
  private finish(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    if (drag.active) { drag.x = event.clientX; drag.y = event.clientY; this.paintDrag(); }
    const edit = drag.active ? moveBlock(drag.snapshot, this.blocks, drag.source, drag.slot) : null;
    this.cancel();
    if (edit) void this.commit(edit, false, drag.snapshot);
    else {
      this.selected = this.blocks[drag.source]?.from;
      const selected = this.geometry.find(g => g.index === drag.source);
      if (selected) this.show(selected);
      this.handle.focus({ preventScroll: true });
    }
  }
  private cancel(): void {
    const drag = this.drag;
    this.drag = undefined;
    drag?.ghost?.remove();
    if (drag && this.handle.hasPointerCapture(drag.pointer)) this.handle.releasePointerCapture(drag.pointer);
    this.geometry.forEach(g => g.elements.forEach(el => el.classList.remove('blocks-source-line')));
    this.root.classList.remove('blocks-dragging'); this.marker.classList.remove('is-visible');
    this.paintSelection();
  }
  private keyboard(event: KeyboardEvent): void {
    if (!this.host.active()) return;
    this.refresh();
    const index = this.selected !== undefined ? this.blocks.findIndex(block => block.from === this.selected) : this.hovered ?? -1;
    const block = this.blocks[index];
    if (!block) return;
    if (this.pending) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.selected = block.from; this.paintSelection(); return; }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.altKey) {
      if (this.host.optionArrowSelection?.() === false || this.selected === undefined) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const next = this.blocks[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (!next) return;
      this.selected = next.from;
      const target = this.geometry.find(g => g.block === next);
      if (target) {
        this.show(target);
        target.elements[0]?.scrollIntoView?.({ block: 'nearest' });
      }
      this.handle.focus({ preventScroll: true });
      this.paintSelection(); this.schedule();
      return;
    }
    event.preventDefault(); event.stopPropagation();
    const edit = moveBlock(this.source, this.blocks, index, event.key === 'ArrowUp' ? index - 1 : index + 2);
    if (edit) void this.commit(edit, false);
  }
  private async commit(edit: Edit, livePreview: boolean, snapshot = this.source): Promise<void> {
    if (this.pending || this.destroyed || !this.host.active() || this.host.read() !== snapshot) { this.refresh(); return; }
    this.pending = true;
    const intent = !livePreview ? { source: snapshot.slice(0, edit.from) + edit.insert + snapshot.slice(edit.to), from: edit.cursor } : undefined;
    this.selectionAfterEdit = intent;
    try {
      const applied = await this.host.apply(edit, snapshot, livePreview);
      if (!applied && this.selectionAfterEdit === intent) this.selectionAfterEdit = undefined;
    } catch (error) {
      if (this.selectionAfterEdit === intent) this.selectionAfterEdit = undefined;
      this.host.report(error);
    } finally {
      this.pending = false;
      if (!this.destroyed) { this.refresh(); this.schedule(); }
    }
  }
  destroy(): void {
    this.destroyed = true;
    this.keyboardScope?.destroy();
    this.cancel();
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    this.cleanup.forEach(fn => fn());
    for (const blank of this.blanks.values()) blank.remove();
    this.controls.remove(); this.highlight.remove(); this.marker.remove();
    this.root.classList.remove('blocks-reading', 'blocks-text-selected');
    this.sections.clear();
  }
}
