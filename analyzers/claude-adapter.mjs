// Project only recorded visible messages and tool blocks. This intermediate
// structure reuses the Pi renderer; it does not imply Pi request semantics.
import { createHash } from 'node:crypto';
import { win32, posix } from 'node:path';
import { isShellTool } from '../plugin/trajectory-tools/lib/tool-attribution.js';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const messageKey = row => row.message?.id || row.uuid || 'line:' + row.__trajectoryLine;
const nativeLocation = (row, callId) => ({
  uuid: row.uuid || null, parentUuid: row.parentUuid || null, line: row.__trajectoryLine,
  messageId: row.message?.id || null, ...(callId ? { callId } : {}),
});
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const toolInput = block => block?.input && typeof block.input === 'object' && !Array.isArray(block.input) ? block.input : null;

function visible(value, parameters = false) {
  if (Array.isArray(value)) return value.map(v => visible(v, parameters)).filter(v => v !== undefined);
  if (!value || typeof value !== 'object') return value;
  if (!parameters && /^(thinking|reasoning|redacted_thinking)$/.test(value.type || '')) return undefined;
  if (!parameters && /^(image|audio|video)$/.test(value.type || '')) return { type: value.type, mediaOmitted: true };
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== '__trajectoryLine' && (parameters || !/^(signature|encrypted_content|encryptedContent)$/.test(k))).map(([k, v]) => [k, visible(v, parameters || k === 'input')]).filter(([, v]) => v !== undefined));
}
export function projectClaudeTranscript(native) {
  const entries = [], seenCalls = new Map(), seenResults = new Set(); let parentId = null, started = false, serial = 0;
  let unmatchedResults = 0, duplicateResults = 0;
  const add = (row, message, block = null) => {
    const id = 'claude-' + (++serial), timestamp = row.timestamp || null;
    entries.push({ type: 'message', id, parentId, timestamp, message: { ...message, timestamp: timestamp ? Date.parse(timestamp) : null }, claudeRow: row, claudeBlock: block }); parentId = id;
  };
  for (const row of native.rows) {
    if (!['user', 'assistant'].includes(row.type) || !row.message) continue;
    const content = typeof row.message.content === 'string' ? [{ type: 'text', text: row.message.content }] : Array.isArray(row.message.content) ? row.message.content : [];
    if (row.type === 'user') {
      const toolResults = content.filter(b => b.type === 'tool_result');
      for (const b of toolResults) {
        const paired = seenResults.has(b.tool_use_id);
        const matched = seenCalls.has(b.tool_use_id) && !paired;
        if (matched) seenResults.add(b.tool_use_id);
        else if (paired) duplicateResults++;
        else unmatchedResults++;
        // Row-level metadata can be joined only to a single, paired shell result.
        const nativeResult = matched && toolResults.length === 1 && isShellTool(seenCalls.get(b.tool_use_id)) ? row.toolUseResult : null;
        const details = {};
        if (Number.isInteger(nativeResult?.exitCode)) details.exitCode = nativeResult.exitCode;
        if (typeof nativeResult?.stderr === 'string' && nativeResult.stderr) details.stderr = nativeResult.stderr;
        if (nativeResult?.interrupted === true) details.interrupted = true;
        add(row, { role: 'toolResult', toolCallId: matched ? b.tool_use_id : null, content: typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : (b.content || []), isError: b.is_error === true,
          ...(Object.keys(details).length ? { details } : {}) }, b);
      }
      const visible = content.filter(b => b.type === 'text');
      if (visible.length) { add(row, { role: 'user', content: visible }); started = true; }
    } else if (started) {
      const blocks = content.filter(b => {
        if (b.type !== 'tool_use') return b.type === 'text';
        if (!b.id || !b.name || seenCalls.has(b.id)) return false;
        seenCalls.set(b.id, b.name); return true;
      }).map(b => b.type === 'tool_use' ? { type: 'toolCall', id: b.id, name: b.name, arguments: toolInput(b) || {} } : b);
      if (blocks.length) add(row, { role: 'assistant', content: blocks, model: row.message.model || null });
    }
  }
  return { header: { type: 'session', version: 3, id: native.sessionId, cwd: native.rows.find(r => r.cwd)?.cwd || '/' }, entries, source: native.source, capturedAt: native.capturedAt, resultDiagnostics: { unmatchedResults, duplicateResults } };
}

