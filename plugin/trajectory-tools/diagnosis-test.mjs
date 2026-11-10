import assert from 'node:assert/strict';
import { apply, costRequests } from './lib/index.js';
import { buildInspection } from './lib/inspect.js';

let seq = 0;
const events = [], content = s => [{ type: 'text', text: s }];
const add = (type, data, surfaceOp) => { if (type === 'assistant/message') data.stream ||= []; const e = { seq: seq++, time: seq * 100, type, data, ...(surfaceOp ? { surfaceOp } : {}) }; events.push(e); return e.seq; };
const user = add('user/message', { source: { kind: 'user' }, content: content('Compare the outputs and preserve the running job.') }, 'append');
add('turn/start', { turn: 1 }); add('step/start', { turn: 1, step: 1 });
const earlyHeader = add('request/header', { header: { tools: [
  { name: 'run_code', parameters: { type: 'object' } },
  { name: 'read', description: 'Read a file', parameters: { type: 'object' } },
] } });
for (let i = 0; i < 7; i++) add('request/context', {});
const outer = add('tool/call', { turn: 1, step: 1, callId: 'outer', name: 'run_code', arguments: '{"code":"run"}' });
const args = { command: 'a'.repeat(25000) };
const start = add('tool/ptc-dispatch-start', { rootCallId: 'outer', subCallId: 'sub', name: 'pwsh', arguments: args });
for (let i = 0; i < 80; i++) add('runtime/noise', {});
const inner = add('tool/ptc-dispatch', { rootCallId: 'outer', subCallId: 'sub', name: 'pwsh', arguments: args,
  content: content('Still running; job-7'), meta: { state: 'running', jobId: 'job-7' } });
add('tool/ptc-dispatch', { rootCallId: 'outer', subCallId: 'result-only', name: 'pwsh', arguments: { command: 'check' }, content: content('ok') });
const formal = add('tool/result', { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'outer' }, content: content('{"out":""}') } }, 'append');
add('step/end', { turn: 1, step: 1 }); add('step/start', { turn: 1, step: 2 });
const following = add('assistant/message', { turn: 1, step: 2, message: { content: content('I will inspect job-7 before rerunning.') }, usage: { inputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0, outputTokens: 10, totalTokens: 115 } }, 'append');
add('step/end', { turn: 1, step: 2 }); add('turn/end', { turn: 1, reason: { kind: 'completed' } });
add('user/message', { source: { kind: 'user' }, content: content('Now read the changed file.') }, 'append');
add('turn/start', { turn: 2 }); add('step/start', { turn: 2, step: 1 });
const laterHeader = add('request/header', { header: { tools: [{ name: 'read', description: 'Read a changed file', parameters: { type: 'object' } }] } });
const crossing = add('tool/call', { turn: 2, step: 1, callId: 'crossing', name: 'pwsh', arguments: '{"command":"long running"}' });
const read = add('tool/call', { turn: 2, step: 1, callId: 'read-2', name: 'read', arguments: '{"file_path":"D:/a.txt"}' });
add('tool/result', { turn: 2, step: 1, message: { source: { kind: 'tool', callId: 'read-2' }, content: content('changed file') } }, 'append');
const unicodePath = 'D:/' + '文'.repeat(850) + '.txt';
for (let i = 0; i < 2; i++) {
  add('tool/call', { turn: 2, step: 1, callId: 'unicode-' + i, name: 'read', arguments: JSON.stringify({ file_path: unicodePath }) });
  add('tool/result', { turn: 2, step: 1, message: { source: { kind: 'tool', callId: 'unicode-' + i }, content: content('same file') } }, 'append');
}
const failedRead = add('tool/call', { turn: 2, step: 1, callId: 'failed', name: 'read', arguments: '{"file_path":"D:/missing.txt"}' });
add('tool/result', { turn: 2, step: 1, message: { source: { kind: 'tool', callId: 'failed' }, isError: true, content: content('file missing') } }, 'append');
const pending = add('tool/call', { turn: 2, step: 1, callId: 'pending', name: 'pwsh', arguments: '{"command":"build"}' });
add('assistant/message', { turn: 2, step: 1, message: { content: content('The changed file is verified.') }, usage: { inputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 0, outputTokens: 3, totalTokens: 73 } }, 'append');
const stepEnd = add('step/end', { turn: 2, step: 1 });
add('tool/result', { turn: 2, step: 1, message: { source: { kind: 'tool', callId: 'crossing' }, content: content('done') } }, 'append');
add('turn/end', { turn: 2, reason: { kind: 'completed' } });
// Replacement copies preserve history, but do not add usage or new attempts.
add('assistant/message', { turn: 1, step: 2, message: { content: content('summary') }, usage: { inputTokens: 999999 } }, { op: 'replace', start: following, end: following });
const copiedResult = add('tool/result', structuredClone(events[read + 1].data), { op: 'replace', startSeq: read + 1, endSeq: read + 1 });
events[copiedResult].time += 86400000;
const loaded = { header: { id: 'fixture', version: 4, cwd: 'D:/' }, events };
assert.equal(costRequests(events).length, 2, 'append-origin usage is retained, replacements excluded');
const index = buildInspection(loaded, 'fixture');
assert.equal(index.summary.toolDefinitions.metadataChanges, 7);
assert.ok(!('requestSamples' in index.summary.toolDefinitions));
assert.equal(index.turnEntries[0].promptSeqs[0], user, 'a user request before turn/start belongs to that turn');
const rawTiming = index.stepEntries.find(s => s.turn === 2);
assert.ok(rawTiming.official.toolWall > rawTiming.official.wall, 'official interval union retains the recorded late replacement');

