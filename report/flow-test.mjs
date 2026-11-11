import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { flowGraph, layoutFlowGraph } from './flow.mjs';
import { bindFigure } from './contract.mjs';
import { renderFigure } from './components.mjs';
import { renderReport } from './render.mjs';
import { withUiLocale } from '../lib/i18n.mjs';

const source = { host: 'pi', session: 'flow-fixture', snapshot: 'same-snapshot', log: 'same-log', cut: 5000 };
const dataset = { schema: 'trajectory-data/1', id: 'flow-data', kind: 'records', source,
  columns: { text: { label: '原文摘录', unit: 'text', basis: 'verbatim' } },
  rows: Array.from({ length: 6 }, (_, index) => ({ id: 'record:' + index, text: '工具输出 /中文/原文.js ' + index,
    evidence: [{ session: source.session, log: source.log, seq: 2655 + index }] })) };
const spec = { id: 'branch', type: 'flow', data: 'records', title: 'Sources converge at verification', nodes: [
  { id: 'feedback', row: 'record:0', label: 'Observe the reported files' },
  { id: 'test', row: 'record:1', label: 'Trim the test source', detail: 'Keep the test behavior unchanged' },
  { id: 'model', row: 'record:1', label: 'Trim the timing source' },
  { id: 'generated', row: 'record:2', label: 'Regenerate the shared copy' },
  { id: 'verify', row: 'record:3', label: 'Verify the staged version', kind: 'result' },
], edges: [
  { from: 'feedback', to: 'test', label: 'The check identifies this file', evidence: ['record:0','record:1'] },
  { from: 'feedback', to: 'model', label: 'The same check identifies it', evidence: ['record:0','record:1'] },
  { from: 'model', to: 'generated', label: 'The shared copy uses this source', evidence: ['record:1','record:2'] },
  { from: 'test', to: 'verify', label: 'Verified together', evidence: ['record:1','record:3'] },
  { from: 'generated', to: 'verify', label: 'Included in the staged check', evidence: ['record:2','record:3'] },
] };

test('flow renders only explicit evidence-bound branches and merges', () => {
  const frozen = JSON.stringify({ dataset, spec });
  const graph = flowGraph(dataset, spec), byId = graph.byId;
  assert.equal(byId.get('test').rank, byId.get('model').rank);
  assert.equal(byId.get('verify').incoming.length, 2);
  const layout = layoutFlowGraph(graph);
  assert.equal(layout.links.length, spec.edges.length);
  for (const node of layout.nodes) assert.ok([node.x,node.y,node.width,node.height].every(Number.isFinite));
  for (const [index, a] of layout.nodes.entries()) for (const b of layout.nodes.slice(index + 1)) {
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'Flow cards never overlap');
  }
  const html = withUiLocale('en', () => renderFigure(spec, { records: dataset }));
  assert.match(html, /data-flow-node="test"/);
  assert.match(html, /data-flow-from="test" data-flow-to="verify"/);
  assert.match(html, /data-related-rows="\[&quot;record:3&quot;\]"/);
  assert.match(html, /#2655/);
  assert.match(html, /Relationship evidence/);
  assert.equal(JSON.stringify({ dataset, spec }), frozen, 'Rendering leaves frozen data and declarations intact');
});

test('flow rejects invented endpoints, uncited relationships, cycles and disconnected processes', () => {
  const bind = next => bindFigure({ ...spec, ...next }, { records: dataset });
  assert.throws(() => bind({ edges: [] }), /explicit relationships/);
  assert.throws(() => bind({ limit: 2 }), /numeric chart options/);
  assert.throws(() => bind({ edges: [{ ...spec.edges[0], to: 'absent' }] }), /existing nodes/);
  assert.throws(() => bind({ edges: [{ ...spec.edges[0], evidence: [] }] }), /evidence rows/);
  assert.throws(() => bind({ nodes: [{ ...spec.nodes[0], row: 'absent' }, ...spec.nodes.slice(1)] }), /recorded evidence/);
  assert.throws(() => bind({ edges: [...spec.edges, { from: 'verify', to: 'feedback', label: 'Cycle', evidence: ['record:0'] }] }), /cycle/);
  assert.throws(() => bind({ nodes: [...spec.nodes, { id: 'separate', row: 'record:4', label: 'Another task' }] }), /one connected process/);
  const noEvidence = structuredClone(dataset); noEvidence.rows[0].evidence = [];
  assert.throws(() => bindFigure(spec, { records: noEvidence }), /recorded evidence/);
  const foreign = structuredClone(dataset); foreign.rows[0].evidence[0].log = 'foreign';
  assert.throws(() => bindFigure(spec, { records: foreign }), /another source/);
});

test('decision shapes retain full descriptions without making a successful outcome implicit', () => {
  const decision = structuredClone(spec);
  decision.nodes[0] = { ...decision.nodes[0], kind: 'decision', label: 'Which recorded condition selected these branches?',
    detail: 'This complete description remains available in the selected readout.' };
  const { html } = renderReport({ markdown: '# Conditions\n\n[[figure:branch]]', locale: 'en', datasets: { records: dataset }, figures: { branch: decision } });
  assert.match(html, /flow-node-decision/);
  assert.match(html, /This complete description remains available/);
  assert.ok(!html.includes('flow-node-success'));
});