export function finalizeClaudeDataset(data, native, projected = projectClaudeTranscript(native)) {
  data.host = 'claude'; data.payload.host = 'claude';
  const session = data.payload.sessions[0]; session.source.host = 'claude';
  Object.assign(session.diagnostics, projected.resultDiagnostics);
  data.fingerprint = hash(JSON.stringify({ host: 'claude', session: data.session, sha256: native.source.sha256 }));
  data.logId = 'claude:' + data.session + ':' + data.fingerprint.slice(0, 16);
  data.payload.evidence = { source: native.source, logId: data.logId, context: { estimate: false, incomplete: true, excluded: ['system prompt', 'tool definitions', 'hidden context', 'request serialization', 'branch selection'] }, agents: 'Only the explicitly selected transcript is included.' };
  data.payload.context.source = { name: 'Claude Code local transcript: visible records only' };
  data.payload.context.requests = []; data.payload.context.current = null;
  data.payload.officialStats = null;
  for (const episode of session.overview.episodes) { episode.id = episode.id.replace(/^pi-/, 'claude-'); episode.condition = 'CLAUDE_TOOL_ERROR'; episode.source = 'claude-transcript'; }
  session.overview.representatives = session.overview.episodes.map(e => e.id);
  const byEntry = new Map(projected.entries.map(e => [e.id, e]));
  const events = new Map(data.payload.events.map(e => [e.seq, e]));
  const calls = new Map(), results = new Map();
  for (const entry of projected.entries) {
    if (entry.message.role === 'assistant') {
      const projectedIds = new Set(entry.message.content.filter(block => block.type === 'toolCall').map(block => block.id));
      for (const b of entry.claudeRow.message.content || []) {
        if (b.type === 'tool_use' && projectedIds.has(b.id) && !calls.has(b.id)) calls.set(b.id, { entry, block: b });
      }
    }
    if (entry.claudeBlock && entry.message.toolCallId) results.set(entry.message.toolCallId, { entry, block: entry.claudeBlock });
  }
  for (const event of data.payload.events) {
    event.source = 'claude-transcript';
    const entry = byEntry.get(event.id);
    if (entry) event.native = nativeLocation(entry.claudeRow, entry.claudeBlock?.tool_use_id);
  }
  for (const fact of Object.values(data.payload.context.callFacts || {})) {
    fact.detail = 'Claude Code · 会话记录'; fact.source = 'claude-transcript';
  }
  for (const record of data.records) {
    let item = byEntry.get(record.native?.entryId), block;
    if (record.kind === 'call') { const found = calls.get(record.native?.callId); item = found?.entry; block = found?.block; }
    if (record.kind === 'result') { const found = results.get(record.native?.callId); item = found?.entry; block = found?.block; }
    if (!item) { const event = events.get(record.seq); item = byEntry.get(event?.id); }
    if (!item) continue;
    const row = item.claudeRow, details = record.kind === 'result' ? item.message.details : null;
    const body = details ? { ...block, toolUseResult: details } : block || row;
    record.body = visible(body); record.nativeHash = hash(body); record.source = 'claude-transcript';
    record.native = nativeLocation(row, block?.id || block?.tool_use_id);
    if (record.kind === 'call') { record.name = block.name; record.arguments = visible(toolInput(block), true); }
  }
  const usageById = new Map();
  const usageFields = { input: 'input_tokens', output: 'output_tokens', cacheRead: 'cache_read_input_tokens', cacheWrite: 'cache_creation_input_tokens' };
  for (const row of native.rows) {
    if (row.type !== 'assistant' || !row.message?.usage || typeof row.message.usage !== 'object') continue;
    const id = messageKey(row);
    const usage = usageById.get(id) || { input: null, output: null, cacheRead: null, cacheWrite: null };
    for (const [key, field] of Object.entries(usageFields)) {
      const value = row.message.usage[field];
      if (Number.isFinite(value) && value >= 0) usage[key] = value;
    }
    usageById.set(id, usage);
  }
  const assigned = new Set(), usages = [];
  const episodesBySeq = new Map(session.overview.episodes.map(episode => [episode.failureSeqs[0], episode]));
  for (const turn of session.turns) {
    turn.native = nativeLocation(byEntry.get(turn.id).claudeRow);
    turn.reason = { kind: 'unknown' };
    turn.endObserved = false;
    const turnCalls = [];
    for (const step of turn.steps) {
      step.semanticUnit = 'claude-assistant-record';
      const row = byEntry.get(events.get(step.seq)?.id)?.claudeRow;
      const id = row && messageKey(row), usage = usageById.get(id);
      if (row) step.native = nativeLocation(row);
      if (usage && !assigned.has(id)) {
        assigned.add(id);
        usages.push({ turn: turn.number, turnId: turn.id, step: step.number, seq: step.seq, time: step.start, usage, source: 'claude-transcript', semanticUnit: 'assistant-message-usage' });
        step.inTok = usage.input; step.cacheTok = usage.cacheRead; step.outTok = usage.output;
      }
      for (const call of step.calls) {
        const { entry, block } = calls.get(call.id);
        const result = results.get(call.id);
        const input = toolInput(block), path = input?.file_path;
        call.source = 'claude-transcript';
        call.timingSource = 'unrecorded-start';
        call.native = nativeLocation(entry.claudeRow, call.id);
        call.resultNative = result ? nativeLocation(result.entry.claudeRow, call.id) : null;
        call.signature = input ? hash([call.nativeName, canonical(input)]) : null;
        if (!input) call.args = null;
        if (call.error) call.error.code = 'CLAUDE_TOOL_ERROR';
        call.semanticKind = ({ Read: 'read', Write: 'write', Edit: 'write', Bash: 'run' })[call.nativeName] || 'other';
        const fact = data.payload.context.callFacts?.[call.seq];
        if (fact && typeof path === 'string' && path && ['Read', 'Write', 'Edit'].includes(call.nativeName)) {
          const filename = path.replace(/\\/g, '/').split('/').at(-1);
          fact.target = path;
          fact.title = ({ Read: '读取 ', Write: '写入 ', Edit: '修改 ' })[call.nativeName] + filename;
          // This is the submitted replacement, not a reconstructed disk diff.
          fact.preview = call.nativeName === 'Edit' && typeof input.old_string === 'string' && typeof input.new_string === 'string'
            ? { before: input.old_string, after: input.new_string, partial: input.replace_all === true }
            : call.nativeName === 'Write' && typeof input.content === 'string'
              ? { before: '', after: input.content, partial: false } : null;
        }
        if (typeof path === 'string' && path && ['Read', 'Write', 'Edit'].includes(call.nativeName)) {
          call.target = path;
          const cwd = entry.claudeRow.cwd || projected.header.cwd;
          const impl = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path) || cwd.includes('\\') ? win32 : posix;
          data.payload.context.fileOperations.push({ seq: call.seq, turn: turn.number, step: step.number, path: impl.resolve(cwd, path), kind: call.nativeName === 'Read' ? 'read' : 'change', status: call.status, time: call.start, end: call.end, source: 'claude-transcript', nativeKind: call.nativeName });
        }
        turnCalls.push(call);
      }
    }
    applyClaudeRecovery(turnCalls, episodesBySeq);
  }
  data.payload.context.usage = usages;
  data.payload.evidence.unplacedAssistantUsageRecords = usageById.size - assigned.size;
  for (const file of data.payload.context.fileOperations) if (file.source === 'pi-session-v3') file.source = 'claude-transcript';
  for (const skill of data.payload.context.skillEvents) skill.source = 'claude-transcript';
  return data;
}

