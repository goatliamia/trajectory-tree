import { createHash } from 'node:crypto';
import { DATA_SCHEMA, validateDataset } from './contract.mjs';
import { REPORT_COLUMNS } from '../plugin/trajectory-tools/lib/report-data.js';
import { errorsForTurn } from '../plugin/analysis-view/lib/eval/overview/shared.mjs';
import { evalCallInterval } from '../plugin/analysis-view/lib/eval/data.mjs';
import { callDurationMs } from '../plugin/trajectory-tools/lib/tool-intervals.js';
import { failureCategories, failureCategoryIndex, failureCondition, failureLabels, summarizeFailureAttributions } from '../plugin/trajectory-tools/lib/tool-attribution.js';

export const EVALUATION_TABLES = ['summary', 'turns', 'tools', 'calls', 'errors', 'error-types', 'requests', 'models', 'window-bands'];
export const EVALUATION_VERSION = 2;
const valid = value => Number.isFinite(value) && value >= 0;
const median = values => {
  const sorted = values.filter(valid).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[middle] + sorted[Math.max(0, Math.ceil(sorted.length / 2) - 1)]) / 2 : null;
};
const sum = values => {
  const known = values.filter(valid);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
};
const ratio = (value, total) => total > 0 ? value / total : null;
const columns = {
  ...REPORT_COLUMNS,
  wallMs: ['轮次经过', 'ms', 'observed'],
  name: ['对象', 'text', 'derived'],
  turns: ['轮次数', 'count', 'observed'],
  returned: ['非报错返回', 'count', 'observed'], unknown: ['结果未知', 'count', 'observed'],
  known: ['已知结果', 'count', 'derived'], errorRate: ['报错占比', 'ratio', 'derived'],
  outcomeCoverage: ['结果覆盖率', 'ratio', 'derived'],
  confirmed: ['已归因', 'count', 'derived'], candidate: ['候选原因', 'count', 'derived'],
  unclassified: ['待定位', 'count', 'derived'], noOutput: ['无文字返回', 'count', 'observed'],
  matched: ['同参非报错返回', 'count', 'derived'], recoveryMs: ['同参返回间隔', 'ms', 'derived'],
  matchedShare: ['同参返回占比', 'ratio', 'derived'],
  longCalls: ['长调用次数', 'count', 'derived'], longDurationMs: ['长调用累计耗时', 'ms', 'derived'],
  longDurationShare: ['长调用耗时占比', 'ratio', 'derived'],
  files: ['关联文件', 'count', 'observed'], deliveries: ['交付登记', 'count', 'observed'],
  changedFiles: ['工作区变更观测', 'count', 'observed'], repeatGroups: ['重复操作组', 'count', 'derived'],
  repeatCalls: ['重复操作中的调用', 'count', 'derived'],
  code: ['错误码', 'text', 'observed'], category: ['报错类型', 'text', 'derived'],
  causeCode: ['归因代码', 'text', 'derived'],
  certainty: ['归因状态', 'text', 'derived'], cause: ['原因', 'text', 'derived'],
  seq: ['记录序号', 'identifier', 'observed'], resultSeq: ['返回序号', 'identifier', 'observed'],
  nativeLine: ['原生行号', 'identifier', 'observed'],
  model: ['模型', 'text', 'observed'], requests: ['请求样本', 'count', 'observed'],
  inputTokens: ['请求输入', 'tokens', 'reported'], windowTokens: ['窗口容量', 'tokens', 'observed'],
  occupancy: ['请求窗口占用', 'ratio', 'derived'],
  inputP50: ['输入 P50', 'tokens', 'derived'], outputP50: ['输出 P50', 'tokens', 'derived'],
  outputRecords: ['输出样本', 'count', 'observed'],
  modelMs: ['模型处理', 'ms', 'observed'], modelSamples: ['模型计时样本', 'count', 'observed'],
  ttftMs: ['首字等待', 'ms', 'observed'], decodeMs: ['生成耗时', 'ms', 'observed'],
};
const outcomeFields = ['calls', 'returned', 'errors', 'unknown', 'known', 'errorRate', 'outcomeCoverage'];
const timingFields = ['durationSumMs', 'durationP50Ms', 'durationP95Ms', 'timingPairedCalls', 'timingMissingCalls', 'timingCoverage', 'longCalls', 'longDurationMs', 'longDurationShare'];
const attributionFields = ['confirmed', 'candidate', 'unclassified', 'noOutput'];

