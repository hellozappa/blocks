import type { Scope, App } from 'obsidian';

export interface KeyboardScopeControl { sync(): void; destroy(): void }
export type KeyboardScopeFactory = (root: HTMLElement, handle: (event: KeyboardEvent) => boolean, selected: () => boolean) => KeyboardScopeControl;

/** Route selected-block Option arrows through Obsidian before global command shortcuts. */
export class BlockKeyboardScope implements KeyboardScopeControl {
  private readonly scope: Scope;
  private pushed = false;
  private disposed = false;
  private readonly document: Document;
  private readonly win: Window;
  private readonly focus = () => this.sync();
  private readonly blur = () => this.pop();

  constructor(private readonly app: App, private readonly root: HTMLElement, handle: (event: KeyboardEvent) => boolean,
    private readonly selected: () => boolean, parent: Scope, createScope: (parent: Scope) => Scope) {
    this.document = root.ownerDocument;
    this.win = this.document.defaultView!;
    this.scope = createScope(parent);
    // A catch-all must return undefined for unhandled keys so Scope delegates to its parent.
    this.scope.register(null, null, event => {
      if (this.disposed || !this.selected() || !this.root.contains(this.document.activeElement)
        || event.isComposing || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      if (handle(event)) return false;
    });
    this.document.addEventListener('focusin', this.focus);
    this.win.addEventListener('focus', this.focus);
    this.win.addEventListener('blur', this.blur);
  }

  sync(): void {
    const active = !this.disposed && this.selected() && this.document.hasFocus() && this.root.contains(this.document.activeElement);
    if (active && !this.pushed) { this.app.keymap.pushScope(this.scope); this.pushed = true; }
    else if (!active) this.pop();
  }

  private pop(): void {
    if (this.pushed) { this.app.keymap.popScope(this.scope); this.pushed = false; }
  }

  destroy(): void {
    this.disposed = true;
    this.pop();
    this.document.removeEventListener('focusin', this.focus);
    this.win.removeEventListener('focus', this.focus);
    this.win.removeEventListener('blur', this.blur);
  }
}
