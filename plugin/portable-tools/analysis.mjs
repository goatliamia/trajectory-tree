import { hash } from './sources.mjs';
import { estimateVisibleTokens } from '../../analyzers/codex-adapter.mjs';
import { matchesIoOutcome, summarizeToolOutcomes, TOOL_OUTCOME_BASIS } from '../trajectory-tools/lib/io-outcome.js';
import { callDurationMs, intervalUnion } from '../trajectory-tools/lib/tool-intervals.js';
import { groupRows } from '../../lib/scope-index.mjs';
import { usageRow, usageSettlements } from './usage.mjs';

export { intervalUnion, usageRow };

export const CATEGORIES = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'];
export const VIEWS = ['overview', 'latency', 'cost', 'repeats', 'io', 'context'];
const valid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sum = values => { const known = values.filter(valid); return known.length ? known.reduce((n, v) => n + v, 0) : null; };
const compact = text => String(text || '').replace(/\s+/g, ' ').slice(0, 180);
const self = name => /(?:^|[/_.])trajectory_(?:inspect|search|read|graph)$/.test(name);
const pointer = (data, seq) => ({ session: data.session, seq, logId: data.logId, ...(data.cut === undefined ? {} : { cut: data.cut }) });
export const toolName = call => call.nativeName || call.name;
function usageTotal(host, rows) {
  const values = rows.map(row => usageRow(host, row));
  return { records: rows.length, ...Object.fromEntries(['input', 'uncachedInput', 'cachedInput', 'cacheWrite', 'output', 'reportedCost'].map(k => [k, sum(values.map(v => v[k]))])), fieldCoverage: Object.fromEntries(['input', 'uncachedInput', 'cachedInput', 'output'].map(k => [k, values.filter(v => valid(v[k])).length])) };
}
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value; }
function declarationEvidence(data) {
  const definitions = new Map();
  function collect(tools, record, prefix = '') {
    for (const tool of Array.isArray(tools) ? tools : []) {
      if (tool.type === 'namespace' && Array.isArray(tool.tools)) { collect(tool.tools, record, prefix + tool.name + '.'); continue; }
      const body = tool.function || tool, name = prefix + (body.name || tool.type || 'unidentified');
      definitions.set(name, { tool: name, raw: tool, seq: record.seq });
    }
  }
  for (const record of data.records) {
    if (record.kind === 'declaration') collect(record.body.tools, record);
    if (record.kind === 'historical-definition') definitions.set(record.name, { tool: record.name, raw: record.body, seq: record.seq });
    if (data.host === 'pi') { const message = record.body?.message || record.body?.systemMessage; if (message?.role === 'system') collect(message.toolsAdded, record); }
  }
  return [...definitions.values()];
}

export function selectPortableEvidence(data, q) {
  const p = data.payload, session = p.sessions[0], context = p.context;
  const range = q.turns || { from: session.turns[0]?.number || 1, to: session.turns.at(-1)?.number || 1 };
  let turns = session.turns.filter(t => t.number >= range.from && t.number <= range.to);
  const allCalls = turns.flatMap(t => t.steps.flatMap(s => s.calls.map(c => ({
    ...c, turn: t.number, step: s.number,
    precise: callDurationMs({ ...c, startSeq: c.startSeq === null || ['ordinal-only', 'unrecorded-start'].includes(c.timingSource) ? null : c.startSeq ?? c.seq }) !== null,
  }))));
  let scopedCalls = allCalls.filter(c => q.includeSelf || !self(toolName(c)));
  const selected = q.seqs && new Set(q.seqs);
  if (selected) scopedCalls = scopedCalls.filter(c => selected.has(c.seq));
  const bySeq = new Map(data.records.map(r => [r.seq, r]));
  let files = context.fileOperations.filter(f => f.turn >= range.from && f.turn <= range.to);
  if (q.focus?.tool) scopedCalls = scopedCalls.filter(c => toolName(c) === q.focus.tool || c.name === q.focus.tool);
  if (q.focus?.file) { const seqs = new Set(files.filter(f => f.path === q.focus.file).map(f => f.seq)); scopedCalls = scopedCalls.filter(c => seqs.has(c.seq)); }
  if (q.focus?.skill) {
    const seqs = new Set(context.skillEvents.filter(s => s.name === q.focus.skill || s.path === q.focus.skill).map(s => s.seq));
    const touched = new Set(turns.filter(t => seqs.has(t.seq) || t.prompts.some(r => seqs.has(r.seq)) || t.steps.some(s => seqs.has(s.seq) || s.calls.some(c => seqs.has(c.seq)))).map(t => t.number));
    scopedCalls = scopedCalls.filter(c => touched.has(c.turn));
  }
  const calls = q.outcome === undefined ? scopedCalls : scopedCalls.filter(c => matchesIoOutcome(c.status, q.outcome));
  const focusTurns = (q.focus || selected) && new Set(calls.map(c => c.turn));
  if (focusTurns) turns = turns.filter(t => focusTurns.has(t.number));
  const turnIds = new Set(turns.map(t => t.id)), turnNumbers = new Set(turns.map(t => t.number));
  const callSeqs = new Set(calls.map(c => c.seq)); files = files.filter(f => callSeqs.has(f.seq));
  const rawUsage = (context.usage || []).filter(u => data.host !== 'codex' ? turnNumbers.has(u.turn) : turnIds.has(u.turnId));
  const usage = usageSettlements(rawUsage);
  const found = selected && new Set(scopedCalls.map(c => c.seq));
  const callSelection = found && { requested: selected.size, matched: found.size, unmatched: [...selected].filter(seq => !found.has(seq)) };
  return { p, session, context, range, turns, allCalls, scopedCalls, calls, bySeq, files, usage, turnIds, turnNumbers, callSelection };
}

