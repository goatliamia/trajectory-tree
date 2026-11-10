import assert from 'node:assert/strict';
import { checkRecordedToolCalls } from './lib/tool-call-checks.js';

const event = (seq, type, data = {}) => ({ seq, type, data });
const tool = (name, parameters) => ({ name, parameters });
const schema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
const events = [
  event(0, 'tool/call', { callId: 'early', name: 'read', arguments: '{}' }),
  event(1, 'request/header', { header: { tools: [tool('read', schema)] } }),
  event(2, 'tool/call', { callId: 'ok', name: 'read', arguments: '{"path":"a"}' }),
  event(3, 'tool/call', { callId: 'missing', name: 'read', arguments: '{}' }),
  event(4, 'tool/call', { callId: 'malformed', name: 'read', arguments: '{' }),
  event(5, 'tool/call', { callId: 'empty', name: 'read', arguments: '' }),
  event(6, 'tool/call', { callId: 'unknown', name: 'read' }),
  event(7, 'tool/ptc-dispatch-start', { rootCallId: 'ok', subCallId: 'sub' }),
  event(8, 'tool/ptc-dispatch', { rootCallId: 'ok', subCallId: 'sub' }),
  event(9, 'request/header', { header: { tools: [tool('read', { type: 'object' })] } }),
  event(10, 'tool/call', { callId: 'changed', name: 'read', arguments: '{}' }),
  event(12, 'tool/call', { callId: 'gap', name: 'read', arguments: '{}' }),
  event(13, 'request/header', { header: { tools: [tool('read', { $ref: '#/$defs/a' })] } }),
  event(14, 'tool/call', { callId: 'unsupported', name: 'read', arguments: '{}' }),
  event(15, 'request/header', { header: { tools: [tool('read', schema), tool('read', schema)] } }),
  event(16, 'tool/call', { callId: 'duplicate', name: 'read', arguments: '{}' }),
  event(17, 'request/header', { header: { tools: [] } }),
  event(18, 'tool/call', { callId: 'absent', name: 'read', arguments: '{}' }),
];
const result = checkRecordedToolCalls(events);
const get = id => result.calls.find(c => c.callId === id);
assert.equal(result.scope.directCalls, 11);
assert.equal(result.scope.innerDispatchEventsExcluded, 2);
assert.deepEqual([get('ok').schema, get('missing').schema, get('malformed').schema, get('empty').schema],
  ['conforming', 'nonconforming', 'nonconforming', 'nonconforming']);
assert.equal(get('malformed').json, 'invalid');
assert.equal(get('empty').json, 'empty');
assert.equal(get('early').reason, 'header-unavailable');
assert.equal(get('unknown').reason, 'arguments-unavailable');
assert.equal(get('changed').schema, 'conforming');
assert.equal(get('changed').headerSeq, 9);
assert.equal(get('gap').reason, 'header-unavailable');
assert.equal(get('unsupported').reason, 'unsupported-schema');
assert.equal(get('duplicate').reason, 'ambiguous-tool');
assert.equal(get('absent').reason, 'tool-not-in-header');
assert.deepEqual(result.schema, { conforming: 2, nonconforming: 3, checkable: 5, unknown: 6, coverage: 5 / 11, conformingRate: 2 / 5 });
assert.equal(checkRecordedToolCalls([]).schema.coverage, null);
assert.equal(checkRecordedToolCalls([]).schema.conformingRate, null);
assert.throws(() => checkRecordedToolCalls([event(2, 'x'), event(2, 'x')]), /strictly increasing/);
console.log('PASS recorded headers, validator, missing evidence, gaps and Code Mode exclusion');
