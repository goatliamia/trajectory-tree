import { commandBatchLimit, commandCrOptions, observeCommandEntries } from '../trace/shared/pwsh-observer.mjs';
import { isShellTool, powerShellScript } from '../trace/shared/tool-attribution.mjs';

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
  return new Map(selected.filter(({ row }) => row.attribution?.site).map(({ row }) => [row.seq, row.attribution]));
}
