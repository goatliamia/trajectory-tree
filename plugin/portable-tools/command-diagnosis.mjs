import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import { commandBatchLimit, commandEvidenceExcerpt as excerpt, observeCommandEntries } from '../analysis-view/lib/trace/shared/pwsh-observer.mjs';
import { datasetAtCut } from './sources.mjs';
import { attributeToolFailure, commandPowerShellEdition, isShellTool, legacyParserDiagnostic, powerShellScript } from '../trajectory-tools/lib/tool-attribution.js';

const seqSchema = { type: 'integer', minimum: 0 };
const identity = { type: 'string', minLength: 1 };
export const COMMAND_TOOL = {
  name: 'trajectory_command_diagnose',
  description: '核对指定命令调用的退出原因。存在原始 PowerShell 脚本时可补查语法和命令位置。',
  inputSchema: { type: 'object', required: ['seqs'], additionalProperties: false, properties: {
    session: identity, snapshot: identity, logId: identity, cut: seqSchema,
    seqs: { type: 'array', minItems: 1, maxItems: commandBatchLimit, items: seqSchema,
      description: '轨迹中的命令调用序号，最多 12 项。' },
  } },
};
const validator = Compile(Type.Unsafe(COMMAND_TOOL.inputSchema));

const decolor = text => String(text ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');

const diagnostics = [
  { kind: 'syntax', program: 'pwsh', pattern: /^ParserError:/i },
  { kind: 'pattern', program: 'rg', pattern: /^rg:\s*regex parse error:/i },
  { kind: 'path', program: 'rg', pattern: /^rg:.*\(os error (?:2|3|123)\)/i },
  { kind: 'path', program: 'Get-Content', pattern: /^Get-Content:.*(?:cannot find|找不到|不存在)/i },
  { kind: 'permission', pattern: /^(?:Error:\s*)?(?:EPERM|EACCES|AccessDenied|Permission denied)\b|^(?:rg|Get-Content):.*\(os error (?:5|13)\)\s*$/i },
  { kind: 'timeout', pattern: /^(?:TimeoutError:|Timed out\b|command timed out\b|locator\.\w+:\s*Timeout\b|.*:\s*Timeout \d+ms exceeded\b)/i },
  { kind: 'child', pattern: /^(?:Error|TypeError|ReferenceError|RangeError|SyntaxError|AssertionError)(?: \[[A-Z_]+\])?:\s+\S/i },
];

const parserMessages = [
  ['MissingArgument', /^Missing argument in parameter list\.$/i],
  ['MissingExpression', /^Missing expression after /i],
  ['EmptyPipeElement', /^An empty pipe element is not allowed\.$/i],
  ['MissingEndParenthesisInExpression', /^Missing closing '\)' in expression\.$/i],
  ['MissingEndCurlyBrace', /^Missing closing '\}' in statement block or type definition\.$/i],
  ['TerminatorExpectedAtEndOfString', /^The string is missing the terminator:/i],
];

function recordedParserError(lines, index) {
  const context = lines.slice(index + 1, index + 8);
  const sourceLine = context.find(line => /^\d+\s*\|/.test(line));
  const messageLine = context.find(line => /^\|\s+[^\s~]/.test(line));
  const message = messageLine?.replace(/^\|\s+/, '') || lines[index].replace(/^ParserError:\s*/i, '');
  const id = parserMessages.find(([, pattern]) => pattern.test(message))?.[0];
  return { evidence: excerpt(message || lines[index]), reported: {
    ...(sourceLine ? { line: Number(/^\d+/.exec(sourceLine)[0]) } : {}), ...(id ? { id } : {}),
  } };
}

function codeLocation(lines) {
  for (const line of lines) {
    const match = /^(?:at\s+(?:[^()]*\()?)?((?:file:\/\/\/|[A-Z]:[\\/]|\/)[^()]+?\.(?:[cm]?[jt]sx?)):(\d+)(?::(\d+))?\)?$/i.exec(line);
    if (match) return { file: excerpt(match[1]), line: Number(match[2]), column: match[3] ? Number(match[3]) : null, source: 'runtime-stack' };
  }
  return null;
}

function resultCause(call, exitCode, output, script) {
  if (call.status !== 'error') return { kind: call.status === 'returned' ? 'returned' : 'unrecorded' };
  const lines = decolor(output).split(/\r?\n/).map(line => line.trim());
  const first = lines.findIndex(Boolean);
  const legacy = legacyParserDiagnostic(lines);
  if (legacy) return { kind: 'syntax', program: 'pwsh', basis: 'recorded-output', outputLine: legacy.index + 1,
    evidence: legacy.id, reported: { id: legacy.id } };
  if (exitCode === 1 && first < 0 && /^rg(?:\.exe)?[ \t]+[^;\r\n|&<>\x60{}()$]+$/i.test(script?.trim() ?? '')) {
    return { kind: 'no-match', program: 'rg', certainty: 'candidate', basis: 'single-rg-exit-and-empty-output' };
  }
  for (let index = Math.max(0, first); index < lines.length; index++) {
    const line = lines[index];
    const rule = diagnostics.find(rule => (rule.kind !== 'syntax' || index === first) && rule.pattern.test(line));
    if (!rule) continue;
    const code = rule.kind === 'child' ? codeLocation(lines) : null;
    const parser = rule.kind === 'syntax' ? recordedParserError(lines, index) : null;
    return { kind: rule.kind, program: rule.program ?? (code ? 'node' : null), basis: 'recorded-output',
      outputLine: index + 1, evidence: excerpt(line), outputBefore: index > first,
      ...(parser ?? {}), ...(code ? { code } : {}) };
  }
  return { kind: 'unresolved', ...(first >= 0 ? { outputRecorded: true } : {}) };
}

function collectCommands(data, powerShellOnly) {
  const records = new Map(data.records.map(record => [record.seq, record]));
  const entries = [];
  for (const turn of data.payload.sessions[0].turns) for (const step of turn.steps) for (const call of step.calls) {
    const name = call.nativeName || call.name;
    if (!isShellTool(name)) continue;
    const record = records.get(call.seq), args = record?.arguments ?? record?.body?.arguments;
    const command = args?.command ?? args?.cmd;
    const captured = Object.hasOwn(data.commandScripts ?? {}, call.id) ? data.commandScripts[call.id] : null;
    const source = captured || powerShellScript(command, name, args?.shell);
    const edition = source?.edition ?? (data.host === 'codex' ? commandPowerShellEdition(command) : null);
    if (powerShellOnly && !source && !edition) continue;
    const body = records.get(call.resultSeq)?.body;
    const result = data.host === 'codex' ? body?.result : body?.toolUseResult ?? body?.details;
    const output = result?.output ?? (typeof body?.content === 'string' ? body.content : Array.isArray(body?.content)
      ? body.content.filter(block => block.type === 'text').map(block => block.text).join('\n') : undefined);
    let attribution = call.attribution;
    if (!attribution || (source && attribution.certainty !== 'confirmed')) {
      const rechecked = attributeToolFailure({ status: call.status, tool: name, output,
        error: result?.error ?? (attribution ? undefined : call.error), exitCode: result?.exitCode ?? attribution?.exitCode,
        stderr: result?.stderr, interrupted: result?.interrupted, command: source?.text ?? command });
      if (rechecked && (!attribution || rechecked.certainty !== 'unknown')) attribution = rechecked;
    }
    const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : attribution?.exitCode ?? null;
    let cause = resultCause(call, exitCode, output || result?.stderr, source?.text);
    if (cause.kind === 'unresolved' && attribution?.certainty === 'confirmed') {
      const kinds = { COMMAND_CONNECTION_DENIED: 'connection', COMMAND_CONNECTION_FAILED: 'connection',
        COMMAND_ENCODING_ERROR: 'encoding', COMMAND_PERMISSION: 'permission', COMMAND_TEST_FAILED: 'check',
        COMMAND_TIMEOUT: 'timeout', COMMAND_NOT_FOUND: 'argument', COMMAND_ARGUMENT: 'argument' };
      cause = { kind: kinds[attribution.code] ?? 'child', program: attribution.program,
        evidence: attribution.evidence, basis: attribution.basis };
    }
    const durationMs = Number.isFinite(call.durationMs) && call.durationMs >= 0 ? call.durationMs : null;
    entries.push({ source, row: {
      seq: call.seq, resultSeq: call.resultSeq, itemId: record?.native?.itemId, turn: turn.number,
      shell: edition === 'Desktop' ? 'powershell' : edition === 'Core' ? 'pwsh' : name,
      operation: call.classification?.kind ?? 'run', status: call.status, exitCode, durationMs, cause, attribution,
      syntax: { state: source ? 'not-selected' : edition ? 'no-source' : 'other-shell', ...(source?.line ? { rolloutLine: source.line } : {}) },
    } });
  }
  return entries;
}

export function commandPageCut(data) {
  const session = data.payload.sessions[0], turns = session.turns;
  const closed = turns.findLastIndex(turn => turn.endObserved && turn.reason?.kind !== 'running');
  return closed >= 0 && closed < turns.length - 1 ? turns[closed + 1].seq - 1 : session.lastSeq;
}

export async function commandReport(data, { seqs, whole = false, cr, signal, powerShellOnly = whole } = {}) {
  signal?.throwIfAborted();
  const entries = collectCommands(data, powerShellOnly), bySeq = new Map(entries.map(entry => [entry.row.seq, entry]));
  const selected = seqs ? [...new Set(seqs)].map(seq => {
    const entry = bySeq.get(seq);
    if (!entry) throw Error('No command call at #' + seq + ' in this cut');
    return entry;
  }) : [];
  if (!seqs || whole) {
    const priority = row => row.cause.kind === 'syntax' ? 2 : Number(row.attribution?.certainty !== 'confirmed');
    const candidates = entries.filter(entry => entry.source && entry.row.status === 'error' &&
      (!seqs || entry.row.cause.kind === 'syntax') && !selected.includes(entry))
      .sort((a, b) => priority(b.row) - priority(a.row) || b.row.seq - a.row.seq)
      .slice(0, Math.max(0, commandBatchLimit - selected.length));
    selected.push(...candidates);
  }
  const observed = await observeCommandEntries(selected, cr, signal);
  return {
    host: data.host, session: data.session, cut: data.cut, logId: data.logId, synthetic: data.synthetic,
    cr: { state: observed.state, runtime: observed.runtime, edition: observed.edition, selected: selected.length },
    rows: (whole ? entries : selected).map(entry => entry.row),
  };
}

export async function commandAttributionDetails(data, cr, signal) {
  if (!cr?.root) return;
  const { rows } = await commandReport(data, { cr, signal, powerShellOnly: true });
  return new Map(rows.filter(row => row.attribution?.site).map(row => [row.seq, row.attribution]));
}

export async function executeCommandTool(service, args, cr, signal) {
  if (!validator.Check(args)) throw Error('Provide 1–12 command call numbers in seqs and a valid session/cut');
  const item = await service.prepare(args.snapshot, args.session, signal, args.cut);
  const data = item.data.cut === undefined ? datasetAtCut(item.data, item.data.payload.sessions[0].lastSeq) : item.data;
  if (args.logId && args.logId !== data.logId) throw Error('Log identity does not match this cut');
  const report = await commandReport(data, { seqs: args.seqs, cr, signal });
  for (const row of report.rows) {
    row.read = { tool: 'trajectory_read', session: data.session, cut: data.cut, logId: data.logId, seq: row.seq, linked: true };
  }
  return report;
}
