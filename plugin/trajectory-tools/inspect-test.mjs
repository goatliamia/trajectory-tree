import assert from 'node:assert/strict';
import { buildInspection, inspectionPage, readOfficialProjections, evidencePointers } from './lib/inspect.js';
import { InspectionService } from './lib/inspect-service.js';
import { replayOfficialStats, estimateToolsTokens } from './lib/official-stats.js';
import { apply, logIdentity } from './lib/index.js';
import { projectToolSchema } from '@deepseek-ai/dsh-tools';
import { readFileSync } from 'node:fs';
import { SKILL_BODY } from './lib/skill.js';
import { callTimingSummary } from './lib/tool-intervals.js';

const timed = (start, end, status = 'returned') => ({ startSeq: 1, resultSeq: 2, start, end, status });
assert.deepEqual(callTimingSummary([timed(0, 10), timed(0, 30, 'error'), timed(0, 20, 'cancelled'),
  { startSeq: null, resultSeq: 3, start: 5, end: 5 }, { startSeq: 4, resultSeq: null, start: 5, end: null }]),
  { calls: 5, pairedCalls: 3, missingCalls: 2, coverage: 0.6, cumulativeMs: 60, p50Ms: 20, p95Ms: 30 });
assert.equal(callTimingSummary([{ startSeq: null, resultSeq: 1, start: 1, end: 1 }]).p50Ms, null);
assert.equal(callTimingSummary([]).coverage, null);

