import { MarkdownRenderChild, MarkdownView, Notice, Plugin, Scope } from 'obsidian';
import { createBlocksExtension } from './editor';
import { BlocksSettingsTab, defaultSettings, highlightColor, loadSettings } from './settings';
import { ReadingControls } from './reading';
import { readingSectionInfo } from './reading-sections';
import { BlockKeyboardScope, type KeyboardScopeFactory } from './keyboard-scope';
import { applyReadingEdit, openReadingBlock } from './reading-edit';

class ReadingSection extends MarkdownRenderChild {
  private frame = 0;
  constructor(element: HTMLElement, private readonly attach: () => void) { super(element); }
  onload(): void {
    // Postprocessors may run before the section is attached to its note pane.
    this.frame = this.containerEl.ownerDocument.defaultView!.requestAnimationFrame(() => { this.frame = 0; this.attach(); });
  }
  onunload(): void {
    if (this.frame) this.containerEl.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
  }
}

export default class BlocksPlugin extends Plugin {
  private reading = new Map<MarkdownView, { path: string; controls: ReadingControls; active: boolean }>();
  private disposed = false;
  private keyboardScopes = new Set<BlockKeyboardScope>();
  private createKeyboardScope: KeyboardScopeFactory = (root, handle, selected) => {
    const owner = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).find(view => view.containerEl.contains(root));
    const scope = new BlockKeyboardScope(this.app, root, handle, selected, owner?.scope ?? this.app.scope, parent => new Scope(parent));
    this.keyboardScopes.add(scope);
    return { sync: () => scope.sync(), destroy: () => { scope.destroy(); this.keyboardScopes.delete(scope); } };
  };

  settings = { ...defaultSettings };
  private savedData: Record<string, unknown> = {};

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.savedData, ...this.settings });
    for (const scope of this.keyboardScopes) scope.sync();
    this.app.workspace.iterateAllLeaves(leaf => {
      leaf.view.containerEl.querySelectorAll<HTMLElement>('.blocks-selection-highlight').forEach(element => {
        element.style.setProperty('--blocks-highlight-color', highlightColor(this.settings));
      });
    });
  }

  async onload(): Promise<void> {
    const data = await this.loadData();
    this.savedData = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    this.settings = loadSettings(this.savedData);
    this.addSettingTab(new BlocksSettingsTab(this, this));
    this.registerEditorExtension(createBlocksExtension(() => highlightColor(this.settings), () => this.settings.optionArrowSelection, this.createKeyboardScope));
    this.registerMarkdownPostProcessor((element, context) => {
      context.addChild(new ReadingSection(element, () => {
        if (this.disposed) return;
        // Embedded notes have their own renderer and must not edit the host note.
        if (!element.parentElement?.classList.contains('markdown-preview-section')) return;
        const view = this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view)
          .find((view): view is MarkdownView => view instanceof MarkdownView && view.file?.path === context.sourcePath && view.previewMode.containerEl.contains(element));
        if (view) this.ensureReading(view).addSection(element, () => context.getSectionInfo(element), target => context.getSectionInfo(target));
      }));
    });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.syncReading()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.syncReading()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.syncReading()));
    this.app.workspace.onLayoutReady(() => {
      if (this.disposed) return;
      this.syncReading();
    });
  }

  private ensureReading(view: MarkdownView): ReadingControls {
    const path = view.file?.path ?? '';
    const existing = this.reading.get(view);
    if (existing?.path === path) return existing.controls;
    existing?.controls.destroy();
    const root = view.previewMode.containerEl.querySelector<HTMLElement>('.markdown-preview-view') ?? view.previewMode.containerEl;
    const controls = new ReadingControls(root, {
      sectionInfo: element => readingSectionInfo(view, element),
      keyboardScope: this.createKeyboardScope,
      highlightColor: () => highlightColor(this.settings),
      clickToEdit: () => this.settings.readingClickToEdit,
      cursorPlacement: () => this.settings.readingCursorPlacement,
      optionArrowSelection: () => this.settings.optionArrowSelection,
      open: (offset, snapshot, screenTop) => openReadingBlock(view, path, offset, snapshot, screenTop),
      read: () => view.getViewData(),
      active: () => view.getMode() === 'preview' && view.file?.path === path,
      apply: async (edit, snapshot, livePreview) => {
        const applied = await applyReadingEdit(view, path, edit, snapshot, livePreview);
        if (!applied) new Notice('The note changed. Try the block operation again.');
        return applied;
      },
      report: error => { console.error('Blocks Reading view operation failed', error); new Notice('Blocks could not update this note.'); },
    });
    this.reading.set(view, { path, controls, active: false });
    return controls;
  }

  private syncReading(): void {
    const views = new Set(this.app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).filter((view): view is MarkdownView => view instanceof MarkdownView));
    for (const [view, entry] of this.reading) if (!views.has(view)) { entry.controls.destroy(); this.reading.delete(view); }
    for (const view of views) if (view.file) {
      const controls = this.ensureReading(view);
      const entry = this.reading.get(view)!;
      const active = view.getMode() === 'preview';
      entry.active = active;
      controls.refresh();
      // Cached sections are discovered by the controller; entering Reading needs no full rebuild.
    }
  }

  onunload(): void {
    this.disposed = true;
    for (const entry of this.reading.values()) entry.controls.destroy();
    this.reading.clear();
    for (const scope of this.keyboardScopes) scope.destroy();
    this.keyboardScopes.clear();
  }
}
