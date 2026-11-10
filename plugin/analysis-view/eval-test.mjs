import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { summarizeTrajectoryEval } from './lib/eval-metrics.js';
import { apply } from './lib/index.js';
import { buildTracePayload } from './lib/trace-build.js';
import { errorsForTurn } from './lib/eval/overview/shared.mjs';

const text = value => [{ type: 'text', text: value }];
const args = { file_path: '/project/panel.js', old_string: 'old', new_string: 'new' };
const raw = [
  ['turn/start', { turn: 1 }],
  ['step/start', { turn: 1, step: 1 }],
  ['tool/call', { turn: 1, step: 1, callId: 'first', name: 'edit', arguments: args }],
  ['tool/result', { turn: 1, step: 1, error: { code: 'FS_NOT_OBSERVED' }, message: { toolCallId: 'first', content: text('Read before editing') } }],
  ['step/end', { turn: 1, step: 1 }],
  ['step/start', { turn: 1, step: 2 }],
  ['tool/call', { turn: 1, step: 2, callId: 'second', name: 'edit', arguments: args }],
  ['tool/result', { turn: 1, step: 2, message: { toolCallId: 'second', content: text('File updated') } }],
  ['step/end', { turn: 1, step: 2 }],
  ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ['turn/start', { turn: 2 }],
  ['step/start', { turn: 2, step: 1 }],
  ['tool/call', { turn: 2, step: 1, callId: 'last', name: 'edit', arguments: args }],
  ['tool/result', { turn: 2, step: 1, error: { code: 'FS_NOT_OBSERVED' }, message: { toolCallId: 'last', content: text('Read before editing') } }],
  ['tool/call', { turn: 2, step: 1, callId: 'pending', name: 'read', arguments: args }],
  ['tool/call', { turn: 2, step: 1, callId: 'mode', name: 'run_code', arguments: {} }],
  ['tool/ptc-dispatch', { rootCallId: 'mode', subCallId: 'probe', name: 'query', arguments: {}, isError: true, content: text('timed out after 3000ms') }],
  ['tool/result', { turn: 2, step: 1, message: { toolCallId: 'mode', content: text('Probe ended') } }],
  ['tool/call', { turn: 2, step: 1, callId: 'shell', name: 'pwsh', arguments: {} }],
  ['tool/result', { turn: 2, step: 1, message: { toolCallId: 'shell', isError: true, content: text('Tool error') } }],
  ['step/end', { turn: 2, step: 1 }],
].map(([type, data], seq) => ({ type, data, seq, time: seq * 10 }));

test('tool outcomes and per-call errors use the trajectory classification and retry pairs', () => {
  const session = buildTracePayload(raw, 'test').sessions[0];
  const { cut, execution, turns } = summarizeTrajectoryEval(session);
  assert.equal(cut, raw.at(-1).seq);
  assert.deepEqual([execution.calls, execution.returned, execution.errors, execution.unknown], [6, 1, 4, 1]);
  assert.deepEqual(execution.attributionCoverage, { confirmed: 3, candidate: 0, unclassified: 1, noOutput: 0 });
  assert.equal(execution.outcomeCoverage, 5 / 6);
  assert.equal(execution.errorRate, 4 / 5);
  assert.deepEqual(turns.map(({ execution: scope }) => [scope.calls, scope.returned, scope.errors, scope.unknown]), [[2, 1, 1, 0], [4, 0, 3, 1]]);
  const [readFirst] = execution.errorsByCondition;
  const timeout = execution.errorsByCondition.find(group => group.code === 'TOOL_TIMEOUT');
  const unspecified = execution.errorsByCondition.find(group => group.code === 'TOOL_ERROR');
  assert.deepEqual([readFirst.code, readFirst.calls, readFirst.matched, readFirst.tools],
    ['FS_NOT_OBSERVED', 2, 1, [{ name: 'edit', count: 2 }]]);
  assert.equal(readFirst.rows[0].retry, null);
  assert.deepEqual(readFirst.rows[1].failure, { seq: 2, callId: 'first' });
  assert.deepEqual(readFirst.rows[1].retry, { seq: 6, callId: 'second' });
  assert.equal(timeout.rows[0].tool, 'query');
  assert.equal(timeout.rows[0].failure.callId, null);
  assert.equal(timeout.rows[0].startSeq, 10);
  assert.equal(unspecified.rows[0].tool, 'pwsh');
  assert.equal(turns[1].execution.errorsByCondition.find(group => group.code === 'FS_NOT_OBSERVED').matched, 0);
});

