// The evidence service owns measurements; renderers receive this compact,
// versioned table without excerpts, methods, or a second statistics formula.
import { createHash } from 'node:crypto';
import { summarizeToolOutcomes, TOOL_OUTCOME_BASIS } from './io-outcome.js';
import { groupInspectionCalls, selectInspectionCalls } from './inspection-io.js';
import { callDurationMs, recordedStepTimingBasis, recordedStepTimings } from './tool-intervals.js';

export const REPORT_DATA_VERSION = 'trajectory-data/1';
export const REPORT_COLUMNS = {
  turn: ['轮次', 'turn', 'identifier'], step: ['步骤', 'step', 'identifier'],
  time: ['记录时间', 'timestamp-ms', 'observed'], start: ['开始时间', 'timestamp-ms', 'observed'], end: ['返回时间', 'timestamp-ms', 'observed'],
  wallMs: ['活动耗时', 'ms', 'official'], ttftMs: ['首字等待', 'ms', 'official'], modelMs: ['模型耗时', 'ms', 'official'],
  toolMs: ['工具累计耗时', 'ms', 'official'], toolCoveredMs: ['工具覆盖时间', 'ms', 'official'],
  recordedStepSpanMs: ['实录步骤区间', 'ms', 'derived'],
  clippedToolMs: ['步内工具累计耗时', 'ms', 'derived'], clippedToolCoveredMs: ['步内工具覆盖时间', 'ms', 'derived'],
  pairedToolCalls: ['有起止记录的工具调用', 'count', 'derived'], crossStepToolCalls: ['超出所属步的工具调用', 'count', 'derived'],
  durationMs: ['调用耗时', 'ms', 'derived'], timingPairedCalls: ['有起止记录的调用', 'count', 'derived'],
  timingMissingCalls: ['缺少有效起止的调用', 'count', 'derived'], timingCoverage: ['耗时样本覆盖率', 'ratio', 'derived'],
  durationSumMs: ['调用累计耗时', 'ms', 'derived'], durationP50Ms: ['调用耗时 P50', 'ms', 'derived'], durationP95Ms: ['调用耗时 P95', 'ms', 'derived'],
  contextTokens: ['步骤输入记录', 'tokens', 'official'], uncachedInputTokens: ['未缓存输入', 'tokens', 'reported'],
  cacheHit: ['输入缓存比例', 'ratio', 'official'],
  cacheReadTokens: ['缓存读取', 'tokens', 'reported'], cacheWriteTokens: ['缓存写入', 'tokens', 'reported'], outputTokens: ['输出', 'tokens', 'reported'],
  retries: ['重试次数', 'count', 'official'], calls: ['调用次数', 'count', 'observed'], errors: ['错误数', 'count', 'observed'],
  operations: ['文件操作记录', 'count', 'observed'],
  returnedCharacters: ['返回文本', 'characters', 'observed'], nativeDurationMs: ['原生持续时间', 'ms', 'reported'],
  name: ['工具', 'text', 'observed'], file: ['文件', 'text', 'observed'], status: ['返回状态', 'text', 'observed'],
  text: ['原文摘录', 'text', 'verbatim'], kind: ['记录类型', 'text', 'observed'],
  omittedCharacters: ['摘录省略字符', 'characters', 'observed'],
  system: ['系统提示', 'tokens', 'estimated'], tools: ['工具定义', 'tokens', 'estimated'], user: ['用户输入', 'tokens', 'estimated'],
  inject: ['运行时注入', 'tokens', 'estimated'], skill: ['技能内容', 'tokens', 'estimated'], assistant: ['模型输出（含思考）', 'tokens', 'estimated'], tool: ['工具输出', 'tokens', 'estimated'],
  total: ['构成估算合计', 'tokens', 'estimated'],
  reportedInput: ['上报请求输入（含缓存）', 'tokens', 'reported'],
};
export function reportTable({ source, kind, rows, fields, coverage = {}, labels = {}, columnInfo = {} }) {
  if (!source?.host || !source.session || !source.snapshot || typeof source.log !== 'string' || !source.log) throw Error('Report data requires host, session, snapshot and a string log identity');
  const columns = Object.fromEntries(fields.map(key => {
    if (!REPORT_COLUMNS[key]) throw Error('Unknown report field: ' + key);
    const [label, unit, basis] = REPORT_COLUMNS[key]; return [key, { label: labels[key] || label, unit, basis, nullable: true,
      aggregate: ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'calls', 'errors', 'returnedCharacters'].includes(key) ? 'sum' : 'none', ...columnInfo[key] }];
  }));
  const id = createHash('sha256').update(JSON.stringify([source, kind, fields])).digest('hex').slice(0, 24);
  return { schema: REPORT_DATA_VERSION, id, source, kind, columns, coverage,
    rows: rows.map(row => {
      if (typeof row.id !== 'string' || !row.id) throw Error('Report rows need stable IDs');
      return { id: row.id, evidence: row.evidence || [], ...Object.fromEntries(fields.map(key => [key,
        typeof row[key] === 'number' ? Number.isFinite(row[key]) ? row[key] : null : row[key] ?? null])) };
    }) };
}
export function reportPage(table, offset = 0, limit = 250) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > table.rows.length) throw Error('Invalid data offset');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw Error('Data limit must be 1..500');
  return { ...table, rows: table.rows.slice(offset, offset + limit), totalRows: table.rows.length, offset,
    nextOffset: offset + limit < table.rows.length ? offset + limit : null };
}
export const reportRef = (index, seq) => Number.isSafeInteger(seq) ? [{ session: index.scope.session, log: index.log?.id ?? index.log, seq }] : [];

