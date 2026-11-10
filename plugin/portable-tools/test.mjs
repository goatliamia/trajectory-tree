import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { createPiSample } from '../../analyzers/pi-sample.mjs';
import { readPiSession } from '../../analyzers/pi-reader.mjs';
import { readCodexHistory } from '../../analyzers/codex-reader.mjs';
import { datasetAtCut, datasetFromNative } from './sources.mjs';
import { PortableService } from './service.mjs';
import { executeTool } from './tools.mjs';
import { commandPageCut, commandReport, executeCommandTool } from './command-diagnosis.mjs';
import { attributeToolFailure } from '../trajectory-tools/lib/tool-attribution.js';

const input = createPiSample({ version: '1.4.0', revision: 'fixture' });
const missingAssistantContent = structuredClone(input);
missingAssistantContent.entries.find(e => e.type === 'message' && e.message.role === 'assistant').message.content = null;
assert.doesNotThrow(() => datasetFromNative('pi', missingAssistantContent));
input.scope = { source: 'pi-sdk-test', observedAt: '2026-10-30T00:00:00Z', systemPrompt: 'system', contextWindow: 200000, tools: [{ name: 'unused_capability', active: true, exposure: 'inline', description: '保持完整能力。'.repeat(5000), parameters: { type: 'object', properties: { path: { type: 'string' } } } }] };
const rawCall = input.entries.flatMap(e => e.message?.role === 'assistant' ? e.message.content : []).find(c => c.type === 'toolCall');
rawCall.arguments.longArgument = '精确参数'.repeat(10000);
rawCall.arguments.literalConfiguration = { type: 'reasoning', text: 'a literal tool parameter, not a hidden reasoning block' };
const service = new PortableService({ load: async () => datasetFromNative('pi', input) });
try {
  const first = await executeTool(service, 'trajectory_inspect', { limit: 2 });
  assert.equal(first.summary.unit, 'assistant-cycle'); assert.equal(first.summary.usage.input, 111300);
  assert.equal(first.summary.usage.cachedInput, 31800); assert.equal(first.synthetic, true);
  assert.equal(first.summary.measuredToolIntervals, 12); assert.ok(first.summary.toolCoveredMs <= first.summary.observedTurnSpanMs);
  assert.equal(first.summary.toolOutcomes.known + first.summary.toolOutcomes.unknown, first.summary.calls);
  const terse = await executeTool(service, 'trajectory_inspect', { snapshot: first.snapshot, samples: false, limit: 2 });
  assert.deepEqual(terse.summary, first.summary, 'Suppressing excerpts preserves the statistics');
  assert.equal(terse.rows[0].firstTask, undefined); assert.equal(terse.rows[0].lastTask, undefined);
  assert.deepEqual(terse.rows[0].read, first.rows[0].read, 'Terse rows retain exact frozen-cut evidence pointers');
  const terseNext = await executeTool(service, 'trajectory_inspect', { cursor: terse.cursor, limit: 2 });
  assert.equal(terseNext.rows[0].firstTask, undefined, 'The sample preference survives cursor continuation');
  await assert.rejects(executeTool(service, 'trajectory_inspect', { cursor: terse.cursor, samples: true }), /Cursor/);
  const page = await executeTool(service, 'trajectory_inspect', { cursor: first.cursor, snapshot: first.snapshot, limit: 2 });
  assert.equal(page.rows[0].turn, 3); assert.ok(!('method' in page)&&!('methodRef' in page)&&!('reportRule' in page));
  for (const view of ['overview', 'latency', 'cost', 'repeats', 'io', 'context']) {
    for (const result of [await executeTool(service, 'trajectory_inspect', { snapshot: first.snapshot, view }), page]) {
      for (const key of ['method', 'methodRef', 'outputRule', 'reportRule']) assert.ok(!(key in result), 'Evidence results do not carry teaching fields: ' + view + '.' + key);
    }
  }
  await assert.rejects(executeTool(service, 'trajectory_inspect', { cursor: first.cursor, focus: { tool: 'read' } }), /Cursor/);
  await assert.rejects(executeTool(service, 'trajectory_inspect', { snapshot: first.snapshot, session: 'other' }), /another session/);
  await assert.rejects(executeTool(service, 'trajectory_inspect', { view: 'unknown' }), /Invalid/);
  const definitions = await executeTool(service, 'trajectory_inspect', { snapshot: first.snapshot, view: 'cost', groupBy: 'definition', focus: { tool: 'unused_capability' } });
  assert.equal(definitions.rows.length, 1); assert.equal(definitions.rows[0].directCallsInRange, 0); assert.equal(definitions.rows[0].active, true);
  const { tool: _, linked, ...defRead } = definitions.rows[0].read;
  const definition = await executeTool(service, 'trajectory_read', { ...defRead, maxChars: 24000 });
  assert.ok(definition.nextRead); assert.equal(definition.native.tool, 'unused_capability');
  const signatureOnly = await executeTool(service, 'trajectory_read', { ...defRead, field: 'parameters' }); assert.equal(JSON.parse(signatureOnly.text).type, 'object'); assert.ok(!signatureOnly.nextRead);
  const entry = service.entries.get(first.snapshot), originalCall = entry.data.payload.sessions[0].turns.flatMap(t => t.steps).flatMap(s => s.calls).find(c => c.id === rawCall.id);
  const shell = entry.data.payload.sessions[0].turns.flatMap(t => t.steps.flatMap(s => s.calls))
    .find(c => c.nativeName === 'bash' && c.status === 'error');
  const shellResult = await commandReport(entry.data, { seqs: [shell.seq] });
  assert.equal(shellResult.rows[0].attribution.code, 'COMMAND_TEST_FAILED');
  assert.equal(shellResult.rows[0].syntax.state, 'other-shell');
  let args = { snapshot: first.snapshot, seq: originalCall.seq, field: 'arguments', maxChars: 7000 }, joined = '';
  do { const piece = await executeTool(service, 'trajectory_read', args); joined += piece.text; if (!piece.nextRead) break; const { tool, ...rest } = piece.nextRead; args = rest; } while (true);
  assert.equal(JSON.parse(joined).longArgument, rawCall.arguments.longArgument, 'long arguments are available without adapter excerpt loss');
  assert.deepEqual(JSON.parse(joined).literalConfiguration, rawCall.arguments.literalConfiguration);
  const linkedRead = await executeTool(service, 'trajectory_read', { snapshot: first.snapshot, seq: originalCall.seq, linked: true });
  assert.ok(linkedRead.linked.some(r => r.kind === 'result')); assert.ok(linkedRead.linked.some(r => r.kind === 'call'));
  rawCall.arguments.longArgument = 'changed after snapshot';
  const old = await executeTool(service, 'trajectory_read', { snapshot: first.snapshot, seq: originalCall.seq, field: 'arguments', maxChars: 1000 });
  assert.ok(old.text.includes('精确参数')); assert.ok(!old.text.includes('changed after snapshot'));
  const changed = await executeTool(service, 'trajectory_inspect', {}); assert.notEqual(first.snapshot, changed.snapshot);
  const noCapture = new PortableService({ load: async () => datasetFromNative('pi', { ...input, capture: [], scope: null }) });
  const timing = await noCapture.call('trajectory_inspect', { view: 'latency' }); assert.equal(timing.summary.toolCoveredMs, null); assert.equal(timing.summary.measuredToolIntervals, 0); noCapture.dispose();
  assert.ok(datasetFromNative('pi', { ...input, capture: [], scope: null }).payload.sessions[0].turns.flatMap(t => t.steps).flatMap(s => s.calls).every(c => c.end == null || c.start === c.end), 'history-only Pi results are point markers, not invented measured intervals');
  const realInput = { ...input, synthetic: false }; const real = datasetFromNative('pi', realInput);
  assert.ok(!real.payload.sessions[0].title.includes('模拟')); assert.equal(real.synthetic, false);
  assert.equal(datasetFromNative('pi', { ...input, scope: { ...input.scope, model: 'another-model', provider: 'synthetic-provider' } }).payload.officialStats.context.pressure.contextWindow, null, 'old usage is not divided by another model capacity');
} finally { service.dispose(); }

