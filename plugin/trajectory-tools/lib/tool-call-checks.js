// Read-only checks against the recorded model-facing request header.
// This is not a replay of the historical runtime or a task-quality judgment.
import { assertObjectJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';

/**
 * Check direct tool/call events using the latest continuously observed header.
 * Input must be the ordered, unfiltered event stream through the desired cut.
 * Inner Code Mode calls have no logged binding-time schema and are excluded.
 * The installed validator checks the recorded schema; its version need not be
 * the version used when the call ran. No argument or schema content is returned.
 */
export function checkRecordedToolCalls(events) {
  let previous = null, header = null, headerSeq = null, innerEvents = 0;
  const calls = [], cache = new WeakMap();
  for (const event of events) {
    if (!Number.isSafeInteger(event?.seq)) throw new TypeError('Events require integer seq values');
    if (previous !== null && event.seq <= previous) throw new Error('Events must be in strictly increasing sequence order');
    if (previous !== null && event.seq !== previous + 1) { header = null; headerSeq = null; }
    previous = event.seq;
    const d = event.data || {};
    if (event.type === 'request/header') {
      header = d.header && typeof d.header === 'object' ? d.header : null;
      headerSeq = header ? event.seq : null;
      continue;
    }
    if (event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch') { innerEvents++; continue; }
    if (event.type !== 'tool/call') continue;
    const record = { seq: event.seq, callId: d.callId ?? null, name: d.name ?? null, headerSeq,
      json: 'unknown', schema: 'unknown', reason: null };
    calls.push(record);
    if (typeof d.arguments !== 'string') { record.reason = 'arguments-unavailable'; continue; }
    let value;
    if (d.arguments === '') { record.json = 'empty'; value = {}; }
    else {
      try { value = JSON.parse(d.arguments); record.json = 'valid'; }
      catch { record.json = 'invalid'; value = d.arguments; }
    }
    if (!header || (header.tools !== undefined && !Array.isArray(header.tools))) { record.reason = 'header-unavailable'; continue; }
    const matches = (header.tools || []).filter(t => t?.name === d.name);
    if (matches.length !== 1) { record.reason = matches.length ? 'ambiguous-tool' : 'tool-not-in-header'; continue; }
    const schema = matches[0].parameters;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) { record.reason = 'schema-unavailable'; continue; }
    let supported = cache.get(schema);
    if (supported === undefined) {
      try { assertObjectJsonSchema(schema); supported = true; } catch { supported = false; }
      cache.set(schema, supported);
    }
    if (!supported) { record.reason = 'unsupported-schema'; continue; }
    try { record.schema = validateJsonSchemaValue(schema, value, '').length ? 'nonconforming' : 'conforming'; }
    catch { record.reason = 'validation-error'; }
  }
  return summarizeRecordedToolChecks(calls, innerEvents);
}

export function summarizeRecordedToolChecks(calls, innerEvents) {
  const count = (field, value) => calls.filter(c => c[field] === value).length;
  const jsonValid = count('json', 'valid'), jsonInvalid = count('json', 'invalid');
  const jsonEmpty = count('json', 'empty'), jsonUnknown = count('json', 'unknown');
  const conforming = count('schema', 'conforming'), nonconforming = count('schema', 'nonconforming');
  const checkable = conforming + nonconforming;
  return {
    basis: { schema: 'latest continuously observed request/header', validator: '@deepseek-ai/dsh-tools installed version',
      historicalRuntimeReplay: false, innerDefinitionsRecorded: false },
    scope: { directCalls: calls.length, innerDispatchEventsExcluded: innerEvents },
    json: { valid: jsonValid, invalid: jsonInvalid, empty: jsonEmpty, unknown: jsonUnknown,
      observed: jsonValid + jsonInvalid + jsonEmpty },
    schema: { conforming, nonconforming, checkable, unknown: calls.length - checkable,
      coverage: calls.length ? checkable / calls.length : null,
      conformingRate: checkable ? conforming / checkable : null },
    calls,
  };
}
