import { summarizeToolOutcomes } from '../trace/shared/io-outcome.mjs';
import { callDurationMs, callTimingSummary } from '../trace/shared/tool-intervals.mjs';
import { scopeByTurn } from '../trace/shared/scope-index.mjs';
import { failureCategories, failureCategoryIndex, failureCondition, failureLabels, powerShellEdition, summarizeFailureAttributions } from '../trace/shared/tool-attribution.mjs';

const longCallMs = 30_000;
const bins = [
  [20, '<20', 'ms'], [50, '20–50', 'ms'], [200, '50–200', 'ms'], [1000, '0.2–1', 's'],
  [5000, '1–5', 's'], [longCallMs, '5–30', 's'], [Infinity, '≥30', 's'],
];
const hostNames = { dsh: 'DSH', codex: 'Codex', pi: 'Pi', claude: 'Claude Code' };
export const EVAL_DETAIL_TURNS = 120;

function interval(call, host) {
  const startSeq = host === 'dsh' ? (call.inner ? call.startSeq : call.seq)
    : call.startSeq === null || ['ordinal-only', 'unrecorded-start'].includes(call.timingSource) ? null : call.startSeq ?? call.seq;
  return { startSeq, resultSeq: call.resultSeq, start: call.start, end: call.end };
}

function measure(calls, host) {
  const intervals = calls.map(({ call }) => interval(call, host));
  const counts = bins.map(() => 0);
  let longMs = 0;
  const rows = [];
  let reportedMs = 0, reportedCalls = 0;
  for (const [index, row] of intervals.entries()) {
    const { call, turn } = calls[index];
    const ms = callDurationMs(row);
    if (ms === null) {
      if (host !== 'dsh' && Number.isFinite(call.durationMs) && call.durationMs >= 0) {
        reportedCalls++;
        reportedMs += call.durationMs;
      }
      continue;
    }
    counts[bins.findIndex(([limit]) => ms < limit)]++;
    if (ms >= longCallMs) longMs += ms;
    rows.push({ turn, call: row.startSeq, result: row.resultSeq, ms });
  }
  rows.sort((a, b) => b.ms - a.ms || b.call - a.call);
  return { timing: { ...callTimingSummary(intervals), counts, longMs, reportedCalls, reportedMs },
    slowest: rows.slice(0, 3) };
}

function toolErrorDetails(episodes, calls, attributions) {
  const byTool = new Map(), related = new Map();
  for (const episode of episodes) {
    const returnedByFailure = new Map(episode.pairs.map(pair => [pair.failedSeq, pair.successSeq]));
    for (const failed of episode.failureSeqs) {
      related.set(failed, { condition: episode.condition, returned: returnedByFailure.get(failed),
        read: episode.failedCount === 1 ? episode.readSeqs[0] : undefined });
    }
  }
  for (const { call, turn, name } of calls) {
    if (call.status !== 'error') continue;
    const pair = related.get(call.seq);
    const parserDetail = attributions?.get(call.seq);
    const attribution = parserDetail ?? call.attribution;
    const code = failureCondition(call.attribution, pair?.condition ?? call.error?.code);
    if (!byTool.has(name)) byTool.set(name, new Map());
    const conditions = byTool.get(name);
    if (!conditions.has(code)) conditions.set(code, { code, category: failureCategoryIndex(code), calls: 0, matched: 0, paired: null, unpaired: null });
    const row = conditions.get(code), returned = pair?.returned ?? null;
    const namedPowerShell = !/[\\/]/.test(name) && powerShellEdition(name) !== null;
    const powerShell = namedPowerShell || call.powerShellEdition || attribution?.program === 'PowerShell' || parserDetail?.site != null;
    const sample = { turn, failed: call.seq, returned, read: pair?.read, result: call.resultSeq, attribution,
      ...(powerShell ? { powerShell: true } : {}) };
    const key = returned == null ? 'unpaired' : 'paired';
    row.calls++;
    row.matched += Number(returned != null);
    if (!row[key] || row[key].failed < call.seq) row[key] = sample;
  }
  return byTool;
}

