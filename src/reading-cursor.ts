import { parser, GFM } from '@lezer/markdown';
import type { Block } from './blocks';

export type CursorPlacement = 'click' | 'start' | 'end';
interface SourceCharacter { char: string; from: number; to: number }
const markdown = parser.configure(GFM);

/** Map rendered text back to Markdown without counting formatting or link destinations. */
function sourceCharacters(source: string, document: Document): SourceCharacter[] {
  const hidden = new Uint8Array(source.length);
  const literal = new Uint8Array(source.length);
  const replacements = new Map<number, { text: string; to: number }>();
  const hide = (from: number, to: number) => hidden.fill(1, from, to);
  const cursor = markdown.parse(source).cursor();
  do {
    if (cursor.name === 'InlineCode' || cursor.name === 'CodeText') literal.fill(1, cursor.from, cursor.to);
    if (/^(EmphasisMark|CodeMark|HeaderMark|QuoteMark|ListMark|LinkMark|StrikethroughMark|TaskMarker|HTMLTag|CodeInfo)$/.test(cursor.name)) hide(cursor.from, cursor.to);
    if (cursor.name === 'Image' || cursor.name === 'LinkTitle'
      || (cursor.name === 'URL' && cursor.node.parent?.name !== 'Autolink')) hide(cursor.from, cursor.to);
    if (cursor.name === 'Escape') replacements.set(cursor.from, { text: source.slice(cursor.from + 1, cursor.to), to: cursor.to });
    if (cursor.name === 'Entity') {
      const decoder = document.createElement('textarea'); decoder.innerHTML = source.slice(cursor.from, cursor.to);
      replacements.set(cursor.from, { text: decoder.value, to: cursor.to });
    }
  } while (cursor.next());
  for (const match of source.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
    if (literal[match.index]) continue;
    const inside = match[1];
    const alias = inside.lastIndexOf('|');
    const label = alias >= 0 ? inside.slice(alias + 1) : inside;
    if (match[0].startsWith('!')) hide(match.index, match.index + match[0].length);
    else {
      const start = match.index + 2 + (alias >= 0 ? alias + 1 : 0);
      hide(match.index, start); hide(start + label.length, match.index + match[0].length);
    }
  }
  for (const match of source.matchAll(/%%[\s\S]*?%%|\^[\w-]+\s*$|==(?=\S)|(?<=\S)==/g)) {
    if (!literal[match.index]) hide(match.index, match.index + match[0].length);
  }
  const result: SourceCharacter[] = [];
  for (let i = 0; i < source.length;) {
    const replacement = replacements.get(i);
    if (replacement && !hidden[i]) {
      for (let j = 0; j < replacement.text.length; j++) result.push({ char: replacement.text[j], from: i, to: replacement.to });
      i = replacement.to;
    } else {
      if (!hidden[i]) result.push({ char: source[i], from: i, to: i + 1 });
      i++;
    }
  }
  return result;
}

/** Resolve a DOM caret boundary to a source offset within the selected block. */
export function sourceOffsetAtCaret(source: string, block: Block, elements: readonly HTMLElement[], node: Node, offset: number): number | undefined {
  if (!elements.some(element => element.contains(node))) return;
  const document = node.ownerDocument!;
  const texts: Text[] = [];
  for (const element of elements) {
    const walker = document.createTreeWalker(element, 4);
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      if (!text.parentElement?.closest('[aria-hidden="true"], button, input, .markdown-embed')) texts.push(text);
    }
  }
  let rendered = '';
  let caret: number | undefined;
  const boundary = document.createRange(); boundary.setStart(node, offset); boundary.collapse(true);
  for (const text of texts) {
    if (text === node) caret = rendered.length + offset;
    else if (caret === undefined && boundary.comparePoint(text, 0) >= 0) caret = rendered.length;
    rendered += text.data;
  }
  if (caret === undefined) caret = rendered.length;
  if (!rendered.length) return;
  const characters = sourceCharacters(source.slice(block.from, block.to), document);
  const positions = new Map<number, SourceCharacter>();
  let at = 0;
  for (let i = 0; i < rendered.length; i++) {
    if (/\s/.test(rendered[i])) continue;
    while (at < characters.length && /\s/.test(characters[at].char)) at++;
    if (characters[at]?.char !== rendered[i]) return;
    positions.set(i, characters[at++]);
  }
  if (caret === 0) return block.from + (positions.get(0)?.from ?? 0);
  if (caret === rendered.length) {
    // The end of the rendered block includes any closing Markdown delimiters.
    return block.to;
  }
  const next = positions.get(caret);
  if (next) return block.from + next.from;
  const previous = positions.get(caret - 1);
  if (previous) return block.from + previous.to;
  for (let i = caret; i < rendered.length; i++) if (positions.has(i)) return block.from + positions.get(i)!.from;
  return block.to;
}

export function readingClickOffset(source: string, block: Block, elements: readonly HTMLElement[], x: number, y: number): number {
  const document = elements[0]?.ownerDocument;
  if (!document) return block.from;
  const api = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = api.caretPositionFromPoint?.(x, y);
  const range = position ? undefined : api.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? range?.startContainer;
  const offset = position?.offset ?? range?.startOffset;
  if (node && offset !== undefined) {
    const mapped = sourceOffsetAtCaret(source, block, elements, node, offset);
    if (mapped !== undefined) return mapped;
  }
  // Images and other widgets may have no rendered text caret.
  const last = elements[elements.length - 1]?.getBoundingClientRect();
  return last && y >= last.bottom ? block.to : block.from;
}