const snapshot = { capturedAt: '2026-01-01T00:00:10Z', source: 'test', thread: { id: 'codex-fixture', createdAt: 1767225600, cwd: '/project', turns: [{ id: 'turn', startedAt: 1767225600, completedAt: 1767225610, status: 'completed', items: [
  { id: 'user', type: 'userMessage', content: [{ type: 'text', text: '检查构建' }] },
  { id: 'cmd', type: 'commandExecution', command: 'cat file.js', commandActions: [], aggregatedOutput: 'body', durationMs: 7, exitCode: 0, status: 'completed' },
  { id: 'dyn', type: 'dynamicToolCall', namespace: 'extension', tool: 'check', arguments: { path: '/project/a.js' }, status: 'completed', success: false, contentItems: [{ type: 'text', text: 'failed' }] },
  { id: 'pending', type: 'commandExecution', command: 'npm run build', status: 'inProgress' },
  { id: 'reasoning', type: 'reasoning', content: ['PRIVATE_THINKING'] },
  { id: 'image-view', type: 'imageView', path: '/project/preview.png' },
  { id: 'output-only', type: 'functionCallOutput', namespace: 'extra', name: 'orphan', output: { text: 'output without parameters' } },
] }] } };
const rollout = [
  { timestamp: '2026-01-01T00:00:00Z', type: 'session_meta', payload: { id: snapshot.thread.id } },
  { timestamp: '2026-01-01T00:00:00Z', type: 'turn_context', payload: { turn_id: 'turn' } },
  { timestamp: '2026-01-01T00:00:00Z', type: 'response_item', payload: { type: 'additional_tools', tools: [{ type: 'function', name: 'unmapped_historical_name', description: 'Historical only', parameters: { type: 'object' } }] } },
  { timestamp: '2026-01-01T00:00:01Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn', item: { id: 'cmd' }, started_at_ms: 1767225590000, completed_at_ms: 1767225620000 } },
  { timestamp: '2026-01-01T00:00:02Z', type: 'token_usage_record', payload: { turn_id: 'turn', response_id: 'response', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 10 } } },
  { timestamp: '2026-01-01T00:00:03Z', type: 'token_usage_record', payload: { turn_id: 'turn', response_id: 'response', usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 15 } } },
].map(JSON.stringify).join('\n');
const codex = new PortableService({ load: async () => datasetFromNative('codex', snapshot, { rollout }) });
try {
  const report = await codex.call('trajectory_inspect', { view: 'cost' });
  assert.equal(report.summary.calls, 4); assert.equal(report.summary.errors, 1);
  assert.deepEqual(report.summary.toolOutcomes, { calls: 4, returned: 2, errors: 1, unknown: 1,
    known: 3, outcomeCoverage: 3 / 4, errorRate: 1 / 3 });
  assert.equal(report.summary.usage.records, 1); assert.equal(report.summary.usage.input, 100); assert.equal(report.summary.usage.uncachedInput, 40); assert.equal(report.summary.usage.output, 15);
  assert.equal(report.summary.toolCoveredMs, 10000); assert.equal(report.coverage.crossTurnToolIntervals, 1);
  const io = { snapshot: report.snapshot, view: 'io' };
  const errors = await executeTool(codex, 'trajectory_inspect', { ...io, outcome: 'error', groupBy: 'tool' });
  assert.equal(errors.outcome, 'error');
  assert.deepEqual(errors.rows.map(r => [r.tool, r.count, r.errors]), [['extension/check', 1, 1]]);
  const abnormal = await executeTool(codex, 'trajectory_inspect', { ...io, outcome: 'abnormal', groupBy: 'tool', limit: 1 });
  assert.equal(abnormal.summary.calls, 2); assert.equal(abnormal.summary.errors, 1);
  assert.deepEqual(abnormal.summary.toolOutcomes, report.summary.toolOutcomes);
  const abnormalNext = await executeTool(codex, 'trajectory_inspect', { cursor: abnormal.cursor });
  assert.deepEqual(abnormalNext.rows.map(r => [r.tool, r.count, r.errors, r.positions[0].status]), [['commandExecution', 1, 0, 'unknown']]);
  await assert.rejects(executeTool(codex, 'trajectory_inspect', { cursor: abnormal.cursor, outcome: 'error' }), /Cursor/);
  const table = await executeTool(codex, 'trajectory_inspect', { ...io, format: 'data', outcome: 'abnormal', focus: { tool: 'commandExecution' } });
  assert.equal(table.source.query.outcome, 'abnormal');
  assert.deepEqual(table.coverage.toolOutcomes, { calls: 2, returned: 1, errors: 0, unknown: 1,
    known: 1, outcomeCoverage: 1 / 2, errorRate: 0 });
  assert.deepEqual(table.rows.map(r => [r.name, r.status]), [['commandExecution', 'unknown']]);
  await assert.rejects(executeTool(codex, 'trajectory_inspect', { view: 'overview', outcome: 'error' }), /only available for the io view/);
  const raw = await codex.call('trajectory_search', { snapshot: report.snapshot, query: 'output without parameters' }); assert.equal(raw.rows.length, 1);
  const hidden = await codex.call('trajectory_search', { snapshot: report.snapshot, query: 'PRIVATE_THINKING' }); assert.equal(hidden.total, 0);
  const image = await codex.call('trajectory_search', { snapshot: report.snapshot, query: '/project/preview.png' }); assert.ok(image.total > 0);
  const historyDefinitions = await codex.call('trajectory_inspect', { snapshot: report.snapshot, view: 'cost', groupBy: 'definition' }); assert.equal(historyDefinitions.rows[0].active, null); assert.equal(historyDefinitions.rows[0].directCallsInRange, null); assert.match(historyDefinitions.definitionBasis, /historical/);
  const api = new PortableService({ load: async () => datasetFromNative('codex', snapshot) });
  const partial = await api.call('trajectory_inspect', { view: 'cost' }); assert.equal(partial.summary.usage.input, null); assert.equal(partial.summary.toolCoveredMs, null); api.dispose();
} finally { codex.dispose(); }

