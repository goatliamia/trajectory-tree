import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { createPiSample } from '../analyzers/pi-sample.mjs';
import { datasetFromNative } from '../plugin/portable-tools/sources.mjs';
import { buildEvalData } from '../plugin/analysis-view/lib/eval/data.mjs';
import { buildTracePayload } from '../plugin/analysis-view/lib/trace-build.js';
import { createRuntimeMetrics } from '../plugin/analysis-view/lib/eval-evidence.js';
import { createOverviewModels } from '../plugin/analysis-view/lib/eval/overview/shared.mjs';
import { portableRuntime } from '../view/eval.mjs';
import { projectPortableOverview } from '../view/overview.mjs';
import { evaluationReportTables, evaluationSession } from './evaluation.mjs';
import { prepareReportData } from './prepare.mjs';
import { bindFigure } from './contract.mjs';
import { renderReport } from './render.mjs';
import { renderFigure } from './components.mjs';
import { collectRecords } from './collect.mjs';
import { ui, withUiLocale } from '../lib/i18n.mjs';

const sourceFor = data => ({ host: data.host, session: data.session, snapshot: 'test-snapshot', log: data.logId,
  cut: data.payload.sessions[0].lastSeq });

test('Eval report scope, tool timings and attribution match the dashboard', () => {
  const data = datasetFromNative('pi', createPiSample({ revision: 'report-eval' }));
  const session = data.payload.sessions[0], source = sourceFor(data);
  const dashboard = buildEvalData(session, portableRuntime(data.payload), { host: 'pi' });
  const catalog = createOverviewModels(), overview = projectPortableOverview(data, catalog);
  const tables = evaluationReportTables(session, dashboard, overview, catalog.models, source);
  const scope = tables.summary.rows[0];
  for (const table of Object.values(tables)) for (const column of Object.values(table.columns)) {
    assert.doesNotMatch(withUiLocale('en', () => ui(column.label)), /[\u3400-\u9fff]/, column.label);
  }
  assert.equal(scope.calls, dashboard.whole.outcomes.calls);
  assert.equal(scope.errors, dashboard.whole.outcomes.errors);
  assert.equal(scope.errorRate, dashboard.whole.outcomes.errorRate);
  assert.equal(tables.errors.rows.length, scope.errors);
  assert.equal(tables['error-types'].rows.reduce((total, row) => total + row.errors, 0), scope.errors);
  assert.equal(tables.tools.rows.reduce((total, row) => total + row.calls, 0), scope.calls);
  assert.equal(tables.calls.rows.filter(row => row.durationMs != null).length, scope.timingPairedCalls);
  assert.equal(tables.calls.rows.reduce((total, row) => total + (row.durationMs ?? 0), 0), scope.durationSumMs);
  for (const tool of dashboard.whole.tools) {
    const row = tables.tools.rows.find(row => row.name === tool.name);
    assert.equal(row.durationP50Ms, tool.timing.p50Ms);
    assert.equal(row.durationP95Ms, tool.timing.p95Ms);
    assert.equal(row.timingMissingCalls, tool.timing.missingCalls);
    assert.equal(row.longCalls, tool.timing.counts.at(-1));
    assert.equal(row.longDurationMs, tool.timing.longMs);
  }
  for (const key of ['confirmed', 'candidate', 'unclassified', 'noOutput']) assert.equal(scope[key], dashboard.whole.attributionCoverage[key]);
  const selected = evaluationSession(session, { from: 2, to: 2 });
  const single = buildEvalData(selected, portableRuntime(data.payload), { host: 'pi' });
  const expected = dashboard.turns.find(row => row.number === 2).metrics;
  assert.deepEqual(single.whole.outcomes, expected.outcomes);
  assert.equal(single.whole.usage.output, expected.usage.output);
  assert.equal(single.whole.files.count, expected.files.count);
});

test('record continuation rebuilds the frozen cut and retains its native pointer', async () => {
  const source = { host: 'codex', session: 'continued', snapshot: 'frozen', log: 'same-log', cut: 10 };
  const argsSeen = [];
  const records = await collectRecords(async (tool, args) => {
    assert.equal(tool, 'trajectory_read'); argsSeen.push(args);
    if (args.cut == null) throw Error('Source changed');
    return { snapshot: source.snapshot, session: source.session, logId: source.log, cut: 10,
      linked: [{ seq: 5, kind: 'result', text: 'original result', length: 15 }] };
  }, source, [5]);
  assert.equal(argsSeen.length, 2);
  assert.equal(argsSeen[1].cut, 10);
  assert.equal(records.rows[0].evidence[0].read.args.cut, 10);
  assert.equal(records.rows[0].evidence[0].read.args.logId, source.log);
});

