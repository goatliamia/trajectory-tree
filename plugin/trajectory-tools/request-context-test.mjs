import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecordedModelTiming, buildRequestContext } from './lib/request-context.js';

const rows = [];
function event(type, data, surfaceOp) {
  const seq = rows.length;
  rows.push({ seq, time: seq * 10, type, data, surfaceOp });
  return seq;
}
function message(type, role, units, source, fields = {}, surfaceOp = 'append') {
  return event(type, { message: { role, units, source }, ...fields }, surfaceOp);
}

const firstSystem = message('system/message', 'system', 4);
message('user/message', 'user', 3, { kind: 'user' });
message('user/message', 'user', 1, { kind: 'runtime-context' });
message('user/message', 'user', 2, { kind: 'skill-catalog' });
const firstHeader = event('request/header', { header: { tokens: 8 } });
const firstResponse = message('assistant/message', 'assistant', 9, { kind: 'model' },
  { turn: 1, step: 1, usage: { inputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 3 } });
event('tool/call', { callId: 'skill-load', name: 'skill' });
message('tool/result', 'tool', 6, { kind: 'tool', callId: 'skill-load' });
const oldTool = message('tool/result', 'tool', 7, { kind: 'tool', callId: 'read-file' });
const replaceSystem = message('system/message', 'system', 5, undefined, {}, { startSeq: firstSystem, endSeq: firstSystem });
const prune = message('tool/result', 'tool', 2, { kind: 'tool', callId: 'read-file' }, {}, { startSeq: oldTool, endSeq: oldTool });
const secondHeader = event('request/header', { header: { tokens: 10 } });
event('request/context', { contextWindow: 1000 });
const secondResponse = message('assistant/message', 'assistant', 11, { kind: 'model' }, { turn: 2, step: 1 });

const meter = {
  foldSurface: () => ({ replacements: [
    { seq: replaceSystem, shadowedSeqs: [firstSystem] },
    { seq: prune, shadowedSeqs: [oldTool] },
  ] }),
  canonicalHeader: header => header,
  deriveEventMessage: row => row.data.message,
  estimateMessage: value => value.units,
  estimateToolsTokens: header => header.tokens,
};

test('request context estimates the native pre-response surface and separates reported input', () => {
  const result = buildRequestContext(rows, meter);
  assert.deepEqual(result.requests, [
    { seq: firstResponse, time: firstResponse * 10, turn: 1, step: 1, headerSeq: firstHeader,
      reportedInput: 33, system: 4, tools: 8, user: 3, inject: 1, skill: 2, assistant: 0, tool: 0, total: 18 },
    { seq: secondResponse, time: secondResponse * 10, turn: 2, step: 1, headerSeq: secondHeader,
      reportedInput: null, system: 5, tools: 10, user: 3, inject: 1, skill: 8, assistant: 9, tool: 2, total: 38 },
  ]);
  assert.equal(result.current.assistant, 20);
  assert.deepEqual(result.pressure, { pressureTokens: 33, contextWindow: 1000 });
});

test('partial logs retain measured input without pricing a missing prefix', () => {
  const result = buildRequestContext(rows.slice(1), { ...meter, foldSurface: () => assert.fail('prefix must be complete') });
  assert.equal(result.requests[0].total, null);
  assert.equal(result.requests[0].reportedInput, 33);
  assert.equal(result.current, null);
});

test('a message projection changes only later context samples', () => {
  const original = rows[1].data.message;
  const decision = { seq: firstResponse + 1, type: 'image/offload' };
  const response = { ...rows[firstResponse], seq: decision.seq + 1, data: { ...rows[firstResponse].data, step: 2 } };
  const events = [...rows.slice(0, decision.seq), decision, response];
  const projected = new Map([[1, { ...original, units: 1 }]]);
  const projection = { type: decision.type, project: row => {
    assert.equal(row, decision);
    return projected;
  } };
  const result = buildRequestContext(events, { ...meter, foldSurface: (history, [wrapped]) => ({
    replacements: [], projectedMessages: wrapped.project(history[decision.seq], {}),
  }) }, [projection]);
  assert.deepEqual(result.requests.map(row => row.user), [3, 1]);
  assert.deepEqual(result.requests.map(row => row.reportedInput), [33, 33]);
});

test('recorded model timing uses the first streamed token and the durable reply', () => {
  const stepEvent = (type, time, step, fields = {}, surfaceOp) => ({
    type, time, data: { turn: 1, step, ...fields }, surfaceOp,
  });
  const events = [stepEvent('step/start', 100, 1),
    stepEvent('assistant/live-chunk', 110, 1, { chunk: { type: 'metadata' } }),
    stepEvent('assistant/attempt', 155, 1, { stream: [{ time: 125 }] }),
    stepEvent('assistant/message', 205, 1, { stream: [{ time: 175 }] }, 'append'),
    stepEvent('assistant/message', 300, 1, {}, { startSeq: 3, endSeq: 3 }),
    stepEvent('step/start', 310, 2),
    stepEvent('assistant/live-chunk', 340, 2, { chunk: { type: 'text' } })];
  const helpers = { assistantStreamFirstTokenTime: stream => stream[0]?.time,
    isTokenDelta: chunk => chunk.type === 'text' };
  assert.deepEqual(buildRecordedModelTiming(events, helpers), [{ turn: 1, steps: [
    { step: 1, ttft: 25, model: 105, decode: 80 },
    { step: 2, ttft: 30, model: null, decode: null },
  ] }]);
});