const commandsFixture = structuredClone(snapshot);
const commandItems = [
  ['miss', 'rg needle src', ''],
  ['later', 'Get-Content a.txt; rg broken src', 'file body\nrg: regex parse error:'],
  ['child', 'node check.mjs', 'Error: token="private-fixture"\n    at verify (file:///project/check.mjs:12:3)'],
  ['syntax', 'rg needle src/{a.js,b.js}', 'ParserError:\nLine |\n   2 | private-fixture\n     | ~\n     | Missing argument in parameter list.'],
  ['unknown-output', 'Write-Output body; exit 1', 'body'],
  ['unknown-empty', 'exit 1', ''],
  ['unix', 'bash -c true', 'Error: unrelated shell'],
];
commandsFixture.thread.turns[0].items = commandItems.map(([id, script, aggregatedOutput]) => ({
  id, type: 'commandExecution', command: id === 'unix' ? script : 'pwsh.exe -Command rendered',
  aggregatedOutput, status: 'failed', exitCode: 1,
}));
commandsFixture.thread.turns.push({ id: 'live', status: 'interrupted', startedAt: 1767225620, items: [] });
const commandRollout = rollout + '\n' + commandItems.map(([id, script]) => JSON.stringify({
  timestamp: '2026-01-01T00:00:04Z', type: 'event_msg', payload: { type: 'item_completed', item: {
    id, command: id === 'unix' ? ['bash', '-c', 'true'] : ['pwsh.exe', '-Command', script],
  } },
})).join('\n') + '\n' + JSON.stringify({
  timestamp: '2026-01-01T00:00:12Z', type: 'event_msg', payload: { type: 'item_completed', item: {
    id: 'miss', command: ['pwsh.exe', '-Command', 'Write-Output future'],
  } },
});
const commandLoad = () => datasetFromNative('codex', commandsFixture, { rollout: commandRollout, commandDiagnostics: true });
const commandData = commandLoad();
const commandCut = commandPageCut(commandData);
const commandSnapshot = datasetAtCut(commandData, commandCut);
assert.equal(commandSnapshot.payload.sessions[0].turns.length, 1, 'The default page freezes the closed prefix');
const commands = await commandReport(commandSnapshot, { whole: true });
assert.deepEqual(commands.rows.map(row => row.cause.kind), ['no-match', 'pattern', 'child', 'syntax', 'unresolved', 'unresolved']);
assert.equal(commands.rows[1].cause.outputBefore, true);
assert.deepEqual(commands.rows[2].cause.code, { file: 'file:///project/check.mjs', line: 12, column: 3, source: 'runtime-stack' });
assert.deepEqual(commands.rows[3].cause.reported, { id: 'MissingArgument', line: 2 });
assert.equal(commands.rows[3].cause.evidence, 'Missing argument in parameter list.');
assert.equal(commands.rows[4].cause.outputRecorded, true);
assert.equal(commands.rows[5].cause.outputRecorded, undefined);
assert.equal(commands.rows[0].attribution.certainty, 'candidate');
assert.equal(commands.rows[3].attribution.code, 'COMMAND_SYNTAX');
const shellError = { status: 'error', tool: 'commandExecution', exitCode: 1 };
assert.equal(attributeToolFailure({ ...shellError, command: 'rg -n "connect EACCES" src',
  output: 'src/example.js:4:const message = "connect EACCES"' }).certainty, 'unknown');
