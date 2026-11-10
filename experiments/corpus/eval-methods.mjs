// Counts findings already assessed by a reviewer. Runtime observations do not
// create verdicts, and coverage applies only to the supplied evaluation units.
const methods = Object.freeze({
  acceptance: Object.freeze(['met', 'not_met', 'unknown']),
  recovery: Object.freeze(['recovered', 'partial', 'blocked', 'unknown']),
  repetition: Object.freeze(['progress', 'no_progress', 'unknown']),
  sideEffects: Object.freeze(['intended', 'unexpected', 'duplicated', 'unknown']),
  claimSupport: Object.freeze(['supported', 'contradicted', 'unknown']),
});

export const ACCEPTANCE_STATES = methods.acceptance;

export function summarizeEvalFindings(method, findings) {
  if (!Object.hasOwn(methods, method)) throw new Error('Unrecognized evaluation method');
  const outcomes = Object.fromEntries(methods[method].map(state => [state, 0]));
  for (const { status } of findings) {
    if (!Object.hasOwn(outcomes, status)) throw new Error('Unrecognized assessment status for ' + method);
    outcomes[status]++;
  }
  const total = findings.length, known = total - outcomes.unknown;
  return { outcomes, total, known, judgedCoverage: total ? known / total : null };
}
