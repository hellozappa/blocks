import * as esbuild from 'esbuild';
const production = process.argv[2] === 'production';
const context = await esbuild.context({
  entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', target: 'es2022',
  external: ['obsidian', '@codemirror/*', '@lezer/common', '@lezer/highlight', '@lezer/lr'],
  sourcemap: production ? false : 'inline', outfile: 'main.js', logLevel: 'info',
});
if (production) { await context.rebuild(); await context.dispose(); }
else await context.watch();