assert.equal(attributeToolFailure({ ...shellError, command: "rg -n 'old|new' src" }).certainty, 'candidate');
assert.equal(attributeToolFailure({ ...shellError, command: 'node fixture.js',
  output: '{"error":"thread/items/list timed out","elapsedMs":20003}' }).code, 'COMMAND_TIMEOUT');
assert.equal(attributeToolFailure({ ...shellError, command: 'powershell.exe -Command sample',
  output: '    + CategoryInfo : ParserError: (:) []\n    + FullyQualifiedErrorId : MissingArgument' }).evidence, 'MissingArgument');
assert.equal(attributeToolFailure({ ...shellError, tool: 'Bash', command: 'rg needle sample',
  output: 'Command exited with code 1' }).certainty, 'candidate');
assert.equal(attributeToolFailure({ ...shellError, status: 'unknown', command: 'node fixture.js',
  output: 'connect EACCES' }), undefined);
const readFailure = 'Codex App Server exited before completing the read';
assert.equal(attributeToolFailure({ ...shellError, command: 'node fixture.js',
  output: JSON.stringify({ ok: false, error: readFailure }) }).code, 'COMMAND_APP_SERVER_EXITED');
assert.equal(attributeToolFailure({ ...shellError, command: 'node fixture.js',
  output: JSON.stringify({ ok: true, error: readFailure }) }).certainty, 'unknown');
