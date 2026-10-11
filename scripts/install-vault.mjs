import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const index = args.indexOf('--vault');
if (index < 0 || !args[index + 1]) throw new Error('Usage: npm run install:vault -- --vault /absolute/vault [--dry-run] [--reload]');
const vault = realpathSync(resolve(args[index + 1]));
if (!existsSync(join(vault, '.obsidian'))) throw new Error('The vault must have a .obsidian directory.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = ['main.js', 'manifest.json', 'styles.css'];
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
if (manifest.id !== 'blocks' || manifest.name !== 'Blocks') throw new Error('Unexpected plugin identity.');
for (const asset of assets) if (!existsSync(join(root, asset))) throw new Error(`Build first. Missing ${asset}.`);
const destination = join(vault, '.obsidian', 'plugins', manifest.id);
if (existsSync(destination) && realpathSync(destination) !== destination) throw new Error('Refusing a symlinked plugin destination.');
const dryRun = args.includes('--dry-run');
const previous = assets.filter(asset => existsSync(join(destination, asset)));
for (const asset of previous) if (lstatSync(join(destination, asset)).isSymbolicLink()) throw new Error(`Refusing a symlinked runtime asset: ${asset}`);
const backup = join(vault, '.obsidian', 'blocks-backups', new Date().toISOString().replace(/[:.]/g, '-'));
if (dryRun) {
  console.log(JSON.stringify({ destination, assets, previous, backup: previous.length ? backup : null, dryRun: true, preserves: 'data.json', reload: args.includes('--reload') }, null, 2));
  process.exit(0);
}
if (previous.length) {
  mkdirSync(backup, { recursive: true });
  for (const asset of previous) copyFileSync(join(destination, asset), join(backup, asset));
}
mkdirSync(destination, { recursive: true });
for (const asset of assets) {
  const source = join(root, asset);
  const target = join(destination, asset);
  copyFileSync(source, target);
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  if (hash(source) !== hash(target)) throw new Error(`Installed asset differs: ${asset}`);
  console.log(`${asset} ${hash(target)}`);
}
console.log(`Installed Blocks in ${destination}${previous.length ? `; backup: ${backup}` : ''}`);
if (args.includes('--reload')) execFileSync('obsidian', [`vault=${basename(vault)}`, 'plugin:reload', 'id=blocks'], { stdio: 'inherit' });
