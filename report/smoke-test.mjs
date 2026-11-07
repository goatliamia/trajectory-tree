// Dependency-free report check: no installed DSH SDK or real session required.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { reportTable } from '../plugin/trajectory-tools/lib/report-data.js';
import { renderReport } from './render.mjs';

const data = reportTable({
  source: { host: 'pi', session: 'synthetic', snapshot: 'snapshot', log: 'log', cut: 1 },
  kind: 'groups', fields: ['turn', 'calls'], rows: [{ id: 'turn:1', turn: 1, calls: 2 }],
});
const original = JSON.stringify(data), evidence = '工具输出 /中文/原文.js';
for (const locale of ['zh-CN', 'en']) {
  const report = renderReport({
    locale, title: 'Smoke report', markdown: '# Smoke report\n\n' + evidence + '\n\n[[figure:calls]]',
    datasets: { summary: data },
    figures: { calls: { id: 'calls', type: 'bar', data: 'summary', fields: { label: 'turn', value: 'calls' } } },
  });
  assert.equal(report.figures.length, 1);
  assert.ok(report.html.includes('data-figure="calls"'));
  assert.ok(report.html.includes(evidence), 'Authored evidence is not translated');
  assert.ok(report.html.includes('data:font/woff2;base64,'), 'Offline fonts are bundled');
  assert.ok(report.html.includes(locale === 'en' ? 'Tool calls' : '工具调用'));
  for (const script of report.html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
}
assert.equal(JSON.stringify(data), original, 'Rendering does not rewrite the frozen dataset');
console.log('PASS report smoke: bound figure, both languages, preserved evidence and offline runtime');