let n = 0;
const event = (type, data, surfaceOp) => ({ seq: n++, time: n * 100, type, data, ...(surfaceOp ? { surfaceOp } : {}) });
const content = value => [{ type: 'text', text: value }];
const matches = Array.from({ length: 10 }, (_, i) => ({ path: 'src/match-' + i + '.txt', matches: [{ lineNumber: 8, line: 'hello' }] }));
matches.push({ ...matches[9], path: 'D:/WORK/SRC/MATCH-9.TXT' });
const header = { tools: [
  { name: 'read', description: 'Read a file', parameters: { type: 'object' } },
  { name: 'unused_plugin_tool', description: 'Long documented tool. '.repeat(80), parameters: { type: 'object' }, deferLoading: true },
  { name: 'run_code', description: 'Execute program', parameters: { type: 'object' } },
] };
const events = [event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 }),
  event('request/header', { turn: 1, step: 1, header }), event('request/context', { turn: 1, step: 1 }),
  event('tool/call', { turn: 1, step: 1, callId: 'root', name: 'run_code', arguments: '{"code":"invoke"}' }),
  event('tool/ptc-dispatch-start', { rootCallId: 'root', parentCallId: 'root', subCallId: 'r1', name: 'read', arguments: { file_path: 'a.txt' } }),
  event('tool/ptc-dispatch', { rootCallId: 'root', parentCallId: 'root', subCallId: 'r1', name: 'read', arguments: { file_path: 'a.txt' }, content: content('1: hello\n2: world') }),
  event('tool/result', { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'root' }, content: content('done') } }),
  event('step/end', { turn: 1, step: 1 }), event('step/start', { turn: 1, step: 2 }),
  event('request/context', { turn: 1, step: 2 }),
  event('tool/call', { turn: 1, step: 2, callId: 'r2', name: 'read', arguments: '{"file_path":"a.txt"}' }),
  event('tool/result', { turn: 1, step: 2, message: { source: { kind: 'tool', callId: 'r2' }, content: content('1: hello\n2: world') } }),
  event('step/end', { turn: 1, step: 2 }), event('step/start', { turn: 1, step: 3 }),
  event('tool/call', { turn: 1, step: 3, callId: 'g', name: 'grep', arguments: '{"path":"src","pattern":"hello"}' }),
  event('tool/result', { turn: 1, step: 3, message: { source: { kind: 'tool', callId: 'g' }, content: content('Found 11 matches') },
    meta: { shape: 'matches', total: 11, files: matches } }),
  event('step/end', { turn: 1, step: 3 }), event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
];
const loaded = { events, header: { id: 'fixture', cwd: 'D:/work', version: 4 } };
const projections = { source: 'test-registered-official-projection', values: { contextTimeline: { requests: [
  { seq: 3, turn: 1, step: 1, total: 30, system: 10, tools: 10, tool: 10 },
  { seq: 10, turn: 1, step: 2, total: 30, system: 10, tools: 5, tool: 15 },
] } } };
const index = buildInspection(loaded, 'fixture', { projections });
const official = replayOfficialStats(events).snapshot;
assert.equal(index.coverage.statistics.status, 'available');
assert.equal(index.summary.steps, official.stepCount);
assert.deepEqual(index.stepEntries.map(row => row.official.wall).sort(), Array.from(official.turns).flatMap(t => Array.from(t.steps, s => s.wall)).sort());
const definitions = index.summary.toolDefinitions;
assert.equal(definitions.metadataChanges, 2, 'request/context counts metadata changes');
assert.equal(definitions.requestSamples, undefined, 'metadata changes must not masquerade as requests');
assert.equal(definitions.estimatedSchemaTokenRequests, undefined, 'metadata changes cannot accumulate schema bills');
assert.equal(definitions.definitions.find(d => d.name === 'read').standaloneEstimatedTokens, estimateToolsTokens({ tools: [header.tools[0]] }));
assert.equal(definitions.definitions.find(d => d.name === 'read').invocationsInScope, 2, 'native dispatch start/result is one invocation');
assert.equal(definitions.definitions.find(d => d.name === 'run_code').invocationsInScope, 1, 'Code Mode transport is not falsely unused');
assert.equal(index.definitionItems[0].name, 'unused_plugin_tool');
assert.equal(index.definitionItems[0].owner, null, 'tool names never invent historical plugin ownership');
assert.equal(index.definitionItems[0].deferredRequested, true);
assert.equal(index.views.repeats[0].sameReturnedText, true);
assert.equal(index.views.repeats[0].classification, 'repeat-candidate');
assert.equal(index.views.io.find(r => r.name === 'grep').files[0].access, 'match');
const tailFile = 'D:/work/src/match-9.txt';
const focusedGrep = inspectionPage(index, 'io', 0, 1, { focus: { file: tailFile } }).items[0];
assert.equal(focusedGrep.name, 'grep');
assert.equal(focusedGrep.files.length, 8);
assert.equal(focusedGrep.omittedFiles, 3);
assert.ok(focusedGrep.files.some(f => f.path === tailFile), 'a match outside the first eight remains queryable and appears in its preview');
const fileGroups = inspectionPage(index, 'io', 0, 20, { focus: { tool: 'grep' }, groupBy: 'file' }).items;
assert.equal(fileGroups.length, 10);
assert.equal(fileGroups.find(row => row.file === tailFile).calls, 1, 'path spellings within a call do not duplicate the file-group count');
const readGroup = inspectionPage(index, 'io', 0, 10, { focus: { tool: 'read' }, groupBy: 'tool' }).items[0];
assert.deepEqual(readGroup.timing, { calls: 2, pairedCalls: 2, missingCalls: 0, coverage: 1, cumulativeMs: 200, p50Ms: 100, p95Ms: 100 });
const wrapperGroup = inspectionPage(index, 'io', 0, 10, { focus: { tool: 'run_code' }, groupBy: 'tool' }).items[0];
assert.equal(wrapperGroup.timing.pairedCalls, 0, 'synthetic focused wrapper has no observed timing');
assert.equal(wrapperGroup.timing.p50Ms, null);
let q = 100;
const item = (type, data) => ({ type, data, seq: q++, time: q * 10 });
const partialEvents = [item('turn/start', { turn: 1 }), item('step/start', { turn: 1, step: 1 }),
  item('tool/call', { turn: 1, step: 1, callId: 'wrap', name: 'run_code', arguments: {} }),
  item('tool/ptc-dispatch', { rootCallId: 'wrap', subCallId: 'no-start', name: 'read', arguments: {}, content: content('x') }),
  item('tool/call', { turn: 1, step: 1, callId: 'bad', name: 'read', arguments: {} }),
  item('tool/result', { turn: 1, step: 1, callId: 'bad', error: 'cancelled', message: { isError: true, content: [] } }),
  item('tool/call', { turn: 1, step: 1, callId: 'open', name: 'read', arguments: {} }),
  item('step/end', { turn: 1, step: 1 }), item('turn/end', { turn: 1, reason: { kind: 'aborted' } }),
  item('turn/start', { turn: 2 }), item('step/start', { turn: 2, step: 1 }),
  item('tool/call', { turn: 2, step: 1, callId: 'later', name: 'read', arguments: {} }),
  item('tool/result', { turn: 2, step: 1, callId: 'later', message: { content: [] } }),
  item('step/end', { turn: 2, step: 1 }), item('turn/end', { turn: 2, reason: { kind: 'completed' } })];