assert.equal(attributeToolFailure({ ...shellError, command: 'git -c core.safecrlf=false diff --check',
  output: 'src/main.js:19: new blank line at EOF.' }).code, 'COMMAND_TEST_FAILED');
assert.equal(attributeToolFailure({ ...shellError, command: 'git log',
  output: 'src/main.js:19: new blank line at EOF.' }).certainty, 'unknown');
assert.equal(attributeToolFailure({ ...shellError, command: 'Start-Process test', stderr: `Start-Process:
Line |
   1 | Start-Process test
     | The process cannot access the file 'output.txt' because it is being used by another process.` }).code, 'COMMAND_FILE_BUSY');
assert.equal(attributeToolFailure({ ...shellError, command: 'node fixture.js',
  stderr: 'response.json: Protocol error. Request content was evicted from inspector cache' }).code, 'COMMAND_RESPONSE_BODY_UNAVAILABLE');
assert.equal(attributeToolFailure({ ...shellError, command: 'pnpm --offline install',
  output: '[ERR_PNPM_NO_OFFLINE_TARBALL] A package is missing from the store' }).code, 'COMMAND_OFFLINE_DEPENDENCY');
assert.equal(attributeToolFailure({ ...shellError, command: 'Get-CimInstance example',
  output: 'Get-CimInstance:\nLine |\n   1 | Get-CimInstance example\n     | 无法从客户端中访问 CIM 资源。' }).code, 'COMMAND_CIM_UNAVAILABLE');
