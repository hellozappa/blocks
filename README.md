# Blocks

Blocks adds a plus button and a six-dot drag handle to the left of the hovered Markdown block in Obsidian's Reading view, Live Preview, and Source mode.

- Click the plus button to insert an empty block below the hovered block. Option-click inserts above.
- Click the handle to select the block. Drag it to another position in the same note, then release to move it.
- The floating block follows the pointer. In the editor, nearby blocks animate into their preview positions. Reading view shows a drop marker. The note changes on drop, with one undo step per move.
- Press Escape to cancel a drag. With the handle focused, press Arrow Up or Arrow Down to move the block, or Enter or Space to select it.

Paragraphs include their soft line breaks. Headings, top-level list items, images, and embeds are separate blocks. A list item carries its nested content. Fenced code, tables, quotes, callouts, display math, and multiline comments move as whole blocks. Separate Obsidian block identifiers stay with their content. Frontmatter has no block controls.

The plugin preserves Markdown content and uses blank lines for empty blocks. Moving content can add blank lines where Markdown needs them to keep neighboring blocks separate. List items retain their markers and numbering. The plugin does not renumber ordered lists. Reduced-motion preferences disable the control and neighboring-block transitions.

By default, clicking a block in Reading view selects it; clicking that selected block again opens Live Preview with the caret where you clicked. In Settings > Blocks, you can instead choose the beginning or end of the block. Images and other widgets without a text caret use a block boundary. Disable this behavior in Settings > Blocks. Links, interactive controls, modified clicks, and text-selection gestures keep their normal behavior.

Reading view controls operate on the note's own rendered sections, including images and top-level list items with their nested content. Moves keep the note in Reading view. The plus button inserts a blank block and switches that note to Live Preview with the caret ready for typing. Blank blocks have visible space in Reading view. Embedded notes do not receive controls that could edit the host note. A move is cancelled if the note changes during the drag.

Selecting a block highlights it and keeps its controls visible. The selected drag handle has a `#F2F2F2` background in light mode and `#444444` in dark mode. Click the note content or press Escape to clear the block selection. In Live Preview and Source mode, Escape selects the block containing the caret when no block is selected. The selected block receives focus through its handle, and the caret is hidden. A second Escape restores the caret. During a drag, Escape cancels it. Up and Down move the selected block. Option+Up and Option+Down select the neighboring block without moving content. This option is enabled by default and can be disabled in Settings > Blocks. The controls have accessible names without hover tooltips or blue focus outlines.

Text selections also highlight the surrounding block background without an additional text highlight. In Settings > Blocks, use the Obsidian accent color or enter a custom hex color and choose it with the color picker. The background uses 18% opacity.

## Build

Requires Node.js and npm.

```sh
npm ci
npm test
npm run build
```

The production runtime consists of `main.js`, `manifest.json`, and `styles.css`. CodeMirror dependencies use Obsidian's host modules. The Markdown parser ships in the plugin bundle.

## Install

Review the destination before installation.

```sh
npm run install:vault -- --vault /absolute/path/to/vault --dry-run
npm run install:vault -- --vault /absolute/path/to/vault
```

The helper backs up existing runtime assets and verifies their SHA-256 hashes after copying. It preserves `data.json`. It does not build or enable the plugin. Enable Blocks in Obsidian's Community plugins settings after the first installation. For an already enabled plugin, `--reload` reloads the installed runtime through the Obsidian CLI.

Automated tests cover Markdown boundaries, content preservation, relative insertion, reordering, undo, and editor integration in a simulated DOM. Smoothness, theme compatibility, popout windows, and mobile behavior require testing in Obsidian.
