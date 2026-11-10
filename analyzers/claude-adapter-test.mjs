import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeTranscript } from './claude-reader.mjs';
import { projectClaudeTranscript, finalizeClaudeDataset } from './claude-adapter.mjs';
import { datasetFromNative } from '../plugin/portable-tools/sources.mjs';
import { PortableService } from '../plugin/portable-tools/service.mjs';

const dir = await mkdtemp(join(tmpdir(), 'trajectory-claude-'));
try {
  const file = join(dir, 'session.jsonl');
  const base = { sessionId: 'test', timestamp: '2026-01-01T00:00:00Z', cwd: dir };
  const rows = [
    { ...base, type: 'user', message: { content: 'inspect' } },
    { ...base, uuid: 'a1', type: 'assistant', message: { id: 'm1', usage: { input_tokens: 7, cache_read_input_tokens: 8 }, content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'a.txt', signature: 'literal' } }] } },
    { ...base, uuid: 'u2', type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'long'.repeat(10000) }] } },
    { ...base, uuid: 'a2', type: 'assistant', message: { id: 'm1', usage: { input_tokens: null, output_tokens: 3, cache_creation_input_tokens: 2 }, content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: 'a.txt', signature: 'literal' } }, { type: 'text', text: 'done' }] } },
  ];
  await writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  const native = await readClaudeTranscript(file), data = finalizeClaudeDataset(datasetFromNative('pi', projectClaudeTranscript(native)), native);
  assert.equal(data.host, 'claude'); assert.equal(data.session, 'test');
  assert.equal(data.payload.sessions[0].totals.calls, 1);
  assert.equal(data.payload.sessions[0].turns[0].steps[0].calls[0].status, 'returned');
  const call = data.records.find(r => r.kind === 'call'), result = data.records.find(r => r.kind === 'result');
  assert.equal(call.name, 'Read'); assert.deepEqual(call.arguments, { file_path: 'a.txt', signature: 'literal' });
  assert.equal(call.native.uuid, 'a1'); assert.equal(call.native.line, 2); assert.equal(result.body.content.length, 40000);
  const service = new PortableService({ load: async () => data });
  let offset = 0, reconstructed = '';
  do {
    const part = await service.call('trajectory_read', { seq: call.seq, field: 'result', offset, maxChars: 10000 });
    reconstructed += part.text; offset = part.nextRead?.offset ?? null;
  } while (offset !== null);
  assert.equal(JSON.parse(reconstructed).content, 'long'.repeat(10000));
  const errors = await service.call('trajectory_inspect', { view: 'io', outcome: 'error' });
  assert.equal(errors.summary.calls, 0);
  assert.equal(errors.summary.toolOutcomes.returned, 1);
  service.dispose();
  assert.deepEqual(data.payload.context.usage.map(x => x.usage), [{ input: 7, output: 3, cacheRead: 8, cacheWrite: 2 }]);
  const firstFingerprint = data.fingerprint;
  assert.deepEqual(data.payload.context.requests, []); assert.equal(data.payload.context.current, null);
  await assert.rejects(readClaudeTranscript(), /explicit transcript/);
  await writeFile(file, rows.map(JSON.stringify).join('\n') + '\n{"partial"');
  assert.equal((await readClaudeTranscript(file)).source.incompleteTail, true);
  const changed = await readClaudeTranscript(file);
  assert.notEqual(finalizeClaudeDataset(datasetFromNative('pi', projectClaudeTranscript(changed)), changed).fingerprint, firstFingerprint);
  await writeFile(file, [rows[0], { ...rows[1], sessionId: 'other' }].map(JSON.stringify).join('\n'));
  await assert.rejects(readClaudeTranscript(file), /exactly one session/);
  rows[2].message.content[0].is_error = true;
  await writeFile(file, rows.map(JSON.stringify).join('\n'));
  const failed = await readClaudeTranscript(file), errorData = finalizeClaudeDataset(datasetFromNative('pi', projectClaudeTranscript(failed)), failed);
  const episode = errorData.payload.sessions[0].overview.episodes[0];
  assert.equal(episode.condition, 'CLAUDE_TOOL_ERROR'); assert.equal(episode.source, 'claude-transcript'); assert.match(episode.id, /^claude-/);
  assert.deepEqual(episode.targets, ['a.txt']);

  const assistant = (uuid, content, usage, cwd = dir) => ({ ...base, cwd, uuid, type: 'assistant', message: { id: uuid, content, usage } });
  const use = (id, input) => ({ type: 'tool_use', id, name: 'Read', input });
  const returned = (id, is_error) => ({ ...base, type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content: id }] } });
  const ownCwd = join(dir, 'work');
  const completeInput = { file_path: 'a.txt', limit: 2 };
  const evalRows = [
    rows[0],
    returned('failed', false), // A result before its invocation cannot settle it.
    assistant('batch', [use('failed', completeInput), use('parallel', completeInput)], { input_tokens: 0, output_tokens: 5 }, ownCwd),
    returned('failed', true),
    returned('failed', false), // A duplicate must not replace the first paired result.
    returned('parallel', false),
    assistant('repeated-stream', [use('failed', completeInput)]),
    assistant('retry-record', [use('retry', { limit: 2, file_path: 'a.txt' }), use('incomplete'), use('pending', {})], { cache_read_input_tokens: 3, input_tokens: -1 }),
    returned('retry', false),
    returned('incomplete', true),
    assistant('hidden-only', [{ type: 'thinking', thinking: 'hidden' }], { output_tokens: 1 }),
  ];
  await writeFile(file, evalRows.map(JSON.stringify).join('\n'));
  const evalData = datasetFromNative('claude', await readClaudeTranscript(file));
  const evalSession = evalData.payload.sessions[0];
  const [evalTurn] = evalSession.turns;
  const [failedCall, parallelCall, retryCall, incompleteCall, pendingCall] = evalTurn.steps.flatMap(step => step.calls);
  assert.equal(evalData.payload.evidence.logId, evalData.logId);
  assert.equal(evalData.payload.evidence.unplacedAssistantUsageRecords, 1);
  assert.equal(evalTurn.native.line, 1);
  assert.equal(evalTurn.endObserved, false);
  assert.equal(evalTurn.reason.kind, 'unknown');
  assert.equal(evalTurn.steps[0].native.uuid, 'batch');
  assert.equal(evalTurn.steps.length, 2);
  assert.equal(evalSession.diagnostics.unmatchedResults, 1);
  assert.equal(evalSession.diagnostics.duplicateResults, 1);
  assert.equal(failedCall.status, 'error');
  assert.equal(failedCall.native.line, 3);
  assert.equal(failedCall.resultNative.line, 4);
  assert.equal(evalData.records.filter(row => row.kind === 'result' && row.native.callId === 'failed').length, 1);
  assert.ok(evalData.records.some(row => row.native.line === 2)); // Orphan remains available as raw evidence.
  assert.equal(failedCall.observedStart, null);
  assert.equal(failedCall.durationMs, null);
  assert.equal(parallelCall.native.line, failedCall.native.line);
  assert.equal(retryCall.signature, failedCall.signature);
  assert.deepEqual(evalSession.overview.episodes.map(row => row.pairs.map(pair => pair.successSeq)), [[retryCall.seq], []]);
  assert.equal(incompleteCall.signature, null);
  assert.equal(incompleteCall.args, null);
  assert.equal(pendingCall.status, 'unknown');
  assert.equal(pendingCall.resultNative, null);
  assert.ok(pendingCall.signature);
  assert.equal(evalData.payload.context.fileOperations.find(row => row.seq === failedCall.seq).path, join(ownCwd, 'a.txt'));
  assert.deepEqual(evalData.payload.context.usage.map(row => row.usage), [
    { input: 0, output: 5, cacheRead: null, cacheWrite: null },
    { input: null, output: null, cacheRead: 3, cacheWrite: null },
  ]);
  console.log('Claude transcript adapter checks passed');
} finally { await rm(dir, { recursive: true, force: true }); }