const tools = new Map(), disposers = [];
let observations = 0;
apply({ tools: { register(t) { tools.set(t.name, t); return () => {}; } }, effect(fn) { disposers.push(fn()); },
  get(name) { if (name === 'sessionQuery') return { async observeSession() { observations++; return { ...loaded, source: 'persisted', [Symbol.dispose]() {} }; } }; },
}, { reconcile: false });
const invoke = (name, args) => tools.get(name).execute({ session: 'fixture', ...args }, { signal: new AbortController().signal });
const first = await invoke('trajectory_inspect', { view: 'overview', turns: { from: 1, to: 1 }, groupBy: 'turn' });
assert.equal(first.ok, true); assert.equal(first.items[0].samples[0].prompt.text, 'Compare the outputs and preserve the running job.');
assert.equal(first.summary.usage.input, 5); assert.ok(!('method' in first)&&!('methodRef' in first)&&!('outputRule' in first));
assert.equal(first.summary.usage.settlements, 1); assert.equal(first.summary.usage.requests, undefined, 'settlements do not claim to count attempts');
const snapshot = first.snapshot;
const second = await invoke('trajectory_inspect', { snapshot, view: 'overview', turns: { from: 2, to: 2 }, groupBy: 'turn' });
assert.equal(second.ok, true); assert.equal(second.summary.usage.input, 50);
assert.equal(second.summary.official.toolWall, rawTiming.official.toolWall, 'Preserve official interval coverage; report crossing step bounds separately');
assert.equal(second.coverage.timing.toolSpansOutsideStep, 1);
assert.deepEqual(second.summary.toolOutcomes, { calls: 6, returned: 4, errors: 1, unknown: 1,
  known: 5, outcomeCoverage: 5 / 6, errorRate: 1 / 5 });
const latency = await invoke('trajectory_inspect', { snapshot, view: 'latency', turns: { from: 2, to: 2 }, focus: { tool: 'read' } });
const clipped = events[stepEnd].time - events[crossing].time;
assert.deepEqual(latency.items[0].recordedToolTiming, {
  calls: 6, pairedCalls: 5, stepSpanMs: events[stepEnd].time - rawTiming.evidence.start,
  crossStepCalls: 1, cumulativeMs: clipped + 400, coveredMs: clipped,
}, 'whole owning step clips a crossing call, counts overlap once and omits unresolved timestamps');
assert.equal(latency.summary.recordedToolTiming.sumStepCoveredMs, clipped);
const turnLatency = await invoke('trajectory_inspect', { snapshot, view: 'latency', groupBy: 'turn', turns: { from: 2, to: 2 }, samples: false });
assert.deepEqual(turnLatency.items[0].recordedToolTiming, latency.summary.recordedToolTiming);
const timingTable = await invoke('trajectory_inspect', { snapshot, view: 'latency', format: 'data', limit: 2 });
assert.equal(timingTable.columns.clippedToolCoveredMs.basis, 'derived');
assert.deepEqual(timingTable.rows.map(row => [row.calls, row.pairedToolCalls, row.clippedToolCoveredMs]),
  [[2, 1, events[inner].time - events[start].time], [0, 0, 0]], 'result-only dispatch lacks a recorded start');
