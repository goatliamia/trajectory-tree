// DSH's durable pre-assistant surface is the input anchor. Price the retained
// messages and the effective tool header without using a Context plugin view.
export const requestContextKeys = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'];
export const requestContextSource = 'DSH recorded surface and token-meter estimate';
export const requestContextBasis = 'Estimated retained messages immediately before each recorded assistant response. Tools use the latest request header. Reported input is separate.';

const count = value => Number.isSafeInteger(value) && value >= 0;
const replacement = event => event.surfaceOp && typeof event.surfaceOp === 'object';
const skillSources = new Set(['skill-catalog', 'skill-invocation']);
let sdk;

function loadSdk() {
  return sdk ??= Promise.all([
    import('@deepseek-ai/dsh-session'),
    import('@deepseek-ai/dsh-session/surface'),
    import('@deepseek-ai/dsh-token-meter/estimate'),
  ]).then(([session, surface, meter]) => ({
    canonicalHeader: session.canonicalHeader, foldSurface: surface.foldSurface,
    deriveEventMessage: surface.deriveEventMessage, estimateMessage: meter.estimateMessage,
    estimateToolsTokens: meter.estimateToolsTokens,
  }), () => null);
}

const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function requestUsageEvidence(usage) {
  const input = numeric(usage?.inputTokens) ? usage.inputTokens : null;
  const read = numeric(usage?.cacheReadTokens) ? usage.cacheReadTokens : null;
  const write = numeric(usage?.cacheWriteTokens) ? usage.cacheWriteTokens : null;
  const output = numeric(usage?.outputTokens) ? usage.outputTokens : null;
  const aggregate = numeric(usage?.totalTokens) && output !== null && usage.totalTokens >= output ? usage.totalTokens - output : null;
  const full = input !== null && read !== null && write !== null ? input + read + write : null;
  const knownInput = [input, read, write].filter(n => n !== null).reduce((a, b) => a + b, 0);
  const inconsistent = aggregate !== null && (full !== null ? aggregate !== full : knownInput > aggregate);
  const prompt = inconsistent ? null : aggregate ?? full;
  return { uncachedInputTokens: input, cacheReadTokens: read, cacheWriteTokens: write, outputTokens: output,
    promptTokens: prompt, cacheRate: prompt > 0 && read !== null && read <= prompt ? read / prompt : null,
    available: usage != null, consistent: !inconsistent,
    denominator: inconsistent ? 'inconsistent' : aggregate !== null ? 'reported-total-minus-output' : full !== null ? 'disjoint-input-buckets' : 'unavailable',
    raw: usage || null };
}

function messageCategory(message, tools) {
  const source = message.source;
  if (message.role === 'system') return 'system';
  if (skillSources.has(source?.kind)) return 'skill';
  if (message.role === 'assistant') return 'assistant';
  if (message.role === 'tool') {
    const call = source?.callId ?? message.toolCallId;
    return tools.get(call) === 'skill' && !message.isError ? 'skill' : 'tool';
  }
  return source?.kind === 'user' ? 'user' : 'inject';
}

