export const IO_OUTCOMES = ['error', 'abnormal'];

export function validateIoOutcome(view, outcome) {
  if (outcome === undefined) return;
  if (!IO_OUTCOMES.includes(outcome)) throw Error('outcome must be error or abnormal');
  if (view !== 'io') throw Error('outcome is only available for the io view');
}

export function matchesIoOutcome(status, outcome) {
  return outcome === undefined || status === 'error' || (outcome === 'abnormal' && status === 'unknown');
}
