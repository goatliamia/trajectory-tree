import { callDurationMs } from '../trace/shared/tool-intervals.mjs';

// Compact observations from the same calls used by Eval. These are investigation
// entries, never model diagnoses, completed repairs or persistent-knowledge items.
export function projectFindingCalls(session, { host = 'dsh', attributions, turns } = {}) {
  const returned = new Map((session.overview?.episodes ?? []).flatMap(episode => episode.pairs.map(pair => [pair.failedSeq, pair.successSeq])));
  const allowed = turns && new Set(turns);
  const rows = [];
  for (const turn of session.turns) {
    if (allowed && !allowed.has(turn.number)) continue;
    for (const step of turn.steps) for (const call of step.calls) {
      const start = host === 'dsh' ? call.inner ? call.startSeq : call.seq
        : call.startSeq === null || ['ordinal-only', 'unrecorded-start'].includes(call.timingSource) ? null : call.startSeq ?? call.seq;
      const paired = callDurationMs({ startSeq: start, resultSeq: call.resultSeq, start: call.start, end: call.end });
      const durationMs = paired ?? (host !== 'dsh' && Number.isFinite(call.durationMs) && call.durationMs >= 0 ? call.durationMs : null);
      if (call.status !== 'error' && call.status !== 'unknown' && !(durationMs >= 30_000)) continue;
      const attribution = attributions?.get(call.seq) ?? call.attribution;
      rows.push({ seq: call.seq, result: call.resultSeq ?? null, turn: turn.number, step: step.number,
        tool: (host === 'dsh' ? call.name : call.nativeName || call.name) ?? '', status: call.status,
        code: attribution?.code ?? 'UNCLASSIFIED_OUTPUT', label: attribution?.label ?? '', certainty: attribution?.certainty ?? 'unknown',
        program: attribution?.program ?? '', exception: attribution?.exception ?? '', runtimeKind: attribution?.runtimeKind ?? '',
        powerShell: Boolean(call.powerShellEdition || attribution?.program === 'PowerShell' || /^(pwsh|powershell)$/i.test(call.name)),
        evidence: attribution?.evidence?.slice(0, 240) ?? '', site: attribution?.site,
        returned: returned.get(call.seq) ?? null, root: call.rootSeq ?? null, durationMs });
    }
  }
  return rows;
}

// Used on both server and browser so session/project/time filtering has exactly
// the same grouping rules. A group is a common signal, not a shared root cause.
export function summarizeFindings(entries) {
  const policies = {
    guard: ['FS_NOT_OBSERVED','FS_STALE_VERSION'],
    arguments: ['COMMAND_SYNTAX','CODE_SYNTAX','COMMAND_ARGUMENT','COMMAND_PATTERN','FS_EDIT_NOT_FOUND'],
    availability: ['COMMAND_NOT_FOUND','COMMAND_OFFLINE_DEPENDENCY','CODE_SANDBOX_UNAVAILABLE'],
    access: ['COMMAND_PERMISSION','TOOL_PERMISSION','COMMAND_CONNECTION_DENIED','COMMAND_FILE_BUSY','COMMAND_CIM_UNAVAILABLE','FS_NOT_FOUND','FS_NOT_TEXT'],
    recovery: ['TOOL_TIMEOUT','COMMAND_TIMEOUT','CODE_TIMEOUT','COMMAND_CONNECTION_FAILED','WEB_PROVIDER_ERROR','TOOL_OUTCOME_UNKNOWN'],
    cancellation: ['ABORTED','ABORTED_BEFORE_DISPATCH','CODE_ABORTED'],
    lookup: ['LOOKUP_NO_MATCH','LOOKUP_COMMAND'],
    validation: ['COMMAND_TEST_FAILED'],
  };
  const policyFor = code => Object.entries(policies).find(([, codes]) => codes.includes(code))?.[0] ?? 'implementation';
  const groups = new Map(), unclassified = [], pending = [];
  for (const row of entries) {
    if (!Number.isSafeInteger(row.seq) || !Number.isSafeInteger(row.turn)) continue;
    const session = row.source?.session ?? row.session ?? '';
    const add = (kind, code, focus) => {
      const key = JSON.stringify(kind==='wait'?[kind,row.tool]:[kind, code, row.tool, row.program || '', row.exception || row.runtimeKind || '', row.certainty]);
      if (!groups.has(key)) groups.set(key, { key, kind, code, focus, tool: row.tool, label: kind==='wait'?'':row.label, certainty: kind==='wait'?'observation':row.certainty,
        program: kind==='wait'?'':row.program || '', exception: kind==='wait'?'':row.exception || row.runtimeKind || '', entries: [], sessions: new Set(), turns: new Set() });
      const group = groups.get(key);group.entries.push(row);group.sessions.add(session);group.turns.add(JSON.stringify([session,row.turn]));
    };
    if (row.status === 'error') {
      if (row.certainty === 'unknown') unclassified.push(row);
      else add('error', row.code, policyFor(row.code));
    } else if (row.status === 'unknown') pending.push(row);
    if (Number.isFinite(row.durationMs) && row.durationMs >= 30_000) add('wait','LONG_CALL','latency');
  }
  const result = [...groups.values()].map(group => {
    const repeated = group.turns.size > 1;
    const directions = group.focus === 'lookup' ? [] : group.kind === 'wait' ? ['repair']
      : group.focus === 'recovery' ? ['recover', ...(repeated ? ['repair'] : [])]
      : group.focus === 'cancellation' ? ['recover']
      : group.focus === 'availability' ? ['repair','capability']
      : ['repair'];
    if (repeated && group.kind === 'error' && group.certainty === 'confirmed' && group.focus!=='cancellation') directions.push('knowledge');
    return { ...group, entries: group.entries.sort((a,b) => b.turn-a.turn || b.seq-a.seq), sessions: group.sessions.size,
      turns: group.turns.size, count: group.entries.length, repeated, directions,
      paired: group.entries.filter(row => Number.isSafeInteger(row.returned)).length,
      durationMs: group.entries.reduce((sum,row) => sum + (row.durationMs ?? 0), 0),
      method: group.kind === 'wait' ? 'latency' : 'disposition' };
  }).sort((a,b) => Number(b.repeated)-Number(a.repeated) || (a.kind==='error'?0:1)-(b.kind==='error'?0:1) || b.count-a.count || a.key.localeCompare(b.key));
  return { groups: result, unclassified, pending, observedErrors: entries.filter(row => row.status === 'error').length };
}

export const findingsRuntime = () => 'globalThis.__trajectorySummarizeFindings = ' + summarizeFindings.toString() + ';';