export function inspectData(data, q) {
  const { p, session, context, range, turns, allCalls, scopedCalls, calls, bySeq, files, usage, turnIds, turnNumbers, callSelection } = selectPortableEvidence(data, q);
  const totals = usageTotal(data.host, usage);
  const nativeSpan = t => valid(t.durationMs) ? t.durationMs : t.endObserved === true && valid(t.start) && valid(t.end) && t.end >= t.start ? t.end - t.start : null;
  const measured = calls.filter(c => c.precise && valid(c.start) && valid(c.end) && c.end >= c.start);
  const nativeTurns = new Map(turns.map(t => [t.number, t]));
  const boundedIntervals = measured.flatMap(c => { const t = nativeTurns.get(c.turn); return t?.endObserved === true && valid(t.start) && valid(t.end) ? [[Math.max(c.start, t.start), Math.min(c.end, t.end)]] : []; }).filter(([a, b]) => b >= a);
  const read = seq => ({ tool: 'trajectory_read', ...pointer(data, seq), linked: true });
  const summary = { host: data.host, unit: data.host === 'pi' ? 'assistant-cycle' : data.host === 'claude' ? 'assistant-record' : 'visible-action', turns: turns.length, actions: turns.reduce((n, t) => n + t.steps.length, 0), calls: calls.length, errors: calls.filter(c => c.status === 'error').length,
    observedTurnSpanMs: sum(turns.map(nativeSpan)), nativeToolDurationMs: sum(calls.map(c => c.durationMs)), measuredToolIntervals: measured.length, toolCoveredMs: boundedIntervals.length ? intervalUnion(boundedIntervals) : null, returnedTextCharacters: calls.reduce((n, c) => n + (c.result?.text.length || 0) + (c.result?.omitted || 0), 0), usage: totals };
  const coverage = { usageUnit: data.host === 'pi' ? 'recorded assistant usage' : data.host === 'claude' ? 'recorded assistant message usage, deduplicated by message ID' : 'local response usage records; not all request attempts', callUnit: 'recorded native calls; inner Code Mode activity only when separately recorded', errorUnit: 'tool-result errors; turn failures and assistant stopReason remain separate', focusedUsage: q.focus ? 'whole owning turns, not attributed to the selected tool/file/skill' : 'selected turns', excludedDiagnosticCalls: allCalls.length - allCalls.filter(c => q.includeSelf || !self(toolName(c))).length, unknownTimingCalls: calls.length - measured.length, toolCoverage: 'union of recorded intervals clipped to owning turn bounds; native durations remain separate', crossTurnToolIntervals: measured.filter(c => { const t = nativeTurns.get(c.turn); return c.start < t.start || c.end > t.end; }).length, context: p.evidence.context, synthetic: data.synthetic };
  coverage.toolOutcomeBasis = TOOL_OUTCOME_BASIS;
  summary.toolOutcomes = summarizeToolOutcomes(scopedCalls);
  summary.failedTurns = data.host === 'codex' ? turns.filter(t => t.reason?.kind === 'failed').length : null;
  summary.assistantErrorCycles = data.host === 'pi' ? turns.flatMap(t => t.steps).filter(s => s.stopReason === 'error' || s.stopReason === 'aborted').length : null;
  if (callSelection) coverage.focusedUsage = 'whole owning turns, not attributed to the selected calls';
  // Share one materialization per query, and skip it for views that never use it.
  let cachedTurnRows;
  const turnRows = () => {
    if (cachedTurnRows) return cachedTurnRows;
    const callsByTurn = groupRows(calls, call => call.turn);
    const codex = data.host === 'codex';
    const usageByTurn = groupRows(usage, row => codex ? row.turnId : row.turn);
    cachedTurnRows = turns.map(t => {
      const own = callsByTurn.get(t.number) ?? [];
      const ownUsage = usageByTurn.get(codex ? t.id : t.number) ?? [];
      return { turn: t.number, title: compact(t.title || t.prompts[0]?.text), actions: t.steps.length, calls: own.length,
        errors: own.filter(c => c.status === 'error').length, wallMs: nativeSpan(t), usage: usageTotal(data.host, ownUsage),
        tools: [...new Set(own.map(toolName))],
        returnedTextCharacters: own.reduce((n, c) => n + (c.result?.text.length || 0) + (c.result?.omitted || 0), 0),
        read: read(t.prompts[0]?.seq ?? t.steps[0]?.seq ?? t.seq) };
    });
    return cachedTurnRows;
  };
  function toolRows() {
    return Array.from(groupRows(calls, toolName), ([name, own]) => {
      return { tool: name, count: own.length, errors: own.filter(c => c.status === 'error').length, operationKinds: Object.fromEntries([...new Set(own.map(c => c.semanticKind || c.classification?.kind || 'other'))].map(k => [k, own.filter(c => (c.semanticKind || c.classification?.kind || 'other') === k).length])), nativeDurationMs: sum(own.map(c => c.durationMs)), returnedTextCharacters: own.reduce((n, c) => n + (c.result?.text.length || 0) + (c.result?.omitted || 0), 0), positions: own.slice(0, 8).map(c => ({ turn: c.turn, step: c.step, status: c.status, read: read(c.seq) })) };
    });
  }
  function fileRows() {
    return Array.from(groupRows(files, file => file.path), ([path, own]) => ({
      file: path, count: own.length, reads: own.filter(f => f.kind === 'read').length,
      changes: own.filter(f => f.kind === 'change').length, errors: own.filter(f => f.status === 'error').length,
      sources: [...new Set(own.map(f => f.source))], read: read(own[0].seq),
    }));
  }
  let rows, extra = {};
  if (['overview', 'latency', 'cost'].includes(q.view)) {
    rows = q.groupBy === 'tool' ? toolRows() : q.groupBy === 'file' ? fileRows() : q.groupBy === 'definition' ? [] : turnRows();
    if (!q.groupBy) {
      const materialized = turnRows(), size = Math.max(1, Math.ceil(materialized.length / 6));
      rows = [];
      for (let i = 0; i < materialized.length; i += size) {
        const group = materialized.slice(i, i + size), selected = new Set(group.map(r => r.turn));
        const selectedIds = new Set(turns.filter(t => selected.has(t.number)).map(t => t.id));
        const windowUsage = usage.filter(u => data.host !== 'codex' ? selected.has(u.turn) : selectedIds.has(u.turnId));
        const range = { from: group[0].turn, to: group.at(-1).turn };
        rows.push({ kind: 'window', turns: range, ...(group.length === 1 ? { turn: group[0].turn } : {}), firstTask: group[0].title, lastTask: group.at(-1).title, actions: group.reduce((n, r) => n + r.actions, 0), calls: group.reduce((n, r) => n + r.calls, 0), errors: group.reduce((n, r) => n + r.errors, 0), wallMs: sum(group.map(r => r.wallMs)), usage: usageTotal(data.host, windowUsage), returnedTextCharacters: group.reduce((n, r) => n + r.returnedTextCharacters, 0), read: group[0].read, expand: { tool: 'trajectory_inspect', view: q.view, turns: range, groupBy: 'turn', ...(q.focus ? { focus: q.focus } : {}) } });
      }
    }
    if (q.view === 'cost') {
      const historical = context.scope ? [] : declarationEvidence(data);
      extra = { latestRecordedInput: p.officialStats?.context?.pressure ?? null, scope: context.scope ? { source: context.scope.source, observedAt: context.scope.observedAt, configuredTools: context.scope.tools.length, activeTools: context.scope.tools.filter(t => t.active).length, definitions: { tool: 'trajectory_inspect', view: 'cost', groupBy: 'definition' }, read: read(data.records.find(r => r.kind === 'scope').seq) } : null, historicalDeclarationCount: historical.length, definitionBasis: context.scope ? 'current Pi SDK catalog; exposure and active status are separate' : historical.length ? 'historical declarations, not a current inventory; non-matching Codex names do not prove non-use' : 'no recorded tool definitions; calls remain available in io' };
      if (q.groupBy === 'definition') rows = (context.scope?.tools || []).filter(t => !q.focus?.tool || t.name === q.focus.tool).map(t => ({ tool: t.name, active: t.active, exposure: t.exposure ?? null, reachesTools: t.reachesTools ?? null, origin: t.source ?? null, schemaTextEstimate: estimateVisibleTokens(JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters })), directCallsInRange: calls.filter(c => toolName(c) === t.name).length, read: read(data.records.find(r => r.kind === 'definition' && r.name === t.name).seq) }));
      if (q.groupBy === 'definition' && !context.scope) rows = historical.filter(t => !q.focus?.tool || t.tool === q.focus.tool).map(t => ({ tool: t.tool, active: null, basis: 'historical declaration', schemaTextEstimate: estimateVisibleTokens(JSON.stringify(t.raw)), directCallsInRange: calls.some(c => toolName(c) === t.tool) || data.host === 'pi' ? calls.filter(c => toolName(c) === t.tool).length : null, read: read(t.seq) }));
    }
  } else if (q.view === 'io') rows = q.groupBy === 'turn' ? turnRows() : q.groupBy === 'file' ? fileRows() :
    q.seqs && !q.groupBy ? calls.map(c => ({ turn: c.turn, step: c.step, seq: c.seq, tool: toolName(c), status: c.status,
      ...(c.attribution ? { attribution: c.attribution } : {}),
      native: bySeq.get(c.seq)?.native, nativeDurationMs: c.durationMs, read: read(c.seq) })) : toolRows();
  else if (q.view === 'repeats') {
    const groups = new Map();
    for (const c of calls) {
      const record = bySeq.get(c.seq);
      let args = record?.arguments ?? record?.body?.arguments;
      if (c.nativeName === 'commandExecution') args = { command: args?.command, cwd: args?.cwd };
      // Incomplete adapter excerpts are never evidence of identical parameters.
      if (args === undefined) continue;
      const signature = hash(canonical({ name: toolName(c), arguments: args }));
      if (!groups.has(signature)) groups.set(signature, []); groups.get(signature).push(c);
    }
    rows = [...groups.values()].filter(g => g.length > 1).map(g => ({ tool: toolName(g[0]), count: g.length, positions: g.slice(0, 12).map(c => ({ turn: c.turn, step: c.step, status: c.status, read: read(c.seq) })), morePositions: Math.max(0, g.length - 12) }));
  } else {
    rows = context.requests.filter(r => turnNumbers.has(r.turn)).map(r => ({ turn: r.turn, step: r.step, seq: r.seq, semantics: r.semanticUnit, values: Object.fromEntries(CATEGORIES.map(k => [k, r[k]])), selectedEstimate: CATEGORIES.reduce((n, k) => n + Number(r[k] || 0), 0), source: r.source, read: read(r.seq) }));
    const boundaries = context.boundaries.filter(b => turnNumbers.has(b.turn)), skills = context.skillEvents.filter(s => !s.turn || turnNumbers.has(s.turn));
    extra = { currentVisibleEstimate: context.current, boundaryCount: boundaries.length, boundaries: boundaries.slice(-12).map(b => ({ kind: b.kind, turn: b.turn, seq: b.seq, source: b.source, summary: compact(b.summary), read: read(b.seq) })), skillEventCount: skills.length, skillEvents: skills.slice(-20).map(s => ({ kind: s.kind, name: s.name, path: s.path, turn: s.turn, seq: s.seq, entries: s.entries?.length })), scopeAvailable: !!context.scope };
  }
  const value = row => q.sort === 'input' ? row.usage?.input : q.sort === 'output' ? row.usage?.output : q.sort === 'returned' ? row.returnedTextCharacters : q.sort === 'count' ? row.count ?? row.calls : q.sort === 'wall' ? row.wallMs ?? row.nativeDurationMs : q.sort === 'change' ? row.selectedEstimate : null;
  if (q.sort && q.sort !== 'time') rows.sort((a, b) => (value(b) ?? -Infinity) - (value(a) ?? -Infinity));
  // Samples are optional excerpts, not the counters or frozen-cut read pointers.
  // Keep them out of both rows and summary windows when explicitly disabled.
  if (q.samples === false) {
    const withoutSamples = value => {
      if (Array.isArray(value)) return value.map(withoutSamples);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).filter(([key]) => !['title', 'firstTask', 'lastTask', 'summary'].includes(key)).map(([key, item]) => [key, withoutSamples(item)]));
    };
    rows = withoutSamples(rows); extra = withoutSamples(extra);
  }
  return { summary, coverage, range, focus: q.focus ?? null, ...(callSelection ? { scope: { callSelection } } : {}),
    ...(q.outcome ? { outcome: q.outcome } : {}), ...extra, rows };
}