test('tool timing follows the selected scope and requires a recorded call and result', () => {
  const { execution, turns } = summarizeTrajectoryEval(buildTracePayload(raw, 'test').sessions[0]);
  const { byTool, ...timing } = execution.timing;
  assert.deepEqual(timing, { calls: 6, pairedCalls: 4, missingCalls: 2, coverage: 4 / 6 });
  const { rows, ...edit } = byTool.find(tool => tool.name === 'edit');
  assert.deepEqual(edit, { name: 'edit', calls: 3, pairedCalls: 3, missingCalls: 0, coverage: 1,
    cumulativeMs: 30, p50Ms: 10, p95Ms: 10 });
  assert.deepEqual(rows[0], { turn: 2, startSeq: 10, record: { seq: 12, callId: 'last' }, resultSeq: 13, durationMs: 10 });
  for (const name of ['read', 'query']) {
    const tool = byTool.find(item => item.name === name);
    assert.deepEqual([tool.pairedCalls, tool.missingCalls, tool.p50Ms, tool.rows.length], [0, 1, null, 0]);
  }
  assert.deepEqual(turns.map(({ execution: scope }) => [scope.timing.calls, scope.timing.pairedCalls]), [[2, 2], [4, 2]]);
  assert.equal(summarizeTrajectoryEval({ turns: [] }).execution.timing.coverage, null);

  const withDispatchStart = raw.flatMap(event => event.type === 'tool/ptc-dispatch'
    ? [{ ...event, type: 'tool/ptc-dispatch-start' }, event] : [event])
    .map((event, seq) => ({ ...event, seq }));
  const paired = summarizeTrajectoryEval(buildTracePayload(withDispatchStart, 'test').sessions[0]);
  const dispatch = paired.execution.timing.byTool.find(tool => tool.name === 'query');
  assert.equal(dispatch.pairedCalls, 1);
  assert.equal(dispatch.p50Ms, 0);
  assert.deepEqual(dispatch.rows[0].record, { seq: 16, callId: null });
  assert.equal(dispatch.rows[0].resultSeq, 17);
});

test('DSH tool and overview preserve native outcomes alongside attribution', () => {
  const events = raw.map(event => {
    if (event.data.callId === 'shell') return { ...event, data: { ...event.data, arguments: { command: 'node smoke.mjs' } } };
    if (event.data.message?.toolCallId === 'shell') return { ...event, data: { ...event.data, meta: {
      exitCode: 1, stderr: 'connect EACCES 127.0.0.1:1234',
    } } };
    return event;
  });
  const [session] = buildTracePayload(events, 'test').sessions;
  const turn = session.turns[1], calls = turn.steps.flatMap(step => step.calls);
  const shell = calls.find(call => call.id === 'shell');
  assert.equal(shell.status, 'error');
  assert.equal(shell.attribution.code, 'COMMAND_CONNECTION_DENIED');
  assert.equal(shell.attribution.basis, 'native-stderr');
  assert.equal(shell.attribution.exitCode, 1);
  assert.equal(calls.find(call => call.id === 'pending').attribution, undefined);
  const errors = errorsForTurn(session.overview.episodes.filter(episode => episode.turn === turn.number), calls);
  assert.deepEqual(errors.find(error => error.failed === shell.resultSeq).attribution, shell.attribution);
  const group = summarizeTrajectoryEval(session).execution.errorsByCondition.find(row => row.code === shell.attribution.code);
  assert.equal(group.calls, 1);
  assert.equal(group.rows[0].failure.seq, shell.seq);
});

