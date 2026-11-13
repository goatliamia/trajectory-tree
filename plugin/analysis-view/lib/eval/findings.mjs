import { callDurationMs } from '../trace/shared/tool-intervals.mjs';
import { dshPowerShellEvidence } from './dsh-command-evidence.mjs';
import { diagnosticSignals, diagnosticLayer } from './diagnostic-rules.mjs';

// Compact observations from the same calls used by Eval. These are investigation
// entries, never model diagnoses, completed repairs or persistent-knowledge items.
export function projectFindingCalls(session, { host = 'dsh', attributions, turns, events } = {}) {
  const records = host === 'dsh' && events ? new Map(events.map(event => [event.seq, event])) : null;
  const returned = new Map((session.overview?.episodes ?? []).flatMap(episode => episode.pairs.map(pair => [pair.failedSeq, pair.successSeq])));
  const allowed = turns && new Set(turns);
  const reads = new Map();
  for (const turn of session.turns) for (const step of turn.steps) for (const call of step.calls) {
    if (call.status !== 'returned' || !call.target || !['read','read_file','read_text_file'].includes(call.name) || !Number.isSafeInteger(call.resultSeq)) continue;
    if (!reads.has(call.target)) reads.set(call.target, []);
    reads.get(call.target).push({ seq: call.seq, result: call.resultSeq, turn: turn.number });
  }
  for (const values of reads.values()) values.sort((a,b)=>a.result-b.result);
  const rows = [];
  for (const turn of session.turns) {
    if (allowed && !allowed.has(turn.number)) continue;
    for (const step of turn.steps) for (const call of step.calls) {
      const start = host === 'dsh' ? call.inner ? call.startSeq : call.seq
        : call.startSeq === null || ['ordinal-only', 'unrecorded-start'].includes(call.timingSource) ? null : call.startSeq ?? call.seq;
      const paired = callDurationMs({ startSeq: start, resultSeq: call.resultSeq, start: call.start, end: call.end });
      const durationMs = paired ?? (host !== 'dsh' && Number.isFinite(call.durationMs) && call.durationMs >= 0 ? call.durationMs : null);
      const shell = records && dshPowerShellEvidence(call, records.get(call.seq), records.get(call.resultSeq));
      if (call.status !== 'error' && call.status !== 'unknown' && !shell?.command.feedback && !(durationMs >= 30_000)) continue;
      const attribution = attributions?.get(call.seq) ?? call.attribution ?? shell?.attribution;
      rows.push({ seq: call.seq, result: call.resultSeq ?? null, turn: turn.number, step: step.number,
        tool: (host === 'dsh' ? call.name : call.nativeName || call.name) ?? '', status: call.status,
        code: attribution?.code ?? 'UNCLASSIFIED_OUTPUT', label: attribution?.label ?? '', certainty: attribution?.certainty ?? 'unknown',
        program: attribution?.program ?? '', exception: attribution?.exception ?? '', runtimeKind: attribution?.runtimeKind ?? '',
        pattern: attribution?.pattern ?? null, layer: diagnosticLayer(attribution), diagnosticIds: attribution?.diagnosticIds ?? [],
        powerShell: Boolean(call.powerShellEdition || attribution?.program === 'PowerShell' || /^(pwsh|powershell)$/i.test(call.name)),
        evidence: attribution?.evidence?.slice(0, 240) ?? '', site: attribution?.site,
        attributionBasis: attribution?.basis ?? 'unknown', reportedCode: call.error?.code ?? null,
        reportedName: call.error?.name ?? null, exitCode: attribution?.exitCode ?? shell?.command.feedback?.exitCode ?? null,
        ...(shell ? { command: shell.command } : {}),
        reportedMessage: call.result?.text?.slice(0, 600) ?? '', target: call.target ?? null,
        measure:call.measure??null,codeFrames:attribution?.codeFrames??call.codeFrames??[],
        ...(attribution?.code === 'FS_NOT_OBSERVED' ? { priorRead: reads.get(call.target)?.findLast(read=>read.result<(start??call.seq)) ?? null } : {}),
        returned: returned.get(call.seq) ?? null, root: call.rootSeq ?? null, durationMs });
    }
  }
  return rows;
}