export function validateEvaluationRequest(request) {
  if (!request || !EVALUATION_TABLES.includes(request.table)) throw Error('Choose a supported Eval report table');
  if (Object.keys(request).some(key => !['from', 'source', 'table', 'turns'].includes(key))) throw Error('Unknown Eval report option');
  const range = request.turns;
  if (range && (Object.keys(range).some(key => !['from', 'to'].includes(key)) || !Number.isSafeInteger(range.from)
      || !Number.isSafeInteger(range.to) || range.from < 1 || range.to < range.from)) throw Error('Eval turns requires an inclusive {from,to} range');
}

export function evaluationSession(session, turns) {
  const selected = turns ? session.turns.filter(turn => turn.number >= turns.from && turn.number <= turns.to) : session.turns;
  const numbers = new Set(selected.map(turn => turn.number));
  return { ...session, turns: selected, overview: { ...session.overview,
    episodes: (session.overview?.episodes ?? []).filter(episode => numbers.has(episode.turn)) } };
}

// All scope and tool statistics come from the same buildEvalData result used by
// the dashboard. Overview requests retain the host's recorded pairing rules.
export function evaluationReportTables(session, dashboard, overview, models, source, turns, readCut = source.cut) {
  const query = { adapter: 'eval', ...(turns ? { turns } : {}) };
  const identity = { ...source, query };
  const evidence = seqs => [...new Set(seqs.filter(Number.isSafeInteger))].slice(0, 24).map(seq => ({
    session: source.session, log: source.log, seq,
    read: { tool: 'trajectory_read', args: { session: source.session, snapshot: source.snapshot, seq,
      ...(source.host === 'dsh' ? { format: 'linked' } : { linked: true, logId: source.log, ...(Number.isSafeInteger(readCut) ? { cut: readCut } : {}) }) } },
  }));
  const locations = session.turns.flatMap(turn => turn.steps.flatMap(step => step.calls.map(call => ({ call, turn, step }))));
  const refs = locations => evidence(locations.flatMap(({ call }) => [call.seq, call.resultSeq]));
  const timing = value => ({ durationSumMs: value.cumulativeMs, durationP50Ms: value.p50Ms,
    durationP95Ms: value.p95Ms, timingPairedCalls: value.pairedCalls, timingMissingCalls: value.missingCalls,
    timingCoverage: value.coverage, longCalls: value.counts?.at(-1) ?? null, longDurationMs: value.longMs ?? null,
    longDurationShare: ratio(value.longMs, value.cumulativeMs) });
  const scope = metrics => ({ ...Object.fromEntries(outcomeFields.map(key => [key, metrics.outcomes[key]])),
    ...timing(metrics.timing.calls), ...metrics.attributionCoverage, outputTokens: metrics.usage.output,
    outputRecords: metrics.usage.outputRecords, wallMs: metrics.timing.turns.ms,
    modelMs: metrics.timing.model?.total?.value ?? null, modelSamples: metrics.timing.model?.total?.samples ?? 0,
    ttftMs: metrics.timing.model?.firstToken?.value ?? null, decodeMs: metrics.timing.model?.decode?.value ?? null,
    matched: metrics.tools.reduce((total, tool) => total + tool.errorConditions.reduce((sum, row) => sum + row.matched, 0), 0),
    files: metrics.files.count, deliveries: metrics.task.deliveries, changedFiles: metrics.task.changes,
    repeatGroups: metrics.checks.repeatGroups, repeatCalls: metrics.checks.repeatCalls });
  const scopeFields = [...outcomeFields, ...timingFields, ...attributionFields, 'outputTokens', 'outputRecords', 'wallMs', 'modelMs', 'modelSamples', 'ttftMs', 'decodeMs',
    'matched', 'files', 'deliveries', 'changedFiles', 'repeatGroups', 'repeatCalls'];
  const allRefs = evidence(session.turns.flatMap(turn => [turn.seq, turn.endSeq]));
  const summaries = [{ id: 'scope', name: '所选范围', turns: session.turns.length, ...scope(dashboard.whole), evidence: allRefs }];
  const callRows = locations.map(({ call, turn, step }) => {
    const interval = evalCallInterval(call, source.host), durationMs = callDurationMs(interval);
    return { id: 'call:' + call.seq, turn: turn.number, step: step.number, name: call.nativeName || call.name,
      seq: call.seq, resultSeq: call.resultSeq, status: call.status,
      durationMs, start: durationMs == null ? null : interval.start, end: durationMs == null ? null : interval.end,
      nativeDurationMs: call.durationMs, evidence: evidence([interval.startSeq, call.seq, call.resultSeq]) };
  });
  const byTurn = new Map(session.turns.map(turn => [turn.number, turn]));
  const rounds = dashboard.turns.map(({ number, metrics }) => ({ id: 'turn:' + number, name: '第 ' + number + ' 轮',
    turn: number, ...scope(metrics), evidence: evidence([byTurn.get(number)?.seq, byTurn.get(number)?.endSeq]) }));
  const tools = dashboard.whole.tools.map(tool => {
    const own = locations.filter(({ call }) => (call.nativeName || call.name) === tool.name);
    const matched = tool.errorConditions.reduce((total, row) => total + row.matched, 0);
    return { id: 'tool:' + tool.name, name: tool.name, ...Object.fromEntries(outcomeFields.map(key => [key, tool[key]])), matched,
      matchedShare: ratio(matched, tool.errors),
      ...timing(tool.timing), ...summarizeFailureAttributions(own.filter(({ call }) => call.status === 'error').map(({ call }) => call.attribution)),
      evidence: refs(own) };
  });
  const errors = [];
  for (const turn of session.turns) {
    const calls = turn.steps.flatMap(step => step.calls);
    const outcomes = errorsForTurn(session.overview.episodes.filter(row => row.turn === turn.number), calls, { portable: source.host !== 'dsh' });
    const indexed = new Map(outcomes.map(error => [error.failed, error]));
    for (const call of calls.filter(call => call.status === 'error')) {
      const result = indexed.get(call.resultSeq ?? call.seq);
      const code = failureCondition(call.attribution, call.error?.code);
      errors.push({ id: 'error:' + call.seq, turn: turn.number, name: call.nativeName || call.name,
        seq: call.seq, resultSeq: call.resultSeq, code, causeCode: call.attribution?.code ?? code, category: failureCategories[failureCategoryIndex(code)][0],
        cause: call.attribution?.label ?? failureLabels[code]?.[0] ?? code,
        certainty: call.attribution?.certainty ?? 'unknown', matched: Number(result?.returned != null),
        recoveryMs: result?.recovery ?? null, evidence: evidence([call.seq, call.resultSeq, result?.returned]) });
    }
  }
  const errorTypes = new Map();
  for (const error of errors) {
    const key = error.causeCode + '/' + error.certainty;
    if (!errorTypes.has(key)) errorTypes.set(key, { id: 'cause:' + key, name: error.cause, code: error.causeCode,
      category: error.category, certainty: error.certainty, errors: 0, matched: 0, evidence: [] });
    const group = errorTypes.get(key);
    group.errors++;
    group.matched += error.matched;
    if (group.evidence.length < 24) group.evidence.push(...error.evidence.slice(0, 24 - group.evidence.length));
  }
  const actions = new Map();
  for (const action of overview?.occupancy?.actions ?? []) {
    if (!byTurn.has(action[2]) || !Number.isSafeInteger(action[1])) continue;
    const key = action[2] + ':' + action[1];
    if (!actions.has(key)) actions.set(key, []);
    actions.get(key).push(action);
  }
  const requests = (overview?.turns ?? []).filter(turn => byTurn.has(turn.no)).flatMap(turn => turn.requests.map((request, index) => {
    const model = models[request.model];
    const name = model?.provider ? model.provider + '/' + model.name : model?.name ?? '未记录路由';
    const own = actions.get(turn.no + ':' + request.seq);
    const paired = own != null || request.type === 'direct';
    const known = paired ? (own ?? []).filter(call => call[5] !== 2).length : null;
    const failed = paired ? (own ?? []).filter(call => call[5] === 1).length : null;
    const capacity = request.window?.[0];
    return { id: 'request:' + turn.no + ':' + (request.seq ?? index), turn: turn.no, step: request.step,
      seq: request.seq, nativeLine: source.host === 'dsh' ? null : request.window?.[1] ?? request.line,
      model: name, name,
      inputTokens: request.input, outputTokens: request.output, windowTokens: valid(capacity) && capacity > 0 ? capacity : null,
      occupancy: valid(request.input) && capacity > 0 ? request.input / capacity : null,
      ttftMs: request.ttft, modelMs: request.responseMs, calls: paired ? own?.length ?? 0 : null,
      known, errors: failed, errorRate: ratio(failed, known), evidence: evidence([request.seq,
        source.host === 'dsh' ? request.window?.[1] : null, ...(own ?? []).flatMap(call => [call[0], call[8]])]) };
  }));
  const aggregateRequests = (rows, id, name) => {
    const known = sum(rows.map(row => row.known)), errors = sum(rows.map(row => row.errors));
    return { id, name, requests: rows.length, inputTokens: sum(rows.map(row => row.inputTokens)),
      outputTokens: sum(rows.map(row => row.outputTokens)), inputP50: median(rows.map(row => row.inputTokens)),
      outputP50: median(rows.map(row => row.outputTokens)), calls: sum(rows.map(row => row.calls)), known, errors,
      errorRate: ratio(errors, known), evidence: evidence(rows.flatMap(row => row.evidence.map(ref => ref.seq))) };
  };
  const routes = new Map();
  for (const request of requests) {
    if (!routes.has(request.model)) routes.set(request.model, []);
    routes.get(request.model).push(request);
  }
  const modelRows = [...routes].map(([name, rows]) => aggregateRequests(rows, 'model:' + name, name));
  const limits = [0, .25, .5, .75, .9, 1, Infinity];
  const bands = limits.slice(0, -1).map((from, index) => {
    const to = limits[index + 1];
    const rows = requests.filter(row => valid(row.occupancy) && row.occupancy >= from && row.occupancy < to);
    const name = Number.isFinite(to) ? from * 100 + '–' + to * 100 + '%' : '≥100%';
    return aggregateRequests(rows, 'window:' + index, name);
  });
  const coverage = { evalVersion: EVALUATION_VERSION, basis: 'Same frozen session and buildEvalData metrics as Eval. Unknown measurements remain null.',
    turns: session.turns.length, attribution: dashboard.whole.attributionCoverage,
    timing: dashboard.whole.timing.calls, requests: requests.length,
    windowRequests: requests.filter(row => valid(row.occupancy)).length,
    longCallThresholdMs: 30_000,
    matched: 'A later same-argument non-error return in the same turn; not a task completion judgment.',
    requestToolPairing: 'Tool outcomes are attached only where the overview links calls to that recorded request.',
    window: 'Recorded request input divided by the capacity recorded for that request. Each request is counted once.' };
  const table = (name, rows, fields) => validateDataset({ schema: DATA_SCHEMA,
    id: createHash('sha256').update(JSON.stringify([EVALUATION_VERSION, identity, name])).digest('hex').slice(0, 24),
    kind: 'eval-' + name, source: identity, coverage,
    columns: Object.fromEntries(fields.map(key => { const [label, unit, basis] = columns[key]; return [key, { label, unit, basis, nullable: true, aggregate: 'none' }]; })),
    rows: rows.map(row => ({ id: row.id, evidence: row.evidence, ...Object.fromEntries(fields.map(key => [key, row[key] ?? null])) })) });
  const requestFields = ['requests', 'inputTokens', 'outputTokens', 'inputP50', 'outputP50', 'calls', 'known', 'errors', 'errorRate'];
  return {
    summary: table('summary', summaries, ['name', 'turns', ...scopeFields]),
    turns: table('turns', rounds, ['name', 'turn', ...scopeFields]),
    calls: table('calls', callRows, ['turn', 'step', 'name', 'seq', 'resultSeq', 'status', 'start', 'end', 'durationMs', 'nativeDurationMs']),
    tools: table('tools', tools, ['name', ...outcomeFields, ...timingFields, ...attributionFields, 'matched', 'matchedShare']),
    errors: table('errors', errors, ['turn', 'name', 'seq', 'resultSeq', 'code', 'causeCode', 'category', 'cause', 'certainty', 'matched', 'recoveryMs']),
    'error-types': table('error-types', [...errorTypes.values()], ['name', 'code', 'category', 'certainty', 'errors', 'matched']),
    requests: table('requests', requests, ['turn', 'step', 'seq', 'nativeLine', 'model', 'inputTokens', 'outputTokens', 'windowTokens', 'occupancy', 'ttftMs', 'modelMs', 'calls', 'known', 'errors', 'errorRate']),
    models: table('models', modelRows, ['name', ...requestFields]),
    'window-bands': table('window-bands', bands, ['name', ...requestFields]),
  };
}
