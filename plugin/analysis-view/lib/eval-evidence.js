import { traceContext, applyGoalEvents } from './trace-context.js';
import { readGoalChanges } from './goal-events.js';
import { CONTEXT_CATEGORIES } from './trace/models/context-model.mjs';
import { fileId } from './trace/models/tool-operation-model.mjs';
import { recordedStepTimings } from './trace/shared/tool-intervals.mjs';
import { costRequests, costTotals, costCoverage } from './trace/shared/usage.mjs';
import { scopeByTurn } from './trace/shared/scope-index.mjs';

const known = value => Number.isFinite(value) && value >= 0;
const replacement = event => event.surfaceOp && typeof event.surfaceOp === 'object';
const sourceOf = event => (event.data?.source ?? event.data?.message?.source)?.kind;
const sumKnown = values => values.length ? values.reduce((total, value) => total + value, 0) : null;
const count = (rows, predicate) => rows.reduce((total, row) => total + Number(predicate(row)), 0);
const dispatch = event => event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch';
const goalEvents = events => events.filter(event => event.type === 'goal/change').map(event => {
  const goal = event.data?.goal ?? event.data?.cleared;
  return { seq: event.seq, time: event.time, goalId: goal?.id ?? null, operation: event.data?.operation,
    objective: goal?.objective, phase: goal?.phase, revision: goal?.revision };
});

export function eventTurnIndex(events) {
  let active = null;
  const turns = new Map();
  for (const event of events) {
    const explicit = Number.isSafeInteger(event.data?.turn) ? event.data.turn : null;
    if (event.type === 'turn/start') active = explicit;
    turns.set(event.seq, explicit ?? active);
    if (event.type === 'turn/end' && (explicit === null || explicit === active)) active = null;
  }
  return turns;
}

function spanSummary(rows) {
  const measured = rows.filter(row => row.endSeq != null && known(row.start) && known(row.end) && row.end >= row.start);
  return { total: rows.length, measured: measured.length, ms: sumKnown(measured.map(row => row.end - row.start)) };
}

function timingMetrics(turns, official, officialTurns) {
  const steps = [], calls = [];
  for (const turn of turns) for (const step of turn.steps) {
    const location = { turn: turn.number, step: step.number };
    steps.push({ ...location, evidence: step });
    for (const call of step.calls) calls.push({ ...location, startSeq: call.inner ? call.startSeq : call.seq,
      resultSeq: call.resultSeq, start: call.start, end: call.end });
  }
  const recorded = [...recordedStepTimings(steps, calls).values()].filter(Boolean);
  const paired = recorded.filter(row => row.coveredMs != null);
  const summary = { turns: spanSummary(turns), steps: spanSummary(steps.map(step => step.evidence)),
    toolSteps: { measured: paired.length, total: steps.length, calls: recorded.reduce((total, step) => total + step.calls, 0),
      pairedCalls: recorded.reduce((total, step) => total + step.pairedCalls, 0),
      cumulativeMs: sumKnown(paired.map(step => step.cumulativeMs)), coveredMs: sumKnown(paired.map(step => step.coveredMs)) },
    official: null };
  if (official) {
    const native = officialTurns.flatMap(turn => turn.steps);
    const fields = Object.fromEntries(['wall', 'ttft', 'model', 'decode', 'tool', 'toolWall', 'retries', 'toolErrors'].map(key => {
      const samples = native.map(step => step[key]).filter(known);
      return [key, { value: sumKnown(samples), samples: samples.length }];
    }));
    summary.official = { source: official.source, steps: native.length, fields };
  }
  return summary;
}

export function repeatGroups(turns, bySeq) {
  const groups = [];
  for (const turn of turns) {
    const bySignature = new Map();
    for (const step of turn.steps) for (const call of step.calls) {
      if (!call.signature || bySeq.get(call.seq)?.data?.arguments == null) continue;
      if (!bySignature.has(call.signature)) bySignature.set(call.signature, []);
      bySignature.get(call.signature).push(call);
    }
    for (const calls of bySignature.values()) if (calls.length >= 2) groups.push({ turn, calls });
  }
  return groups;
}

