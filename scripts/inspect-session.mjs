// Local evidence rehearsal; reports stay in ignored .dsh by default.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadSession } from '../analyzers/load-session.mjs';
import { buildInspection, inspectionPage } from '../plugin/trajectory-tools/lib/inspect.js';
import { readRequestContext } from '../plugin/trajectory-tools/lib/request-context.js';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--source')) throw Error('Use --source <session.v4.jsonl.zstd> [--view cost|tool-checks] [--out .dsh/inspect-session.json]');
const loaded = loadSession(arg('--source'));
const start = performance.now(), view = process.argv.includes('--view') ? arg('--view') : 'cost';
let report, summary;
if (view === 'tool-checks') {
  const { checkRecordedToolCalls } = await import('../plugin/trajectory-tools/lib/tool-call-checks.js');
  report = checkRecordedToolCalls(loaded.events);
  summary = { directCalls: report.scope.directCalls, checkable: report.schema.checkable, nonconforming: report.schema.nonconforming };
} else {
  const index = buildInspection(loaded, loaded.id, { contextSeries: await readRequestContext(loaded.events) });
  report = inspectionPage(index, view);
  summary = { retainedEstimateBytes: JSON.stringify(index).length * 2, steps: index.summary.steps, coverage: index.coverage,
    definitions: index.summary.toolDefinitions.definitions.length, uncalledDefinitions: index.definitionItems.length, entries: report.totalEntries };
}
const output = resolve(process.argv.includes('--out') ? arg('--out') : '.dsh/inspect-session.json');
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, milliseconds: performance.now() - start, ...summary }));
