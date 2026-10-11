# Blocks

Blocks adds a plus button and a six-dot drag handle to the left of the hovered Markdown block in Obsidian's Live Preview and Source mode.

- Click the plus button to insert an empty block below the hovered block. Option-click inserts above.
- Click the handle to select the block. Drag it to another position in the same note, then release to move it.
- The floating block follows the pointer. Nearby blocks animate into their preview positions. The note changes on drop, with one undo step per move.
- Press Escape to cancel a drag. With the handle focused, press Arrow Up or Arrow Down to move the block, or Enter or Space to select it.

Paragraphs include their soft line breaks. Headings, top-level list items, images, and embeds are separate blocks. A list item carries its nested content. Fenced code, tables, quotes, callouts, display math, and multiline comments move as whole blocks. Separate Obsidian block identifiers stay with their content. Frontmatter has no block controls.

The plugin preserves Markdown content and uses blank lines for empty blocks. Moving content can add blank lines where Markdown needs them to keep neighboring blocks separate. List items retain their markers and numbering. The plugin does not renumber ordered lists. Reading view is not supported in this version. Reduced-motion preferences disable the control and neighboring-block transitions.

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
