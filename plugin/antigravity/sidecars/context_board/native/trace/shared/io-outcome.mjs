export const IO_OUTCOMES = ['error', 'abnormal'];
export const TOOL_OUTCOME_BASIS = 'Recorded calls or actions in the selected scope before the outcome filter. Returned means a recorded non-error outcome. Error rate uses only calls with a known outcome.';

export function validateIoOutcome(view, outcome) {
  if (outcome === undefined) return;
  if (!IO_OUTCOMES.includes(outcome)) throw Error('outcome must be error or abnormal');
  if (view !== 'io') throw Error('outcome is only available for the io view');
}

export function matchesIoOutcome(status, outcome) {
  return outcome === undefined || status === 'error' || (outcome === 'abnormal' && status === 'unknown');
}

export function summarizeToolOutcomes(calls) {
  let returned = 0, errors = 0, unknown = 0;
  for (const call of calls) {
    if (call.status === 'returned') returned++;
    else if (call.status === 'error') errors++;
    else unknown++;
  }
  const known = returned + errors;
  return { calls: calls.length, returned, errors, unknown, known,
    outcomeCoverage: calls.length ? known / calls.length : null,
    errorRate: known ? errors / known : null };
}
