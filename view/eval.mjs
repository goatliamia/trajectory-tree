import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildEvalData, diagnosisSource, EVAL_DETAIL_TURNS } from '../plugin/analysis-view/lib/eval/data.mjs';
import { renderEvalPage } from '../plugin/analysis-view/lib/eval/render.mjs';
import { usageRow, usageSettlements } from '../plugin/portable-tools/usage.mjs';
import { datasetAtCut } from '../plugin/portable-tools/sources.mjs';
import { scopeByTurn } from '../lib/scope-index.mjs';

const valid = value => Number.isFinite(value) && value >= 0;
const sum = values => values.length ? values.reduce((total, value) => total + value, 0) : null;
function spans(rows) {
  const measured = rows.flatMap(row => valid(row.durationMs) ? [row.durationMs]
    : row.endObserved === true && valid(row.start) && valid(row.end) && row.end >= row.start ? [row.end - row.start] : []);
  return { total: rows.length, measured: measured.length, ms: sum(measured) };
}

function portableRuntime(payload) {
  const { host, context = {} } = payload;
  const session = payload.sessions[0];
  const turnNumbers = new Map(session.turns.map(turn => [turn.id, turn.number]));
  const usageIn = scopeByTurn(usageSettlements(context.usage ?? []).map(row => ({
    turn: host === 'codex' ? turnNumbers.get(row.turnId) : row.turn,
    output: usageRow(host, row).output,
  })));
  const filesIn = scopeByTurn((context.fileOperations ?? []).filter(row => row.path && row.source !== 'estimate'));
  return (turns, number) => {
    const rows = usageIn(number);
    const outputs = rows.map(row => row.output).filter(valid);
    const steps = turns.flatMap(turn => turn.steps);
    const files = filesIn(number);
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

export function writeHostEvalPage(dataset, output, { locale, attributions } = {}) {
  const { payload, logId, host } = datasetAtCut(dataset, dataset.payload.sessions[0].lastSeq);
  const session = payload.sessions[0];
  const data = buildEvalData(session, portableRuntime(payload), { host, synthetic: payload.synthetic, turnLimit: EVAL_DETAIL_TURNS, attributions });
  const html = renderEvalPage(data, { integrated: true, mode: host, locale,
    diagnosis: diagnosisSource(session, data, { host, logId, file: session.source?.file }) });
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  return { output: path, bytes: Buffer.byteLength(html), host, synthetic: !!payload.synthetic, locale: locale || 'auto',
    view: 'eval', cut: data.cut, logId, session: session.id, totals: session.totals };
}