test('DSH report ranges use the same per-turn usage and error populations', () => {
  const text = value => [{ type: 'text', text: value }];
  const rows = [];
  const add = (type, data) => rows.push({ type, data, seq: rows.length, time: rows.length * 10 });
  for (let turn = 1; turn <= 3; turn++) {
    add('turn/start', { turn }); add('step/start', { turn, step: 1 });
    add('assistant/message', { turn, step: 1, message: { content: text('check') }, usage: { inputTokens: turn * 100, cacheReadTokens: 0, outputTokens: turn * 10 } });
    add('tool/call', { turn, step: 1, callId: 'c' + turn, name: 'pwsh', arguments: { command: 'sample' } });
    add('tool/result', { turn, step: 1, message: { toolCallId: 'c' + turn, isError: turn === 2, content: text('sample') } });
    add('step/end', { turn, step: 1 }); add('turn/end', { turn, reason: { kind: 'completed' } });
  }
  const [session] = buildTracePayload(rows, 'dsh-report').sessions;
  const runtime = createRuntimeMetrics(session, { events: rows });
  const full = buildEvalData(session, runtime);
  const selected = buildEvalData(evaluationSession(session, { from: 2, to: 3 }), runtime);
  assert.equal(selected.whole.outcomes.calls, 2);
  assert.equal(selected.whole.outcomes.errors, full.turns[1].metrics.outcomes.errors);
  assert.equal(selected.whole.usage.output, 50);
});

test('unknown outputs and absent output remain separate even with the same native exit code', () => {
  const data = datasetFromNative('pi', createPiSample({ revision: 'report-unknown' }));
  const session = data.payload.sessions[0], catalog = createOverviewModels();
  const step = session.turns[0].steps[0], template = step.calls[0];
  step.calls = [
    { ...template, seq: 1, resultSeq: 2, status: 'error', error: { code: 'EXIT_1' },
      attribution: { code: 'UNCLASSIFIED_OUTPUT', label: '有返回，原因待确认', certainty: 'unknown', basis: 'unclassified-output' } },
    { ...template, seq: 3, resultSeq: 4, status: 'error', error: { code: 'EXIT_1' },
      attribution: { code: 'NO_OUTPUT', label: '无文字返回', certainty: 'unknown', basis: 'no-output' } },
  ];
  const tables = evaluationReportTables(session, buildEvalData(session, portableRuntime(data.payload), { host: 'pi' }),
    projectPortableOverview(data, catalog), catalog.models, sourceFor(data));
  const groups = tables['error-types'].rows;
  assert.equal(groups.find(row => row.code === 'NO_OUTPUT').errors, 1);
  assert.equal(groups.find(row => row.code === 'UNCLASSIFIED_OUTPUT').errors, 1);
});

test('window tables retain native line identities and unpaired outcomes', () => {
  const data = datasetFromNative('pi', createPiSample({ revision: 'report-window' }));
  const session = data.payload.sessions[0], catalog = createOverviewModels();
  const overview = projectPortableOverview(data, catalog);
  const target = overview.turns[0].requests[0];
  target.input = 500; target.window = [1000, 999999];
  target.seq = null; target.type = null;
  const source = { ...sourceFor(data), host: 'codex' };
  const tables = evaluationReportTables(session, buildEvalData(session, portableRuntime(data.payload), { host: 'pi' }), overview, catalog.models, source);
  const request = tables.requests.rows.find(row => row.nativeLine === 999999);
  assert.equal(request.occupancy, .5);
  assert.equal(request.errors, null);
  assert.ok(request.evidence.every(ref => ref.seq !== 999999));
  assert.equal(tables['window-bands'].rows.find(row => row.name === '50–75%').requests, 1);
});

test('prepare pins Eval tables, checks identities and keeps existing plans usable', async () => {
  const data = datasetFromNative('pi', createPiSample({ revision: 'report-plan' }));
  const session = data.payload.sessions[0], source = sourceFor(data), catalog = createOverviewModels();
  const tables = evaluationReportTables(session, buildEvalData(session, portableRuntime(data.payload), { host: 'pi' }),
    projectPortableOverview(data, catalog), catalog.models, source);
  const plan = { schema: 'trajectory-report-plan/1', sources: {
    summary: { evaluation: { source, table: 'summary' } }, tools: { evaluation: { from: 'summary', table: 'tools' } },
  } };
  const execute = async () => ({ source });
  const evaluation = async (_, request) => tables[request.table];
  const prepared = await prepareReportData(execute, plan, { evaluation });
  assert.equal(prepared.catalog.datasets.summary.examples[0].calls, tables.summary.rows[0].calls);
  const again = await prepareReportData(execute, plan, { evaluation, previous: prepared.bundle });
  assert.deepEqual(again.catalog.reused, ['summary', 'tools']);
  const stale = structuredClone(prepared.bundle);
  delete stale.datasets.summary.coverage.evalVersion;
  const refreshed = await prepareReportData(execute, plan, { evaluation, previous: stale });
  assert.deepEqual(refreshed.catalog.prepared, ['summary', 'tools']);
  const turns = { from: 2, to: 3 };
  await prepareReportData(execute, { ...plan, sources: { summary: { evaluation: { source: { ...source, query: { turns } }, table: 'summary' } } } },
    { evaluation: async (pinned, request) => { assert.deepEqual(pinned.query.turns, turns); return evaluation(pinned, request); } });
  await assert.rejects(prepareReportData(execute, { ...plan, sources: { summary: { evaluation: { source: { ...source, query: { focus: { tool: 'read' } } }, table: 'summary' } } } }, { evaluation }), /unfiltered source/);
  await assert.rejects(prepareReportData(execute, plan, { evaluation: async () => ({ ...tables.summary, source: { ...source, log: 'foreign' } }) }), /another source|another source cut/);
  await assert.rejects(prepareReportData(execute, { ...plan, sources: { x: { evaluation: { source, table: 'unknown' } } } }, { evaluation }), /supported Eval/);
});

