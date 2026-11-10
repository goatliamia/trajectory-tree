const valid = value => Number.isFinite(value) && value >= 0;

// Telemetry can re-emit a response ID. The last observation supplies its settlement.
export function usageSettlements(rows) {
  return [...new Map(rows.map((row, index) => [row.responseId || 'record:' + index, row])).values()];
}

export function usageRow(host, row) {
  const usage = row.usage || {};
  if (host === 'pi' || host === 'claude') {
    const input = ['input', 'cacheRead', 'cacheWrite'].every(key => valid(usage[key]))
      ? usage.input + usage.cacheRead + usage.cacheWrite : null;
    return {
      input,
      uncachedInput: valid(usage.input) ? usage.input : null,
      cachedInput: valid(usage.cacheRead) ? usage.cacheRead : null,
      cacheWrite: valid(usage.cacheWrite) ? usage.cacheWrite : null,
      output: valid(usage.output) ? usage.output : null,
      reportedCost: valid(usage.cost?.total) ? usage.cost.total : null,
    };
  }
  const cached = usage.cached_input_tokens ?? usage.input_tokens_details?.cached_tokens;
  return {
    input: valid(usage.input_tokens) ? usage.input_tokens : null,
    uncachedInput: valid(usage.input_tokens) && valid(cached) && cached <= usage.input_tokens ? usage.input_tokens - cached : null,
    cachedInput: valid(cached) ? cached : null,
    cacheWrite: null,
    output: valid(usage.output_tokens) ? usage.output_tokens : null,
    reportedCost: null,
  };
}
