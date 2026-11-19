export const recordedStepTimingBasis = 'Paired native call intervals clipped to their owning step with observed boundaries. Covered time counts overlapping intervals once.';

function validInterval(start, end) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start;
}

// Only an observed start and result form a duration; a dispatch result alone
// is not a zero-length call. Include all recorded result statuses.
export function callDurationMs(call) {
  return call.startSeq != null && call.resultSeq != null && validInterval(call.start, call.end)
    ? call.end - call.start : null;
}

export function callTimingSummary(calls) {
  const durations = calls.map(callDurationMs).filter(value => value !== null).sort((a, b) => a - b);
  const count = durations.length;
  const percentile = p => count ? durations[Math.ceil(p * count) - 1] : null;
  return { calls: calls.length, pairedCalls: count, missingCalls: calls.length - count,
    coverage: calls.length ? count / calls.length : null,
    cumulativeMs: count ? durations.reduce((a, b) => a + b, 0) : null,
    p50Ms: percentile(0.50), p95Ms: percentile(0.95) };
}

export function intervalUnion(spans) {
  const ordered = spans.filter(([start, end]) => validInterval(start, end)).sort((a, b) => a[0] - b[0]);
  let previousEnd = -Infinity;
  let total = 0;
  for (const [start, end] of ordered) {
    total += Math.max(0, end - Math.max(start, previousEnd));
    previousEnd = Math.max(previousEnd, end);
  }
  return total;
}

function stepTiming(evidence, calls) {
  if (evidence.seq == null) return null;
  const paired = calls.filter(call => call.startSeq != null && call.resultSeq != null && validInterval(call.start, call.end));
  const timing = { calls: calls.length, pairedCalls: paired.length, stepSpanMs: null,
    crossStepCalls: null, cumulativeMs: null, coveredMs: null };
  const { start, end, endSeq } = evidence;
  if (endSeq == null || !validInterval(start, end)) return timing;
  timing.stepSpanMs = end - start;
  timing.crossStepCalls = paired.filter(call => call.start < start || call.end > end).length;
  if (calls.length && !paired.length) return timing;
  const clipped = paired.map(call => [Math.max(call.start, start), Math.min(call.end, end)]).filter(([a, b]) => b >= a);
  timing.cumulativeMs = clipped.reduce((total, [a, b]) => total + (b - a), 0);
  timing.coveredMs = intervalUnion(clipped);
  return timing;
}

export function recordedStepTimings(steps, calls) {
  const key = ({ turn, step }) => turn + ':' + step;
  const byStep = new Map(steps.map(step => [key(step), []]));
  for (const call of calls) byStep.get(key(call))?.push(call);
  return new Map(steps.map(step => [step, stepTiming(step.evidence, byStep.get(key(step)))]));
}
