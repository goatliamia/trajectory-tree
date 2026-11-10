import { createHash } from 'node:crypto';
import { projectSession } from './inspect-models/session.js';
import { describeOperation } from './inspect-models/operations.mjs';
import { replayOfficialStats, estimateToolsTokens } from './official-stats.js';
import { costRequests, costTotals, costCoverage } from './usage.js';
import { buildRelations } from './linked-read.js';
import { summarizeToolOutcomes, TOOL_OUTCOME_BASIS } from './io-outcome.js';
import { groupInspectionCalls, matchesInspectionFocus, sampleInspectionCall, sampleInspectionFiles, selectInspectionCalls } from './inspection-io.js';
import { recordedStepTimingBasis, recordedStepTimings } from './tool-intervals.js';
import { buildRequestContext, requestContextBasis, requestContextKeys, requestContextSource } from './request-context.js';

export const INSPECT_VIEWS = ['overview', 'latency', 'cost', 'repeats', 'io', 'context'];
const replacement = e => e.surfaceOp && typeof e.surfaceOp === 'object';
const text = blocks => (blocks || []).filter(b => b.type === 'text').map(b => b.text || '').join('\n');
const json = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
const hash = value => createHash('sha256').update(value).digest('base64url');
const clip = (value, max = 180) => { const s = String(value || ''); return { text: Buffer.from(s.slice(0, max), 'utf16le').toString('utf16le'), omitted: Math.max(0, s.length - max) }; };
const inRange = (n, range) => !range || n >= range.from && n <= range.to;
const stepKey = row => row.turn + ':' + row.step;
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const contextTotalColumn = 4 + requestContextKeys.length;
const sum = values => { const known = values.filter(v => v != null); return known.length ? known.reduce((a, b) => a + b, 0) : null; };
const METRICS = ['wall', 'ttft', 'model', 'decode', 'tool', 'toolWall', 'retries', 'toolErrors', 'output'];
const outsideStep = s => finite(s.official.toolWall) !== null && finite(s.official.wall) !== null && s.official.toolWall > s.official.wall + 1;
const sumSteps = steps => {
  const totals = Object.fromEntries(METRICS.map(k => [k, sum(steps.map(s => s.official[k]))]));
  // Preserve official per-step readings. A call spanning beyond a step cannot
  // decompose that step's active time (including later copies/background work).
  // 官方逐项 toolWall 已经是调用区间的并集;它偶尔大于活动步时长(调用跨步),
  // 这不是错误,求和照旧,只在 coverage 里说明,不再把整项置空。
  return totals;
};

function sumRecordedToolTiming(steps, recorded) {
  const timings = steps.map(step => recorded.get(step)).filter(Boolean);
  return {
    measuredSteps: timings.filter(timing => timing.coveredMs !== null).length,
    calls: sum(timings.map(timing => timing.calls)),
    pairedCalls: sum(timings.map(timing => timing.pairedCalls)),
    sumStepCumulativeMs: sum(timings.map(timing => timing.cumulativeMs)),
    sumStepCoveredMs: sum(timings.map(timing => timing.coveredMs)),
  };
}

export async function readOfficialProjections(ctx, loaded, signal) {
  signal?.throwIfAborted();
  const registry = ctx.get('sessionProjections');
  const id = loaded.header?.id ?? loaded.id;
  const live = id ? ctx.get('sessions')?.get?.(id) : undefined;
  const keys = ['tokenUsage', 'contextBreakdown', 'contextPressure'];
  if (live && typeof registry?.snapshot === 'function') {
    const snapshot = registry.snapshot(live, keys);
    if (snapshot?.asOfSeq === loaded.events.at(-1)?.seq) {
      const values = Object.fromEntries(keys.filter(key => snapshot.values?.[key] !== undefined).map(key => [key, snapshot.values[key]]));
      return { values, source: 'sessionProjections.snapshot', asOfSeq: snapshot.asOfSeq };
    }
  }
  return { values: {}, source: 'unavailable' };
}