function fileMetrics(rows, pointer, callStart) {
  const seen = new Set(), files = new Map(), calls = new Set(), returnedWrites = new Set();
  const access = { read: 0, match: 0, write: 0 };
  for (const row of rows) {
    const path = fileId(row.path), key = JSON.stringify([row.seq, path, row.access]);
    if (seen.has(key)) continue;
    seen.add(key);
    calls.add(row.seq);
    access[row.access]++;
    if (row.access === 'write' && row.status === 'returned') returnedWrites.add(row.seq);
    if (!files.has(path)) files.set(path, { path: row.path, calls: new Set(), last: row, reads: [], writes: [] });
    const file = files.get(path);
    file.calls.add(row.seq);
    if (row.seq > file.last.seq) file.last = row;
    if (row.status !== 'returned' || row.resultSeq == null || row.access === 'match') continue;
    const start = callStart.get(row.seq);
    if (start == null || start > row.resultSeq) continue;
    file[row.access === 'read' ? 'reads' : 'writes'].push({ start, end: row.resultSeq });
  }
  let pairedWriteFiles = 0, readBeforeFirstWrite = 0, readAfterLastWrite = 0;
  for (const file of files.values()) {
    if (!file.writes.length) continue;
    pairedWriteFiles++;
    const first = file.writes.reduce((min, row) => Math.min(min, row.start), Infinity);
    const last = file.writes.reduce((max, row) => Math.max(max, row.end), -Infinity);
    if (file.reads.some(row => row.end < first)) readBeforeFirstWrite++;
    if (file.reads.some(row => row.start > last)) readAfterLastWrite++;
  }
  return { files: files.size, calls: calls.size, access, returnedWriteCalls: returnedWrites.size,
    pairedWriteFiles, readBeforeFirstWrite, readAfterLastWrite,
    rows: [...files.values()].sort((a, b) => b.calls.size - a.calls.size || b.last.seq - a.last.seq).slice(0, 8)
      .map(file => ({ path: file.path, calls: file.calls.size, ...pointer(file.last.seq) })) };
}

