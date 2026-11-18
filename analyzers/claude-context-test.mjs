import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { datasetFromNative, datasetAtCut } from '../plugin/portable-tools/sources.mjs';
import { hostCapabilities } from '../lib/host-capabilities.mjs';
import { diagnosticLayer } from '../plugin/analysis-view/lib/eval/diagnostic-rules.mjs';

const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const content = text => [{ type: 'text', text }];
const human = text => ({ type: 'user', turnOrigin: 'human', message: { role: 'user', content: text } });
const blob = message => ({ type: 'api-request-blob', hash: hash(message), message });
const shape = { system: content('Recorded system prompt'), tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object' } }] };
const compactShape = { system: content('Recorded system prompt'), tools: [] };
const prompt = { role: 'user', content: '<system-reminder>Worktree instructions</system-reminder>\n\nInspect the tree' };
const reply = { role: 'assistant', content: [
  { type: 'thinking', thinking: 'private-thinking-must-not-be-published', signature: 'private-signature' },
  { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'a.txt' } },
  { type: 'text', text: 'Reading the file' },
] };
const returned = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'File contents' }] };
const skill = { role: 'user', content: content('Base directory for this skill: /skills/review\nReview instructions') };
const compact = { role: 'user', content: '<system-reminder>Compacted context</system-reminder>\nContinue' };
const request = (id, selectedShape, keep, tail, base) => ({ type: 'api-request', id, shapeHash: hash(selectedShape), keep, tail, ...(base ? { base } : {}), params: { model: 'recorded-model' } });
const rows = [
  human(prompt.content),
  { type: 'api-request-shape', shapeHash: hash(shape), shape }, blob(prompt),
  request('r1', shape, 0, [hash(prompt)]),
  ...reply.content.map(block => ({ type: 'assistant', requestRef: 'r1', message: { id: 'm1', role: 'assistant', content: [block] } })),
  { type: 'user', message: returned },
  { type: 'user', isMeta: true, message: skill },
  blob(returned), blob(skill),
  request('r2', shape, 1, [hash(reply), hash(returned), hash(skill)], 'r1'),
  { type: 'assistant', requestRef: 'r2', message: { id: 'm2', role: 'assistant', content: content('Read complete') } },
  human('Continue'),
  { type: 'api-request-shape', shapeHash: hash(compactShape), shape: compactShape }, blob(compact),
  request('r3', compactShape, 0, [hash(compact)], 'r2'), // Dispatch recorded before any response.
  { type: 'user', isMeta: true, message: { content: '<local-command-caveat>Local command</local-command-caveat>' } },
  { type: 'user', message: { content: '<command-name>/reload-plugins</command-name><command-message>reload-plugins</command-message>' } },
];
function load(input = rows) {
  const native = { sessionId: 'capture-test', source: { sha256: hash(input) }, capturedAt: '2026-11-17T00:00:00Z',
    rows: input.map((row, index) => ({ sessionId: 'capture-test', timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(), ...row, __trajectoryLine: index + 1 })) };
  return datasetFromNative('claude', native);
}
const data = load(), { context, sessions: [session] } = data.payload;
assert.equal(session.title, 'Inspect the tree');
assert.equal(session.totals.turns, 2, 'Skill expansion and local commands are context, not user turns');
assert.equal(session.totals.calls, 1);
assert.equal(session.timingSource, 'recorded-activity-span');
assert.ok(session.turns.every(turn => turn.endObserved === false));
assert.equal(context.capture.reconstructed, 3);
assert.equal(context.capture.unresolved, 0);
assert.equal(context.requests[0].system > 0, true);
assert.equal(context.requests[0].inject > 0, true);
assert.equal(context.requests[1].skill > 0, true);
assert.equal(context.requests[1].total > context.requests[0].total, true);
assert.deepEqual(context.requests[0].contextSteps, [1, 2], 'Split assistant records join by requestRef and canonical message hash');
assert.equal(context.requests[2].step, null, 'A pending request does not invent an assistant step');
assert.equal(context.requests[2].turn, 2);
assert.equal(session.turns[1].end, context.requests[2].time, 'Pending dispatch extends the observed span, not completion coverage');
assert.equal(session.turns[1].endSeq, context.requests[2].seq);
assert.equal(context.current.tools, 0, 'Tool removals and compaction follow the new recorded request');
assert.equal(context.requests[2].total < context.requests[1].total, true);
assert.equal(hostCapabilities(data.payload).contextComposition, 'recorded-request-estimate');
assert.ok(!JSON.stringify(data).includes('private-thinking-must-not-be-published'));
assert.ok(data.records.some(record => JSON.stringify(record.body).includes('Worktree instructions')), 'Original prompt evidence remains readable');
for (const sample of context.requests) assert.equal(data.records.find(record => record.seq === sample.seq).native.line, sample.contextLine);
const beforePendingRequest = datasetAtCut(data, context.requests[2].seq - 1);
assert.equal(beforePendingRequest.payload.context.requests.length, 2, 'A frozen cut cannot borrow a future request composition');

