import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildEvalData, diagnosisSource, EVAL_DETAIL_TURNS } from '../plugin/analysis-view/lib/eval/data.mjs';
import { renderEvalPage } from '../plugin/analysis-view/lib/eval/render.mjs';
import { usageRow, usageSettlements } from '../plugin/portable-tools/usage.mjs';
import { datasetAtCut } from '../plugin/portable-tools/sources.mjs';
import { scopeByTurn } from '../lib/scope-index.mjs';

const valid = value => Number.isFinite(value) && value >= 0;
const sum = values => values.length ? values.reduce((total, value) => total + value, 0) : null;
function resultText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(resultText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object' || value.mediaOmitted || /^(?:input_|output_)?(?:image|audio|video)(?:_url)?$/.test(value.type || '')) return '';
  if (typeof value.text === 'string') return value.text;
  if (value.content != null) return resultText(value.content);
  return JSON.stringify(value);
}
function spans(rows) {
  const measured = rows.flatMap(row => valid(row.durationMs) ? [row.durationMs]
    : row.endObserved === true && valid(row.start) && valid(row.end) && row.end >= row.start ? [row.end - row.start] : []);
  return { total: rows.length, measured: measured.length, ms: sum(measured) };
}

export function portableRuntime(payload) {
  const { host, context = {} } = payload;
  const session = payload.sessions[0];
  const turnNumbers = new Map(session.turns.map(turn => [turn.id, turn.number]));
  const usageIn = scopeByTurn(usageSettlements(context.usage ?? []).map(row => ({
    turn: host === 'codex' ? turnNumbers.get(row.turnId) : row.turn,
    output: usageRow(host, row).output,
  })));
  const filesIn = scopeByTurn((context.fileOperations ?? []).filter(row => row.path && row.source !== 'estimate'));
  return (turns, number) => {
    const select = index => number == null && turns.length !== session.turns.length
      ? turns.flatMap(turn => index(turn.number)) : index(number);
    const rows = select(usageIn);
    const outputs = rows.map(row => row.output).filter(valid);
    const steps = turns.flatMap(turn => turn.steps);
    const files = select(filesIn);
    return {
      timing: { turns: spans(turns), steps: spans(steps),
        toolSteps: { coveredMs: null, measured: null, total: steps.length }, official: null },
      usage: { output: sum(outputs), coverage: { output: outputs.length }, requests: rows.length },
      files: { files: new Set(files.map(row => row.path)).size, pairedWriteFiles: null,
        readBeforeFirstWrite: null, readAfterLastWrite: null },
      task: { deliveries: null, deliveredFiles: null, workspaceObservations: null, evidence: [] },
      context: { skillLoads: null, childSessions: null },
      repeats: { groups: null, calls: null },
    };
  };
}

export function portableDiagnosis(dataset) {
  const scoped = datasetAtCut(dataset, dataset.payload.sessions[0].lastSeq), session = scoped.payload.sessions[0];
  const source = diagnosisSource(session, null, { host: scoped.host, logId: scoped.logId, file: session.source?.file });
  source.rounds = session.turns.map(turn => ({ number: turn.number, ms: turn.durationMs ?? null, calls: turn.calls, errors: turn.errors }));
  return source;
}

export function writeHostEvalPage(dataset, output, { locale, attributions, section, evidenceFile } = {}) {
  const { payload, logId, host, records, commandScripts } = datasetAtCut(dataset, dataset.payload.sessions[0].lastSeq);
  const session = payload.sessions[0];
  const argumentsBySeq = new Map(records.map(record => [record.seq, record.arguments ?? record.body?.arguments]));
  // Query snapshots drop duplicated renderer excerpts. Read bounded previews
  // from the same frozen native records rather than treating them as no output.
  const failedResults = new Set(session.turns.flatMap(turn => turn.steps.flatMap(step => step.calls.filter(call => call.status === 'error').map(call => call.resultSeq))));
  const resultsBySeq = new Map(records.filter(record => failedResults.has(record.seq)).map(record => {
    const value = host === 'codex' ? record.body?.result?.output ?? record.body?.result : record.body?.content;
    return [record.seq, value == null ? undefined : resultText(value)];
  }));
  const data = buildEvalData(session, portableRuntime(payload), { host, synthetic: payload.synthetic, turnLimit: EVAL_DETAIL_TURNS, attributions, argumentsBySeq, resultsBySeq, commandScripts });
  const html = renderEvalPage(data, { integrated: true, mode: host, locale, section,
    diagnosis: {...diagnosisSource(session, data, { host, logId, file: session.source?.file }),evidenceFile} });
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  return { output: path, bytes: Buffer.byteLength(html), host, synthetic: !!payload.synthetic, locale: locale || 'auto',
    view: 'eval', cut: data.cut, logId, session: session.id, totals: session.totals };
}