function applyClaudeRecovery(calls, episodesBySeq) {
  const returnedBySignature = new Map();
  for (const call of calls) {
    if (call.status !== 'returned' || !call.signature) continue;
    if (!returnedBySignature.has(call.signature)) returnedBySignature.set(call.signature, []);
    returnedBySignature.get(call.signature).push(call);
  }
  for (const call of calls) {
    const episode = episodesBySeq.get(call.seq);
    if (!episode) continue;
    // Transcript line order separates a later retry from a parallel call
    // whose result happened to be recorded after this error.
    const next = call.resultNative && returnedBySignature.get(call.signature)
      ?.find(candidate => candidate.native.line > call.resultNative.line);
    const continuation = next && Number.isFinite(next.end) && Number.isFinite(call.end) && next.end >= call.end
      ? next.end - call.end : null;
    Object.assign(episode, {
      targets: call.target ? [call.target] : [],
      complete: !!next, confirmedCount: next ? 1 : 0, unconfirmedCount: next ? 0 : 1,
      resolvedAt: next?.end ?? null, continuationMs: continuation, stepMs: null,
      summary: next ? '相同操作随后返回成功' : '后续结果待确认',
      pairs: next ? [{ failedSeq: call.seq, successSeq: next.seq, successTime: next.end, successStart: null }] : [],
      sequence: next ? [episode.sequence[0], { kind: 'success', time: next.end, label: '同参操作成功', seqs: [next.seq] }]
        : episode.sequence.slice(0, 1),
    });
  }
}