function schemaInventory(events) {
  const definitions = new Map(), uses = new Map(), roots = new Map(), seen = new Set(), estimates = new Map();
  const headerSeqs = [];
  let turn = null, metadataChanges = 0, metadataChangesWithoutHeader = 0;
  let active = new Map();
  for (const event of events) {
    if (replacement(event)) continue;
    const d = event.data || {};
    if (event.type === 'turn/start') turn = d.turn;
    if (event.type === 'tool/call') roots.set(d.callId, d.turn ?? turn);
    if (event.type === 'request/header') {
      headerSeqs.push(event.seq);
      const next = new Map();
      for (const schema of d.header?.tools || []) {
        if (!schema.name) continue;
        const version = hash(JSON.stringify(schema));
        if (!estimates.has(version)) estimates.set(version, estimateToolsTokens({ tools: [schema] }));
        let item = definitions.get(schema.name);
        if (!item) {
          item = { name: schema.name, owner: null, versions: new Set(), standaloneEstimatedTokens: 0, deferredRequested: false,
            firstHeaderSeq: event.seq, lastHeaderSeq: event.seq, intervals: [] };
          definitions.set(schema.name, item);
        }
        item.versions.add(version); item.lastHeaderSeq = event.seq;
        item.standaloneEstimatedTokens = Math.max(item.standaloneEstimatedTokens, estimates.get(version));
        item.deferredRequested ||= schema.deferLoading === true;
        let interval = active.get(schema.name);
        if (interval?.version !== version) {
          interval = { fromSeq: event.seq, toSeq: null, version, standaloneEstimatedTokens: estimates.get(version),
            deferredRequested: schema.deferLoading === true };
          item.intervals.push(interval);
        }
        next.set(schema.name, interval);
      }
      for (const [name, interval] of active) if (next.get(name) !== interval) interval.toSeq = event.seq - 1;
      active = next;
    }
    if (event.type === 'request/context') { metadataChanges++; if (!headerSeqs.length) metadataChangesWithoutHeader++; }
    if (['tool/call', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start'].includes(event.type)) {
      const key = event.type === 'tool/call' ? 'root:' + d.callId : JSON.stringify([d.rootCallId, d.subCallId]);
      const id = d.callId || d.subCallId ? key : 'seq:' + event.seq;
      if (d.name && !seen.has(id)) {
        seen.add(id);
        const t = d.turn ?? roots.get(d.rootCallId) ?? turn, k = JSON.stringify([d.name, t]);
        if (!uses.has(k)) uses.set(k, { name: d.name, turn: t, count: 0 });
        uses.get(k).count++;
      }
    }
  }
  return { source: '@deepseek-ai/dsh-token-meter/estimate', basis: 'official-standalone-estimate',
    headerChanges: headerSeqs.length, headerSeqs, metadataChanges, metadataChangesWithoutHeader,
    definitions: [...definitions.values()].map(d => ({ ...d, versions: d.versions.size })),
    invocations: [...uses.values()],
    coverage: { owners: 'not recorded in tool schemas', embeddedCatalogs: 'not separated from system text',
      measurement: 'Definition sizes are estimates; metadata changes are not requests/exposures. Invocation counts do not establish necessity.' } };
}

export function buildInspection(loaded, sessionId, { turns = null, projections = { values: {} }, contextSeries, statsReader = replayOfficialStats } = {}) {
  const events = loaded.events, bySeq = new Map(events.map(e => [e.seq, e]));
  const scope = { session: sessionId, turns, fromSeq: events[0]?.seq ?? null, toSeq: events.at(-1)?.seq ?? null };
  const anchors = Object.fromEntries(events.map(e => [e.seq, hash(JSON.stringify(e))]));
  const coverage = {}, views = Object.fromEntries(INSPECT_VIEWS.map(v => [v, []])), stepEntries = [];
  const relations = buildRelations(events), usageRows = costRequests(events);
  let native;
  try { native = projectSession([{ type: 'session', id: sessionId, version: 4 }, ...events], { cwd: loaded.header?.cwd }); }
  catch (error) { native = { turns: [] }; coverage.native = { status: 'unavailable', reason: error.message }; }
  const nativeSteps = new Map(), calls = [], callsByStep = new Map();
  for (const t of native.turns) for (const s of t.steps) {
    if (!inRange(t.number, turns)) continue;
    nativeSteps.set(t.number + ':' + s.number, { turn: t.number, step: s.number,
      evidence: { seq: s.seq, assistantSeq: s.assistantSeq, endSeq: s.endSeq, start: s.start, end: s.endObserved ? s.end : null, following: clip(s.reply?.text, 220) } });
    for (const call of s.calls) {
      const raw = bySeq.get(call.seq)?.data || {}, result = bySeq.get(call.resultSeq)?.data || {};
      const output = text(result.message?.content || result.content), args = json(raw.arguments);
      const detail = describeOperation(call, args, output, result.meta, loaded.header?.cwd);
      const startSeq = call.inner ? call.startSeq : call.seq;
      calls.push({ seq: call.seq, resultSeq: call.resultSeq, startSeq, rootSeq: call.rootSeq ?? null,
        name: call.name, turn: t.number, step: s.number, signature: call.signature, status: call.status, start: startSeq == null ? null : call.start, end: call.end,
        ...(call.attribution ? { attribution: call.attribution } : {}),
        args: clip(typeof raw.arguments === 'string' ? raw.arguments : JSON.stringify(raw.arguments || {})), result: clip(output),
        resultHash: call.resultSeq == null ? null : hash(output), outputCharacters: call.resultSeq == null ? null : output.length,
        family: detail.family, files: detail.files.map(f => ({ path: f.path, access: f.access, matchedLines: f.lines?.length || 0 })),
        search: detail.search ? { total: detail.search.total, shown: detail.search.shown, truncated: detail.search.truncated } : null });
    }
  }
  let official;
  for (const c of calls) { const k = c.turn + ':' + c.step; if (!callsByStep.has(k)) callsByStep.set(k, []); callsByStep.get(k).push(c); }
  try { official = statsReader(events); coverage.statistics = { status: 'available', source: official.source, hash: official.hash }; }
  catch (error) { official = { snapshot: { turns: [] } }; coverage.statistics = { status: 'unavailable', reason: error.message }; }
  const officialSteps = new Map(official.snapshot.turns.filter(t => inRange(t.turn, turns)).flatMap(t => t.steps).map(s => [s.turn + ':' + s.step, s]));
  for (const key of new Set([...officialSteps.keys(), ...nativeSteps.keys()])) {
    const stats = officialSteps.get(key), projected = nativeSteps.get(key);
    const { turn, step } = stats ?? projected;
    const own = callsByStep.get(key) || [];
    const entry = { turn, step,
      official: Object.fromEntries([...METRICS, 'cacheRead', 'cacheWrite', 'cacheHit', 'context'].map(k => [k, finite(stats?.[k])])),
      tools: stats?.tools,
      evidence: { ...projected?.evidence,
        callSeqs: own.slice(0, 3).map(c => c.seq), omittedCalls: Math.max(0, own.length - 3) } };
    const index = stepEntries.push(entry) - 1; views.latency.push(index); views.cost.push(index);
  }
  views.latency.sort((a, b) => (stepEntries[b].official.wall ?? -1) - (stepEntries[a].official.wall ?? -1));
  views.cost.sort((a, b) => ((stepEntries[b].official.context ?? 0) + (stepEntries[b].official.output ?? 0)) - ((stepEntries[a].official.context ?? 0) + (stepEntries[a].official.output ?? 0)));
  const groups = new Map();
  for (const c of calls) {
    const { signature, resultHash, ...proof } = c;
    views.io.push({ ...proof, callSeq: c.seq, stepSeq: nativeSteps.get(c.turn + ':' + c.step)?.evidence.seq ?? null });
    if (!signature) continue;
    const key = c.turn + ':' + signature; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c);
  }
  for (const own of groups.values()) if (own.length >= 2) views.repeats.push({
    name: own[0].name, turn: own[0].turn, count: own.length, seq: own[0].seq,
    sameReturnedText: own.every(c => c.resultHash !== null && c.resultHash === own[0].resultHash),
    classification: own[0].family === 'process' ? 'polling-or-task-operation' : 'repeat-candidate',
    evidenceSeqs: [own[0].seq, own.at(-1).seq], omittedCalls: Math.max(0, own.length - 2),
    files: [...new Set(own.flatMap(c => c.files.map(f => f.path)))] });
  views.repeats.sort((a, b) => b.count - a.count);
  views.io.sort((a, b) => b.outputCharacters - a.outputCharacters || a.seq - b.seq);
  const values = projections.values || {};
  const { requests, current, pressure } = contextSeries ?? buildRequestContext(events, null);
  coverage.projections = { source: projections.source || 'unavailable', keys: ['tokenUsage', 'contextBreakdown', 'contextPressure'].filter(k => values[k] !== undefined),
    ...(projections.error ? { reason: projections.error } : {}) };
  coverage.context = { source: requestContextSource, basis: requestContextBasis,
    estimatedSamples: requests.filter(row => finite(row.total) !== null).length,
    reportedSamples: requests.filter(row => finite(row.reportedInput) !== null).length,
    firstRecordedTurn: requests[0]?.turn ?? null,
    status: requests.length ? requests[0].turn > (turns?.from ?? native.turns[0]?.number ?? 1) ? 'partial' : 'available' : 'unavailable' };
  let relatedAt = 0;
  for (let i = 1; i < requests.length; i++) {
    const before = requests[i - 1], after = requests[i], relatedEvents = [];
    while (relatedAt < events.length && events[relatedAt].seq <= before.seq) relatedAt++;
    while (relatedAt < events.length && events[relatedAt].seq <= after.seq) {
      const e = events[relatedAt++];
      if (relatedEvents.length < 5 && /^(?:compaction\/|tool\/result|tool\/ptc-dispatch$)/.test(e.type)) relatedEvents.push({ seq: e.seq, type: e.type });
    }
    if (!inRange(after.turn, turns)) continue;
    const estimatedNet = finite(after.total) !== null && finite(before.total) !== null ? after.total - before.total : null;
    const reportedNet = finite(after.reportedInput) !== null && finite(before.reportedInput) !== null ? after.reportedInput - before.reportedInput : null;
    if (estimatedNet === null && reportedNet === null) continue;
    // The two endpoints already live in contextSamples. Expand the deltas only
    // for rows on the requested page, so long cuts stay within the cache budget.
    views.context.push([i, estimatedNet, reportedNet, relatedEvents]);
  }
  const inventory = schemaInventory(events);
  inventory.definitions.sort((a, b) => b.standaloneEstimatedTokens - a.standaloneEstimatedTokens);
  const definitions = inventory.definitions.map(d => ({ ...d, invocationsInScope: inventory.invocations.filter(u => u.name === d.name && inRange(u.turn, turns)).reduce((n, u) => n + u.count, 0) }));
  const turnEntries = native.turns.filter(t => inRange(t.number, turns)).map(t => {
    const own = stepEntries.filter(s => s.turn === t.number), meta = relations.turns[t.number];
    const promptSeqs = meta?.userSeqs || t.prompts.map(p => p.seq), prompt = promptSeqs.map(seq => text(bySeq.get(seq)?.data?.content)).filter(Boolean).join('\n');
    const last = [...t.steps].reverse().find(s => s.reply?.text);
    const toolCounts = {}; for (const c of calls.filter(c => c.turn === t.number)) toolCounts[c.name] = (toolCounts[c.name] || 0) + 1;
    return { turn: t.number, seq: t.seq, endSeq: t.endSeq, status: t.reason?.kind || 'open', steps: own.length,
      prompt: clip(prompt || t.prompts[0]?.text, 600), promptSeqs, following: clip(last?.reply?.text, 500),
      replySeq: last?.assistantSeq ?? null, official: sumSteps(own), toolCounts,
      markers: t.markers.map(m => ({ seq: m.seq, type: m.type })) };
  });
  const usage = costTotals(usageRows);
  const summary = { steps: stepEntries.length, nativeCallsForEvidence: calls.length,
    tokenUsageWholeSession: values.tokenUsage || (usage.requests ? {
      uncachedInputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite,
    } : null),
    contextBreakdownAtCut: values.contextBreakdown || (current ? { systemTokens: current.system, toolsTokens: current.tools,
      messageTokens: current.total - current.system - current.tools, source: requestContextSource } : null),
    contextPressureAtCut: values.contextPressure || pressure || null,
    toolDefinitions: { ...inventory, headerSeqs: undefined, invocations: undefined, definitions, definitionCount: definitions.length },
    statisticsScope: 'official step metrics; whole-session projections and at-cut composition labeled separately' };
  return JSON.parse(JSON.stringify({ scope, coverage, summary, views, stepEntries, turnEntries, usageRows,
    // Tuples avoid retaining a second set of long field names per request.
    contextSamples: requests.map(r => ['seq', 'turn', 'step', 'time', ...requestContextKeys, 'total', 'reportedInput', 'headerSeq'].map(k => r[k] ?? null)),
    declarationHeaders: inventory.headerSeqs, declarationInvocations: inventory.invocations,
    definitionItems: definitions.filter(d => d.invocationsInScope === 0), anchors, relations }));
}