test('framework scopes keep measured spans, paired cache fields and recorded evidence separate', () => {
  const events = raw.slice(0, -1);
  const append = (type, data, surfaceOp) => events.push({ type, data, seq: events.length, time: events.length * 10, surfaceOp });
  append('user/message', { turn: 2, source: { kind: 'user' }, content: text('Deliver the verified panel.') });
  append('assistant/message', { turn: 2, step: 1, usage: { inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0, outputTokens: 10 } });
  append('assistant/message', { turn: 2, step: 1, usage: { cacheReadTokens: 60 } });
  append('assistant/message', { turn: 2, step: 1, usage: { inputTokens: 900 } }, { op: 'replace' });
  append('workspace/changes', { turn: 2 });
  append('deliverables/presented', { turn: 2, files: [{ path: '/project/panel.js' }] });
  append('goal/change', { turn: 2, operation: 'create', goal: { id: 'panel', objective: 'Deliver panel' } });
  append('request/header', { turn: 2, header: { tools: [] } });
  append('compaction/prune', { turn: 2 });
  append('compaction/start', { turn: 2 });
  append('compaction/end', { turn: 2 });
  append('subagent/catalog', { turn: 2, childId: 'child' });
  append('user/message', { turn: 2, source: { kind: 'subagent-settled' }, content: text('Child returned') });
  append('step/end', { turn: 2, step: 1 });
  const session = buildTracePayload(events, 'test').sessions[0];
  const { metrics, turns } = summarizeTrajectoryEval(session, { events,
    official: { source: 'fixture', snapshot: { turns: [{ turn: 2, steps: [{ wall: 20, ttft: 0 }] }] } },
    projections: { source: 'fixture', values: {
      contextPressure: { pressureTokens: 10, projectedTokens: 12, contextWindow: 100 },
    } },
    requestContext: { requests: [{ turn: 2, system: 1, tools: 2, user: 3, inject: 4, skill: 0, assistant: 5, tool: 6 }] },
  });
  assert.deepEqual(metrics.timing.turns, { total: 2, measured: 1, ms: 90 });
  assert.deepEqual(metrics.timing.official.fields.ttft, { value: 0, samples: 1 });
  assert.deepEqual(metrics.timing.official.fields.decode, { value: null, samples: 0 });
  assert.equal(turns[0].metrics.timing.official.fields.wall.value, null);
  assert.deepEqual([metrics.usage.requests, metrics.usage.input, metrics.usage.cacheRead, metrics.usage.cacheWrite, metrics.usage.cacheEfficiency],
    [2, 20, 140, 0, 0.8]);
  assert.equal(metrics.usage.cacheEfficiencySample.records, 1);
  assert.equal(turns[0].metrics.usage.input, null);
  assert.deepEqual(metrics.files.access, { read: 1, match: 0, write: 3 });
  assert.equal(metrics.files.returnedWriteCalls, 1);
  assert.equal(turns[0].metrics.files.access.write, 2);
  assert.equal(metrics.repeats.groups, 1);
  assert.equal(turns[1].metrics.repeats.groups, 0);
  assert.deepEqual([metrics.task.prompts, metrics.task.workspaceObservations, metrics.task.deliveries, metrics.task.goalChanges], [1, 1, 1, 1]);
  assert.deepEqual(metrics.task.turnReasons, { completed: 1, open: 1 });
  assert.deepEqual([metrics.context.headers, metrics.context.toolResultPrunes, metrics.context.compactionsEnded,
    metrics.context.childSessions, metrics.context.settledMessages], [1, 1, 1, 1, 1]);
  assert.equal(metrics.context.requestComposition.peakTokens, 21);
  assert.equal(metrics.context.pressure.projectedTokens, 12);
  assert.equal(turns[1].metrics.context.pressure, null);
  assert.equal(turns[0].metrics.context.childSessions, 0);
});