const partialIndex = buildInspection({ ...loaded, events: partialEvents }, 'fixture', { statsReader() { throw Error('none'); } });
const partial = inspectionPage(partialIndex, 'io', 0, 10, { turns: { from: 1, to: 1 }, groupBy: 'tool' }).items.find(row => row.tool === 'read');
assert.deepEqual(partial.timing, { calls: 3, pairedCalls: 1, missingCalls: 2, coverage: 1 / 3, cumulativeMs: 10, p50Ms: 10, p95Ms: 10 });
const abnormal = inspectionPage(partialIndex, 'io', 0, 10, { turns: { from: 1, to: 1 }, groupBy: 'tool', outcome: 'abnormal' });
assert.equal(abnormal.items.find(row => row.tool === 'read').timing.calls, 2, 'timing group follows outcome filtering');
assert.equal(abnormal.summary.toolOutcomes.calls, 3, 'outcome coverage remains before outcome filtering');
for (const row of index.views.io) {
  assert.ok(['tool/call', 'tool/ptc-dispatch-start', 'tool/ptc-dispatch'].includes(events[row.seq].type), 'IO seq must open the actual invocation, not its step start');
  assert.equal(row.callSeq, row.seq);
  assert.equal(events[row.stepSeq].type, 'step/start', 'the owning step remains separately navigable');
}
const ioPointers = evidencePointers(inspectionPage(index, 'io', 0, 10));
assert.ok(index.views.io.every(row => ioPointers.some(ref => ref.seq === row.callSeq)), 'read pointers include every actual IO call anchor');
assert.equal(index.views.context[0].net, 0);
assert.equal(index.views.context[0].categoryNetChange.tool, 5, 'net-zero is not no additions');
assert.equal(inspectionPage(index, 'latency', 0, 1).items.length, 1);
const openEvents = events.slice(0, 13);
const nativeOnly = buildInspection({ ...loaded, events: openEvents }, 'fixture', {
  statsReader() { throw Error('statistics unavailable'); },
});
const nativeLatency = inspectionPage(nativeOnly, 'latency', 0, 10);
assert.equal(nativeLatency.coverage.statistics.status, 'unavailable');
assert.equal(nativeLatency.items[0].recordedToolTiming.coveredMs, events[6].time - events[5].time);
assert.equal(nativeLatency.items[1].recordedToolTiming.pairedCalls, 1);
assert.equal(nativeLatency.items[1].recordedToolTiming.coveredMs, null, 'open step has no observed right boundary');
assert.equal(nativeLatency.items[1].evidence.end, null);
assert.equal(nativeLatency.summary.official.wall, null);
assert.equal(inspectionPage(index, 'cost', 0, 1).largestDefinitions.length, 1);
assert.equal(index.views.latency.length, index.stepEntries.length, 'views retain compact references to one step evidence table');
assert.equal(readFileSync(new URL('./skills/trajectory-query/SKILL.md',import.meta.url),'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,''),SKILL_BODY,'runtime skill is loaded from its packaged source');

let restored = 0;
const large = { ...loaded, inherited: 20, events: Array.from({ length: 1002 }, (_, seq) => ({ seq, type: 'test/sample', data: {} })) };
const folded = await readOfficialProjections({ get: name => name === 'sessionProjections' ? {
  restore(checkpoint, batch, floor, sessionHeader, inherited) {
    assert.equal(floor, restored ? 1000 : 0); assert.equal(inherited, 20); assert.equal(sessionHeader, loaded.header);
    assert.equal(checkpoint.count || 0, restored ? 1000 : 0); restored++;
    const count = (checkpoint.count || 0) + batch.length;
    return { checkpoint: { count }, snapshot: { asOfSeq: batch.at(-1).seq, values: { tokenUsage: { officialSample: count } } } };
  },
} : undefined }, large);
assert.equal(restored, 2); assert.equal(folded.asOfSeq, 1001); assert.equal(folded.values.tokenUsage.officialSample, 1002);
const stopped = new AbortController(); stopped.abort();
await assert.rejects(readOfficialProjections({ get: () => ({ restore() { assert.fail('aborted restore must not run'); } }) }, loaded, stopped.signal), /abort/i);

let now = 0, reads = 0;
const service = new InspectionService({ load: async () => { reads++; return loaded; }, identify: logIdentity,
  ctx: { get: () => undefined }, now: () => now });
const first = await service.query({ view: 'latency', limit: 1 }, 'fixture');
const grepTable = await service.query({ snapshot: first.snapshot, view: 'io', format: 'data', focus: { file: tailFile }, groupBy: 'file' }, 'fixture');
assert.deepEqual(grepTable.rows.map(row => [row.file, row.calls]), fileGroups.map(row => [row.file, row.calls]));
assert.equal(grepTable.coverage.toolOutcomes.calls, 1);
assert.equal(grepTable.rows[0].timingPairedCalls, 1);
assert.equal(grepTable.rows[0].durationP95Ms, 100);
const picked = index.views.io.slice(0, 2).map(call => call.seq).sort((a, b) => a - b);
const exact = await service.query({ snapshot: first.snapshot, view: 'io', seqs: [...picked, picked[0], 99999], sort: 'time', limit: 1 }, 'fixture');
assert.deepEqual(exact.scope.callSelection, { requested: 3, matched: 2, unmatched: [99999] });
assert.equal(exact.summary.calls, 2);
const nextExact = await service.query({ cursor: exact.nextCursor, limit: 1 }, 'fixture');
assert.deepEqual([...exact.items, ...nextExact.items].map(call => call.seq), picked);
const exactTable = await service.query({ snapshot: first.snapshot, view: 'io', seqs: picked, format: 'data' }, 'fixture');
assert.deepEqual(exactTable.rows.map(row => row.id), picked.map(seq => 'call:' + seq));
await assert.rejects(service.query({ snapshot: first.snapshot, view: 'context', seqs: picked }, 'fixture'), /requires view=io/);
await assert.rejects(service.query({ cursor: exact.nextCursor, seqs: [picked[0]] }, 'fixture'), /does not match/);
const cut = events.at(-1).seq;
const appended = new InspectionService({ ctx: { get: () => undefined }, load: async () => ({ ...loaded,
  events: [...events, { seq: cut + 1, type: 'turn/start', time: events.at(-1).time + 1, data: { turn: 999 } }],
}) });
try {
  const pinned = await appended.query({ cut, view: 'io', seqs: picked }, 'fixture');
  assert.equal(pinned.scope.toSeq, cut);
  assert.equal(pinned.scope.callSelection.matched, picked.length);
  const linked = await appended.readLinked({ session: 'fixture', cut, seq: picked[0] });
  assert.equal(linked.cut, cut);
  assert.ok(linked.records.every(row => row.seq <= cut));
  await assert.rejects(appended.query({ cut: cut + 2 }, 'fixture'), /cut is unavailable/);
} finally { appended.dispose(); }
assert.ok(first.snapshot); assert.ok(first.nextCursor); assert.ok(first.reads.length);
const continued = await service.query({ view: 'latency', cursor: first.nextCursor, limit: 1 }, 'fixture');
for (const view of ['overview', 'latency', 'cost', 'repeats', 'io', 'context']) {
  for (const result of [await service.query({ snapshot: first.snapshot, view }, 'fixture'), continued]) {
    for (const key of ['method', 'methodRef', 'outputRule', 'reportRule']) assert.ok(!(key in result), 'Evidence results do not carry teaching fields: ' + view + '.' + key);
  }
}
assert.equal(reads, 1, 'pagination reuses compact prepared evidence, not another raw log');
await assert.rejects(service.query({ view: 'cost', cursor: first.nextCursor }, 'fixture'), /view/);
await assert.rejects(service.query({ snapshot: first.snapshot, session: 'other' }, 'fixture'), /another session/);
service.validateRead(first.snapshot, 'fixture', 4, 7, events.filter(e => e.seq >= 4 && e.seq <= 7));
const mutated = structuredClone(events.filter(e => e.seq >= 4 && e.seq <= 7)); mutated[0].data.arguments = 'changed';
assert.throws(() => service.validateRead(first.snapshot, 'fixture', 4, 7, mutated), /changed/);
assert.throws(() => service.validateRead(first.snapshot, 'fixture', 0, 500), /exceeds/);
now += 120001;
await assert.rejects(service.query({ snapshot: first.snapshot }, 'fixture'), /expired/);
service.dispose();
const tiny = new InspectionService({ load: async () => loaded, ctx: { get: () => undefined }, maxBytes: 1 });
await assert.rejects(tiny.query({}, 'fixture'), /budget/); assert.equal(tiny.entries.size, 0); tiny.dispose();
const many = new InspectionService({ load: async () => loaded, ctx: { get: () => undefined } });
const evicted = await many.query({}, 'fixture');
for (let i = 0; i < 4; i++) await many.query({}, 'fixture');
assert.equal(many.entries.size, 4);
await assert.rejects(many.query({ snapshot: evicted.snapshot }, 'fixture'), /expired/); many.dispose();

// Exercise the actual registered tool and its ready-to-call original-record pointers.
const registered = new Map(), disposers = [];
let observed = 0, released = 0;
apply({ tools: { register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name); } },
  effect(fn) { disposers.push(fn()); },
  get(name) { return name === 'sessionQuery' ? { async observeSession(id, options) {
    assert.equal(id, 'fixture'); assert.equal(options.projectionMode, 'none'); observed++;
    return { ...loaded, source: 'prepared', [Symbol.dispose]() { released++; } };
  } } : undefined; },
}, { reconcile: false });
const exec = { sessionId: 'fixture', signal: new AbortController().signal };
const packet = await registered.get('trajectory_inspect').execute({ session: 'fixture', view: 'latency', limit: 1 }, exec);
assert.equal(packet.ok, true); assert.equal(observed, 1); assert.equal(released, 1);
assert.ok(packet.reads.length);
const original = await registered.get(packet.reads[0].tool).execute(packet.reads[0].args, exec);
assert.equal(original.ok, true, 'returned deep read succeeds through the public tool');
assert.equal(original.log.id, packet.log.id, 'diagnostics use the same log identity as historical tools');
assert.ok(JSON.stringify(original).includes('step/start'));
const next = await registered.get('trajectory_inspect').execute({ snapshot: packet.snapshot, view: 'cost' }, exec);
assert.equal(next.ok, true); assert.equal(observed, 2, 'cross-view query reuses the inspection; only deep read reopens the source');
const wrong = await registered.get('trajectory_read').execute({ ...packet.reads[0].args, snapshot: 'expired' }, exec);
assert.equal(wrong.ok, false);

const schemas = [...registered.values()].map(tool => projectToolSchema(tool, true));
const baseline = schemas.filter(s => s.name !== 'trajectory_inspect').map(s => {
  if (s.name === 'trajectory_read') { const copy = structuredClone(s); delete copy.parameters.properties.snapshot; return copy; }
  return s;
});
const before = estimateToolsTokens({ tools: baseline }), after = estimateToolsTokens({ tools: schemas });
assert.ok(after > before);
console.log(JSON.stringify({ officialDefinitionEstimate: { before, after, added: after - before }, basis: 'Official standalone native schemas; excludes Code Mode system catalogs and runtime skill discovery text.' }));
for (const dispose of disposers) dispose?.();
console.log('PASS official stats parity, official schema estimates, native transport use, bounded evidence, grep semantics, net change, snapshot identity, paging, expiry and byte budget');
