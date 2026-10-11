import { parser, GFM } from '@lezer/markdown';

export interface Block { from: number; to: number; kind: string }
export interface Edit { from: number; to: number; insert: string; cursor: number }
const markdown = parser.configure([GFM, {
  defineNodes: ['Math', 'Comment'],
  parseBlock: [{
    name: 'ObsidianDelimitedBlock',
    before: 'LinkReference',
    parse(cx, line) {
      const delimiter = line.text.trim();
      if (line.indent >= 4 || (delimiter !== '$$' && delimiter !== '%%')) return false;
      const from = cx.lineStart + line.pos;
      let to = cx.lineStart + line.text.length;
      while (cx.nextLine()) {
        to = cx.lineStart + line.text.length;
        if (line.text.trim() === delimiter) { cx.nextLine(); break; }
      }
      cx.addElement(cx.elt(delimiter === '$$' ? 'Math' : 'Comment', from, to));
      return true;
    },
    endLeaf(_cx, line) { return /^(?:\$\$|%%)[ \t]*$/.test(line.text); },
  }],
}]);

export function bodyStart(text: string): number {
  if (!/^(?:\uFEFF)?---\r?\n/.test(text)) return 0;
  const opening = text.indexOf('\n') + 1;
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening;
  const match = closing.exec(text);
  return match ? match.index + match[0].length : text.length;
}

/** Parse Markdown units without putting content into a second document model. */
export function parseBlocks(text: string): Block[] {
  const start = bodyStart(text);
  if (start === text.length && /^(?:\uFEFF)?---\r?\n/.test(text)
    && !/^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.test(text.slice(text.indexOf('\n') + 1))) return [];
  const body = text.slice(start);
  const blocks: Block[] = [];
  const tree = markdown.parse(body);
  function push(from: number, to: number, kind: string): void {
    if (text[to - 1] === '\r') to--;
    blocks.push({ from, to, kind });
  }
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === 'BulletList' || node.name === 'OrderedList') {
      for (let item = node.firstChild; item; item = item.nextSibling) {
        if (item.name === 'ListItem') push(start + item.from, start + item.to, node.name);
      }
    } else push(start + node.from, start + node.to, node.name);
  }

  // A separate block identifier belongs to the preceding content.
  for (let i = 1; i < blocks.length; i++) {
    if (/^\^[\w-]+$/.test(text.slice(blocks[i].from, blocks[i].to))) {
      blocks[i - 1].to = blocks[i].to;
      blocks.splice(i--, 1);
    }
  }

  const withEmpty: Block[] = [];
  let previousEnd = start;
  for (const block of blocks) {
    addEmpty(previousEnd, block.from, withEmpty, previousEnd === start);
    withEmpty.push(block);
    previousEnd = block.to;
  }
  addEmpty(previousEnd, text.length, withEmpty, blocks.length === 0, true);
  if (!withEmpty.length && start < text.length + 1) withEmpty.push({ from: text.length, to: text.length, kind: 'Empty' });
  return withEmpty;

  function addEmpty(from: number, to: number, output: Block[], leading: boolean, trailing = false): void {
    const gap = text.slice(from, to);
    if (gap.trim()) return;
    const lines = [...gap.matchAll(/\r?\n/g)];
    if (leading && lines.length >= 2) output.push({ from, to: from, kind: 'Empty' });
    const first = 1;
    const last = trailing ? lines.length : lines.length - 1;
    for (let i = first; i < last; i += 2) {
      const pos = from + lines[i].index! + lines[i][0].length;
      output.push({ from: pos, to: pos, kind: 'Empty' });
    }
  }
}

export function blockAt(blocks: readonly Block[], position: number): Block | undefined {
  return blocks.find(b => b.from <= position && position <= b.to);
}

function newline(text: string): string { return text.includes('\r\n') ? '\r\n' : '\n'; }

export function insertBlock(text: string, block: Block, above: boolean): Edit {
  const nl = newline(text);
  const at = above ? block.from : block.to;
  const insert = nl.repeat(2);
  return { from: at, to: at, insert, cursor: above ? at : at + insert.length };
}

/** Slot is a boundary in the original block array, before removal. */
export function moveBlock(text: string, blocks: readonly Block[], source: number, slot: number): Edit | null {
  if (source < 0 || source >= blocks.length || slot < 0 || slot > blocks.length) return null;
  if (slot === source || slot === source + 1) return null;
  const low = Math.min(source, slot);
  const high = Math.max(source, slot - 1);
  const region = blocks.slice(low, high + 1);
  const gaps = region.slice(0, -1).map((block, i) => text.slice(block.to, region[i + 1].from));
  const reordered = [...region];
  const [moving] = reordered.splice(source - low, 1);
  const destination = slot > source ? slot - low - 1 : slot - low;
  reordered.splice(destination, 0, moving);
  const nl = newline(text);
  function requiredGap(a: Block, b: Block): number {
    return /List$/.test(b.kind) && b.kind === a.kind ? 1 : 2;
  }
  const before = low > 0 ? blocks[low - 1] : undefined;
  const after = high + 1 < blocks.length ? blocks[high + 1] : undefined;
  const priorGap = before ? text.slice(before.to, region[0].from) : '';
  const extraBefore = before ? Math.max(0, requiredGap(before, reordered[0]) - (priorGap.match(/\n/g) ?? []).length) : 0;
  let insert = nl.repeat(extraBefore);
  let cursor = region[0].from;
  reordered.forEach((block, i) => {
    if (i) {
      const required = requiredGap(reordered[i - 1], block);
      const gap = gaps[i - 1];
      const count = (gap.match(/\n/g) ?? []).length;
      insert += count >= required ? gap : gap + nl.repeat(required - count);
    }
    if (block === moving) cursor = region[0].from + insert.length;
    insert += text.slice(block.from, block.to);
  });
  if (after) {
    const nextGap = text.slice(region[region.length - 1].to, after.from);
    insert += nl.repeat(Math.max(0, requiredGap(reordered[reordered.length - 1], after) - (nextGap.match(/\n/g) ?? []).length));
  }
  return { from: region[0].from, to: region[region.length - 1].to, insert, cursor };
}