test('file read order uses paired calls in the selected scope', () => {
  const rows = [
    ['turn/start', { turn: 1 }],
    ['step/start', { turn: 1, step: 1 }],
    ['tool/call', { callId: 'before', name: 'read', arguments: args }],
    ['tool/result', { message: { toolCallId: 'before', content: text('old') } }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ['turn/start', { turn: 2 }],
    ['step/start', { turn: 2, step: 1 }],
    ['tool/call', { callId: 'write', name: 'edit', arguments: args }],
    ['tool/call', { callId: 'overlap', name: 'read', arguments: args }],
    ['tool/result', { message: { toolCallId: 'write', content: text('Updated') } }],
    ['tool/result', { message: { toolCallId: 'overlap', content: text('Unknown revision') } }],
    ['tool/call', { callId: 'other', name: 'read', arguments: { file_path: '/project/other.js' } }],
    ['tool/result', { message: { toolCallId: 'other', content: text('Another file') } }],
  ];
  const summarize = rows => {
    let turn, step;
    const events = rows.map(([type, data], seq) => {
      turn = data.turn ?? turn; step = data.step ?? step;
      return { type, seq, time: seq * 10, data: { turn, step, ...data } };
    });
    return summarizeTrajectoryEval(buildTracePayload(events, 'test').sessions[0], { events });
  };
  const first = summarize(rows);
  const counts = ({ files }) => [files.pairedWriteFiles, files.readBeforeFirstWrite, files.readAfterLastWrite];
  assert.deepEqual(counts(first.metrics), [1, 1, 0]);
  assert.deepEqual(counts(first.turns[1].metrics), [1, 0, 0]);
  rows.push(['tool/call', { callId: 'readback', name: 'read', arguments: args }],
    ['tool/result', { message: { toolCallId: 'readback', content: text('new') } }]);
  assert.deepEqual(counts(summarize(rows).turns[1].metrics), [1, 0, 1]);
});

test('the Eval route reads the existing cut and publishes read-only metrics', async () => {
  const disposers = [];
  let route, reads = 0, releases = 0;
  const services = {
    webServer: { register(value) { route = value.handler; return () => {}; } },
    sessionQuery: { async observeSession(sessionId) {
      assert.equal(sessionId, 'test');
      reads++;
      return { events: raw, [Symbol.dispose]() { releases++; } };
    } },
    sessions: new Map([['test', { seq: raw.at(-1).seq + 1 }]]),
    sessionProjections: { snapshot(_session, keys) {
      assert.deepEqual(keys, ['contextPressure']);
      return { asOfSeq: raw.at(-1).seq + 1, values: {} };
    } },
  };
  apply({ get(name) {
    assert.ok(name !== 'llm' && name !== 'agentDefaultModel', 'read-only metrics do not acquire model services');
    return services[name];
  }, effect: run => { disposers.push(run()); } }, { evalToolSort: { get: () => 'errors' } });
  async function request(method, format = '') {
    const req = Object.assign(new EventEmitter(), { method, url: '/analysis-view/eval?session=test' + format, headers: {} });
    const res = new EventEmitter();
    res.writeHead = status => { res.status = status; };
    res.end = value => { res.writableEnded = res.writableFinished = true; res.value = format ? value : JSON.parse(value); };
    await route(req, res);
    return { status: res.status, data: res.value };
  }
  try {
    const response = await request('GET');
    assert.equal(response.status, 200);
    const expected = summarizeTrajectoryEval(buildTracePayload(raw, 'test').sessions[0]);
    assert.equal(response.data.cut, expected.cut);
    assert.deepEqual(response.data.execution, expected.execution);
    assert.equal(response.data.metrics.files.returnedWriteCalls, 1);
    assert.equal(response.data.metrics.context.requestComposition?.peakTokens ?? null, null);
    assert.equal(response.data.turns[0].metrics.repeats.groups, 1);
    const page = await request('GET', '&format=page');
    assert.equal(page.status, 200);
    const dashboard = JSON.parse(page.data.match(/id="eval-data">([^<]+)<\/script>/)[1]);
    assert.equal(dashboard.cut, expected.cut);
    assert.deepEqual(dashboard.whole.outcomes, expected.execution.outcomes ?? Object.fromEntries(
      Object.keys(dashboard.whole.outcomes).map(key => [key, expected.execution[key]])));
    assert.match(page.data, /id="diagnosis-editor"/);
    assert.match(page.data, /analysis-diagnosis-draft/);
    assert.match(page.data, /window\.__trajectoryEvalToolSort = "errors"/);
    assert.equal((await request('POST')).status, 404);
    assert.equal(reads, 2);
    assert.equal(releases, reads);
  } finally { for (const dispose of disposers.reverse()) dispose?.(); }
});
