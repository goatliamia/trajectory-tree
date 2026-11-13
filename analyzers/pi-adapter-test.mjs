import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createPiSample, PI_SOURCE_REVISION } from './pi-sample.mjs';
import { adaptPiSession, piSessionPath, piVisibleComposition } from './pi-adapter.mjs';
import { fileObjects } from '../docs/demo/layout-review/file-model.mjs';
import { contextByTurn } from '../docs/demo/layout-review/context-model.mjs';
import { collectToolResults } from '../docs/demo/layout-review/tool-result-model.mjs';

const input = createPiSample({ revision: PI_SOURCE_REVISION, version: '1.4.0' }), graph = adaptPiSession(input), session = graph.sessions[0];
assert.equal(input.header.version, 3);
assert.equal(graph.synthetic, true);
assert.deepEqual(session.totals, { turns: 5, steps: 14, calls: 12, errors: 2 });
assert.ok(input.entries.every(e => e.id && 'parentId' in e && !('synthetic' in e)), 'synthetic provenance stays outside native SessionEntry fields');
assert.ok(input.capture.every(row => row.synthetic && Number.isFinite(row.observedAt) && !('observedAt' in row.event)), 'timestamps belong to the capture envelope');
assert.equal(input.capture.filter(row => row.event.type === 'turn_start').length, 14, 'one native turn per assistant cycle');
assert.equal(input.capture[input.capture.findIndex(row => row.event.type === 'agent_start') + 1].event.type, 'turn_start');
assert.ok(graph.context.requests.every(r => r.synthetic && r.source === 'estimate'));
assert.ok(Object.values(graph.context.callFacts).every(f => f.synthetic));
assert.ok(session.overview.episodes.every(e => e.complete && e.pairs.length === 1));
assert.ok(session.turns.flatMap(t => t.steps).flatMap(s => s.calls).every(c => c.startSeq === c.seq));
assert.deepEqual(graph.context.skillEvents.map(e => e.kind).sort(), ['catalog', 'explicit-skill-reference', 'skill-file-read']);
assert.ok(graph.context.boundaries[0].firstKeptEntryId);
assert.equal(graph.officialStats.context.pressure.contextWindow, null, 'unknown model capacity is never invented');
assert.equal(graph.context.agentBranches.length, 0, 'no core subagent capability is fabricated');
assert.ok(Object.values(graph.context.callFacts).some(f => f.patch?.startsWith('--- a/')));
assert.ok(fileObjects(graph.context.fileOperations).some(f => f.failed.length && f.reads.length));
assert.ok(collectToolResults(session, graph.context.callFacts, graph.context.fileOperations).length >= 4);
assert.ok(contextByTurn(graph.context.requests).some(r => r.decrease > 0), 'compaction produces a source-estimate reduction');
const noCapture = adaptPiSession({ ...input, capture: [] });
assert.ok(noCapture.sessions[0].turns.flatMap(t => t.steps).flatMap(s => s.calls).every(c =>
  c.timingSource === 'unrecorded-start' && c.startSeq === null && c.durationMs > 0), 'native duration does not imply an observed start');
const latestMissingUsage = structuredClone(input);
const lastMessage = latestMissingUsage.entries.findLast(e => e.type === 'message' && e.message.role === 'assistant').message;
delete lastMessage.usage;
assert.equal(adaptPiSession(latestMissingUsage).officialStats.context.pressure.pressureTokens, null, 'missing latest usage does not reuse an earlier request');
const latestAssistantModel = structuredClone(input);
const assistantAfterChange = latestAssistantModel.entries.findLast(e => e.type === 'message' && e.message.role === 'assistant').message;
assistantAfterChange.model = 'later-model'; assistantAfterChange.provider = 'later-provider';
assert.deepEqual(adaptPiSession(latestAssistantModel).context.route, { model: 'later-model', provider: 'later-provider' }, 'a later assistant updates the native model route');
const missingContent = structuredClone(input);
missingContent.entries.find(e => e.type === 'message' && e.message.role === 'assistant').message.content = null;
assert.doesNotThrow(() => adaptPiSession(missingContent), 'native Pi tolerates assistant messages with missing content');
const mismatchedCapture = structuredClone(input);
const capturedStart = mismatchedCapture.capture.find(row => row.event.type === 'tool_execution_start');
capturedStart.event.toolName = 'different-tool';
const capturedCall = adaptPiSession(mismatchedCapture).sessions[0].turns.flatMap(t => t.steps).flatMap(s => s.calls).find(c => c.id === capturedStart.event.toolCallId);
assert.equal(capturedCall.timingSource, 'unrecorded-start', 'capture for a different tool cannot supply a start');
const changed = structuredClone(input), later = changed.entries.filter(e => e.type === 'message' && e.message.role === 'assistant').flatMap(e => e.message.content).filter(c => c.type === 'toolCall' && c.name === 'bash');
later[1].arguments.command += ' --changed';
assert.equal(adaptPiSession(changed).sessions[0].overview.episodes.find(e => e.turn === 2).complete, false, 'different command is not exact-operation recovery');
const splitResult = structuredClone(input);
const failedShell = splitResult.entries.find(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'bash' && entry.message.isError).message;
failedShell.content = [];
failedShell.details = { exitCode: 2, stderr: 'rg: regex parse error:' };
const splitCall = adaptPiSession(splitResult).sessions[0].turns.flatMap(turn => turn.steps.flatMap(step => step.calls))
  .find(call => call.id === failedShell.toolCallId);