export function buildRequestContext(events, meter, registeredProjections = []) {
  const requests = [], tools = new Map(), active = new Map(), projectedAt = new Map();
  const buckets = Object.fromEntries(requestContextKeys.map(key => [key, 0]));
  let headerSeq = null, route, pressureTokens, contextWindow;
  const canEstimate = Boolean(meter && events.every((event, index) => event.seq === index));
  // Price each message version at the event that changed it, using the same
  // projection definitions the host uses for its current request surface.
  const projections = registeredProjections.map(projection => ({ type: projection.type, project(event, context) {
    const updates = projection.project(event, context);
    projectedAt.set(event.seq, updates);
    return updates;
  } }));
  const folded = canEstimate ? meter.foldSurface(events, projections) : null;
  const shadowed = new Map((folded?.replacements ?? []).map(row => [row.seq, row.shadowedSeqs]));
  const totals = () => ({ ...buckets, total: requestContextKeys.reduce((sum, key) => sum + buckets[key], 0) });
  const setMessage = (seq, message) => {
    const prior = active.get(seq);
    if (prior) buckets[prior.key] -= prior.tokens;
    const next = message ? { key: messageCategory(message, tools), tokens: meter.estimateMessage(message) } : null;
    if (next) buckets[next.key] += next.tokens;
    active.set(seq, next);
  };

  for (const event of events) {
    const data = event.data ?? {};
    if (event.type === 'request/header' && data.header) {
      headerSeq = event.seq;
      if (canEstimate) buckets.tools = meter.estimateToolsTokens(meter.canonicalHeader(data.header));
    } else if (event.type === 'tool/call' && data.callId != null) {
      tools.set(data.callId, data.name);
    } else if (event.type === 'request/context') {
      if (data.model || data.provider) route = { model: data.model, provider: data.provider, reasoningEffort: data.reasoningEffort };
      contextWindow = count(data.contextWindow) && data.contextWindow > 0 ? data.contextWindow : undefined;
    } else if (event.type === 'model/selection' && (data.model || data.provider)) {
      route = { model: data.model, provider: data.provider, reasoningEffort: data.reasoningEffort };
    }

    if (event.type === 'assistant/message' && !replacement(event) && count(data.turn) && count(data.step)) {
      const input = requestUsageEvidence(data.usage).promptTokens;
      if (input !== null) pressureTokens = input;
      const estimated = canEstimate && headerSeq !== null && event.surfaceOp === 'append';
      requests.push({ seq: event.seq, turn: data.turn, step: data.step, time: event.time,
        headerSeq, reportedInput: input, ...(estimated ? totals() : { total: null }) });
    }
    if (!canEstimate) continue;
    for (const [seq, message] of projectedAt.get(event.seq) ?? []) {
      if (active.has(seq)) setMessage(seq, message);
    }
    if (event.surfaceOp !== 'append' && !replacement(event)) continue;
    for (const seq of shadowed.get(event.seq) ?? []) {
      const prior = active.get(seq);
      if (prior) buckets[prior.key] -= prior.tokens;
      active.delete(seq);
    }
    setMessage(event.seq, meter.deriveEventMessage(event));
  }

  const pressure = pressureTokens === undefined && contextWindow === undefined ? null : { pressureTokens, contextWindow };
  return { requests, route, pressure, current: canEstimate && headerSeq !== null ? totals() : null };
}

export async function readRequestContext(events, signal, projections = []) {
  const meter = await loadSdk();
  if (meter && !projections.some(row => row.type === 'image/offload') && events.some(row => row.type === 'image/offload')) {
    const offload = await import('@deepseek-ai/dsh-compaction-image-offload/projection').catch(() => null);
    if (offload?.imageOffloadProjection) projections = [...projections, offload.imageOffloadProjection];
  }
  signal?.throwIfAborted();
  try { return buildRequestContext(events, meter, projections); }
  catch { return buildRequestContext(events, null); }
}

export function buildRecordedModelTiming(events, { assistantStreamFirstTokenTime, isTokenDelta } = {}) {
  const turns = new Map(), steps = new Map();
  const span = (start, end) => count(start) && count(end) && end >= start ? end - start : null;
  for (const event of events) {
    const { turn, step, stream, chunk } = event.data ?? {};
    const key = turn + ':' + step;
    if (event.type === 'step/start' && count(turn) && count(step)) {
      steps.set(key, { turn, step, start: event.time, first: undefined, response: undefined });
      continue;
    }
    const state = steps.get(key);
    if (!state || replacement(event)) continue;
    if (event.type === 'assistant/live-chunk' && chunk && isTokenDelta?.(chunk)) state.first ??= event.time;
    if (event.type === 'assistant/attempt' || event.type === 'assistant/message') {
      if (Array.isArray(stream)) state.first ??= assistantStreamFirstTokenTime?.(stream);
      if (event.type === 'assistant/message') state.response ??= event.time;
    }
  }
  for (const { turn, step, start, first, response } of steps.values()) {
    if (!turns.has(turn)) turns.set(turn, { turn, steps: [] });
    turns.get(turn).steps.push({ step, ttft: span(start, first), model: span(start, response), decode: span(first, response) });
  }
  return [...turns.values()];
}

export async function readRecordedModelTiming(events, signal) {
  const helpers = await import('@deepseek-ai/dsh-llm').catch(() => undefined);
  signal?.throwIfAborted();
  return buildRecordedModelTiming(events, helpers);
}