function usageSummary(rows) {
  const { requests, unknownRequests, ...totals } = costTotals(rows);
  return { settlements: requests, unknownSettlements: unknownRequests, ...totals, coverage: costCoverage(rows),
    basis: 'recorded assistant/message usage settlements; missing buckets remain null' };
}

function usageFor(index, turns, stepKeys) {
  return usageSummary(index.usageRows.filter(row => inRange(row.turn, turns) && (!stepKeys || stepKeys.has(stepKey(row)))));
}

function usageByStep(rows, turns) {
  const groups = new Map();
  for (const row of rows) {
    if (!inRange(row.turn, turns)) continue;
    const key = stepKey(row), group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function definitionsInScope(index, turns, tool) {
  const ownTurns = index.turnEntries.filter(row => inRange(row.turn, turns));
  if (turns && !ownTurns.length) return [];
  const fromSeq = turns ? ownTurns[0].seq : index.scope.fromSeq;
  const toSeq = (turns ? ownTurns.at(-1).endSeq : null) ?? index.scope.toSeq;
  const points = [...index.usageRows, ...index.views.io].filter(row => inRange(row.turn, turns)).map(row => row.seq);
  const definitions = [];
  for (const definition of index.summary.toolDefinitions.definitions) {
    if (tool && definition.name !== tool) continue;
    const intervals = definition.intervals.filter(({ fromSeq: start, toSeq: end }) => points.length
      ? points.some(seq => seq >= start && (end == null || seq <= end))
      : start <= toSeq && (end == null || end >= fromSeq));
    if (!intervals.length) continue;
    const last = intervals.at(-1);
    const lastHeaderSeq = index.declarationHeaders.findLast(seq => seq >= last.fromSeq && seq <= Math.min(last.toSeq ?? toSeq, toSeq));
    definitions.push({ ...definition, intervals: undefined,
      firstHeaderSeq: intervals[0].fromSeq, lastHeaderSeq: lastHeaderSeq ?? last.fromSeq,
      versions: new Set(intervals.map(interval => interval.version)).size,
      standaloneEstimatedTokens: intervals.reduce((max, interval) => Math.max(max, interval.standaloneEstimatedTokens), 0),
      deferredRequested: intervals.some(interval => interval.deferredRequested),
      invocationsInScope: index.declarationInvocations.filter(row => row.name === definition.name && inRange(row.turn, turns))
        .reduce((count, row) => count + row.count, 0) });
  }
  return definitions.sort((a, b) => b.standaloneEstimatedTokens - a.standaloneEstimatedTokens);
}

function contextChange(samples, { sampleIndex, ...row }) {
  const before = samples[sampleIndex - 1], after = samples[sampleIndex];
  const endpoint = sample => {
    const [total, reportedInput, headerSeq] = sample.slice(contextTotalColumn);
    return { seq: sample[0], headerSeq, total, reportedInput };
  };
  const categoryNetChange = Object.fromEntries(requestContextKeys.map((key, i) => {
    const left = before[4 + i], right = after[4 + i];
    return [key, left !== null && right !== null ? right - left : null];
  }));
  return { ...row, before: endpoint(before), after: endpoint(after), categoryNetChange };
}

export function inspectionPage(index, view, offset = 0, limit = 3, options = {}) {
  const { turns = index.scope.turns, focus, outcome, groupBy, sort, samples = true, seqs } = options;
  const { scopedCalls, calls, callSelection } = selectInspectionCalls(index, { turns, focus, outcome, seqs });
  const callBySeq = new Map(index.views.io.map(c => [c.seq, c]));
  if (focus?.tool) for (const call of scopedCalls) if (call.transportOnly) callBySeq.set(call.seq, call);
  const preview = call => sampleInspectionCall(call, focus);
  const focusSteps = focus || seqs ? new Set(calls.map(c => c.turn + ':' + c.step)) : null;
  const steps = index.stepEntries.filter(s => inRange(s.turn, turns) && (!focusSteps || focusSteps.has(s.turn + ':' + s.step)));
  const timings = view === 'latency' ? recordedStepTimings(steps, index.views.io) : null;
  const allowedTurns = new Set([...steps.map(s => s.turn), ...calls.map(c => c.turn)]);
  const ownTurns = index.turnEntries.filter(t => inRange(t.turn, turns) && (!focusSteps || allowedTurns.has(t.turn)));
  const stepView = (view === 'latency' || view === 'cost') && groupBy !== 'turn';
  let stepUsage;
  const usageRowsFor = row => (stepUsage ??= usageByStep(index.usageRows, turns)).get(stepKey(row)) ?? [];
  const scope = { ...index.scope, turns: turns || null, ...(outcome ? { outcome } : {}),
    ...(focus ? { focus } : {}), ...(callSelection ? { callSelection } : {}),
    ...(focusSteps ? { metricsScope: 'whole steps containing matching calls; not per-object token/time attribution' } : {}) };
  const hydration = step => {
    const { following, ...evidence } = step.evidence;
    if (!samples) return { ...step, evidence };
    return { ...step, evidence: { ...evidence, following, callSeqs: undefined,
      prompt: index.turnEntries.find(t => t.turn === step.turn)?.prompt,
      calls: evidence.callSeqs.map(seq => callBySeq.get(seq)).filter(Boolean).map(preview) } };
  };
  const groupTurn = (ts, compact = false) => {
    const ids = new Set(ts.map(t => t.turn)), ss = steps.filter(s => ids.has(s.turn));
    const usage = usageFor(index, { from: ts[0].turn, to: ts.at(-1).turn }, new Set(ss.map(s => s.turn + ':' + s.step)));
    const counts = Object.fromEntries([...new Set(ts.flatMap(t => Object.keys(t.toolCounts)))].map(n => [n, ts.reduce((v, t) => v + (t.toolCounts[n] || 0), 0)]));
    const toolPairs = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const largest = [...ts].sort((a, b) => (b.official.wall ?? -1) - (a.official.wall ?? -1))[0];
    const sampleTurns = [...new Set(compact ? [ts[0], ts.at(-1), largest] : [ts[0], ts[Math.floor((ts.length - 1) / 2)], ts.at(-1), largest])];
    const small = (e, max) => ({ ...clip(e.text, max), omitted: e.omitted + Math.max(0, e.text.length - max) });
    return { turns: { from: ts[0].turn, to: ts.at(-1).turn }, seq: ts[0].seq, endSeq: ts.at(-1).endSeq,
      steps: ss.length, official: sumSteps(ss),
      ...(timings ? { recordedToolTiming: sumRecordedToolTiming(ss, timings) } : {}),
      usage: compact ? { settlements: usage.settlements, input: usage.input, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, output: usage.output,
        ...(usage.unknownSettlements ? { unknownSettlements: usage.unknownSettlements } : {}) } : usage,
      ...(samples ? { samples: sampleTurns.map(t => ({ turn: t.turn, seq: t.seq, promptSeqs: t.promptSeqs, prompt: compact ? small(t.prompt, 180) : t.prompt,
        following: compact ? small(t.following, 140) : t.following, replySeq: t.replySeq, status: t.status })) } : {}),
      toolCounts: compact ? Object.fromEntries(toolPairs.slice(0, 6)) : counts,
      ...(compact && toolPairs.length > 6 ? { omittedToolKinds: toolPairs.length - 6, otherCalls: toolPairs.slice(6).reduce((n, p) => n + p[1], 0) } : {}),
      markers: ts.flatMap(t => t.markers).slice(0, compact ? 4 : 8) };
  };
  let rows;
  if (view === 'overview') {
    if (groupBy === 'tool' || groupBy === 'file') rows = groupInspectionCalls(calls, groupBy);
    else if (groupBy === 'turn') rows = ownTurns.map(t => groupTurn([t]));
    else { rows = []; const size = Math.max(1, Math.ceil(ownTurns.length / 6)); for (let i = 0; i < ownTurns.length; i += size) rows.push(groupTurn(ownTurns.slice(i, i + size), true)); }
  } else if (view === 'latency' || view === 'cost') {
    rows = stepView ? steps.slice() : ownTurns.map(t => groupTurn([t]));
  } else if (view === 'io') rows = groupBy ? groupInspectionCalls(calls, groupBy) : calls;
  else if (view === 'repeats') rows = index.views.repeats.filter(r => inRange(r.turn, turns) && matchesInspectionFocus(r, focus))
    .map(r => ({ ...r, files: sampleInspectionFiles(r.files, focus), evidenceSeqs: undefined, evidence: r.evidenceSeqs.map(seq => preview(callBySeq.get(seq))) }));
  else rows = index.views.context.flatMap(([sampleIndex, estimatedNet, reportedNet, relatedEvents]) => {
    const [seq, turn, step] = index.contextSamples[sampleIndex];
    if (!inRange(turn, turns) || focusSteps && !focusSteps.has(turn + ':' + step)) return [];
    return [{ sampleIndex, turn, step, seq, net: estimatedNet ?? reportedNet, estimatedNet, reportedNet, relatedEvents }];
  });
  const order = sort || (view === 'latency' ? 'wall' : view === 'cost' ? 'input' : view === 'io' ? 'returned' : view === 'repeats' ? 'count' : view === 'context' ? 'change' : 'time');
  const usageOrder = order === 'input' || order === 'output';
  // Rank on the requested bucket and attach full usage and evidence only after paging.
  const ranks = stepView && usageOrder ? new Map(rows.map(row => [row, sum(usageRowsFor(row).map(usage => usage[order]))])) : null;
  const value = row => order === 'wall' ? row.official?.wall : usageOrder ? (ranks ? ranks.get(row) : row.usage?.[order]) :
    order === 'returned' ? row.returnedCharacters ?? row.outputCharacters : order === 'count' ? row.calls ?? row.count : order === 'change' ? Math.abs(row.net ?? 0) : row.seq;
  rows.sort((a, b) => order === 'time' ? (value(a) ?? Infinity) - (value(b) ?? Infinity) : (value(b) ?? -1) - (value(a) ?? -1) || (a.seq ?? 0) - (b.seq ?? 0));
  const includeDefinitions = view === 'overview' || view === 'cost';
  const definitionTool = view === 'cost' ? focus?.tool : undefined;
  const compactToolCost = definitionTool && !samples;
  const definitions = includeDefinitions ? definitionsInScope(index, turns, definitionTool) : [];
  const uncalled = view === 'cost' && !compactToolCost ? definitions.filter(d => !d.invocationsInScope) : null;
  const coverage = structuredClone(index.coverage);
  coverage.toolOutcomeBasis = TOOL_OUTCOME_BASIS;
  if ((view === 'io' || view === 'overview') && groupBy) coverage.callTiming = 'Observed call start and result timestamps; all paired result statuses included. P50/P95 use nearest rank. Durations may overlap; missing is not zero. Groups follow outcome filtering.';
  const outsideCount = steps.filter(outsideStep).length;
  if (outsideCount) coverage.timing = { toolSpansOutsideStep: outsideCount,
    toolWallAggregate: 'sum of official per-step toolWall; spans crossing step boundaries can make it exceed active step time',
    tool: 'sum of paired call durations, may overlap; not tool wall coverage' };
  if (coverage.context.status !== 'unavailable') coverage.context.status = coverage.context.firstRecordedTurn > (turns?.from ?? ownTurns[0]?.turn ?? 1) ? 'partial' : 'available';
  const summary = { turns: ownTurns.length, steps: steps.length, calls: calls.length, official: sumSteps(steps),
    toolOutcomes: coverage.native?.status === 'unavailable' ? null : summarizeToolOutcomes(scopedCalls),
    usage: usageFor(index, turns, focusSteps), timingUnit: 'ms; sums of official active steps, not session elapsed time' };
  if (timings) {
    coverage.recordedToolTiming = recordedStepTimingBasis + ' Rollups sum measured steps. Unpaired calls and missing step bounds can leave gaps.';
    summary.recordedToolTiming = sumRecordedToolTiming(steps, timings);
  }
  if (includeDefinitions && !compactToolCost) Object.assign(summary, {
    tokenUsageWholeSession: index.summary.tokenUsageWholeSession, contextBreakdownAtCut: index.summary.contextBreakdownAtCut,
    contextPressureAtCut: index.summary.contextPressureAtCut });
  if (includeDefinitions) summary.toolDefinitions = { ...index.summary.toolDefinitions, definitions: undefined,
    definitionCount: definitions.length,
    scope: (definitionTool ? 'selected tool; ' : '') + 'declaration versions active at recorded settlements/calls in selected turns; metadata counters cover the whole cut' };
  let items = rows.slice(offset, offset + limit);
  if (stepView) items = items.map(step => ({ ...hydration(step),
    ...(timings ? { recordedToolTiming: timings.get(step) } : {}), usage: usageSummary(usageRowsFor(step)) }));
  if (view === 'context') items = items.map(row => contextChange(index.contextSamples, row));
  return { scope, coverage, summary, groupBy: groupBy || (view === 'overview' ? 'window' : view === 'io' ? 'call' : 'step'), sort: order,
    totalEntries: rows.length, offset, items: view === 'io' && !groupBy ? items.map(preview) : items,
    ...(view === 'overview' ? { availableViews: ['latency', 'cost', 'repeats', 'io', 'context'] } : {}),
    ...(groupBy === 'file' ? { groupingNote: 'Calls touching several files occur in several groups; character counts describe the full call result.' } : {}),
    ...(view === 'cost' ? { largestDefinitions: definitions.slice(offset, offset + limit) } : {}),
    ...(uncalled ? { uncalledDefinitionCandidates: uncalled.slice(offset, offset + limit), totalUncalledDefinitionCandidates: uncalled.length } : {}),
    nextOffset: offset + limit < Math.max(rows.length, view === 'cost' ? definitions.length : 0) ? offset + limit : null };
}
export function evidencePointers(packet) {
  const refs = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, field] of Object.entries(value)) {
      if (['seq', 'stepSeq', 'callSeq', 'resultSeq', 'startSeq', 'endSeq', 'rootSeq', 'headerSeq', 'firstHeaderSeq', 'lastHeaderSeq', 'replySeq'].includes(key) && Number.isSafeInteger(field)) refs.add(field);
      else if (field && typeof field === 'object') walk(field);
    }
  };
  walk(packet.items); walk(packet.uncalledDefinitionCandidates); walk(packet.largestDefinitions);
  return [...refs].map(seq => ({ session: packet.scope.session, seq }));
}