assert.deepEqual([splitCall.status, splitCall.attribution.code, splitCall.attribution.basis, splitCall.attribution.exitCode],
  ['error', 'COMMAND_PATTERN', 'native-stderr', 2]);
const feedbackInput = structuredClone(input);
const feedbackShell = feedbackInput.entries.find(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'bash' && entry.message.isError).message;
feedbackShell.content = [{ type: 'text', text: 'log\n'.repeat(5000) + 'bash: -c: line 2: syntax error: unexpected end of file' }];
const feedbackGraph = adaptPiSession(feedbackInput), feedbackCalls = feedbackGraph.sessions[0].turns.flatMap(turn => turn.steps.flatMap(step => step.calls));
const feedbackCall = feedbackCalls.find(call => call.id === feedbackShell.toolCallId);
assert.equal(feedbackCall.measure.chars, textLength(feedbackShell));
assert.ok(feedbackCall.result.omitted > 0, 'feedback measures use the full result before excerpt truncation');
assert.equal(feedbackCall.codeFrames[0].line, 2, 'shell error location survives excerpt truncation');
assert.equal(feedbackCall.codeFrames[0].lines.length, 0, 'bash wrapper coordinates do not highlight an unverified submitted script');
const powershellInput = structuredClone(input);
for (const entry of powershellInput.entries) {
  if (entry.message?.role === 'assistant') for (const call of entry.message.content || []) if (call.name === 'bash') {
    call.name = 'powershell'; call.arguments.command = 'Write-Output ok\nif (';
  }
  if (entry.message?.toolName === 'bash') {
    entry.message.toolName = 'powershell';
    if (entry.message.isError) entry.message.content = [{ type: 'text', text: 'ParserError:\nLine |\n   2 | if (\n     |     ~\n     | Missing closing ) in expression.\nCommand exited with code 1' }];
  }
}
const powershellCall = adaptPiSession(powershellInput).sessions[0].turns.flatMap(turn => turn.steps.flatMap(step => step.calls))
  .find(call => call.name === 'powershell' && call.status === 'error');
assert.equal(powershellCall.semanticKind, 'run', 'Pi 1.5.2 native PowerShell is a shell execution');
assert.equal(powershellCall.codeFrames[0].line, 2);
assert.ok(powershellCall.codeFrames[0].lines.some(line => line.error && line.text === 'if ('), 'verified native PowerShell source is highlighted');
assert.ok(feedbackCalls.some(call => call.name === 'read' && call.measure?.kind === 'read'));
const pendingFeedback = structuredClone(input);
for (const entry of pendingFeedback.entries) if (entry.message?.role === 'toolResult') entry.message.role = 'custom';
assert.ok(adaptPiSession(pendingFeedback).sessions[0].turns.flatMap(turn => turn.steps.flatMap(step => step.calls))
  .filter(call => call.name === 'write').every(call => call.measure.state === 'pending'), 'unpaired writes remain planned');
function textLength(message) { return message.content.map(block => block.text).join('\n').length; }
assert.throws(() => piSessionPath([{ id: 'a', parentId: 'a' }]), /cycle/);
assert.throws(() => piSessionPath([{ id: 'a', parentId: 'missing' }]), /Missing/);
const prompt = [{ type: 'message', id: 'a', parentId: null, message: { role: 'system', content: 'base', sections: { rules: 'first' }, toolsAdded: [{ name: 'read', parameters: {} }] } }, { type: 'message', id: 'b', parentId: 'a', message: { role: 'system', content: '', sections: { rules: null }, toolsRemoved: [{ name: 'read' }] } }, { type: 'custom', id: 'c', parentId: 'b', customType: 'state', data: 'PRIVATE-STATE'.repeat(100) }];
assert.equal(piVisibleComposition(prompt).tools, 0, 'tool removal replays native transcript state');
assert.equal(piVisibleComposition(prompt).inject, 0, 'plain custom state is not LLM context');
assert.equal(piVisibleComposition(prompt).system, 1);
const nativeRepo = process.env.TRAJECTORY_PI_TEST_REPO;
if (nativeRepo) {
  const get = path => execFileSync('git', ['-C', nativeRepo, 'show', PI_SOURCE_REVISION + ':' + path], { encoding: 'utf8', windowsHide: true });
  assert.match(get('packages/coding-agent/src/core/session-manager.ts'), /CURRENT_SESSION_VERSION = 3/);
  assert.match(get('packages/coding-agent/src/core/session-manager.ts'), /firstKeptEntryId: string/);
  assert.match(get('packages/coding-agent/src/core/tools/edit.ts'), /details: \{ diff: diffResult.diff, patch, firstChangedLine/);
  assert.match(get('packages/agent/src/types.ts'), /type: "tool_execution_end"/);
  assert.match(get('packages/ai/src/types.ts'), /toolsRemoved\?: ToolReference\[\]/);
  assert.match(get('packages/coding-agent/README.md'), /skips features like sub-agents/);
}
if (process.env.TRAJECTORY_PI_TEST_VIEW) {
  const html = readFileSync(process.env.TRAJECTORY_PI_TEST_VIEW, 'utf8');
  assert.match(html, /Pi · 模拟会话/); assert.match(html, /全部内容、时长、用量与结果均为模拟/);
  const payload = JSON.parse(html.match(/<script id="trace-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.host, 'pi'); assert.equal(payload.synthetic, true);
}
console.log('Pi adapter tests passed: native source fields, synthetic provenance, shared file/context/result models, exact recovery, compaction, skill sources, unavailable timing/capacity, tree validation.');
