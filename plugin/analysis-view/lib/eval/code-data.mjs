import { isProgramTool, isShellTool, powerShellScript, commandPowerShellEdition } from '../trace/shared/tool-attribution.mjs';

const clip = (text, size) => {
  text = String(text ?? '');
  return { text: text.slice(0, size), omitted: Math.max(0, text.length - size) };
};
const argumentsOf = call => {
  try { return JSON.parse(call.args?.text ?? '{}'); } catch { return null; }
};
const phaseOf = attribution => {
  const code = attribution?.code ?? '';
  if (['COMMAND_SYNTAX','CODE_SYNTAX','COMMAND_PATTERN'].includes(code)) return 'syntax';
  if (['COMMAND_ARGUMENT','COMMAND_NOT_FOUND'].includes(code)) return 'arguments';
  if (['COMMAND_PERMISSION','TOOL_PERMISSION','COMMAND_CONNECTION_DENIED','CODE_SANDBOX_UNAVAILABLE'].includes(code)) return 'access';
  if (['CODE_TIMEOUT','CODE_ABORTED','CODE_WORKER_EXIT','CODE_PROTOCOL','CODE_OUTPUT_LIMIT','CODE_INVALID_OUTPUT'].includes(code)) return 'runtime';
  if (['COMMAND_RUNTIME_ERROR','COMMAND_ENCODING_ERROR','COMMAND_TEST_FAILED'].includes(code)) return 'child';
  if (code === 'CODE_EXCEPTION') return 'program';
  return attribution?.certainty === 'confirmed' ? 'execution' : 'unresolved';
};

// Project existing call identities once. The frontend only filters this frozen
// population; grouping by a signal does not declare a common root cause.
export function codeExecutionData(session, { host = 'dsh', attributions, argumentsBySeq, resultsBySeq, commandScripts } = {}) {
  const all = session.turns.flatMap(turn => turn.steps.flatMap(step => step.calls.map(call => ({ call, turn: turn.number, step: step.number }))));
  const bySeq = new Map(all.map(row => [row.call.seq, row]));
  const returns = new Map((session.overview?.episodes ?? []).flatMap(episode => episode.pairs.map(pair => [pair.failedSeq, pair.successSeq])));
  const calls = all.filter(({ call }) => isShellTool(call.nativeName || call.name) || isProgramTool(call.name)).map(location => {
    const { call } = location, name = call.nativeName || call.name;
    let args = argumentsBySeq?.get(call.seq) ?? argumentsOf(call);
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
    const command = args?.command ?? args?.cmd;
    const source = commandScripts?.[call.id] ?? powerShellScript(command, name, args?.shell);
    const edition = call.powerShellEdition || source?.edition || commandPowerShellEdition(command);
    const program = isProgramTool(call.name);
    const executor = program ? 'PTC' : edition || /^pwsh$|^powershell$/i.test(name) ? 'PowerShell' : 'Shell';
    return { ...location, name, args, command, source, edition, program, executor };
  });
  const counts = new Map();
  for (const row of calls) {
    const key = row.turn + ':' + row.executor;
    if (!counts.has(key)) counts.set(key, { turn: row.turn, executor: row.executor, calls: 0, errors: 0, unknown: 0 });
    const count = counts.get(key); count.calls++;
    count.errors += Number(row.call.status === 'error'); count.unknown += Number(row.call.status === 'unknown');
  }
  const rows = calls.filter(({ call }) => call.status === 'error').map(({ call, turn, step, name, args, command, source, edition, program, executor }) => {
    const attribution = attributions?.get(call.seq) ?? call.attribution;
    const identified = args?.commandActions?.map(action => action.command).filter(value => typeof value === 'string').join('\n');
    const script = program ? args?.code : source?.text ?? (identified || (typeof command === 'string' ? command : Array.isArray(command) ? command.join(' ') : null));
    const exact = program ? typeof args?.code === 'string' : !!source;
    const phase = phaseOf(attribution), code = attribution?.code ?? call.error?.code ?? 'TOOL_ERROR';
    const fingerprint = JSON.stringify([executor, phase, code, attribution?.program ?? '', attribution?.exception ??
      (program && attribution?.runtimeKind === 'exception' ? attribution.evidence : attribution?.runtimeKind) ?? '']);
    const root = bySeq.get(call.rootSeq)?.call;
    const paired = returns.get(call.seq);
    const recordedOutput = resultsBySeq?.get(call.resultSeq);
    return { seq: call.seq, startSeq: host === 'dsh' && call.inner ? call.startSeq : call.startSeq ?? call.seq,
      resultSeq: call.resultSeq, turn, step, name, executor, edition: edition ?? null,
      phase, code, nativeCode: call.error?.code ?? null, attribution, fingerprint,
      source: typeof script === 'string' ? { ...clip(script, 2800), exact } : null,
      output: typeof recordedOutput === 'string' ? clip(recordedOutput, 2200)
        : call.result ? { text: call.result.text.slice(0, 2200), omitted: (call.result.omitted ?? 0) + Math.max(0, call.result.text.length - 2200) } : null,
      root: Number.isSafeInteger(call.rootSeq) ? { seq: call.rootSeq, resultSeq: root?.resultSeq ?? null, status: root?.status ?? null } : null,
      returned: paired ?? null,
    };
  });
  return { host, session: session.id, cut: session.lastSeq, counts: [...counts.values()], rows };
}