export function inspectionReportData(index, query, source) {
  const inRange = turn => !query.turns || turn >= query.turns.from && turn <= query.turns.to;
  const { scopedCalls, calls: selectedCalls, callSelection } = selectInspectionCalls(index, query);
  selectedCalls.sort((a, b) => a.seq - b.seq);
  const keys = query.focus ? new Set(selectedCalls.map(c => c.turn + ':' + c.step)) : null;
  const selected = row => inRange(row.turn) && (!keys || keys.has(row.turn + ':' + row.step));
  const coverage = { ...index.coverage, ...(query.focus ? { focusedMetrics: 'Whole owning steps; not attributed tool/file usage or waiting' } : {}) };
  if (query.groupBy === 'file') coverage.grouping = 'Calls touching multiple files occur in multiple groups; returned characters describe each complete call result';
  const table = (kind, rows, fields) => reportTable({ source, kind, rows, fields, coverage });
  if (query.view === 'context') {
    const fields = ['seq', 'turn', 'step', 'time', 'system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'total', 'reportedInput', 'headerSeq'];
    const requests = (index.contextSamples || []).map(tuple => Object.fromEntries(fields.map((key, i) => [key, tuple[i]]))).filter(selected).sort((a,b)=>a.seq-b.seq);
    coverage.context = { ...coverage.context, selectedRows: requests.length,
      status: !requests.length ? 'unavailable' : index.coverage.context.firstRecordedTurn > (query.turns?.from ?? 1) ? 'partial' : 'available',
      missingValues: 'null means unrecorded; gaps are not zero', sampleUnit: 'retained-surface estimate at a recorded response, with reported input separate' };
    return table('context', requests.map(r => ({ ...r, id: 'context:' + r.seq, evidence: [...reportRef(index, r.seq), ...reportRef(index, r.headerSeq)] })),
      fields.filter(key => key !== 'seq' && key !== 'headerSeq'));
  }
  if (query.view === 'cost') return table('usage', index.usageRows.filter(selected).sort((a,b)=>a.seq-b.seq).map(r => ({
    id: 'usage:' + r.seq, turn: r.turn, step: r.step, uncachedInputTokens: r.input,
    cacheReadTokens: r.cacheRead, cacheWriteTokens: r.cacheWrite, outputTokens: r.output, evidence: reportRef(index, r.seq),
  })), ['turn', 'step', 'uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']);
  if (query.view === 'io' || query.view === 'repeats') {
    if (query.view === 'repeats') throw Error('Use the repeats summary and linked reads to select an evidence-backed sequence; no inferred attempt graph');
    coverage.toolOutcomeBasis = TOOL_OUTCOME_BASIS;
    if (callSelection) coverage.callSelection = callSelection;
    coverage.toolOutcomes = coverage.native?.status === 'unavailable' ? null : summarizeToolOutcomes(scopedCalls);
    coverage.callTiming = 'Observed start and result timestamps; duration includes recorded errors and cancellations when paired. P50/P95 use nearest rank; overlap is counted in each call. Missing is not zero. Groups follow outcome filtering.';
    if (query.groupBy) {
      const byTool = query.groupBy === 'tool';
      const rows = groupInspectionCalls(selectedCalls, query.groupBy, 6).map(group => ({
        id: 'group:' + group[query.groupBy], name: group.tool, file: group.file,
        calls: group.calls, errors: group.errors, returnedCharacters: group.returnedCharacters,
        timingPairedCalls: group.timing.pairedCalls, timingMissingCalls: group.timing.missingCalls,
        timingCoverage: group.timing.coverage, durationSumMs: group.timing.cumulativeMs,
        durationP50Ms: group.timing.p50Ms, durationP95Ms: group.timing.p95Ms,
        evidence: group.examples.flatMap(example => [...reportRef(index, example.startSeq ?? example.seq), ...reportRef(index, example.resultSeq)]),
      }));
      return table('groups', rows, [byTool ? 'name' : 'file', 'calls', 'errors', 'returnedCharacters', 'timingPairedCalls', 'timingMissingCalls', 'timingCoverage', 'durationSumMs', 'durationP50Ms', 'durationP95Ms']);
    }
    return table('calls', selectedCalls.map(c => ({ ...c, id: 'call:' + c.seq, returnedCharacters: c.outputCharacters, durationMs: callDurationMs(c),
      evidence: [...reportRef(index, c.startSeq ?? c.seq), ...reportRef(index, c.resultSeq)] })), ['turn', 'step', 'name', 'status', 'start', 'end', 'durationMs', 'returnedCharacters']);
  }
  const fields = ['turn', 'step', 'start', 'end', 'wallMs', 'ttftMs', 'modelMs', 'toolMs', 'toolCoveredMs', 'contextTokens', 'cacheHit', 'outputTokens', 'retries'];
  const steps = index.stepEntries.filter(selected).sort((a,b)=>(a.evidence.seq??Infinity)-(b.evidence.seq??Infinity));
  const timings = query.view === 'latency' ? recordedStepTimings(steps, index.views.io) : null;
  if (timings) {
    fields.push('recordedStepSpanMs', 'calls', 'pairedToolCalls', 'crossStepToolCalls', 'clippedToolMs', 'clippedToolCoveredMs');
    coverage.recordedToolTiming = recordedStepTimingBasis;
  }
  return table('steps', steps.map(s => {
    const timing = timings?.get(s);
    return { id: 'step:' + s.turn + ':' + s.step,
      turn: s.turn, step: s.step, start: s.evidence.start, end: s.evidence.end,
      wallMs: s.official.wall, ttftMs: s.official.ttft, modelMs: s.official.model, toolMs: s.official.tool,
      toolCoveredMs: s.official.toolWall, contextTokens: s.official.context, cacheHit: s.official.cacheHit, outputTokens: s.official.output, retries: s.official.retries,
      recordedStepSpanMs: timing?.stepSpanMs, calls: timing?.calls, pairedToolCalls: timing?.pairedCalls,
      crossStepToolCalls: timing?.crossStepCalls, clippedToolMs: timing?.cumulativeMs, clippedToolCoveredMs: timing?.coveredMs,
      evidence: timings ? [...reportRef(index, s.evidence.seq), ...reportRef(index, s.evidence.endSeq)]
        : reportRef(index, s.evidence.assistantSeq ?? s.evidence.seq),
    };
  }), fields);
}
