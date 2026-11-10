import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRelations, linkedRecord } from '../../plugin/trajectory-tools/lib/linked-read.js';
import { summarizeToolOutcomes } from '../../plugin/trajectory-tools/lib/io-outcome.js';
import { ACCEPTANCE_STATES, summarizeEvalFindings } from './eval-methods.mjs';
import { decodeZstdSession } from './decode-session.mjs';

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const probes = new URL('../probes/', import.meta.url);
const defaultFixtures = fileURLToPath(new URL('../../.dsh/diagnostic-pilot/', import.meta.url));
const rubric = [
  '根据当前切点的证据分别回答每一项验收问题。区分操作恢复、实际效果和最终验收。',
  '对象、版本与判据相符的证据确认满足时用 met，确认未满足时用 not_met。',
  '只有命令、完成自述、不同范围的检查或缺少关键结果时用 unknown，并说明具体缺少的证据。',
  '核对检查的实际条件。旧断言失败与改过断言后的自检通过可同时成立。',
  '指标描述可见调用的返回状态。每项验收判断仍需核对对应的检查和实际结果。',
  '返回一个 JSON 对象，字段为 packetId 和 verdicts。每项 verdict 包含 criterion、status、evidence 和 reason。',
  'criterion 使用 criteria 中的 id。evidence 是支持本项判断的可见事件 seq 数组。unknown 另给非空的 missing。',
];

export function prepareAcceptanceCase(caseId, variant, fixtures = defaultFixtures) {
  const cases = readJson(new URL('acceptance-cases.json', probes));
  if (!Object.hasOwn(cases, caseId) || !['full', 'withheld'].includes(variant)) {
    throw Error('Expected a known acceptance case and variant (full or withheld)');
  }
  const spec = cases[caseId];
  const { cases: sources } = readJson(join(fixtures, 'manifest.json'));
  const source = sources.find(entry => entry.key === spec.fixture);
  if (!source) throw Error('Missing frozen source: ' + spec.fixture);
  const compressed = readFileSync(join(fixtures, spec.fixture, 'source.v4.jsonl.zstd'));
  if (sha256(compressed) !== source.sourceHash) throw Error('Frozen source hash changed');
  const rows = decodeZstdSession(compressed).toString('utf8').trimEnd().split('\n').map(JSON.parse);
  if (rows.find(row => row.type === 'session')?.id !== source.session) throw Error('Frozen session does not match manifest');
  const prefix = rows.filter(row => Number.isSafeInteger(row.seq) && row.seq <= spec.cut);
  if (prefix.length !== spec.cut + 1 || prefix.some((row, i) => row.seq !== i)) throw Error('Frozen cut is incomplete');

  const relations = buildRelations(prefix);
  const callAt = seq => relations.calls[relations.callRefs[seq]];
  const selected = new Set(spec.anchors);
  for (const anchor of spec.anchors) {
    if (!prefix[anchor] || !Object.hasOwn(relations.locations, anchor)) throw Error('Invalid original anchor: ' + anchor);
    const call = callAt(anchor);
    if (call) for (const seq of [call.callSeq, call.resultSeq]) {
      if (seq != null) selected.add(seq);
    }
  }
  for (const seq of spec.withheld) {
    if (!selected.has(seq)) throw Error('Withheld result is outside the prepared evidence: ' + seq);
    if (variant === 'withheld') selected.delete(seq);
  }
  const evidence = [...selected].sort((a, b) => a - b).map(seq => {
    const { type, name, text, ...fields } = linkedRecord(prefix[seq], ['anchor'], { session: source.session });
    const record = { seq, type };
    const call = callAt(seq);
    if (name || call?.name) record.tool = name || call.name;
    if (call && call.callSeq !== seq && selected.has(call.callSeq)) record.callSeq = call.callSeq;
    if (text) record.text = text;
    for (const [key, field] of [['arguments', 'data.arguments'], ['error', 'data.error'], ['reason', 'data.reason']]) {
      if (fields[field]) record[key] = fields[field];
    }
    return record;
  });
  const visibleCalls = evidence.filter(record => record.type === 'tool/call').map(record => {
    const resultSeq = callAt(record.seq)?.resultSeq;
    const result = selected.has(resultSeq) ? prefix[resultSeq].data : null;
    if (!result) return { status: 'unknown' };
    return { status: result.error || result.message?.isError ? 'error' : 'returned' };
  });
  const packet = { schema: 'trajectory-acceptance/1', case: caseId,
    source: { host: 'dsh', session: source.session, sourceHash: source.sourceHash, cut: spec.cut },
    metrics: { scope: 'Top-level calls and matched results visible in this evidence packet',
      toolOutcomes: summarizeToolOutcomes(visibleCalls) },
    rubric, criteria: spec.criteria, evidence };
  return { ...packet, packetId: sha256(JSON.stringify(packet)) };
}