function execution(turns, episodes, host, attributions) {
  const groups = new Map(), calls = [];
  for (const turn of turns) for (const step of turn.steps) for (const call of step.calls) {
    const name = (host === 'dsh' ? call.name : call.nativeName || call.name) ?? '';
    if (!groups.has(name)) groups.set(name, []);
    const row = { call, turn: turn.number, name };
    groups.get(name).push(row);
    calls.push(row);
  }
  const details = toolErrorDetails(episodes, calls, attributions);
  const tools = [...groups].map(([name, rows]) => ({
    name, ...summarizeToolOutcomes(rows.map(({ call }) => call)), ...measure(rows, host),
    errorConditions: [...(details.get(name)?.values() ?? [])]
      .sort((a, b) => b.calls - a.calls || a.code.localeCompare(b.code))
      .map(({ paired, unpaired, ...condition }) => ({ ...condition, examples: [paired, unpaired].filter(Boolean) })),
  }));
  const allCalls = calls.map(({ call }) => call);
  const attributionCoverage = summarizeFailureAttributions(allCalls.filter(call => call.status === 'error').map(call => call.attribution));
  return { outcomes: summarizeToolOutcomes(allCalls), attributionCoverage, tools, callTiming: measure(calls, host).timing };
}

// Presentation adapter. All evidence is already projected from one source cut.
export function buildEvalData(session, runtime, { host = 'dsh', title = session.title, turnLimit, synthetic = false, attributions } = {}) {
  const episodesIn = scopeByTurn(session.overview?.episodes ?? []);
  const scope = (turns, number) => {
    const { timing, usage, files, task, context, repeats, parameters } = runtime(turns, number);
    const { outcomes, attributionCoverage, tools, callTiming } = execution(turns, episodesIn(number), host, attributions);
    const official = timing.official;
    return {
      outcomes, attributionCoverage, tools,
      usage: { output: usage.output, outputRecords: usage.coverage.output, requests: usage.requests },
      timing: { turns: timing.turns, steps: timing.steps, toolSteps: timing.toolSteps, calls: callTiming,
        model: timing.recordedModel ?? (official ? { steps: official.steps, total: official.fields.model,
          firstToken: official.fields.ttft, decode: official.fields.decode } : null) },
      files: { count: files.files, paired: files.pairedWriteFiles, before: files.readBeforeFirstWrite, after: files.readAfterLastWrite },
      task: { deliveries: task.deliveries, files: task.deliveredFiles, changes: task.workspaceObservations,
        evidence: task.evidence.filter(row => ['deliverables/presented', 'workspace/changes'].includes(row.type))
          .map(({ type, seq }) => ({ type, seq })) },
      context: { skillLoads: context.skillLoads, children: context.childSessions },
      checks: { repeatGroups: repeats.groups, repeatCalls: repeats.calls,
        directCalls: parameters?.scope.directCalls ?? null, schema: parameters?.schema ?? null, json: parameters?.json ?? null },
    };
  };
  const turns = turnLimit ? session.turns.slice(-turnLimit) : session.turns;
  return { title, host, sourceLabel: hostNames[host] + (synthetic ? ' 模拟记录' : ' 实录'),
    cut: session.lastSeq, longCallMs, totalTurns: session.turns.length,
    failureLabels, failureCategories: failureCategories.map(([zh, en]) => [zh, en]),
    durationBins: bins.map(([, label, unit]) => ({ label, unit })),
    whole: scope(session.turns, null), turns: turns.map(turn => ({ number: turn.number, metrics: scope([turn], turn.number) })) };
}

export function diagnosisSource(session, dashboard, { host = 'dsh', logId, file } = {}) {
  const rounds = dashboard ? dashboard.turns.map(({ number, metrics }) => ({ number, ms: metrics.timing.turns.ms,
    output: metrics.usage.output, outputRecords: metrics.usage.outputRecords, requests: metrics.usage.requests,
    calls: metrics.outcomes.calls, errors: metrics.outcomes.errors })) : [];
  return { host, logId, file, session: session.id, cut: session.lastSeq, rounds, maxCallSelection: 500,
    episodes: session.overview?.episodes ?? [] };
}
