import { Plugin } from 'obsidian';
import { blocksExtension } from './editor';

export default class BlocksPlugin extends Plugin {
  onload(): void { this.registerEditorExtension(blocksExtension); }
}
