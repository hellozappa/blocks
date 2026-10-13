import type { MarkdownView } from 'obsidian';
import type { SectionInfo } from './reading';

/** Guard the renderer adapter used when a reload supplies no postprocessor contexts. */
export function readingSectionInfo(view: MarkdownView, element: HTMLElement): SectionInfo | null {
  const preview = view.previewMode as typeof view.previewMode & {
    renderer?: { getSectionInfo?: (element: HTMLElement) => unknown };
  };
  const renderer = preview.renderer;
  if (typeof renderer?.getSectionInfo !== 'function') return null;
  const info = renderer.getSectionInfo(element) as Partial<SectionInfo> | null;
  if (!info || typeof info.text !== 'string' || !Number.isInteger(info.lineStart) || !Number.isInteger(info.lineEnd)
    || info.lineStart! < 0 || info.lineEnd! < info.lineStart!) return null;
  return info as SectionInfo;
}
