import { App, PluginSettingTab, Setting } from 'obsidian';
import type { CursorPlacement } from './reading-cursor';

export interface BlocksSettings { useAccentColor: boolean; highlightColor: string; readingClickToEdit: boolean; readingCursorPlacement: CursorPlacement; optionArrowSelection: boolean }
export const defaultSettings: BlocksSettings = { useAccentColor: true, highlightColor: '#7852EE', readingClickToEdit: true, readingCursorPlacement: 'click', optionArrowSelection: true };

export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(hex)) return '#' + [...hex].map(char => char + char).join('').toUpperCase();
  if (/^[\da-f]{6}$/i.test(hex)) return '#' + hex.toUpperCase();
  return undefined;
}

export function loadSettings(data: Partial<BlocksSettings> | null | undefined): BlocksSettings {
  return {
    optionArrowSelection: typeof data?.optionArrowSelection === 'boolean' ? data.optionArrowSelection : true,
    readingCursorPlacement: data?.readingCursorPlacement === 'start' || data?.readingCursorPlacement === 'end' ? data.readingCursorPlacement : 'click',
    readingClickToEdit: typeof data?.readingClickToEdit === 'boolean' ? data.readingClickToEdit : true,
    useAccentColor: typeof data?.useAccentColor === 'boolean' ? data.useAccentColor : defaultSettings.useAccentColor,
    highlightColor: normalizeHex(data?.highlightColor) ?? defaultSettings.highlightColor,
  };
}

export function highlightColor(settings: BlocksSettings): string {
  return settings.useAccentColor ? 'var(--interactive-accent)' : settings.highlightColor;
}

interface SettingsHost {
  settings: BlocksSettings;
  app: App;
  saveSettings(): Promise<void>;
}

export class BlocksSettingsTab extends PluginSettingTab {
  constructor(private readonly host: SettingsHost, plugin: ConstructorParameters<typeof PluginSettingTab>[1]) {
    super(host.app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName('Option+arrows change the selected block')
      .setDesc('Hold Option while pressing Up or Down to select the neighboring block without moving its content. Up and Down alone move the selected block.')
      .addToggle(toggle => toggle.setValue(this.host.settings.optionArrowSelection).onChange(async value => {
        this.host.settings.optionArrowSelection = value;
        await this.host.saveSettings();
      }));
    new Setting(this.containerEl)
      .setName('Click blocks to edit in Reading view')
      .setDesc('Click a block to select it. Click the selected block again to open Live Preview. Links and interactive controls keep their normal behavior.')
      .addToggle(toggle => toggle.setValue(this.host.settings.readingClickToEdit).onChange(async value => {
        this.host.settings.readingClickToEdit = value;
        await this.host.saveSettings();
      }));
    new Setting(this.containerEl)
      .setName('Cursor position when opening Live Preview')
      .setDesc('Choose where the cursor goes after the second click on a selected block in Reading view.')
      .addDropdown(dropdown => dropdown.addOptions({ click: 'Where you click', start: 'Beginning of block', end: 'End of block' })
        .setValue(this.host.settings.readingCursorPlacement).onChange(async value => {
          if (value !== 'click' && value !== 'start' && value !== 'end') return;
          this.host.settings.readingCursorPlacement = value;
          await this.host.saveSettings();
        }));
    new Setting(this.containerEl)
      .setName('Use Obsidian accent color')
      .setDesc('Follow the accent color in Settings > Appearance. Turn this off to use a custom highlight color.')
      .addToggle(toggle => toggle.setValue(this.host.settings.useAccentColor).onChange(async value => {
        this.host.settings.useAccentColor = value;
        await this.host.saveSettings();
        this.display();
      }));
    const color = new Setting(this.containerEl)
      .setName('Highlight color')
      .setDesc('Enter a three- or six-digit hex color, or choose a color. The block background uses 18% opacity.');
    let text: import('obsidian').TextComponent;
    let picker: import('obsidian').ColorComponent;
    color.addText(component => {
      text = component;
      component.setValue(this.host.settings.highlightColor).setPlaceholder('#7852EE')
        .setDisabled(this.host.settings.useAccentColor).onChange(async value => {
          const normalized = normalizeHex(value);
          component.inputEl.setCustomValidity(normalized ? '' : 'Enter a valid hex color.');
          component.inputEl.setAttribute('aria-invalid', String(!normalized));
          if (!normalized) return;
          this.host.settings.highlightColor = normalized;
          picker.setValue(normalized);
          await this.host.saveSettings();
        });
    }).addColorPicker(component => {
      picker = component;
      component.setValue(this.host.settings.highlightColor).setDisabled(this.host.settings.useAccentColor)
        .onChange(async value => {
          const normalized = normalizeHex(value);
          if (!normalized) return;
          this.host.settings.highlightColor = normalized;
          text.setValue(normalized);
          text.inputEl.setCustomValidity('');
          text.inputEl.setAttribute('aria-invalid', 'false');
          await this.host.saveSettings();
        });
    });
  }
}
