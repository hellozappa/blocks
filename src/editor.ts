import { EditorSelection, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Block, Edit, blockAt, insertBlock, moveBlock, parseBlocks } from './blocks';
import { createControls } from './controls';

interface Geometry { block: Block; index: number; top: number; bottom: number; left: number; right: number }
interface PreviewLine { element: HTMLElement; index: number; originalTranslate: string; shift?: number }
interface Drag {
  pointer: number; startX: number; startY: number; x: number; y: number;
  source: number; slot: number; active: boolean; snapshot: string;
  height: number; offset: number; left: number; width: number; ghost?: HTMLElement;
}

class BlockControls {
  private blocks: Block[];
  private geometry: Geometry[] = [];
  private hovered?: Block;
  private selected?: Block;
  private selectionOrigin?: number;
  private drag?: Drag;
  private frame = 0;
  private lastPointer?: { x: number; y: number };
  private lines: PreviewLine[] = [];
  private layout?: { editor: DOMRect; content: DOMRect; viewport: DOMRect };
  private readonly controls: HTMLElement;
  private readonly plus: HTMLButtonElement;
  private readonly handle: HTMLButtonElement;
  private readonly marker: HTMLElement;
  private readonly highlight: HTMLElement;
  private readonly win: Window;
  private readonly cleanup: (() => void)[] = [];
  private destroyed = false;

  constructor(private readonly view: EditorView) {
    this.win = view.dom.ownerDocument.defaultView!;
    this.blocks = parseBlocks(view.state.doc.toString());
    const buttons = createControls(view.dom.ownerDocument);
    this.controls = buttons.controls;
    this.plus = buttons.plus;
    this.handle = buttons.handle;
    this.marker = view.dom.ownerDocument.createElement('div');
    this.marker.className = 'blocks-drop-marker';
    this.marker.setAttribute('aria-hidden', 'true');
    this.highlight = view.dom.ownerDocument.createElement('div');
    this.highlight.className = 'blocks-selection-highlight';
    this.highlight.setAttribute('aria-hidden', 'true');
    view.dom.append(this.highlight, this.controls, this.marker);
    this.listen(view.contentDOM, 'pointerdown', () => this.clearSelection());
    this.listen(view.dom, 'pointermove', event => this.hover(event as PointerEvent));
    this.listen(view.dom, 'pointerleave', () => { if (!this.drag && !this.selected) this.hide(); });
    this.listen(view.scrollDOM, 'scroll', () => this.measure());
    this.listen(this.plus, 'pointerdown', event => event.preventDefault());
    this.listen(this.plus, 'click', event => {
      if (!this.hovered || this.view.state.readOnly) return;
      this.apply(insertBlock(this.view.state.doc.toString(), this.hovered, (event as MouseEvent).altKey), 'input.blocks');
    });
    this.listen(this.handle, 'pointerdown', event => this.begin(event as PointerEvent));
    this.listen(this.handle, 'pointermove', event => this.pointerMove(event as PointerEvent));
    this.listen(this.handle, 'pointerup', event => this.finish(event as PointerEvent));
    this.listen(this.handle, 'pointercancel', () => this.cancel());
    this.listen(this.handle, 'lostpointercapture', () => this.cancel());
    this.listen(this.handle, 'keydown', event => this.keyboard(event as KeyboardEvent));
    this.listen(this.win, 'keydown', event => this.escape(event as KeyboardEvent), true);
    this.listen(this.win, 'blur', () => this.cancel());
    this.measure();
  }