const timingTail = await invoke('trajectory_inspect', { cursor: timingTable.nextCursor });
assert.equal(timingTail.rows[0].clippedToolCoveredMs, clipped);
assert.ok(timingTail.rows[0].evidence.some(ref => ref.seq === stepEnd));
assert.equal(second.method, undefined); assert.equal(second.outputRule, undefined);
assert.equal(observations, 1, 'changing the query range reuses one prepared cut');
const toolsInSecond = await invoke('trajectory_inspect', { snapshot, view: 'cost', turns: { from: 2, to: 2 } });
assert.deepEqual(toolsInSecond.largestDefinitions.map(d => d.name), ['read'], 'removed declarations do not leak into later turn scope');
const earlyRead = await invoke('trajectory_inspect', { snapshot, view: 'cost', focus: { tool: 'read' }, turns: { from: 1, to: 1 } });
assert.deepEqual(earlyRead.largestDefinitions.map(d => [d.name, d.versions, d.firstHeaderSeq, d.lastHeaderSeq, d.invocationsInScope, d.owner]),
  [['read', 1, earlyHeader, earlyHeader, 0, null]], 'an uncalled tool retains just its scoped declaration and unknown owner');
const changedRead = await invoke('trajectory_inspect', { snapshot, view: 'cost', focus: { tool: 'read' } });
assert.deepEqual(changedRead.largestDefinitions.map(d => [d.name, d.versions, d.firstHeaderSeq, d.lastHeaderSeq]),
  [['read', 2, earlyHeader, laterHeader]], 'a focused comparison retains both declaration versions across the full scope');
assert.deepEqual(changedRead.reads.slice(0, 2).map(read => read.args.seq), [earlyHeader, laterHeader],
  'selected tool declarations have immediately usable original-record pointers');
const group = await invoke('trajectory_inspect', { snapshot, view: 'io', groupBy: 'file', sort: 'count', focus: { file: 'd:\\a.txt' } });
assert.equal(group.items[0].calls, 1); assert.equal(group.items[0].examples[0].seq, read);
const selected = await invoke('trajectory_inspect', { snapshot, view: 'cost', focus: { tool: 'read' }, sort: 'time' });
assert.equal(selected.items.length, 1); assert.equal(selected.items[0].turn, 2);
assert.match(selected.scope.metricsScope, /whole steps/);
const compactRead = await invoke('trajectory_inspect', { snapshot, view: 'cost', focus: { tool: 'read' }, sort: 'time', samples: false, limit: 1 });
assert.deepEqual(compactRead.summary.usage, selected.summary.usage, 'omitting excerpts preserves scoped usage');
assert.deepEqual(compactRead.largestDefinitions, selected.largestDefinitions, 'compact response keeps declaration evidence');
assert.equal(compactRead.items[0].evidence.following, undefined, 'no-excerpt request keeps step pointers without reply text');
const outerCost = await invoke('trajectory_inspect', { snapshot, view: 'cost', focus: { tool: 'run_code' } });
assert.equal(outerCost.summary.steps, 1, 'unwrapped transport remains queryable by its real name');
const outerCalls = await invoke('trajectory_inspect', { snapshot, view: 'io', focus: { tool: 'run_code' }, groupBy: 'tool' });
assert.equal(outerCalls.items[0].calls, 1);
assert.equal(outerCalls.items[0].returnedCharacters, null, 'unretained outer content size is unknown, not zero');
assert.equal(outerCalls.reads[0].args.seq, outer);
const unicodePage = await invoke('trajectory_inspect', { snapshot, view: 'io', focus: { file: unicodePath }, turns: { to: 2, from: 2 }, limit: 1 });
assert.ok(unicodePage.nextCursor.length > 3000, 'a supported Unicode selector can produce a long cursor');
const unicodeNext = await invoke('trajectory_inspect', { cursor: unicodePage.nextCursor, turns: { from: 2, to: 2 }, limit: 1 });
assert.equal(unicodeNext.ok, true); assert.equal(unicodeNext.offset, 1);