test('flow preserves native text and source identity in both standalone report languages', () => {
  for (const locale of ['zh-CN', 'en']) {
    const { html } = renderReport({ markdown: '# Branches\n\n[[figure:branch]]', locale,
      datasets: { records: dataset }, figures: { branch: spec } });
    assert.ok(html.includes('工具输出 /中文/原文.js'));
    assert.ok(html.includes('same-snapshot'));
    assert.ok(html.includes('same-log'));
    assert.match(html, /SIL OPEN FONT LICENSE/);
    assert.ok(html.includes(locale === 'en' ? 'Links show verified relationships' : '连线表示已核实的关系'));
    for (const [,script] of html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  }
});

test('flow keeps observed outcomes, analysis conclusions and relationship meanings distinct', () => {
  const annotated = structuredClone(spec);
  annotated.nodes[0].outcome = 'error';
  annotated.nodes[1].outcome = 'unknown';
  annotated.nodes[2].outcome = 'returned';
  annotated.nodes[4].basis = 'analysis';
  const kinds = ['sequence', 'dependency', 'propagation', 'recovery', 'alternative'];
  annotated.edges.forEach((edge, index) => edge.kind = kinds[index]);
  const html = withUiLocale('en', () => renderFigure(annotated, { records: dataset }));
  for (const kind of kinds) assert.ok(html.includes('data-flow-kind="' + kind + '"'));
  for (const outcome of ['error','unknown','returned']) assert.ok(html.includes('data-flow-outcome="' + outcome + '"'));
  assert.match(html, /data-flow-node="verify" data-flow-basis="analysis" data-row=/);
  assert.match(html, /Call failed/);
  assert.match(html, /Analysis conclusion/);
  assert.match(html, /Non-error return/);
  assert.ok(!html.includes('flow-node-success'));
  assert.throws(() => bindFigure({ ...annotated, nodes: annotated.nodes.map(node => node.id === 'verify' ? { ...node, outcome: 'returned' } : node) }, { records: dataset }), /not a recorded execution outcome/);
  assert.throws(() => bindFigure({ ...annotated, nodes: annotated.nodes.map(node => ({ ...node, outcome: 'completed' })) }, { records: dataset }), /Flow outcome/);
  assert.throws(() => bindFigure({ ...annotated, edges: annotated.edges.map(edge => ({ ...edge, kind: 'caused-by-proximity' })) }, { records: dataset }), /relationship kind/);
  const plain = withUiLocale('en', () => renderFigure(spec, { records: dataset }));
  assert.ok(!plain.includes('data-flow-outcome='), 'The renderer never infers an execution outcome from a label or node shape');
  assert.ok(!plain.includes('flow-link-propagation'), 'The renderer never upgrades an untyped relationship to causality');
});

test('flow routes long dependencies through reserved lanes and keeps labels clear', () => {
  const overlaps = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
  const original = JSON.stringify({ dataset, spec });
  for (const orientation of [undefined, 'horizontal', 'vertical']) {
    const layout = layoutFlowGraph(flowGraph(dataset, { ...spec, ...(orientation ? { orientation } : {}) }));
    if (orientation) assert.equal(layout.orientation, orientation);
    assert.equal(layout.collisions,0,orientation || 'auto');
    for (const [index, edge] of layout.links.entries()) {
      assert.ok(!/NaN|Infinity/.test(edge.path));
      for (const node of layout.nodes) assert.ok(!overlaps(edge.labelBox,node),'Link labels leave node text visible');
      for (const other of layout.links.slice(index+1)) assert.ok(!overlaps(edge.labelBox,other.labelBox),'Relationship labels remain separate');
      for (const point of edge.points) assert.ok(point.x>=0 && point.y>=0 && point.x<=layout.width && point.y<=layout.height);
    }
    const start = layout.nodes.find(node=>node.id==='test'), end = layout.nodes.find(node=>node.id==='verify');
    const link = layout.links.find(edge=>edge.from===start.id&&edge.to===end.id);
    assert.ok(link.points.length>=4,'Skipped ranks get a reserved route rather than an invented node');
  }
  assert.equal(JSON.stringify({ dataset, spec }),original);
});

test('multi-record conclusions show first and final pointers without dropping evidence', () => {
  const multiple = structuredClone(dataset);
  multiple.rows[3].evidence = multiple.rows.slice(0,4).flatMap(row=>row.evidence);
  const html = withUiLocale('en',()=>renderFigure(spec,{records:multiple}));
  assert.match(html,/>#2655 … #2658<\/tspan>/);
  assert.match(html,/data-readout="Verify the staged version · #2655 · #2656 · #2657 · #2658"/);
  assert.equal(multiple.rows[3].evidence.length,4);
});