  private listen(target: EventTarget, type: string, handler: EventListener, capture = false): void {
    target.addEventListener(type, handler, capture);
    this.cleanup.push(() => target.removeEventListener(type, handler, capture));
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.clearSelection();
      this.cancel();
      this.blocks = parseBlocks(update.state.doc.toString());
      this.hovered = undefined;
      this.hide();
    }
    if (update.selectionSet && this.selected) {
      const range = update.state.selection.main;
      if (range.from !== this.selected.from || range.to !== this.selected.to) this.clearSelection();
    }
    if (update.docChanged || update.geometryChanged || update.viewportChanged) this.measure();
  }

  private measure(): void {
    this.view.requestMeasure({
      key: this,
      read: view => {
        const editor = view.dom.getBoundingClientRect();
        const content = view.contentDOM.getBoundingClientRect();
        const viewport = view.scrollDOM.getBoundingClientRect();
        const geometry: Geometry[] = [];
        this.blocks.forEach((block, index) => {
          const emptyInViewport = block.from === block.to && block.from >= view.viewport.from && block.from <= view.viewport.to;
          if (!emptyInViewport && !view.visibleRanges.some(r => block.to >= r.from && block.from <= r.to)) return;
          const first = view.lineBlockAt(block.from);
          const last = view.lineBlockAt(block.to);
          const top = view.documentTop + first.top;
          const bottom = view.documentTop + last.bottom;
          if (bottom >= viewport.top && top <= viewport.bottom) geometry.push({ block, index, top, bottom, left: content.left, right: content.right });
        });
        const lines: PreviewLine[] = [];
        for (const child of view.contentDOM.children) {
          if (!(child as HTMLElement).style || child.classList.contains('cm-gap')) continue;
          try {
            const pos = view.posAtDOM(child);
            const block = blockAt(this.blocks, pos);
            if (block) {
              const prior = this.lines.find(line => line.element === child);
              lines.push({ element: child as HTMLElement, index: this.blocks.indexOf(block), originalTranslate: prior?.originalTranslate ?? (child as HTMLElement).style.translate, shift: prior?.shift });
            }
          } catch { /* A replaced widget can lack a document position. */ }
        }
        for (const item of geometry) {
          const rendered = lines.find(line => line.index === item.index)?.element;
          const bounds = rendered?.getBoundingClientRect();
          const prior = this.drag?.active ? this.geometry.find(g => g.block.from === item.block.from) : undefined;
          const textStart = !this.drag?.active && rendered?.classList.contains('cm-line') ? view.coordsAtPos(item.block.from, 1) : null;
          item.left = prior?.left ?? textStart?.left ?? bounds?.left ?? content.left;
          item.right = prior?.right ?? bounds?.right ?? content.right;
        }
        return { editor, content, viewport, geometry, lines };
      },
      write: result => {
        if (this.destroyed) return;
        const nextElements = new Set(result.lines.map(line => line.element));
        for (const line of this.lines) {
          if (!this.drag?.active || !nextElements.has(line.element)) this.restoreLine(line);
        }
        this.geometry = result.geometry;
        this.lines = result.lines;
        this.layout = { editor: result.editor, content: result.content, viewport: result.viewport };
        this.updateSelection();
        if (this.drag) {
          const source = this.geometry.find(g => g.index === this.drag!.source);
          if (source) this.drag.height = this.dragHeight(source);
        }
        if (this.drag?.active) { this.preview(); this.scheduleFrame(); }
        else if (this.selected) {
          const selected = this.geometry.find(g => g.block === this.selected);
          if (selected) this.showBlock(selected);
          else this.hide();
        }
        else if (this.lastPointer) this.showAt(this.lastPointer.x, this.lastPointer.y);
      },
    });
  }

  private hover(event: PointerEvent): void {
    if (this.drag || this.selected || this.controls.contains(event.target as Node)) return;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.showAt(event.clientX, event.clientY);
  }

  private showAt(x: number, y: number): void {
    if (this.view.state.readOnly) { this.hide(); return; }
    const viewport = this.view.scrollDOM.getBoundingClientRect();
    const content = this.view.contentDOM.getBoundingClientRect();
    if (y < viewport.top || y > viewport.bottom || x > content.right) { this.hide(); return; }
    const found = this.geometry.find(g => y >= g.top && y < g.bottom);
    if (!found || x < found.left - 58) { this.hide(); return; }
    this.showBlock(found);
  }

  private showBlock(found: Geometry): void {
    const layout = this.layout;
    if (!layout) return;
    this.hovered = found.block;
    this.updateSelection();
    const top = Math.max(found.top, layout.viewport.top) - layout.editor.top;
    this.controls.style.top = `${top}px`;
    this.controls.style.left = `${Math.max(0, found.left - layout.editor.left - 54)}px`;
    this.controls.classList.add('is-visible');
  }

  private hide(): void { this.controls.classList.remove('is-visible'); }

  private select(block: Block): void {
    const origin = this.view.state.selection.main.head;
    this.view.dispatch({ selection: EditorSelection.single(block.from, block.to) });
    this.selected = block;
    this.hovered = block;
    this.selectionOrigin = origin >= block.from && origin <= block.to ? origin : block.from;
    this.updateSelection();
    const selected = this.geometry.find(g => g.block === block);
    if (selected) this.showBlock(selected);
  }

  private clearSelection(): void {
    this.selected = undefined;
    this.selectionOrigin = undefined;
    this.updateSelection();
  }

  private escape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing
      || !this.view.dom.contains(this.view.dom.ownerDocument.activeElement)) return;
    if (this.drag || this.selected) {
      event.preventDefault(); event.stopPropagation();
      this.cancel();
      if (this.selected) {
        const cursor = this.selectionOrigin ?? this.selected.from;
        this.clearSelection();
        this.view.dispatch({ selection: EditorSelection.cursor(cursor) });
        this.view.focus();
      }
      return;
    }
    if (this.view.state.readOnly || this.view.state.selection.ranges.length !== 1 || !this.view.state.selection.main.empty) return;
    const block = blockAt(this.blocks, this.view.state.selection.main.head);
    if (!block) return;
    event.preventDefault(); event.stopPropagation();
    this.select(block);
  }

  private updateSelection(): void {
    const pressed = !!this.selected && this.hovered === this.selected;
    this.handle.classList.toggle('is-selected', pressed);
    this.handle.setAttribute('aria-pressed', String(pressed));
    const bounds = this.geometry.find(g => g.block === this.selected);
    const layout = this.layout;
    const visible = !!bounds && !!layout && !this.drag?.active;
    this.highlight.classList.toggle('is-visible', visible);
    if (!visible || !bounds || !layout) return;
    const top = Math.max(bounds.top, layout.viewport.top);
    const bottom = Math.min(bounds.bottom, layout.viewport.bottom);
    this.highlight.style.top = `${top - layout.editor.top}px`;
    this.highlight.style.left = `${bounds.left - layout.editor.left}px`;
    this.highlight.style.width = `${Math.max(1, bounds.right - bounds.left)}px`;
    this.highlight.style.height = `${Math.max(0, bottom - top)}px`;
  }

  private dragHeight(source: Geometry): number {
    const next = this.geometry.find(g => g.index === source.index + 1);
    const prior = this.geometry.find(g => g.index === source.index - 1);
    return next ? next.top - source.top : source.bottom - source.top + (prior ? source.top - prior.bottom : 0);
  }

  private begin(event: PointerEvent): void {
    if (event.button !== 0 || !this.hovered || this.view.state.readOnly) return;
    event.preventDefault();
    const source = this.blocks.indexOf(this.hovered);
    const rect = this.geometry.find(g => g.index === source);
    if (!rect) return;
    this.drag = {
      pointer: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, source, slot: source, active: false,
      snapshot: this.view.state.doc.toString(), height: this.dragHeight(rect),
      offset: event.clientY - rect.top, left: rect.left, width: Math.max(1, rect.right - rect.left),
    };
    this.handle.setPointerCapture(event.pointerId);
    this.handle.focus({ preventScroll: true });
  }

  private pointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 4) this.activate();
    if (drag.active) this.scheduleFrame();
  }

  private activate(): void {
    const drag = this.drag!;
    drag.active = true;
    this.updateSelection();
    this.view.dom.classList.add('blocks-dragging');
    const ghost = this.view.dom.ownerDocument.createElement('div');
    ghost.className = 'blocks-drag-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const style = this.win.getComputedStyle(this.view.contentDOM);
    ghost.style.width = `${drag.width}px`;
    ghost.style.font = style.font;
    ghost.style.color = style.color;
    for (const line of this.lines.filter(l => l.index === drag.source)) {
      const clone = line.element.cloneNode(true) as HTMLElement;
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      clone.style.removeProperty('translate');
      ghost.append(clone);
    }
    if (!ghost.childNodes.length) ghost.textContent = this.view.state.doc.sliceString(this.blocks[drag.source].from, this.blocks[drag.source].to) || 'Empty block';
    this.view.dom.ownerDocument.body.append(ghost);
    drag.ghost = ghost;
    ghost.style.transform = `translate3d(${drag.left + drag.x - drag.startX}px, ${drag.y - drag.offset}px, 0)`;
    this.positionDragControls();
    this.preview();
  }

  private positionDragControls(): void {
    const drag = this.drag;
    const layout = this.layout;
    if (!drag?.active || !layout) return;
    this.controls.style.top = `${drag.y - drag.offset - layout.editor.top}px`;
    this.controls.style.left = `${Math.max(0, drag.left + drag.x - drag.startX - layout.editor.left - 54)}px`;
    this.controls.classList.add('is-visible');
  }

  private tick(): void {
    this.frame = 0;
    const drag = this.drag;
    const viewport = this.layout?.viewport;
    if (!drag?.active || !viewport) return;
    const slot = this.dropSlot(drag.y);
    const distance = drag.y < viewport.top + 48 ? drag.y - viewport.top - 48
      : drag.y > viewport.bottom - 48 ? drag.y - viewport.bottom + 48 : 0;
    let nextScroll: number | undefined;
    if (distance) {
      const scroll = this.view.scrollDOM;
      const current = scroll.scrollTop;
      const maximum = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
      const next = Math.max(0, Math.min(maximum, current + Math.max(-18, Math.min(18, distance * 0.25))));
      if (next !== current) nextScroll = next;
    }
    drag.ghost!.style.transform = `translate3d(${drag.left + drag.x - drag.startX}px, ${drag.y - drag.offset}px, 0)`;
    this.positionDragControls();
    if (drag.slot !== slot) { drag.slot = slot; this.preview(); }
    if (nextScroll !== undefined) {
      this.view.scrollDOM.scrollTop = nextScroll;
      this.scheduleFrame();
    }
  }

  private scheduleFrame(): void {
    if (this.drag?.active && !this.frame) this.frame = this.win.requestAnimationFrame(() => this.tick());
  }

  private dropSlot(y: number): number {
    const next = this.geometry.find(g => y < (g.top + g.bottom) / 2);
    const candidate = next ? next.index : this.geometry.length ? this.geometry[this.geometry.length - 1].index + 1 : this.drag!.slot;
    const current = this.drag!.slot;
    // A small reversal margin prevents pointer noise from restarting animations.
    const boundary = this.geometry.find(g => g.index === (candidate > current ? candidate - 1 : candidate));
    if (boundary && candidate !== current) {
      const midpoint = (boundary.top + boundary.bottom) / 2;
      if (candidate > current && y < midpoint + 6) return current;
      if (candidate < current && y > midpoint - 6) return current;
    }
    return candidate;
  }

  private preview(): void {
    const drag = this.drag;
    const layout = this.layout;
    if (!drag?.active || !layout) return;
    for (const line of this.lines) {
      const wasPreviewing = line.element.classList.contains('blocks-preview-line');
      if (!wasPreviewing) line.element.classList.add('blocks-preview-line');
      let shift = 0;
      if (drag.slot > drag.source + 1 && line.index > drag.source && line.index < drag.slot) shift = -drag.height;
      if (drag.slot < drag.source && line.index >= drag.slot && line.index < drag.source) shift = drag.height;
      if (!wasPreviewing || line.shift !== shift) line.element.style.translate = `0px ${shift}px`;
      line.shift = shift;
      const source = line.index === drag.source;
      if (line.element.classList.contains('blocks-source-line') !== source) line.element.classList.toggle('blocks-source-line', source);
    }
    const target = this.geometry.find(g => g.index === drag.slot);
    const last = this.geometry[this.geometry.length - 1];
    if (!target && !last) return;
    let y = target ? target.top : last.bottom;
    if (drag.slot > drag.source + 1) y -= drag.height;
    const bounds = target ?? last;
    this.marker.style.top = `${y - layout.editor.top}px`;
    this.marker.style.left = `${bounds.left - layout.editor.left}px`;
    this.marker.style.width = `${Math.max(0, bounds.right - bounds.left)}px`;
    this.marker.classList.add('is-visible');
  }

  private finish(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    if (drag.active) drag.slot = this.dropSlot(event.clientY);
    const edit = drag.active && drag.snapshot === this.view.state.doc.toString()
      ? moveBlock(drag.snapshot, this.blocks, drag.source, drag.slot) : null;
    this.cancel();
    if (edit) this.apply(edit, 'move.blocks', this.blocks[drag.source]);
    else {
      if (!drag.active) this.select(this.blocks[drag.source]);
      const selected = this.geometry.find(g => g.block === this.selected);
      if (selected) this.showBlock(selected);
      else this.showAt(event.clientX, event.clientY);
    }
  }

  private clearPreview(): void {
    for (const line of this.lines) this.restoreLine(line);
  }

  private restoreLine(line: PreviewLine): void {
    if (!line.element.classList.contains('blocks-preview-line')) return;
    if (line.originalTranslate) line.element.style.translate = line.originalTranslate;
    else line.element.style.removeProperty('translate');
    line.element.classList.remove('blocks-preview-line', 'blocks-source-line');
    line.shift = undefined;
  }

  private cancel(): void {
    const drag = this.drag;
    this.drag = undefined;
    if (this.frame) this.win.cancelAnimationFrame(this.frame);
    this.frame = 0;
    drag?.ghost?.remove();
    if (drag && this.handle.hasPointerCapture(drag.pointer)) this.handle.releasePointerCapture(drag.pointer);
    this.clearPreview();
    this.view.dom.classList.remove('blocks-dragging');
    this.marker.classList.remove('is-visible');
    this.updateSelection();
    const selected = this.geometry.find(g => g.block === this.selected);
    if (selected && !this.destroyed) this.showBlock(selected);
    else this.hide();
  }

  private keyboard(event: KeyboardEvent): void {
    if (!this.hovered || this.view.state.readOnly) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.select(this.hovered);
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const source = this.blocks.indexOf(this.hovered);
    const edit = moveBlock(this.view.state.doc.toString(), this.blocks, source, event.key === 'ArrowUp' ? source - 1 : source + 2);
    if (edit) {
      this.apply(edit, 'move.blocks', this.blocks[source]);
      this.hovered = blockAt(this.blocks, edit.cursor);
      this.handle.focus({ preventScroll: true });
    }
  }

  private apply(edit: Edit, event: string, moving?: Block): void {
    this.view.dispatch({
      changes: { from: edit.from, to: edit.to, insert: edit.insert },
      selection: EditorSelection.single(edit.cursor, edit.cursor + (moving ? moving.to - moving.from : 0)), scrollIntoView: true,
      annotations: Transaction.userEvent.of(event),
    });
    if (moving) {
      this.selected = blockAt(this.blocks, edit.cursor);
      this.selectionOrigin = edit.cursor;
      this.hovered = this.selected;
      this.lastPointer = undefined;
      this.updateSelection();
    }
    this.view.focus();
  }

  destroy(): void {
    this.destroyed = true;
    this.cancel();
    this.cleanup.forEach(fn => fn());
    this.controls.remove();
    this.marker.remove();
    this.highlight.remove();
    this.view.dom.classList.remove('blocks-editor');
  }
}

export const blocksExtension = [
  EditorView.editorAttributes.of({ class: 'blocks-editor' }),
  ViewPlugin.fromClass(BlockControls),
];