const errors = await invoke('trajectory_inspect', { snapshot, view: 'io', outcome: 'error', groupBy: 'tool' });
assert.equal(errors.scope.outcome, 'error');
assert.deepEqual(errors.items.map(r => [r.tool, r.calls, r.errors]), [['read', 1, 1]]);
assert.equal(errors.reads[0].args.seq, failedRead);
const abnormal = await invoke('trajectory_inspect', { snapshot, view: 'io', turns: { from: 2, to: 2 }, outcome: 'abnormal', sort: 'time', limit: 1 });
assert.equal(abnormal.totalEntries, 2);
assert.deepEqual(abnormal.summary.toolOutcomes, second.summary.toolOutcomes, 'the outcome selector does not change the denominator');
assert.equal(abnormal.items[0].status, 'error');
const abnormalNext = await invoke('trajectory_inspect', { cursor: abnormal.nextCursor });
assert.deepEqual(abnormalNext.items.map(r => [r.seq, r.status]), [[pending, 'unknown']]);
assert.equal(abnormalNext.items[0].outputCharacters, null, 'a missing return is distinct from an empty return');
assert.equal((await invoke('trajectory_inspect', { cursor: abnormal.nextCursor, outcome: 'error' })).ok, false);
const failureTable = await invoke('trajectory_inspect', { snapshot, view: 'io', format: 'data', outcome: 'error', focus: { file: 'D:/missing.txt' } });
assert.equal(failureTable.source.query.outcome, 'error');
assert.equal(failureTable.coverage.toolOutcomes.known, 1);
assert.deepEqual(failureTable.rows.map(r => [r.name, r.status, r.evidence[0].seq]), [['read', 'error', failedRead]]);
assert.equal((await invoke('trajectory_inspect', { snapshot, view: 'overview', outcome: 'error' })).ok, false);

const linked = await invoke('trajectory_read', { snapshot, seq: inner, format: 'linked' });
assert.equal(linked.ok, true);
for (const n of [user, start, inner, outer, formal, following]) assert.ok(linked.records.some(r => r.seq === n), 'connected record survives distant log noise: ' + n);
const returned = linked.records.find(r => r.seq === inner);
assert.match(returned['data.meta'].text, /job-7/);
assert.match(linked.records.find(r => r.seq === formal).text.text, /"out":""/);
const detailArgs = returned.more.find(r => r.args.field === 'data.arguments').args;
let piece = await invoke('trajectory_read', detailArgs), rebuilt = piece.text;
assert.equal(piece.format, 'field'); assert.ok(piece.nextRead);
while (piece.nextRead) { piece = await invoke(piece.nextRead.tool, piece.nextRead.args); assert.equal(piece.ok, true); rebuilt += piece.text; }
assert.equal(rebuilt, JSON.stringify(args), 'field paging reconstructs exact full arguments');
const badPath = await invoke('trajectory_read', { snapshot, seq: inner, field: '__proto__.constructor' });
assert.equal(badPath.ok, false, 'field reads cannot traverse prototypes');
const beforeAppend = events.length;
add('assistant/message', { turn: 2, step: 1, message: { content: content('later') } }, 'append');
const cutRead = await invoke('trajectory_read', { snapshot, seq: inner, format: 'linked' });
assert.equal(cutRead.cut, beforeAppend - 1); assert.ok(cutRead.records.every(r => r.seq < beforeAppend));
assert.equal((await invoke('trajectory_read', { snapshot, seq: beforeAppend, field: 'data' })).ok, false);
events[formal].data.message.content = content('mutated');
assert.equal((await invoke('trajectory_read', { snapshot, seq: inner, format: 'linked' })).ok, false, 'mutated evidence is rejected');
assert.equal((await invoke('trajectory_inspect', { snapshot, view: 'context', groupBy: 'file' })).ok, false);
assert.equal((await invoke('trajectory_inspect', { snapshot, view: 'io', focus: { tool: 'read', file: 'D:/a.txt' } })).ok, false);
for (const fn of disposers) fn?.();
console.log('PASS native registered tools: changing scope, object/group queries, truthful metadata, bounded linked reads, exact full-body continuation, append/replacement semantics and frozen evidence');
