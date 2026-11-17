import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const TEXT_EXT = /\.(?:m?js|cjs|ts|tsx|json|md|css|html|yml|yaml|txt|py)$/i;
const SKIP_DIRS = new Set(['.git', '.claude', 'worktrees', 'node_modules', '.dsh', 'out']);
const PERSONAL_PATH_RE = /(?:1410[01]|sql(?:~0020|\s+)event|[CD]:[\\/]+projects\b|[CD]:[\\/]+Users[\\/]+(?!example\d?\b)[A-Za-z0-9_.-]+)/i;
const PORTABLE_DSH_RE = /\b(?:DSH|PTC)\b|预设|<!--\s*\/?host:/i;

function walk(dir, results = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (entry.isFile() && TEXT_EXT.test(entry.name)) results.push(full);
  }
  return results;
}

test('repository text files contain no personal usernames or local machine paths', () => {
  const selfPath = fileURLToPath(import.meta.url);
  const violations = [];
  for (const file of walk(root)) {
    if (file === selfPath || file.endsWith('.real.json') || file.endsWith('.real.html')) continue;
    const text = readFileSync(file, 'utf8');
    const match = PERSONAL_PATH_RE.exec(text);
    if (match) violations.push(`${relative(root, file).replaceAll('\\', '/')}: ${match[0]}`);
  }
  assert.deepEqual(violations, []);
});

test('portable host skills contain no DSH-specific terminology or host tags', () => {
  const portableDirs = [
    'plugin/codex/skills',
    'plugin/claude/skills',
    'plugin/portable-tools/skills',
    '.agents/skills',
    'dist/trajectory-tree-codex/skills',
    'dist/trajectory-tree-claude/skills',
    'dist/trajectory-tree-pi/plugin/portable-tools/skills',
  ].filter(relDir => existsSync(join(root, relDir)));
  const violations = [];
  for (const relDir of portableDirs) {
    for (const file of walk(join(root, relDir))) {
      const text = readFileSync(file, 'utf8');
      const match = PORTABLE_DSH_RE.exec(text);
      if (match) violations.push(`${relative(root, file).replaceAll('\\', '/')}: ${match[0]}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('documentation index and archive links resolve to existing files', () => {
  for (const docFile of ['docs/INDEX.md', 'docs/archive/README.md', 'docs/diagnostics.md', 'docs/metric-framework.md']) {
    const full = join(root, docFile);
    const text = readFileSync(full, 'utf8');
    for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      const target = match[1].trim();
      if (/^(?:https?:|mailto:|\/)/.test(target)) continue;
      assert.ok(existsSync(resolve(full, '..', target)), `${docFile} broken link -> ${target}`);
    }
  }
});