function taskMetrics(events, turns, goals, pointer) {
  const prompts = events.filter(event => event.type === 'user/message' && sourceOf(event) === 'user');
  const deliveries = events.filter(event => event.type === 'deliverables/presented');
  const workspace = events.filter(event => event.type === 'workspace/changes');
  const goalPhases = new Map();
  for (const goal of goals) {
    if (goal.goalId == null) continue;
    if (goal.operation === 'clear') goalPhases.delete(goal.goalId);
    else if (goal.phase) goalPhases.set(goal.goalId, goal.phase);
  }
  const phaseCounts = new Map();
  for (const phase of goalPhases.values()) phaseCounts.set(phase, (phaseCounts.get(phase) || 0) + 1);
  const reasons = new Map();
  for (const turn of turns) {
    const reason = turn.endSeq != null ? turn.reason?.kind ?? 'unknown' : 'open';
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  return { prompts: prompts.length, turns: turns.length, turnReasons: Object.fromEntries(reasons),
    goalChanges: count(goals, goal => goal.source === 'event'),
    goalToolRecords: count(goals, goal => goal.source !== 'event'),
    goalPhases: Object.fromEntries(phaseCounts), todoUpdates: count(events, event => event.type === 'todo/write'),
    workspaceObservations: workspace.length, deliveries: deliveries.length,
    deliveredFiles: deliveries.reduce((total, event) => total + (Array.isArray(event.data?.files) ? event.data.files.length : 0), 0),
    evidence: [...prompts.slice(-3), ...deliveries.slice(-3), ...workspace.slice(-3), ...goals.slice(-3)]
      .sort((a, b) => a.seq - b.seq).map(row => ({ ...pointer(row.seq), type: row.type ?? 'goal' })) };
}

function contextMetrics(events, skills, retainedSkills, { requests, source, pressure }, pointer) {
  const countType = type => count(events, event => event.type === type);
  const receipts = events.filter(event => event.type === 'session-log-deepseek/delivery-accepted');
  const compactions = events.filter(event => event.type === 'compaction/summary');
  const compactionTokens = compactions.map(event => event.data?.usage?.totalTokens).filter(known);
  const branches = new Set(events.filter(event => event.type === 'subagent/catalog').map(event => event.data?.childId).filter(Boolean));
  const loads = skills.filter(skill => skill.kind === 'skill-tool-load');
  const keys = CONTEXT_CATEGORIES.map(category => category.key);
  const measured = requests?.filter(request => keys.every(key => known(request[key]))) ?? [];
  const totals = measured.map(request => keys.reduce((total, key) => total + request[key], 0));
  return {
    headers: countType('request/header'), contextUpdates: countType('request/context'), receipts: receipts.length,
    deliveredThroughSeq: receipts.findLast(event => Number.isSafeInteger(event.data?.throughSeq))?.data.throughSeq ?? null,
    compactionsStarted: countType('compaction/start'), compactionsEnded: countType('compaction/end'),
    compactionUsage: { summaries: compactions.length, measured: compactionTokens.length, total: sumKnown(compactionTokens) },
    toolResultPrunes: countType('compaction/prune'),
    skillCatalogs: count(skills, skill => skill.kind === 'catalog'),
    skillReferences: count(skills, skill => skill.kind === 'explicit-skill-reference'), skillLoads: loads.length,
    retainedSkillLoads: retainedSkills ? count(loads, load => retainedSkills.has(load.resultSeq)) : null,
    childSessions: branches.size, handoffMessages: count(events, event => event.type === 'user/message' &&
      ['agent-message', 'team-message', 'subagent-settled'].includes(sourceOf(event))),
    settledMessages: count(events, event => event.type === 'user/message' && sourceOf(event) === 'subagent-settled'),
    requestComposition: requests === null ? null : { source, requests: requests.length,
      measured: measured.length, peakTokens: totals.reduce((peak, value) => Math.max(peak ?? 0, value), null),
      netTokens: totals.length >= 2 ? totals.at(-1) - totals[0] : null },
    pressure: pressure ? { reportedTokens: known(pressure.pressureTokens) ? pressure.pressureTokens : null,
      projectedTokens: known(pressure.projectedTokens) ? pressure.projectedTokens : null,
      contextWindow: known(pressure.contextWindow) ? pressure.contextWindow : null } : null,
    evidence: events.filter(event => ['compaction/end', 'compaction/prune', 'subagent/catalog',
      'session-log-deepseek/delivery-accepted'].includes(event.type)).slice(-6)
      .map(event => ({ ...pointer(event.seq), type: event.type })),
  };
}

export function createRuntimeMetrics(session, { events, official, checks, projections, retainedSkills, goals = [] }) {
  const eventTurns = eventTurnIndex(events);
  const turnStarts = new Map(session.turns.map(turn => [turn.number, turn.seq]));
  const calls = new Map(), callStart = new Map();
  for (const turn of session.turns) for (const step of turn.steps) for (const call of step.calls) {
    eventTurns.set(call.seq, turn.number);
    if (call.resultSeq != null) eventTurns.set(call.resultSeq, turn.number);
    if (!call.inner) calls.set(call.seq, call.id);
    callStart.set(call.seq, call.inner ? call.startSeq : call.seq);
  }
  const observed = events.filter(event => !replacement(event));
  const bySeq = new Map(observed.map(event => [event.seq, event]));
  const payload = { sessions: [session], context: traceContext(events, { sessions: [session] }) };
  applyGoalEvents(payload, [...new Map([...goalEvents(events), ...goals].map(goal => [goal.seq, goal])).values()]);
  for (const marker of payload.context.goal?.markers ?? []) eventTurns.set(marker.seq, marker.turn);
  const eventsIn = scopeByTurn(observed, event => eventTurns.get(event.seq));
  const usageIn = scopeByTurn(costRequests(events));
  const filesIn = scopeByTurn(payload.context.fileOperations);
  const skillsIn = scopeByTurn(payload.context.skillEvents, row => eventTurns.get(row.seq) ?? row.turn);
  const goalsIn = scopeByTurn(payload.context.goal?.markers ?? []);
  const checksIn = checks ? scopeByTurn(checks.calls, call => eventTurns.get(call.seq)) : null;
  const officialIn = official ? scopeByTurn(official.snapshot.turns) : null;
  const timeline = projections?.values?.contextTimeline;
  const requestsIn = !timeline?.unsupported && Array.isArray(timeline?.requests) ? scopeByTurn(timeline.requests) : null;
  const pointer = seq => {
    const turn = eventTurns.get(seq) ?? null;
    return { seq, turn, startSeq: turnStarts.get(turn) ?? null, callId: calls.get(seq) ?? null };
  };
  return (turns, turnNumber) => {
    const ownEvents = eventsIn(turnNumber);
    const ownUsage = usageIn(turnNumber);
    const repeats = repeatGroups(turns, bySeq);
    let parameters = null;
    if (checks) {
      const { calls: checked, ...summary } = checks.summarize(
        checksIn(turnNumber), count(ownEvents, dispatch));
      parameters = { ...summary, evidence: checked.filter(call => call.json === 'invalid' || call.schema === 'nonconforming')
        .slice(-8).map(call => ({ ...pointer(call.seq), tool: call.name })) };
    }
    return {
      timing: timingMetrics(turns, official, officialIn?.(turnNumber)),
      usage: { ...costTotals(ownUsage), coverage: costCoverage(ownUsage) },
      files: fileMetrics(filesIn(turnNumber), pointer, callStart),
      task: taskMetrics(ownEvents, turns, goalsIn(turnNumber), pointer),
      context: contextMetrics(ownEvents, skillsIn(turnNumber), retainedSkills, {
        requests: requestsIn?.(turnNumber) ?? null,
        source: projections?.source,
        pressure: turnNumber == null ? projections?.values?.contextPressure : null,
      }, pointer),
      repeats: { groups: repeats.length, calls: repeats.reduce((total, group) => total + group.calls.length, 0),
        rows: repeats.slice(-8).map(({ calls: group }) => ({ tool: group[0].name, calls: group.length, ...pointer(group.at(-1).seq) })) },
      parameters,
    };
  };
}

async function readProjections(ctx, entry, events, cut, signal) {
  const registry = ctx.get('sessionProjections');
  if (!registry) return null;
  const live = ctx.get('sessions')?.get?.(entry.sessionId);
  if (live && typeof registry.snapshot === 'function') {
    try {
      const snapshot = registry.snapshot(live, ['contextTimeline', 'contextPressure']);
      if (snapshot?.asOfSeq === cut) return { source: 'sessionProjections.snapshot', values: snapshot.values };
    } catch { signal.throwIfAborted(); }
  }
  if (!entry.header || !registry.restore || !events.every((event, index) => event.seq === index)) return null;
  let checkpoint = {}, snapshot;
  const deadline = performance.now() + 2000;
  for (let i = 0; i < events.length; i += 1000) {
    signal.throwIfAborted();
    if (performance.now() > deadline) return null;
    const restored = registry.restore(checkpoint, events.slice(i, i + 1000), i, entry.header, entry.inherited);
    checkpoint = restored.checkpoint;
    snapshot = restored.snapshot;
    await new Promise(resolve => setImmediate(resolve));
  }
  return snapshot?.asOfSeq === cut ? { source: 'sessionProjections.restore', values: snapshot.values } : null;
}

async function readRetainedSkills(entry, events) {
  const loads = entry.payload.sessions[0].turns.some(turn => turn.steps.some(step =>
    step.calls.some(call => call.name === 'skill' && call.status === 'returned')));
  if (!loads) return new Set();
  if (!events.every((event, index) => event.seq === index)) return null;
  const { SurfaceManager } = await import('@deepseek-ai/dsh-session/surface');
  return new Set(new SurfaceManager(events, 0).nodes);
}

async function readSupplementalGoals(ctx, entry, cut, signal) {
  if (!entry.source || !Number.isSafeInteger(cut)) return [];
  // A live observation can read its persisted prefix; a detached observation
  // requires the same storage revision before filtering to the observed cut.
  const goals = await readGoalChanges(ctx, entry.sessionId, Number.isSafeInteger(entry.cursor) ? cut : undefined, entry.source, signal);
  return goals.filter(goal => goal.seq <= cut);
}

export async function readRuntimeEvidence(ctx, entry, events, signal) {
  const cut = entry.payload.sessions[0].lastSeq;
  const optional = async read => {
    try { return await read(); } catch (error) { signal.throwIfAborted(); return null; }
  };
  const [official, checks, projections, retainedSkills, goals] = await Promise.all([
    optional(async () => (await import('./trace/shared/official-stats.mjs')).replayOfficialStats(events)),
    optional(async () => {
      const { checkRecordedToolCalls, summarizeRecordedToolChecks } = await import('./trace/shared/tool-call-checks.mjs');
      const { calls } = checkRecordedToolCalls(events);
      return { calls, summarize: summarizeRecordedToolChecks };
    }),
    optional(() => readProjections(ctx, entry, events, cut, signal)),
    optional(() => readRetainedSkills(entry, events)),
    optional(() => readSupplementalGoals(ctx, entry, cut, signal)),
  ]);
  signal.throwIfAborted();
  return { events, official, checks, projections, retainedSkills, goals: goals ?? [] };
}