assert.equal(attributeToolFailure({ ...shellError, command: 'python quick_validate.py example',
  output: 'Unexpected key(s) in SKILL.md frontmatter: example. Allowed properties are: description, name' }).code, 'COMMAND_TEST_FAILED');
assert.equal(attributeToolFailure({ ...shellError, interrupted: true }).basis, 'native-status');
assert.equal(attributeToolFailure({ ...shellError, exitCode: -1 }).basis, 'no-output');
assert.ok(!JSON.stringify(commands).includes('private-fixture'));
assert.equal(commands.rows[0].syntax.state, 'not-configured');
assert.equal(commandData.commandScripts.miss.text, 'rg needle src', 'A later raw record cannot replace the original script');
const commandService = new PortableService({ load: async () => commandLoad(), rebuildSnapshots: true });
try {
  const exact = { cut: commandCut, logId: commandSnapshot.logId, seqs: [commands.rows[1].seq] };
  const result = await executeCommandTool(commandService, exact, {});
  assert.equal(result.rows[0].cause.kind, 'pattern');
  const { tool, ...pointer } = result.rows[0].read;
  const linked = await executeTool(commandService, tool, pointer);
  assert.ok(linked.linked.some(row => row.seq === result.rows[0].resultSeq));
  await assert.rejects(executeCommandTool(commandService, { ...exact, logId: 'foreign' }, {}), /Log identity/);
  await assert.rejects(executeCommandTool(commandService, { ...exact, seqs: [5000] }, {}), /No command call/);
} finally { commandService.dispose(); }
const prior = datasetFromNative('codex', snapshot, { rollout });
const cut = prior.payload.sessions[0].lastSeq;
const anchored = datasetAtCut(prior, cut);
const appended = structuredClone(snapshot);
appended.thread.turns.push({ id: 'diagnosis-turn', status: 'inProgress', startedAt: 1767225620,
  items: [{ id: 'diagnosis-prompt', type: 'userMessage', content: [{ type: 'text', text: 'Diagnose the selected calls' }] }] });
const readLive = () => datasetFromNative('codex', appended, { rollout });
const evidence = new PortableService({ load: async () => readLive(), rebuildSnapshots: true });
const stateless = new PortableService({ load: async () => readLive(), rebuildSnapshots: true });
try {
  const selected = anchored.records.filter(r => r.kind === 'call').slice(0, 2).map(r => r.seq);
  const first = await executeTool(evidence, 'trajectory_inspect', { cut, logId: anchored.logId, view: 'io', seqs: [...selected, 5000], limit: 1 });
  assert.deepEqual(first.scope.callSelection, { requested: 3, matched: 2, unmatched: [5000] });
  assert.equal(first.summary.turns, 1, 'diagnosis does not include the turn that sent the prompt');
  const second = await executeTool(stateless, 'trajectory_inspect', { cursor: first.cursor });
  assert.deepEqual([...first.rows, ...second.rows].map(r => r.seq), selected);
  const { tool, ...pointer } = second.rows[0].read;
  assert.equal((await executeTool(stateless, tool, pointer)).logId, anchored.logId);
  appended.thread.turns[0].items[1].aggregatedOutput = 'a changed earlier record';
  await assert.rejects(executeTool(evidence, 'trajectory_inspect', { cut, logId: anchored.logId }), /Log identity/);
} finally { evidence.dispose(); stateless.dispose(); }