// Used on both server and browser so session/project/time filtering has exactly
// the same grouping rules. A group is a common signal, not a shared root cause.
export function summarizeFindings(entries) {
  const policies = {
    control: ['APPROVAL_REJECTED','APPROVAL_CANCELLED','ASK_CANCELLED'],
    guard: ['FS_NOT_OBSERVED','FS_STALE_VERSION'],
    arguments: ['COMMAND_SYNTAX','CODE_SYNTAX','COMMAND_ARGUMENT','COMMAND_PATTERN','FS_EDIT_NOT_FOUND',
      'INVALID_IMAGE_BASE64','INVALID_IMAGE','IMAGE_TYPE_MISMATCH','INVALID_FILE_BASE64','INVALID_ATTACHMENT_REF',
      'INVALID_ARGS','SEARCH_INVALID_PATTERN','FS_AMBIGUOUS_EDIT'],
    availability: ['COMMAND_NOT_FOUND','COMMAND_OFFLINE_DEPENDENCY','CODE_SANDBOX_UNAVAILABLE',
      'APPROVAL_UNAVAILABLE','TOOL_CONTEXT_UNAVAILABLE','UNKNOWN_TOOL','TOOL_ACTIVATION_FAILED',
      'ATTACHMENT_PROJECTION_UNSUPPORTED','ATTACHMENT_FILES_UNSUPPORTED','HOST_SANDBOX_SETUP_FAILED','browser-unavailable'],
    access: ['COMMAND_PERMISSION','TOOL_PERMISSION','COMMAND_CONNECTION_DENIED','COMMAND_FILE_BUSY','COMMAND_CIM_UNAVAILABLE','FS_NOT_FOUND','FS_NOT_TEXT',
      'ATTACHMENT_NOT_FOUND','ATTACHMENT_READ_FAILED','ATTACHMENT_WRITE_FAILED','FS_NOT_REGULAR_FILE','FS_REPLACE_FAILED'],
    contract: ['INVALID_TOOL_OUTPUT','UNSUPPORTED_SCHEMA'],
    input: ['TOO_MANY_IMAGES','IMAGES_TOO_LARGE','UNSUPPORTED_IMAGE_TYPE','IMAGE_TOO_LARGE','IMAGE_TOO_MANY_PIXELS','IMAGE_DIMENSION_TOO_LARGE','ATTACHMENT_CORRUPT','SEARCH_RAW_OUTPUT_OVERFLOW'],
    recovery: ['TOOL_TIMEOUT','COMMAND_TIMEOUT','CODE_TIMEOUT','COMMAND_CONNECTION_FAILED','WEB_PROVIDER_ERROR'],
    outcome: ['TOOL_OUTCOME_UNKNOWN','JOB_NOT_FOUND'],
    external: ['COMMAND_EXTERNAL_FEEDBACK'],
    cancellation: ['ABORTED','ABORTED_BEFORE_DISPATCH','CODE_ABORTED','WEB_ABORTED','JOB_WAIT_ABORTED'],
    lookup: ['LOOKUP_NO_MATCH','LOOKUP_COMMAND'],
    validation: ['COMMAND_TEST_FAILED'],
  };
  const policyFor = code => Object.entries(policies).find(([, codes]) => codes.includes(code))?.[0] ?? 'implementation';
  const groups = new Map(), unclassified = [], pending = [];
  for (const row of entries) {
    if (!Number.isSafeInteger(row.seq) || !Number.isSafeInteger(row.turn)) continue;
    const session = row.source?.session ?? row.session ?? '';
    const add = (kind, code, focus) => {
      const key = JSON.stringify(kind==='wait'?[kind,row.tool]:[kind, code, row.tool, row.program || '', row.exception || row.runtimeKind || '', row.pattern || '',row.certainty]);
      if (!groups.has(key)) groups.set(key, { key, kind, code, focus, tool: row.tool, label: kind==='wait'?'':row.label, certainty: kind==='wait'?'observation':row.certainty,
        program: kind==='wait'?'':row.program || '', exception: kind==='wait'?'':row.exception || row.runtimeKind || '', pattern:kind==='wait'?null:row.pattern, layer:row.layer??null, entries: [], sessions: new Set(), turns: new Set() });
      const group = groups.get(key);group.entries.push(row);group.sessions.add(session);group.turns.add(JSON.stringify([session,row.turn]));
    };
    if (row.status === 'error' || row.command?.feedback) {
      if (row.certainty === 'unknown' && row.code!=='TOOL_OUTCOME_UNKNOWN') unclassified.push(row);
      else add(row.status === 'error' ? 'error' : 'command', row.code, policyFor(row.code));
    } else if (row.status === 'unknown') pending.push(row);
    if (Number.isFinite(row.durationMs) && row.durationMs >= 30_000) add('wait','LONG_CALL','latency');
  }
  const result = [...groups.values()].map(group => {
    const repeated = group.turns.size > 1;
    const signals=diagnosticSignals({...group,turns:group.turns.size});
    const directions=signals.map(signal=>signal.direction);
    // Repetition and a recognized error establish an observation, not a root
    // cause or a need to repair implementation / add persistent instructions.
    return { ...group, entries: group.entries.sort((a,b) => b.turn-a.turn || b.seq-a.seq), sessions: group.sessions.size,
      turns: group.turns.size, count: group.entries.length, repeated, directions, signals,
      paired: group.entries.filter(row => Number.isSafeInteger(row.returned)).length,
      durationMs: group.entries.reduce((sum,row) => sum + (row.durationMs ?? 0), 0),
      causeConfirmed: false, needsAction: null,
      observationOnly: ['control','lookup'].includes(group.focus),
      method: group.kind === 'wait' ? 'latency' : 'disposition' };
  }).sort((a,b) => Number(b.repeated)-Number(a.repeated) || (a.kind==='error'?0:1)-(b.kind==='error'?0:1) || b.count-a.count || a.key.localeCompare(b.key));
  return { groups: result, unclassified, pending, observedErrors: entries.filter(row => row.status === 'error').length,
    commandFeedback: entries.filter(row => row.status !== 'error' && row.command?.feedback).length };
}

export const findingsRuntime = () => '(()=>{const diagnosticSignals='+diagnosticSignals.toString()+';globalThis.__trajectorySummarizeFindings = ' + summarizeFindings.toString() + ';})();';
