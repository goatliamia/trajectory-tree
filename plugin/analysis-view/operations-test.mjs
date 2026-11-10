import assert from 'node:assert/strict';
import { buildTracePayload } from './lib/trace-build.js';
import { traceContext } from './lib/trace-context.js';
import { collectToolResults, toolResultLabel, toolResultEndpoint } from './lib/trace/models/tool-result-model.mjs';

const text = text => [{ type: 'text', text }];
let seq = 0;
const event = (type, data, surfaceOp) => ({ type, seq: seq++, time: seq * 10, data, ...(surfaceOp ? { surfaceOp } : {}) });
const rows = [
  event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 }),
  event('tool/call', { turn: 1, step: 1, callId: 'root', name: 'run_code', arguments: '{"code":"dispatch tools"}' }),
  event('tool/ptc-dispatch-start', { rootCallId: 'root', parentCallId: 'root', subCallId: 'read', name: 'read', arguments: { file_path: 'src/a.ts' } }),
  event('tool/ptc-dispatch', { rootCallId: 'root', parentCallId: 'root', subCallId: 'read', name: 'read', arguments: { file_path: 'src/a.ts' }, content: text('1: alpha\n2: beta'), isError: false }),
  event('tool/ptc-dispatch', { rootCallId: 'root', parentCallId: 'root', subCallId: 'grep', name: 'grep', arguments: { path: 'src', pattern: 'beta' }, content: text('Found 1 of 30 matches\n\nsrc/a.ts\nLine 2: beta\n\n(Full grep result stored at: spill.txt)'), isError: false }),
  event('tool/result', { turn: 1, step: 1, message: { toolCallId: 'root', content: text('done') } }),
  event('step/end', { turn: 1, step: 1 }), event('turn/end', { turn: 1 }),
  event('turn/start', { turn: 2 }), event('step/start', { turn: 2, step: 1 }),
  event('tool/call', { turn: 2, step: 1, callId: 'failed-root', name: 'run_code', arguments: '{"code":"wait"}' }),
  event('tool/ptc-dispatch-start', { rootCallId: 'failed-root', subCallId: 'waiting', name: 'job_output', arguments: { job_id: 'job' } }),
  event('tool/result', { turn: 2, step: 1, error: { code: 'ROOT_ERROR' }, message: { toolCallId: 'failed-root', content: text('parent failed') } }),
  event('tool/call', { turn: 2, step: 1, callId: 'glob', name: 'glob', arguments: '{"pattern":"*.ts","path":"src"}' }),
  event('tool/result', { turn: 2, step: 1, message: { toolCallId: 'glob', content: text('src/a.ts\nsrc/b.ts') } }),
  event('tool/call', { turn: 2, step: 1, callId: 'pure', name: 'run_code', arguments: '{"code":"1+1"}' }),
  event('tool/result', { turn: 2, step: 1, message: { toolCallId: 'pure', content: text('2') } }),
  event('step/end', { turn: 2, step: 1 }), event('turn/end', { turn: 2 }),
];
const payload = buildTracePayload(rows, 'fixture', { cwd: 'D:/work' }), session = payload.sessions[0];
assert.deepEqual(session.turns[0].steps[0].calls.map(c => c.name), ['read', 'grep']);
assert.equal(session.totals.calls, 6);
assert.equal(session.totals.errors, 1, 'a failed wrapper keeps its own recorded error');
assert.equal(session.diagnostics.unresolvedCalls, 1);
const read = session.turns[0].steps[0].calls[0], grep = session.turns[0].steps[0].calls[1];
assert.equal(read.startSeq, 3); assert.equal(read.seq, 4); assert.equal(read.resultSeq, 4); assert.equal(read.rootSeq, 2);
assert.equal(grep.startSeq, null, 'older dispatches must not invent a start event');
const context = traceContext(rows, payload);
assert.deepEqual(context.fileOperations.map(op => [op.path, op.access]), [['D:/work/src/a.ts', 'read'], ['D:/work/src/a.ts', 'match']]);
assert.equal(context.fileOperations[1].matchLines, 1);
assert.equal(context.callFacts[grep.seq].operation.search.total, 30);
assert.equal(context.callFacts[grep.seq].operation.search.truncated, true);
assert.equal(context.callFacts[read.seq].operation.family, 'read');
const outcomes = collectToolResults(session, context.callFacts, context.fileOperations);
assert.ok(outcomes.some(result => result.kind === 'pending' && /待返回/.test(toolResultLabel(result))));
const members = outcomes.filter(result => result.turn === 2).map(result => ({ result }));
assert.equal(toolResultEndpoint(members).kind, 'incident', 'an error replaces the normal endpoint rather than adding a second symbol');
assert.ok(outcomes.some(result => result.calls.some(call => call.name === 'run_code' && call.id === 'pure')), 'pure Code Mode remains visible');

const structured = [...rows];
structured[grep.seq] = { ...structured[grep.seq], data: { ...structured[grep.seq].data, content: text(''), meta: { shape: 'matches', total: 2, files: [{ path: 'other.ts', matches: [{ lineNumber: 8, line: 'one' }, { lineNumber: 9, line: 'two' }] }] } } };
const projected = traceContext(structured, payload);
assert.deepEqual(projected.fileOperations.filter(op => op.access === 'match').map(op => [op.path, op.matchLines]), [['D:/work/other.ts', 2]]);

const dispatch = (type, id, result = {}) => event(type, {
  rootCallId: 'ptc', parentCallId: 'ptc', subCallId: id, name: 'web_fetch',
  arguments: { url: 'https://example.com/' }, ...result,
});
const start = id => dispatch('tool/ptc-dispatch-start', id);
const settle = (id, result) => dispatch('tool/ptc-dispatch', id, result);
const head = [
  event('turn/start', { turn: 3 }), event('step/start', { turn: 3, step: 1 }),
  event('tool/call', { turn: 3, step: 1, callId: 'ptc', name: 'run_code', arguments: {} }),
  start('failed'), start('parallel'),
];
const failed = settle('failed', { isError: true, error: { code: 'TOOL_TIMEOUT' } });
const parallel = settle('parallel', { isError: false });
const retryStart = start('retry');
const retry = settle('retry', { isError: false });
const followup = [event('tool/result', { turn: 3, step: 1, message: { toolCallId: 'ptc', content: text('done') } }),
  event('step/end', { turn: 3, step: 1 }), event('turn/end', { turn: 3 })];
const episode = buildTracePayload([...head, failed, parallel, retryStart, retry, ...followup], 'parallel-ptc')
  .sessions[0].overview.episodes[0];
assert.deepEqual(episode.pairs.map(({ failedSeq, successSeq }) => [failedSeq, successSeq]), [[failed.seq, retry.seq]],
  'a later result from a concurrent PTC subcall is not a retry');
console.log('PASS native dispatch identity/timing, wrapper folding and own errors, pending bodies, grep evidence, path-only exclusions, and PTC retry ordering');