function validateAcceptanceFinding(finding, visible, label) {
  const { status, evidence, reason, missing } = finding;
  if (!ACCEPTANCE_STATES.includes(status)) throw Error('Invalid acceptance status: ' + label);
  if (!Array.isArray(evidence) || evidence.some(seq => !visible.has(seq)) || new Set(evidence).size !== evidence.length) {
    throw Error('Evidence references must be unique and present in the packet: ' + label);
  }
  if (typeof reason !== 'string' || !reason.trim() || (status === 'unknown'
    ? typeof missing !== 'string' || !missing.trim()
    : evidence.length === 0)) {
    throw Error('Verdict requires a reason and supporting evidence or a specific gap: ' + label);
  }
  return { status, evidence, reason, ...(status === 'unknown' ? { missing } : {}) };
}

export function scoreAcceptance(packet, assessment, reference) {
  if (assessment?.packetId !== packet.packetId || !Array.isArray(assessment.verdicts)) {
    throw Error('Assessment must identify this evidence packet and include verdicts');
  }
  const ids = new Set(packet.criteria.map(criterion => criterion.id));
  if (!ids.size || ids.size !== packet.criteria.length) throw Error('Expected distinct evaluation criteria');
  const visible = new Set(packet.evidence.map(record => record.seq));
  const seen = new Set();
  const findings = assessment.verdicts.map(verdict => {
    if (!verdict || typeof verdict !== 'object') throw Error('Invalid verdict');
    const { criterion } = verdict;
    if (!ids.has(criterion) || seen.has(criterion)) {
      throw Error('Unexpected criterion, duplicate verdict, or invalid status: ' + criterion);
    }
    seen.add(criterion);
    const checked = validateAcceptanceFinding(verdict, visible, criterion);
    const expected = reference[criterion];
    if (!expected || !ACCEPTANCE_STATES.includes(expected.status) || expected.evidence.some(seq => !visible.has(seq))) {
      throw Error('Reference is incompatible with the packet: ' + criterion);
    }
    return { criterion, ...checked,
      expectedStatus: expected.status,
      missingEvidence: expected.evidence.filter(seq => !checked.evidence.includes(seq)) };
  });
  if (seen.size !== ids.size) throw Error('Assessment is missing a criterion');
  const matched = findings.filter(f => f.status === f.expectedStatus);
  const anchoredMatches = matched.filter(f => !f.missingEvidence.length).length;
  return { packetId: packet.packetId, source: packet.source, ...summarizeEvalFindings('acceptance', findings),
    matched: matched.length, anchoredMatches,
    overclaims: findings.filter(f => f.expectedStatus === 'unknown' && f.status !== 'unknown').length,
    passed: anchoredMatches === ids.size, findings };
}

function main([command, caseId, variant, ...rest]) {
  const usage = 'Usage: acceptance-eval.mjs prepare <case> <variant> [fixtures-dir]\n' +
    '       acceptance-eval.mjs score <case> <variant> <assessment.json|-> [fixtures-dir]';
  if (command === '--help') { console.log(usage); return; }
  if (command === 'prepare' && rest.length <= 1) {
    console.log(JSON.stringify(prepareAcceptanceCase(caseId, variant, rest[0]), null, 2));
    return;
  }
  if (command !== 'score' || rest.length < 1 || rest.length > 2) throw Error(usage);
  const [assessmentFile, fixtures] = rest;
  const packet = prepareAcceptanceCase(caseId, variant, fixtures);
  const reference = readJson(new URL('acceptance-keys.json', probes))[caseId][variant];
  const result = scoreAcceptance(packet, readJson(assessmentFile === '-' ? 0 : assessmentFile), reference);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
