#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncAntigravity } from './sync-antigravity.mjs';

const source = fileURLToPath(new URL('../plugin/antigravity/', import.meta.url));
// The install list deliberately contains only the panel and its local assets.
export const INSTALL_FILES = [
  'plugin.json', 'assets/logo.svg',
  ...['sidecar.json', 'package.json', 'index.html', 'main.mjs', 'context-data.mjs', 'request-records.mjs', 'usage-data.mjs',
    'app.js', 'styles.css', 'native/categories.mjs', 'fonts/Geist-Variable.woff2', 'fonts/GeistMono-Variable.woff2', 'fonts/LICENSE.txt']
    .map(name => 'sidecars/context_board/' + name),
];

export function installAntigravity(destination) {
  const target = resolve(destination);
  if (target === resolve(source)) throw new Error('Install destination must differ from the plugin source.');
  for (const file of INSTALL_FILES) {
    const path = join(target, file);
    mkdirSync(dirname(path), { recursive: true }); copyFileSync(join(source, file), path);
  }
  // Remove only the known /ctx prototype shipped by this same plugin. Other
  // user skills and global sidecars are outside the installer's ownership.
  const legacySkill = join(target, 'skills/ctx/SKILL.md');
  if (existsSync(legacySkill) && readFileSync(legacySkill, 'utf8').includes('sidecar://trajectory-tree/context_board/')) unlinkSync(legacySkill);
  const legacyWidget = join(target, 'sidecars/context_board/widget-cli.mjs');
  if (existsSync(legacyWidget) && readFileSync(legacyWidget, 'utf8').includes('agy-context-live.html')) unlinkSync(legacyWidget);
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), destAt = args.indexOf('--dest');
  if (args.some((arg, i) => !['--stage-only', '--build-only', '--dest'].includes(arg) && !(destAt >= 0 && i === destAt + 1))) throw new Error('Usage: node scripts/install-antigravity.mjs [--build-only] [--dest <plugin-directory>]');
  if (destAt >= 0 && (!args[destAt + 1] || args[destAt + 1].startsWith('--'))) throw new Error('--dest requires a plugin directory');
  syncAntigravity();
  if (args.includes('--stage-only') || args.includes('--build-only')) console.log(JSON.stringify({ ok: true, built: source }));
  else console.log(JSON.stringify({ ok: true, pluginDir: installAntigravity(destAt >= 0 ? args[destAt + 1] : join(homedir(), '.gemini/config/plugins/trajectory-tree')) }));
}
