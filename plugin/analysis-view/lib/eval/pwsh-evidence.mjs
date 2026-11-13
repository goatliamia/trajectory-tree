import { commandBatchLimit, commandCrOptions, observeCommandEntries } from '../trace/shared/pwsh-observer.mjs';
import { isShellTool, powerShellScript } from '../trace/shared/tool-attribution.mjs';

// Bounded enrichment of an overview's existing observations. The historical
// script is parser input only; neither its commands nor its child programs run.
export async function enrichFindingPowerShell(rows, events, cr = commandCrOptions([]), signal) {
  const records = new Map(events.map(event => [event.seq, event]));
  const result = rows.map(row => ({ ...row })), selected = [];
  for (const row of result) {
    if (!row.powerShell || row.status !== 'error' && !row.command?.feedback) continue;
    let args = records.get(row.seq)?.data?.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
    const source = powerShellScript(args?.command ?? args?.cmd, row.tool, args?.shell);
    row.syntax = { state: !source ? 'no-source' : !cr?.root ? 'not-configured' : 'not-selected' };
    if (!source || !cr?.root) continue;
    selected.push({ source, original: row, row: { seq: row.seq, status: 'error', exitCode: row.exitCode,
      syntax: row.syntax, attribution: { code: row.code, label: row.label, certainty: row.certainty,
        basis: row.attributionBasis, program: row.program, exception: row.exception, runtimeKind: row.runtimeKind,
        evidence: row.evidence, exitCode: row.exitCode, site: row.site, pattern:row.pattern, layer:row.layer, diagnosticIds:row.diagnosticIds } } });
  }
  const priority = entry => entry.row.attribution.code === 'COMMAND_SYNTAX' ? 2 : Number(entry.row.attribution.certainty !== 'confirmed');
  const batch = selected.sort((a,b) => priority(b)-priority(a) || b.row.seq-a.row.seq).slice(0, commandBatchLimit);
  if (!batch.length) return result;
  const budget = AbortSignal.timeout(2500);
  try { await observeCommandEntries(batch, cr, signal ? AbortSignal.any([signal, budget]) : budget); }
  catch (error) {
    signal?.throwIfAborted();
    if (!budget.aborted) throw error;
    for (const entry of batch) if (entry.row.syntax.state === 'not-selected') entry.row.syntax.state = 'time-budget';
  }
  for (const { original, row } of batch) {
    const a = row.attribution;
    Object.assign(original, { code: a.code, label: a.label, certainty: a.certainty, attributionBasis: a.basis,
      program: a.program ?? '', evidence: a.evidence ?? '', site: a.site, commandSite: a.commandSite, guidance: a.guidance,
      pattern:a.pattern??null,layer:a.layer??original.layer??null,diagnosticIds:a.diagnosticIds??original.diagnosticIds??[] });
    if(a.codeFrames?.length)original.codeFrames=a.codeFrames;
  }
  return result;
}

export async function evalPowerShellEvidence(session, events, signal, cr = commandCrOptions([])) {
  if (!cr.root) return null;
  const argumentsBySeq = new Map();
  for (const event of events) {
    if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch') argumentsBySeq.set(event.seq, event.data?.arguments);
  }
  const entries = [];
  for (const turn of session.turns) for (const step of turn.steps) for (const call of step.calls) {
    if (call.status !== 'error' || !isShellTool(call.name)) continue;
    let args = argumentsBySeq.get(call.seq);
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { continue; }
    }
    const source = powerShellScript(args?.command ?? args?.cmd, call.name, args?.shell);
    if (!source) continue;
    entries.push({ source, row: { seq: call.seq, status: call.status, exitCode: call.attribution?.exitCode,
      attribution: call.attribution, syntax: { state: 'not-selected' } } });
  }
  if (!entries.length) return null;
  const priority = row => row.attribution?.code === 'COMMAND_SYNTAX' ? 2 : Number(row.attribution?.certainty !== 'confirmed');
  const selected = entries.sort((a, b) => priority(b.row) - priority(a.row) || b.row.seq - a.row.seq).slice(0, commandBatchLimit);
  const budget = AbortSignal.timeout(2500);
  try {
    await observeCommandEntries(selected, cr, signal ? AbortSignal.any([signal, budget]) : budget);
  } catch (error) {
    signal?.throwIfAborted();
    if (budget.aborted) return null;
    throw error;
  }
  return new Map(selected.filter(({ row }) => row.attribution?.site||row.attribution?.codeFrames?.length).map(({ row }) => [row.seq, row.attribution]));
}
