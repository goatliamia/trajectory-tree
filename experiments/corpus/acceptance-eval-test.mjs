import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { prepareAcceptanceCase, scoreAcceptance } from './acceptance-eval.mjs';
import { summarizeEvalFindings } from './eval-methods.mjs';

const packet = { packetId: 'cut-without-host-result',
  source: { session: 'fixture', cut: 8 },
  criteria: [{ id: 'local-check' }, { id: 'host-acceptance' }],
  evidence: [{ seq: 5 }, { seq: 6 }, { seq: 7 }] };
const reference = {
  'local-check': { status: 'met', evidence: [5, 6] },
  'host-acceptance': { status: 'unknown', evidence: [7] },
};
const response = (local, host) => ({
  packetId: packet.packetId,
  verdicts: [
    { criterion: 'local-check', status: 'met', evidence: [5, 6], reason: 'The recorded local check passed.', ...local },
    { criterion: 'host-acceptance', status: 'unknown', evidence: [7], reason: 'The last host check has no result.',
      missing: 'A result for the same host and artifact.', ...host },
  ],
});

test('scores verdicts and required anchors separately', () => {
  const grounded = scoreAcceptance(packet, response(), reference);
  assert.deepEqual(grounded.outcomes, { met: 1, not_met: 0, unknown: 1 });
  assert.equal(grounded.judgedCoverage, 0.5);
  assert.equal(grounded.anchoredMatches, 2);
  assert.equal(grounded.passed, true);
  const unsupported = scoreAcceptance(packet, response({ evidence: [6] }), reference);
  assert.equal(unsupported.matched, 2);
  assert.equal(unsupported.anchoredMatches, 1);
  assert.equal(unsupported.passed, false);
  const overconfident = scoreAcceptance(packet, response({}, { status: 'met' }), reference);
  assert.equal(overconfident.overclaims, 1);
  assert.equal(overconfident.passed, false);
});

test('rejects a foreign packet, a hidden citation, and an unexplained unknown', () => {
  assert.throws(() => scoreAcceptance(packet, { ...response(), packetId: 'full' }, reference), /this evidence packet/);
  assert.throws(() => scoreAcceptance(packet, response({}, { evidence: [8] }), reference), /present in the packet/);
  assert.throws(() => scoreAcceptance(packet, response({}, { missing: '' }), reference), /specific gap/);
  assert.throws(() => scoreAcceptance(packet, response({}, { criterion: 'local-check' }), reference), /duplicate verdict/);
});

test('the evaluation dimensions count unverified items without borrowing verdicts from each other', () => {
  for (const [method, status] of Object.entries({ acceptance: 'not_met', recovery: 'partial',
    repetition: 'no_progress', sideEffects: 'duplicated', claimSupport: 'contradicted' })) {
    const summary = summarizeEvalFindings(method, [{ status }, { status: 'unknown' }, { status }]);
    assert.deepEqual([summary.total, summary.known, summary.outcomes[status], summary.outcomes.unknown,
      summary.judgedCoverage], [3, 2, 2, 1, 2 / 3]);
  }
  assert.equal(summarizeEvalFindings('acceptance', []).judgedCoverage, null);
  assert.throws(() => summarizeEvalFindings('acceptance', [{ status: 'recovered' }]), /assessment status/);
});

const hasFrozenSource = existsSync(new URL('../../.dsh/diagnostic-pilot/repair/source.v4.jsonl.zstd', import.meta.url));
test('withholding removes the result from the same real cut', { skip: !hasFrozenSource }, () => {
  for (const [caseId, resultSeq] of [['client-self-test', 4242], ['long-session-browser', 10578]]) {
    const full = prepareAcceptanceCase(caseId, 'full');
    const withheld = prepareAcceptanceCase(caseId, 'withheld');
    assert.deepEqual(withheld.source, full.source);
    assert.deepEqual(withheld.criteria, full.criteria);
    assert.ok(full.evidence.some(record => record.seq === resultSeq && Number.isSafeInteger(record.callSeq)));
    assert.deepEqual(withheld.evidence, full.evidence.filter(record => record.seq !== resultSeq));
    assert.equal(withheld.metrics.toolOutcomes.calls, full.metrics.toolOutcomes.calls);
    assert.equal(withheld.metrics.toolOutcomes.known, full.metrics.toolOutcomes.known - 1);
    assert.equal(withheld.metrics.toolOutcomes.unknown, full.metrics.toolOutcomes.unknown + 1);
    assert.notEqual(withheld.packetId, full.packetId);
  }
});
