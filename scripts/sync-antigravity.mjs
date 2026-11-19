#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { CONTEXT_CATEGORIES } from '../docs/demo/layout-review/context-model.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sidecar = join(root, 'plugin/antigravity/sidecars/context_board');
const read = path => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n');
function replaceOnce(source, pattern, replacement) {
  const matches = [...source.matchAll(new RegExp(pattern.source, 'g' + (pattern.multiline ? 'm' : '')))];
  if (matches.length !== 1) throw new Error('Shared context panel changed; review the Antigravity transport adaptation.');
  return source.replace(pattern, replacement);
}
function moduleScope(source, exports) {
  const body = source.replace(/^import [^\n]+;\n/gm, '').replace(/^export \{[^\n]+\};?\n/gm, '').replace(/\bexport (function|const) /g, '$1 ');
  return `const {${exports.join(',')}}=(()=>{\n${body}\nreturn {${exports.join(',')}};\n})();`;
}

export function syncAntigravity({ check = false } = {}) {
  const categories = `// Generated from the shared trajectory context categories.\nexport const CONTEXT_CATEGORIES=${JSON.stringify(CONTEXT_CATEGORIES)};\n`;
  const ui = 'const ui=(text,...values)=>Array.isArray(text)&&Object.hasOwn(text,"raw")?text.map((part,i)=>part+(i<values.length?values[i]:"")).join(""):String(text??"");';
  let panel = read('view/current-context/panel.js');
  panel = replaceOnce(panel, /function stylesheet\(name\)\s*\{[\s\S]*?\n\}/, 'function stylesheet() {}');
  panel = replaceOnce(panel, /const response = await fetch\(base \+ '\?session='[\s\S]*?if \(!response\.ok\) throw new Error\(next\.error \|\| 'HTTP ' \+ response\.status\);/, 'const next = await window.__ttLoadCurrentContext(sessionId);');
  panel = replaceOnce(panel, /const url = new URL\(base \+ '\/body'[\s\S]*?text = result\.text;/, 'text = await window.__ttLoadContextBody(sessionId, version, item.id);');
  panel = panel.replaceAll('当前上下文', '最近请求上下文').replaceAll('当前保留', '请求来源');
  const model = replaceOnce(read('view/current-context/model.js'), /secondary: '#' \+ item\.seq \+ ' · ' \+/, "secondary: (item.seq == null ? '' : '#' + item.seq + ' · ') +");
  const modules = [
    moduleScope(categories, ['CONTEXT_CATEGORIES']),
    moduleScope(read('docs/demo/preset-context/treemap.js'), ['tileLayout']),
    moduleScope(read('docs/demo/preset-context/zoom-treemap.js'), ['toggleZoomFocus', 'zoomMapOverlay', 'zoomMapIndex', 'createZoomTreemap']),
    moduleScope(model.replace('Math.max(480,', 'Math.max(180,'), ['currentContextScene']),
    moduleScope(panel, ['mountCurrentContext']),
  ];
  const css = read('design/tokens.css') + '\n' + read('view/current-context/panel.css').replace(/@font-face\{[^}]+\}/g, '') + '\n' + read('docs/demo/preset-context/zoom-treemap.css') + '\n' + read('plugin/antigravity/sidecars/context_board/styles.base.css');
  const output = new Map([
    ['app.js', `(()=>{\n"use strict";\n${ui}\n${modules.join('\n')}\n${read('plugin/antigravity/sidecars/context_board/app.src.js')}\n})();\n`],
    ['styles.css', css], ['native/categories.mjs', categories],
    ['native/tool-behavior.mjs', read('plugin/analysis-view/lib/eval/workspace/ui/tool-behavior.mjs')],
    ...['Geist-Variable.woff2', 'GeistMono-Variable.woff2'].map(name => ['fonts/' + name, readFileSync(join(root, 'plugin/analysis-view/lib/trace/fonts', name))]),
    ['fonts/LICENSE.txt', read('plugin/analysis-view/lib/trace/fonts/LICENSE.txt')],
  ]);
  const changed = [];
  for (const [name, content] of output) {
    const path = join(sidecar, name), expected = Buffer.from(content);
    let current; try { current = readFileSync(path); } catch {}
    if (current && typeof content === 'string') current = Buffer.from(current.toString('utf8').replaceAll('\r\n', '\n'));
    if (current?.equals(expected)) continue;
    changed.push(name);
    if (!check) { mkdirSync(new URL('./', pathToFileURL(path)), { recursive: true }); writeFileSync(path, expected); }
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--check'), changed = syncAntigravity({ check });
  console.log(JSON.stringify({ ok: !check || !changed.length, changed }));
  if (check && changed.length) process.exitCode = 1;
}