const manyTurns = structuredClone(snapshot);
manyTurns.thread.turns = Array.from({ length: 13 }, (_, i) => ({ ...snapshot.thread.turns[0], id: 'turn-' + i, items: snapshot.thread.turns[0].items.map(item => ({ ...item, id: item.id + '-' + i })) }));
const allHistory = new PortableService({ load: async () => datasetFromNative('codex', manyTurns) });
try {
  const overview = await allHistory.call('trajectory_inspect');
  const covered = overview.rows.flatMap(r => Array.from({ length: r.turns.to - r.turns.from + 1 }, (_, i) => r.turns.from + i));
  assert.deepEqual(covered, Array.from({ length: 13 }, (_, i) => i + 1), 'the first overview covers the full process rather than the first page of turns');
} finally { allHistory.dispose(); }

const rpcCalls = [], turn = { id: 't', items: [], status: 'completed' };
const history = await readCodexHistory(async (method, params) => { rpcCalls.push(method); if (method === 'thread/read') return { thread: { id: 'x', historyMode: 'paginated' } }; if (method === 'thread/turns/list') return { data: [turn] }; return params.cursor ? { data: [{ turnId: 't', item: { type: 'agentMessage', id: 'b', text: 'two' } }] } : { data: [{ turnId: 't', item: { type: 'agentMessage', id: 'a', text: 'one' } }], nextCursor: 'page2' }; }, 'x');
assert.deepEqual(history.thread.turns[0].items.map(i => i.id), ['a', 'b']); assert.ok(rpcCalls.every(name => ['thread/read', 'thread/turns/list', 'thread/items/list'].includes(name)));
await assert.rejects(readCodexHistory(async method => method === 'thread/read' ? { thread: { id: 'x', historyMode: 'paginated' } } : { data: [], nextCursor: 'cycle' }, 'x'), /did not advance/);
const legacyItems = await readCodexHistory(async (method, args) => { if (method === 'thread/read') return { thread: { id: 'x', historyMode: 'paginated' } }; if (method === 'thread/items/list') throw Object.assign(Error('unsupported'), { code: -32601 }); return { data: [{ ...turn, items: args.itemsView === 'full' ? [{ id: 'full' }] : [] }] }; }, 'x');
assert.equal(legacyItems.thread.turns[0].items[0].id, 'full');

const temp = await mkdtemp(join(tmpdir(), 'trajectory-portable-'));
assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(basename(temp).startsWith('trajectory-portable-'));
try {
  const file = join(temp, 'session.jsonl'), sample = createPiSample({});
  await writeFile(file, [sample.header, ...sample.entries].map(JSON.stringify).join('\n') + '\n{"type":');
  const read = await readPiSession(file, { synthetic: true }); assert.equal(read.source.incompleteTail, true); assert.equal(read.synthetic, true);
  await writeFile(file, '{}\nnot-json\n{}\n'); await assert.rejects(readPiSession(file), /line 2/);
  const tooSmall = new PortableService({ load: async () => datasetFromNative('pi', sample), maxBytes: 10 }); await assert.rejects(tooSmall.call('trajectory_inspect'), /budget/); tooSmall.dispose();
} finally { await rm(temp, { recursive: true, force: true }); }
console.log('Portable evidence tests passed: native units, usage/cache deduplication, clipped timing, immutable cuts, pagination, full-body continuation, static capabilities, branch JSONL, API-only unknowns, read-only Codex RPC.');