const broken = load([...rows, request('missing', shape, 1, [], 'absent')]);
assert.equal(broken.payload.context.requests.length, 3);
assert.equal(broken.payload.context.current, null, 'Unresolved latest requests do not display stale composition as current');
assert.equal(broken.payload.context.capture.unresolved, 1);
const damagedRows = rows.map(row => row.type === 'api-request-blob' && row.hash === hash(returned) ? { ...row, message: { role: 'user', content: 'tampered' } } : row);
assert.equal(load(damagedRows).payload.context.capture.reconstructed, 3, 'An independently verified native record can supply an intact message');
const damaged = load(damagedRows.filter(row => row.message !== returned));
assert.deepEqual(damaged.payload.context.requests.map(row => row.requestId), ['r1', 'r3'], 'Hash validation rejects damaged content; an independent compacted request can recover');
const systemText = 'Session-specific instruction';
const systemBlocks = { role: 'system', content: content(systemText) };
const firstUser = { role: 'user', content: content('Inspect') };
const merged = { role: 'user', content: [...returned.content, ...content('Continue')] };
const alternate = load([
  human('Inspect'), { type: 'api-request-shape', shapeHash: hash(shape), shape },
  { type: 'api-request-blob', hash: hash(systemBlocks), message: { role: 'system', content: systemText } },
  request('first', shape, 0, [hash(systemBlocks), hash(firstUser)]),
  { type: 'user', message: returned }, human('Continue'),
  request('second', shape, 2, [hash(merged)], 'first'),
  request('partial', shape, 2, ['missing-body'], 'second'),
  request('recovered', shape, 2, [], 'partial'),
]).payload.context;
assert.deepEqual(alternate.requests.map(r => r.requestId), ['first', 'second', 'recovered']);
assert.ok(alternate.requests[0].inject > 0 && alternate.requests[1].tool > 0);
assert.equal(alternate.capture.unresolved, 1);
const legacy = load(rows.filter(row => !row.type.startsWith('api-request')));
assert.deepEqual(legacy.payload.context.requests, []);
assert.equal(legacy.payload.context.current, null);
const guardText = '<tool_use_error>This session is isolated in the worktree /project/work. Edit the worktree copy of this file instead of the shared-checkout path.</tool_use_error>';
const guards = load([human('Edit the file'),
  { type: 'assistant', message: { id: 'guards', content: [
    { type: 'tool_use', id: 'edit-guard', name: 'Edit', input: { file_path: '/shared/file.txt', old_string: 'a', new_string: 'b' } },
    { type: 'tool_use', id: 'bash-guard', name: 'Bash', input: { command: 'git status' } },
  ] } },
  { type: 'user', message: { content: ['edit-guard', 'bash-guard'].map(tool_use_id => ({ type: 'tool_result', tool_use_id, is_error: true, content: guardText })) } },
]).payload.sessions[0].turns[0].steps[0].calls;
assert.equal(guards[0].attribution.code, 'HOST_WORKTREE_GUARD');
assert.equal(diagnosticLayer(guards[0].attribution), 'host-environment');
assert.equal(guards[0].error.code, 'CLAUDE_TOOL_ERROR', 'Native outcome remains distinct from attribution');
assert.equal(guards[1].attribution.code, 'HOST_WORKTREE_GUARD', 'Bash retains the shared worktree control recognition');
console.log('Claude request replay, boundaries, pending requests and legacy coverage checks passed');
