import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadSession } from '../analyzers/load-session.mjs';
import { buildTracePayload } from '../plugin/analysis-view/lib/trace-build.js';
import { traceContext } from '../plugin/analysis-view/lib/trace-context.js';
import { createRuntimeMetrics, readRuntimeEvidence } from '../plugin/analysis-view/lib/eval-evidence.js';
import { readTracePresentation, renderTraceDocument } from '../plugin/analysis-view/lib/trace/presentation.mjs';

import { buildEvalData, diagnosisSource } from '../plugin/analysis-view/lib/eval/data.mjs';
import { demoBridge, evalAsset, inlineTraceFonts, renderDiagnosisDemo, renderEvalPage } from '../plugin/analysis-view/lib/eval/render.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: options } = parseArgs({ options: {
  source: { type: 'string' },
  out: { type: 'string' },
  title: { type: 'string' },
  diagnosis: { type: 'boolean' },
} });
const source = resolve(options.source ?? join(root, '.dsh/diagnostic-pilot/repair/source.v4.jsonl.zstd'));
const output = resolve(options.out ?? join(root, options.diagnosis ? '.dsh/diagnosis-demo/index.html' : '.dsh/eval-dashboard/index.html'));
const title = options.title ?? (options.source ? 'DSH 会话' : '插件修复与长会话加载排查');
const { id, events } = loadSession(source);
if (!id || !events.length) throw new Error('Expected a recorded DSH session with events');

const payload = buildTracePayload(events, id);
const [session] = payload.sessions;
if (!session.turns.length) throw new Error('The recorded session has no turns');
const evidence = await readRuntimeEvidence({ get: () => undefined }, { payload }, events, new AbortController().signal);
const data = buildEvalData(session, createRuntimeMetrics(session, evidence), { title });
const outcomes = data.whole.outcomes;
const page = renderEvalPage(data, { integrated: options.diagnosis, script: options.diagnosis ? demoBridge : "" });
let html = page;
if (options.diagnosis) {
  if (data.cut !== session.lastSeq || outcomes.calls !== session.totals.calls || outcomes.errors !== session.totals.errors) {
    throw Error('Trace and Eval disagree on the source cut or call counts');
  }
  const assets = readTracePresentation();
  const context = traceContext(events, payload, evidence.requestContext);
  const extension = [demoBridge, evalAsset('diagnosis-gesture.js'), evalAsset('diagnosis-trace.js')].join('\n');
  const trace = renderTraceDocument({ ...payload, context, officialStats: evidence.official }, assets, {
    template: inlineTraceFonts(assets.template), locale: 'zh-CN', extension,
  });
  html = renderDiagnosisDemo({ ...diagnosisSource(session, data), calls: outcomes.calls, errors: outcomes.errors,
    views: { trace, eval: page } });
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html);
console.log(JSON.stringify({ output, cut: data.cut, turns: data.turns.length, ...outcomes }));
