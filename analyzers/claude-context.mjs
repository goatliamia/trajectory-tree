import { createHash } from 'node:crypto';

const categories = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'];
const empty = () => Object.fromEntries(categories.map(key => [key, 0]));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const estimate = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const wide = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return Math.ceil(wide + (text.length - wide) / 4);
};
const blocks = content => typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
const requestRef = row => typeof row.requestRef === 'string' ? row.requestRef : row.requestRef?.id ?? row.requestRef?.requestId;

// Visible text estimates exclude thinking signatures, media and provider framing.
// Reported input is never distributed among the source categories.
function textParts(parts, text, fallback) {
  if (/^Base directory for this skill:/i.test(text.trimStart()) || /^<skill\b/.test(text.trimStart())) {
    parts.skill += estimate(text); return;
  }
  const rest = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>|<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, value => {
    parts.inject += estimate(value); return '';
  });
  parts[fallback] += estimate(rest);
}
function messageParts(message, skillCalls) {
  const parts = empty();
  for (const block of blocks(message.content)) {
    if (block.type === 'text') {
      if (message.role === 'user') textParts(parts, String(block.text ?? ''), 'user');
      else parts[message.role === 'assistant' ? 'assistant' : 'inject'] += estimate(block.text ?? '');
    } else if (block.type === 'tool_use') {
      parts.assistant += estimate({ name: block.name, input: block.input });
    } else if (block.type === 'tool_result') {
      const key = skillCalls.has(block.tool_use_id) && !block.is_error ? 'skill' : 'tool';
      for (const value of blocks(block.content)) if (value.type === 'text') parts[key] += estimate(value.text ?? '');
    }
  }
  return parts;
}

// CC 2.1.325 records canonical message hashes and base/keep/tail request deltas.
// Assistant bodies normally come from split assistant records, not blob rows.
// Resolve every reference before publishing an estimate.
export function claudeRequestContext(native, session, byEntry, events) {
  const messages = new Map(), groups = new Map(), shapes = new Map(), states = new Map(), skillCalls = new Set();
  for (const row of native.rows) {
    if (row.type !== 'assistant' || !row.message?.id) continue;
    const group = groups.get(row.message.id) || { role: 'assistant', content: [] };
    group.content.push(...blocks(row.message.content)); groups.set(row.message.id, group);
    const message = { role: 'assistant', content: blocks(row.message.content) };
    messages.set(digest(message), message);
    for (const block of message.content) if (block.type === 'tool_use' &&
      (block.name === 'Skill' || block.name === 'Read' && /(?:^|[\\/])SKILL\.md$/i.test(block.input?.file_path || ''))) skillCalls.add(block.id);
  }
  for (const message of groups.values()) messages.set(digest(message), message);
  for (const row of native.rows) {
    if (row.type === 'api-request-shape' && row.shape && digest(row.shape) === row.shapeHash) shapes.set(row.shapeHash, row.shape);
    if (row.type === 'api-request-blob' && row.message && digest(row.message) === row.hash) messages.set(row.hash, row.message);
  }
  const anchors = new Map(), requestSeqs = new Map();
  for (const event of events.values()) {
    const row = byEntry.get(event.id)?.claudeRow;
    if (row?.type === 'api-request') requestSeqs.set(row.id, event.seq);
  }
  for (const turn of session.turns) for (const step of turn.steps) {
    const row = byEntry.get(events.get(step.seq)?.id)?.claudeRow, ref = row && requestRef(row);
    if (!ref) continue;
    if (!anchors.has(ref)) anchors.set(ref, { turn: turn.number, turnId: turn.id, step: step.number, seq: step.seq, contextSteps: [] });
    anchors.get(ref).contextSteps.push(step.number);
  }
  const partsByHash = new Map(), shapeParts = new Map(), requests = [], failures = [];
  let recorded = 0, turnIndex = -1, last = null;
  for (const row of native.rows) {
    if (row.type !== 'api-request') continue;
    recorded++; last = null;
    const prior = row.base ? states.get(row.base) : null, shape = shapes.get(row.shapeHash);
    let reason = null;
    if (!row.id || !Number.isFinite(Date.parse(row.timestamp))) reason = 'invalid-request-anchor';
    else if (!Number.isInteger(row.keep) || row.keep < 0 || row.keep > (prior?.length ?? 0)) reason = 'missing-or-invalid-base';
    else if (!Array.isArray(row.tail) || row.tail.some(key => typeof key !== 'string')) reason = 'invalid-message-tail';
    else if (!shape || !Array.isArray(shape.tools) || !Array.isArray(shape.system) && typeof shape.system !== 'string') reason = 'missing-or-invalid-shape';
    const hashes = reason ? null : [...(prior || []).slice(0, row.keep), ...row.tail];
    if (hashes && hashes.some(key => !messages.has(key))) reason = 'unresolved-message';
    if (reason) { failures.push({ requestId: row.id, line: row.__trajectoryLine, reason }); continue; }
    states.set(row.id, hashes);
    while (turnIndex + 1 < session.turns.length && session.turns[turnIndex + 1].native.line <= row.__trajectoryLine) turnIndex++;
    const turn = session.turns[turnIndex];
    if (!turn) { failures.push({ requestId: row.id, line: row.__trajectoryLine, reason: 'request-before-user-turn' }); continue; }
    if (!shapeParts.has(row.shapeHash)) shapeParts.set(row.shapeHash, {
      system: blocks(shape.system).filter(block => block.type === 'text').reduce((sum, block) => sum + estimate(block.text ?? ''), 0),
      tools: shape.tools.length ? estimate(shape.tools) : 0,
    });
    const parts = { ...empty(), ...shapeParts.get(row.shapeHash) };
    for (const key of hashes) {
      if (!partsByHash.has(key)) partsByHash.set(key, messageParts(messages.get(key), skillCalls));
      const item = partsByHash.get(key);
      for (const category of categories) parts[category] += item[category];
    }
    last = { ...(anchors.get(row.id) || { turn: turn.number, turnId: turn.id, step: null }), seq: requestSeqs.get(row.id),
      requestId: row.id, contextLine: row.__trajectoryLine, time: Date.parse(row.timestamp), model: row.params?.model ?? null,
      ...parts, total: categories.reduce((sum, key) => sum + parts[key], 0), activeMs: null,
      source: 'estimate', semanticUnit: 'claude-recorded-request-visible-text', samplingPoint: 'request-dispatch' };
    requests.push(last);
  }
  return { requests, current: last ? Object.fromEntries(categories.map(key => [key, last[key]])) : null,
    capture: { recorded, reconstructed: requests.length, unresolved: failures.length, failures: failures.slice(0, 10), latestRequestId: last?.requestId ?? null },
    source: { name: 'Claude Code recorded API requests; independent visible-text estimates', kind: 'claude-recorded-api-requests' } };
}