test('tables and trends preserve missing measurements and the offline evidence runtime', () => {
  const data = datasetFromNative('pi', createPiSample({ revision: 'report-render' }));
  const session = data.payload.sessions[0], catalog = createOverviewModels();
  const datasets = evaluationReportTables(session, buildEvalData(session, portableRuntime(data.payload), { host: 'pi' }),
    projectPortableOverview(data, catalog), catalog.models, sourceFor(data));
  const table = { id: 'tools', type: 'table', data: 'tools', fields: { label: 'name', value: 'calls' },
    series: ['calls', 'errorRate', 'durationP50Ms'], sort: 'descending' };
  const trend = { id: 'rounds', type: 'trend', data: 'turns', fields: { x: 'turn' }, series: ['errors'] };
  assert.throws(() => bindFigure({ ...trend, series: ['errors', 'outputTokens'] }, datasets), /same unit/);
  const report = renderReport({ locale: 'en', template: 'diagnostic', datasets, figures: { tools: table, rounds: trend },
    markdown: '# Report\n\n## Tool results\n\n[[figure:tools]]\n\n## Error distribution\n\n[[figure:rounds]]' });
  assert.equal(report.figures.length, 2);
  assert.ok(report.html.includes('report-measures'));
  assert.ok(report.html.includes('report-provenance'));
  assert.match(report.html, /SIL OPEN FONT LICENSE/);
  for (const [,script] of report.html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  const ref = datasets.tools.rows.find(row => row.evidence.length).evidence[0];
  const records = { ...datasets.tools, kind: 'records', columns: { text: { label: '原文摘录', unit: 'text', basis: 'verbatim' } },
    rows: [{ id: 'selected', text: 'linked excerpt', evidence: [ref] }, { id: 'unrelated', text: 'unlinked excerpt', evidence: [] }] };
  const withExcerpts = renderReport({ locale: 'en', datasets: { ...datasets, records }, figures: { tools: table }, markdown: '# Report\n\n[[figure:tools]]' });
  const encoded = JSON.parse(withExcerpts.html.match(/id="report-bindings" type="application\/json">([^<]*)<\/script>/)[1]);
  assert.equal(encoded.datasets.records.rows.length, 1);
  assert.equal(encoded.datasets.records.rows[0].text, 'linked excerpt');
});

test('category composition preserves the whole, row evidence, zero and unknown parts', () => {
  const source = { host: 'pi', session: 'pie', snapshot: 'frozen', log: 'same', cut: 5000 };
  const bands = { schema: 'trajectory-data/1', id: 'bands', kind: 'groups', source, columns: {
    name: { label: '对象', unit: 'text', basis: 'derived' }, requests: { label: '请求样本', unit: 'count', basis: 'observed' },
    seq: { label: '返回序号', unit: 'identifier', basis: 'observed' }, turn: { label: '轮次', unit: 'turn', basis: 'identifier' },
  }, rows: [
    { id: 'low', name: '0–75%', requests: 1392, seq: 2655, turn: 39, evidence: [{ session: 'pie', log: 'same', seq: 2655 }] },
    { id: 'high', name: '75–100%', requests: 319, seq: 3436, turn: 43, evidence: [{ session: 'pie', log: 'same', seq: 3436 }] },
    { id: 'none', name: '≥100%', requests: 0, evidence: [] },
  ] };
  const spec = { id: 'share', type: 'donut', data: 'bands', fields: { label: 'name', value: 'requests' } };
  const html = withUiLocale('en', () => renderFigure(spec, { bands }));
  assert.match(html, /1,711/);
  assert.match(html, /18\.6%/);
  assert.match(html, /data-row="high"/);
  assert.match(html, /≥100%/);
  assert.throws(() => bindFigure({ ...spec, series: ['requests'] }, { bands }), /choose either/);
  assert.throws(() => bindFigure(spec, { bands: { ...bands, rows: [{ ...bands.rows[0], requests: -1 }] } }), /negative/);
  const unknown = renderFigure(spec, { bands: { ...bands, rows: [{ ...bands.rows[0], requests: null }, bands.rows[1]] } });
  assert.match(unknown, /记录不完整/);
  assert.ok(!unknown.includes('18.6%'));
  const table = { id: 'exact', type: 'table', data: 'bands', fields: { label: 'name' }, series: ['turn','seq'] };
  const exact = withUiLocale('en', () => renderFigure(table, { bands }));
  assert.match(exact, /Turn 39/);
  assert.match(exact, />2655</);
  assert.doesNotMatch(exact, /2\.7k|identifier/);
});
